import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, MagentoOrder, SiteConfig } from "../src/types";

vi.mock("../src/db", () => ({
  createReview: vi.fn().mockResolvedValue(true),
  createRunLog: vi.fn().mockResolvedValue("run-1"),
  finishRunLog: vi.fn().mockResolvedValue(undefined),
  getSiteCursor: vi.fn().mockResolvedValue({ lastSuccessCreatedAt: null, lastSuccessOrderId: null }),
  getReviewSummary: vi.fn().mockResolvedValue(null),
  markHoldAlreadySatisfied: vi.fn().mockResolvedValue(undefined),
  markHoldNotAttempted: vi.fn().mockResolvedValue(undefined),
  markHoldResult: vi.fn().mockResolvedValue(undefined),
  markHoldSkipped: vi.fn().mockResolvedValue(undefined),
  markSlackResult: vi.fn().mockResolvedValue(undefined),
  recordOrderSignal: vi.fn().mockResolvedValue(undefined),
  updateSiteCursor: vi.fn().mockResolvedValue(undefined),
  countRecentRelatedOrders: vi.fn().mockResolvedValue(0),
  hasDifferentPaymentOrBillingToday: vi.fn().mockResolvedValue(false)
}));

vi.mock("../src/slack", () => ({
  sendSlackHoldAlert: vi.fn().mockResolvedValue({ attempted: true, succeeded: true, error: null })
}));

vi.mock("../src/verification", () => ({
  createVerificationCaseForHold: vi.fn().mockResolvedValue({
    verificationCase: { id: "case-1", incrementId: "000009001", magentoOrderId: 9001, customerEmail: "buyer@example.com" },
    token: "token-1",
    created: true
  })
}));

vi.mock("../src/email", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined)
}));

import { getSiteCursor, markHoldNotAttempted, markHoldResult, markHoldSkipped, markSlackResult } from "../src/db";
import { sendVerificationEmail } from "../src/email";
import { getScanStart, reviewOrder } from "../src/scanner";
import { sendSlackHoldAlert } from "../src/slack";
import { createVerificationCaseForHold } from "../src/verification";

describe("scanner hold notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a Slack message after a successful Magento hold", async () => {
    const client = {
      listOrders: vi.fn(),
      getOrder: vi.fn(),
      getCustomer: vi.fn().mockResolvedValue({ id: 10, created_at: "2026-01-01 00:00:00" }),
      countCompletedOrders: vi.fn().mockResolvedValue(0),
      holdOrder: vi.fn().mockResolvedValue(true),
      unholdOrder: vi.fn(),
      getOrderStatus: vi.fn().mockResolvedValue("holded"),
      addOrderComment: vi.fn().mockResolvedValue(true),
      cancelOrder: vi.fn(),
      listInvoices: vi.fn(),
      refundInvoiceOffline: vi.fn()
    };
    const stats = { pagesFetched: 0, ordersEvaluated: 0, holdsAttempted: 0, holdsSucceeded: 0 };

    await reviewOrder(env(), site(), client, suspiciousOrder(), new Date("2026-06-18T12:00:00Z"), stats);

    expect(client.holdOrder).toHaveBeenCalledWith(9001);
    expect(client.addOrderComment).toHaveBeenCalledOnce();
    expect(markHoldResult).toHaveBeenCalledWith(expect.anything(), expect.any(String), true, "holded", null, "live");
    expect(sendSlackHoldAlert).toHaveBeenCalledWith(
      {
        webhookUrl: undefined,
        botToken: "xoxb-test",
        channelId: "C0BBH9RE3GV"
      },
      expect.objectContaining({
        id: "staging",
        adminBaseUrl: "https://as.vapewholesaleusa.com/admin_N7zuJfehzDnf"
      }),
      expect.objectContaining({ entity_id: 9001 }),
      expect.objectContaining({ decision: "hold", matchedCount: 2 })
    );
    expect(markSlackResult).toHaveBeenCalledWith(expect.anything(), expect.any(String), true, null);
    expect(createVerificationCaseForHold).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "staging" }),
      expect.objectContaining({ entity_id: 9001 }),
      expect.any(String),
      expect.any(String)
    );
    expect(sendVerificationEmail).toHaveBeenCalledOnce();
    expect(stats).toMatchObject({ ordersEvaluated: 1, holdsAttempted: 1, holdsSucceeded: 1 });
  });

  it("does not call Magento hold for completed suspicious orders", async () => {
    const client = {
      listOrders: vi.fn(),
      getOrder: vi.fn(),
      getCustomer: vi.fn().mockResolvedValue({ id: 10, created_at: "2026-01-01 00:00:00" }),
      countCompletedOrders: vi.fn().mockResolvedValue(0),
      holdOrder: vi.fn(),
      unholdOrder: vi.fn(),
      getOrderStatus: vi.fn(),
      addOrderComment: vi.fn(),
      cancelOrder: vi.fn(),
      listInvoices: vi.fn(),
      refundInvoiceOffline: vi.fn()
    };
    const stats = { pagesFetched: 0, ordersEvaluated: 0, holdsAttempted: 0, holdsSucceeded: 0 };
    const order = { ...suspiciousOrder(), status: "complete" };

    await reviewOrder(env(), site(), client, order, new Date("2026-06-18T12:00:00Z"), stats);

    expect(client.holdOrder).not.toHaveBeenCalled();
    expect(sendSlackHoldAlert).not.toHaveBeenCalled();
    expect(markHoldNotAttempted).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "complete",
      "status complete is not holdable",
      "live"
    );
    expect(stats).toMatchObject({ ordersEvaluated: 1, holdsAttempted: 0, holdsSucceeded: 0 });
  });

  it("creates a test verification case without updating Magento or sending Slack", async () => {
    const client = {
      listOrders: vi.fn(),
      getOrder: vi.fn(),
      getCustomer: vi.fn().mockResolvedValue({ id: 10, created_at: "2026-01-01 00:00:00" }),
      countCompletedOrders: vi.fn().mockResolvedValue(0),
      holdOrder: vi.fn(),
      unholdOrder: vi.fn(),
      getOrderStatus: vi.fn(),
      addOrderComment: vi.fn(),
      cancelOrder: vi.fn(),
      listInvoices: vi.fn(),
      refundInvoiceOffline: vi.fn()
    };
    const stats = { pagesFetched: 0, ordersEvaluated: 0, holdsAttempted: 0, holdsSucceeded: 0 };
    const testEnv = {
      ...env(),
      MAGENTO_ORDER_UPDATES_ENABLED: "false",
      CUSTOMER_EMAIL_ENABLED: "false"
    };

    await reviewOrder(testEnv, site(), client, suspiciousOrder(), new Date("2026-06-18T12:00:00Z"), stats);

    expect(client.holdOrder).not.toHaveBeenCalled();
    expect(client.addOrderComment).not.toHaveBeenCalled();
    expect(sendSlackHoldAlert).not.toHaveBeenCalled();
    expect(markHoldSkipped).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "pending",
      "dry run: Magento hold skipped"
    );
    expect(createVerificationCaseForHold).toHaveBeenCalledOnce();
    expect(sendVerificationEmail).toHaveBeenCalledOnce();
    expect(stats).toMatchObject({ ordersEvaluated: 1, holdsAttempted: 0, holdsSucceeded: 0 });
  });
});

