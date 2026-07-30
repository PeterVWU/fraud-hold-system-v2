import {
  countRecentRelatedOrders,
  hasDifferentPaymentOrBillingToday
} from "./db";
import {
  getByPath,
  getShippingAddress,
  normalizeAddress,
  normalizeWhitespace,
  parseMagentoDateMs,
  parseNumber
} from "./normalizers";
import type { FraudRule, MagentoCustomer, MagentoOrder, RuleContext } from "./types";
import { stateForUsZip } from "./zipState";

export const INITIAL_RULES: FraudRule[] = [
  {
    id: "billing_shipping_address_mismatch",
    name: "Billing/shipping address mismatch",
    enabled: true,
    required: false,
    async evaluate(order, context) {
      const billing = normalizeAddress(order.billing_address);
      const shipping = normalizeAddress(getShippingAddress(order));
      const comparable = Boolean(billing && shipping);
      const addressMismatch = comparable && billing !== shipping;
      const completedOrderCount = addressMismatch
        ? await (context.getCompletedOrderCount?.() ?? Promise.resolve(0))
        : 0;
      const establishedCustomer = completedOrderCount >= 10;
      return {
        matched: addressMismatch && !establishedCustomer,
        evidence: { billing, shipping, comparable, addressMismatch, completedOrderCount, establishedCustomer }
      };
    }
  },
  {
    id: "account_age_under_24h",
    name: "Account age under 24 hours",
    enabled: true,
    required: false,
    async evaluate(order, context) {
      const accountCreatedAt = findCustomerCreatedAt(order, context.customer);
      if (!accountCreatedAt) {
        return { matched: false, evidence: { reason: "customer_created_at unavailable" } };
      }

      const accountCreatedMs = Date.parse(accountCreatedAt);
      const orderCreatedMs = parseMagentoDateMs(order.created_at);
      if (!Number.isFinite(accountCreatedMs) || !Number.isFinite(orderCreatedMs)) {
        return { matched: false, evidence: { accountCreatedAt, reason: "invalid date" } };
      }

      const ageHours = (orderCreatedMs - accountCreatedMs) / 3_600_000;
      return {
        matched: ageHours >= 0 && ageHours < 24,
        evidence: { accountCreatedAt, ageHours }
      };
    }
  },
  {
    id: "velocity_customer_or_ip_1h",
    name: "2+ orders from same customer or IP within 1 hour",
    enabled: true,
    required: false,
    async evaluate(order, context) {
      const since = new Date(parseMagentoDateMs(order.created_at) - 3_600_000).toISOString();
      const previousCount = await countRecentRelatedOrders(context.db, context.site.id, context.signal, since);
      return {
        matched: previousCount >= 1,
        evidence: { previousCount, since, customerKnown: Boolean(context.signal.customerKeyHash), ip: context.signal.remoteIp }
      };
    }
  },
  {
    id: "order_total_gte_150",
    name: "Order total >= $150",
    enabled: true,
    required: false,
    async evaluate(order) {
      const grandTotal = parseNumber(order.grand_total);
      return {
        matched: grandTotal >= 150,
        evidence: { grandTotal, threshold: 150 }
      };
    }
  },
  {
    id: "zip_state_mismatch",
    name: "ZIP does not match state",
    enabled: true,
    required: false,
    async evaluate(order) {
      const address = order.billing_address;
      if (normalizeWhitespace(address?.country_id).toUpperCase() !== "US") {
        return { matched: false, evidence: { reason: "non-US or missing country" } };
      }

      const expectedState = stateForUsZip(address?.postcode);
      const actualState = normalizeWhitespace(address?.region_code ?? address?.region).toUpperCase();
      const comparable = Boolean(expectedState && actualState);
      return {
        matched: comparable && expectedState !== actualState,
        evidence: { postcode: address?.postcode ?? null, expectedState, actualState, comparable }
      };
    }
  },
  {
    id: "multiple_cards_or_billing_names_same_day",
    name: "Customer used multiple cards or billing names in same day",
    enabled: true,
    required: false,
    async evaluate(order, context) {
      const dayStart = startOfUtcDay(order.created_at);
      const matched = await hasDifferentPaymentOrBillingToday(context.db, context.site.id, context.signal, dayStart);
      return {
        matched,
        evidence: {
          dayStart,
          hasPaymentFingerprint: Boolean(context.signal.paymentFingerprintHash),
          billingName: context.signal.billingNameNorm
        }
      };
    }
  }
];

export function findCustomerCreatedAt(order: MagentoOrder, customer: MagentoCustomer | null = null): string | null {
  if (typeof customer?.created_at === "string" && customer.created_at.trim()) {
    return customer.created_at;
  }

  const candidatePaths = [
    "customer_created_at",
    "extension_attributes.customer_created_at",
    "extension_attributes.customer.created_at"
  ];

  for (const path of candidatePaths) {
    const value = getByPath(order, path);
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  const customAttributes = order.custom_attributes;
  if (Array.isArray(customAttributes)) {
    const attr = customAttributes.find((item) => item?.attribute_code === "customer_created_at");
    if (typeof attr?.value === "string") {
      return attr.value;
    }
  }

  return null;
}

function startOfUtcDay(date: string): string {
  const parsed = new Date(date);
  const parsedMs = parseMagentoDateMs(date);
  if (Number.isNaN(parsedMs)) {
    return new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
  }
  return `${new Date(parsedMs).toISOString().slice(0, 10)}T00:00:00.000Z`;
}
