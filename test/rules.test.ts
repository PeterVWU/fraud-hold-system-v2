import { describe, expect, it, vi } from "vitest";
import { evaluateFraudRules } from "../src/ruleEngine";
import type { Env, MagentoOrder, OrderSignal, SiteConfig } from "../src/types";

const site: SiteConfig = {
  id: "main",
  name: "Main",
  baseUrl: "https://magento.example.com",
  storeCode: "default",
  accessTokenEnv: "MAGENTO_TOKEN",
  enabled: true,
  paymentFingerprintPaths: ["payment.additional_information.card_fingerprint"],
  holdThreshold: 2
};

const baseOrder: MagentoOrder = {
  entity_id: 123,
  increment_id: "100000123",
  created_at: "2026-06-18T10:00:00.000Z",
  status: "pending",
  customer_id: 10,
  customer_email: "buyer@example.com",
  grand_total: 50,
  total_qty_ordered: 1,
  remote_ip: "203.0.113.10",
  billing_address: {
    firstname: "Jane",
    lastname: "Buyer",
    street: ["10 Main St"],
    city: "Los Angeles",
    region_code: "CA",
    postcode: "90001",
    country_id: "US",
    telephone: "555-100-2000"
  },
  extension_attributes: {
    customer_created_at: "2026-06-01T00:00:00.000Z",
    shipping_assignments: [
      {
        shipping: {
          address: {
            firstname: "Jane",
            lastname: "Buyer",
            street: ["10 Main St"],
            city: "Los Angeles",
            region_code: "CA",
            postcode: "90001",
            country_id: "US",
            telephone: "555-100-2000"
          }
        }
      }
    ]
  }
};

const signal: OrderSignal = {
  customerKeyHash: "customer",
  customerEmailHash: "email",
  remoteIp: "203.0.113.10",
  billingNameNorm: "jane buyer",
  paymentFingerprintHash: "payment",
  grandTotal: 50,
  totalQty: 1
};

describe("fraud rule engine", () => {
  it("allows an order when fewer than two non-required rules match", async () => {
    const db = fakeDb({ recentCount: 0, differentPaymentOrBilling: false });
    const decision = await evaluateFraudRules(env(), site, baseOrder, { db, now: new Date(), signal, customer: null });

    expect(decision.decision).toBe("allow");
    expect(decision.matchedCount).toBe(0);
  });

  it("holds an order when two configured rules match", async () => {
    const db = fakeDb({ recentCount: 0, differentPaymentOrBilling: false });
    const order: MagentoOrder = {
      ...baseOrder,
      grand_total: 175,
      total_qty_ordered: 12
    };
    const decision = await evaluateFraudRules(env(), site, order, {
      db,
      now: new Date(),
      customer: null,
      signal: { ...signal, grandTotal: 175, totalQty: 12 }
    });

    expect(decision.decision).toBe("hold");
    expect(decision.matchedCount).toBe(2);
    expect(decision.ruleResults.filter((result) => result.matched).map((result) => result.ruleId)).toEqual([
      "order_total_gte_150",
      "total_quantity_gte_10"
    ]);
  });

  it("detects billing and shipping mismatches", async () => {
    const db = fakeDb({ recentCount: 0, differentPaymentOrBilling: false });
    const order: MagentoOrder = {
      ...baseOrder,
      extension_attributes: {
        ...baseOrder.extension_attributes,
        shipping_assignments: [
          {
            shipping: {
              address: {
                firstname: "John",
                lastname: "Receiver",
                street: ["99 Other St"],
                city: "Phoenix",
                region_code: "AZ",
                postcode: "85001",
                country_id: "US",
                telephone: "555-999-8888"
              }
            }
          }
        ]
      }
    };

    const decision = await evaluateFraudRules(env(), site, order, { db, now: new Date(), signal, customer: null });
    const matched = decision.ruleResults.filter((result) => result.matched).map((result) => result.ruleId);

    expect(matched).toContain("billing_shipping_address_mismatch");
    expect(matched).toContain("billing_shipping_phone_mismatch");
    expect(matched).toContain("billing_shipping_name_mismatch");
    expect(decision.decision).toBe("hold");
  });

  it("uses persisted signals for velocity and payment/billing history rules", async () => {
    const db = fakeDb({ recentCount: 1, differentPaymentOrBilling: true });
    const decision = await evaluateFraudRules(env(), site, baseOrder, { db, now: new Date(), signal, customer: null });
    const matched = decision.ruleResults.filter((result) => result.matched).map((result) => result.ruleId);

    expect(matched).toContain("velocity_customer_or_ip_1h");
    expect(matched).toContain("multiple_cards_or_billing_names_same_day");
    expect(decision.decision).toBe("hold");
  });

  it("detects account age from fetched Magento customer data", async () => {
    const db = fakeDb({ recentCount: 0, differentPaymentOrBilling: false });
    const decision = await evaluateFraudRules(env(), site, baseOrder, {
      db,
      now: new Date(),
      signal,
      customer: { id: 10, created_at: "2026-06-18 00:00:00" }
    });

    const accountAge = decision.ruleResults.find((result) => result.ruleId === "account_age_under_24h");
    expect(accountAge?.matched).toBe(true);
  });
});

function env(): Env {
  return {
    DB: fakeDb({ recentCount: 0, differentPaymentOrBilling: false }),
    FRAUD_SCAN_WORKFLOW: { create: vi.fn() },
    MAGENTO_SITES_JSON: "[]",
    DEFAULT_HOLD_THRESHOLD: "2"
  } as unknown as Env;
}

function fakeDb(options: { recentCount: number; differentPaymentOrBilling: boolean }): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes("COUNT(*) AS count") && sql.includes("remote_ip")) {
                return { count: options.recentCount };
              }
              if (sql.includes("payment_fingerprint_hash")) {
                return { count: options.differentPaymentOrBilling ? 1 : 0 };
              }
              return { count: 0 };
            }
          };
        }
      };
    }
  } as unknown as D1Database;
}