describe("scanner interval window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses only the configured scan interval when no cursor exists", async () => {
    vi.mocked(getSiteCursor).mockResolvedValueOnce({ lastSuccessCreatedAt: null, lastSuccessOrderId: null });

    const scanStart = await getScanStart(
      {} as D1Database,
      { ...site(), scanIntervalMinutes: 5, cursorOverlapMinutes: 0 },
      new Date("2026-06-18T12:00:00Z")
    );

    expect(scanStart).toBe("2026-06-18 11:55:00");
  });

  it("uses the saved cursor after a successful run", async () => {
    vi.mocked(getSiteCursor).mockResolvedValueOnce({
      lastSuccessCreatedAt: "2026-06-18 11:58:00",
      lastSuccessOrderId: 9002
    });

    const scanStart = await getScanStart(
      {} as D1Database,
      { ...site(), scanIntervalMinutes: 5, cursorOverlapMinutes: 0 },
      new Date("2026-06-18T12:00:00Z")
    );

    expect(scanStart).toBe("2026-06-18 11:58:00");
  });
});

function env(): Env {
  return {
    DB: {} as D1Database,
    FRAUD_SCAN_WORKFLOW: { create: vi.fn(), get: vi.fn(), createBatch: vi.fn() },
    MAGENTO_SITES_JSON: "[]",
    DEFAULT_HOLD_THRESHOLD: "2",
    HOLD_ACTION_MODE: "live",
    MAGENTO_ORDER_UPDATES_ENABLED: "true",
    CUSTOMER_EMAIL_ENABLED: "true",
    SLACK_BOT_TOKEN: "xoxb-test",
    SLACK_CHANNEL_ID: "C0BBH9RE3GV"
  };
}

function site(): SiteConfig {
  return {
    id: "staging",
    name: "Staging Magento",
    baseUrl: "https://staging.vapewholesaleusa.com",
    adminBaseUrl: "https://as.vapewholesaleusa.com/admin_N7zuJfehzDnf",
    storeCode: "default",
    accessTokenEnv: "MAGENTO_MAIN_ACCESS_TOKEN",
    enabled: true,
    paymentFingerprintPaths: ["payment.cc_last4"],
    holdThreshold: 2
  };
}

function suspiciousOrder(): MagentoOrder {
  return {
    entity_id: 9001,
    increment_id: "000009001",
    created_at: "2026-06-18 11:30:00",
    status: "pending",
    customer_id: 10,
    customer_email: "buyer@example.com",
    grand_total: 200,
    total_qty_ordered: 12,
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
      shipping_assignments: [
        {
          shipping: {
            address: {
              firstname: "Jane",
              lastname: "Buyer",
              street: ["99 Other St"],
              city: "Los Angeles",
              region_code: "CA",
              postcode: "90001",
              country_id: "US",
              telephone: "555-100-2000"
            }
          }
        }
      ]
    },
    payment: { cc_last4: "4242" }
  };
}
