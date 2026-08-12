import { describe, expect, it, vi } from "vitest";
import { countRecentRelatedOrders, hasDifferentPaymentOrBillingToday } from "../src/db";
import type { OrderSignal } from "../src/types";

const signal: OrderSignal = {
  customerKeyHash: "customer",
  customerEmailHash: "email",
  remoteIp: "203.0.113.1",
  billingNameNorm: "peter test",
  paymentFingerprintHash: "card",
  grandTotal: 200,
  totalQty: 1
};

describe("order signal time comparisons", () => {
  it("normalizes Magento and ISO timestamps for velocity queries", async () => {
    const prepare = vi.fn(() => ({ bind: () => ({ first: vi.fn().mockResolvedValue({ count: 1 }) }) }));
    await countRecentRelatedOrders({ prepare } as unknown as D1Database, "staging", signal, "2026-08-12T14:00:00.000Z");
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("datetime(order_created_at) >= datetime(?)"));
  });

  it("normalizes Magento and ISO timestamps for daily payment and billing queries", async () => {
    const prepare = vi.fn(() => ({ bind: () => ({ first: vi.fn().mockResolvedValue({ count: 1 }) }) }));
    await hasDifferentPaymentOrBillingToday({ prepare } as unknown as D1Database, "staging", signal, "2026-08-12T00:00:00.000Z");
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("datetime(order_created_at) >= datetime(?)"));
  });
});
