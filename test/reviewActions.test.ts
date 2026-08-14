import { afterEach, describe, expect, it, vi } from "vitest";
import { approveVerificationCase, declineVerificationCase } from "../src/reviewActions";
import type { Env, SiteConfig } from "../src/types";

describe("staff review actions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("blocks staff Magento actions unless the update switch is explicitly enabled", async () => {
    await expect(
      approveVerificationCase(
        { ...env(), MAGENTO_ORDER_UPDATES_ENABLED: "false" },
        site(),
        {
          id: "case-1",
          reviewId: "review-1",
          siteId: "staging",
          magentoOrderId: 1,
          incrementId: "0001",
          customerEmail: "buyer@example.com",
          status: "submitted",
          emailStatus: "skipped",
          emailError: null,
          emailSentAt: null,
          documentUploadedAt: "2026-06-18T12:00:00.000Z",
          tokenExpiresAt: "2026-06-25T12:00:00.000Z",
          matchedRuleNames: [],
          createdAt: "2026-06-18T12:00:00.000Z",
          updatedAt: "2026-06-18T12:00:00.000Z"
        },
        "2026-06-18T12:00:00.000Z"
      )
    ).rejects.toThrow("Magento order updates are disabled");
  });

  it("marks a registered customer verified before recording approval", async () => {
    const responses = [
      orderResponse("holded", 42),
      jsonResponse(true),
      jsonResponse("processing"),
      jsonResponse(true),
      jsonResponse({ id: 42, email: "buyer@example.com", custom_attributes: [{ attribute_code: "loyalty", value: "gold" }] }),
      jsonResponse({ id: 42, email: "buyer@example.com", custom_attributes: [{ attribute_code: "loyalty", value: "gold" }, { attribute_code: "Verified", value: "1" }] })
    ];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(responses.shift()));
    vi.stubGlobal("fetch", fetchMock);
    const database = recordingDb();

    await approveVerificationCase(
      { ...env(), DB: database.db, MAGENTO_ORDER_UPDATES_ENABLED: "true", MAGENTO_TOKEN: "token" },
      site(),
      verificationCase(),
      "2026-06-18T12:00:00.000Z"
    );

    expect(fetchMock.mock.calls.map(([url]) => String(url).replace("https://staging.example.com/rest/V1", ""))).toEqual([
      "/orders/1",
      "/orders/1/unhold",
      "/orders/1/statuses",
      "/orders/1/comments",
      "/customers/42",
      "/customers/42"
    ]);
    expect(fetchMock.mock.calls[5][1]).toEqual(expect.objectContaining({ method: "PUT" }));
    expect(database.bindings).toContainEqual([
      expect.any(String), "case-1", "approve", null, null, null, null,
      "2026-06-18T12:00:00.000Z", "2026-06-18T12:00:00.000Z"
    ]);
    expect(database.bindings).toContainEqual(["approved", "2026-06-18T12:00:00.000Z", "case-1"]);
  });

  it("approves a guest order without updating a customer", async () => {
    const responses = [
      orderResponse("holded"),
      jsonResponse(true),
      jsonResponse("processing"),
      jsonResponse(true)
    ];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(responses.shift()));
    vi.stubGlobal("fetch", fetchMock);

    await approveVerificationCase(
      { ...env(), DB: recordingDb().db, MAGENTO_ORDER_UPDATES_ENABLED: "true", MAGENTO_TOKEN: "token" },
      site(),
      verificationCase(),
      "2026-06-18T12:00:00.000Z"
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/customers/"))).toBe(false);
  });

  it("restores the hold and leaves D1 unchanged when the verified marker update fails", async () => {
    const responses = [
      orderResponse("holded", 42),
      jsonResponse(true),
      jsonResponse("processing"),
      jsonResponse(true),
      jsonResponse({ id: 42, email: "buyer@example.com", custom_attributes: [] }),
      new Response(JSON.stringify({ message: "customer save failed" }), { status: 500 }),
      jsonResponse(true)
    ];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(responses.shift()));
    vi.stubGlobal("fetch", fetchMock);
    const database = recordingDb();

    await expect(approveVerificationCase(
      { ...env(), DB: database.db, MAGENTO_ORDER_UPDATES_ENABLED: "true", MAGENTO_TOKEN: "token" },
      site(),
      verificationCase(),
      "2026-06-18T12:00:00.000Z"
    )).rejects.toThrow("Failed to mark Magento customer verified");

    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe("https://staging.example.com/rest/V1/orders/1/hold");
    expect(database.bindings).toEqual([]);
  });

  it("creates a credit memo, cancels when necessary, and records the decline", async () => {
    const responses = [
      orderResponse("holded"),
      jsonResponse(true),
      jsonResponse({ items: [{ entity_id: 161, state: 2 }] }),
      jsonResponse(987),
      jsonResponse("processing"),
      jsonResponse(true),
      jsonResponse("canceled")
    ];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(responses.shift()));
    vi.stubGlobal("fetch", fetchMock);
    const database = recordingDb();

    await declineVerificationCase(
      { ...env(), DB: database.db, MAGENTO_ORDER_UPDATES_ENABLED: "true", MAGENTO_TOKEN: "token" },
      site(),
      verificationCase(),
      "2026-06-18T12:00:00.000Z"
    );

    expect(fetchMock.mock.calls.map(([url]) => String(url).replace("https://staging.example.com/rest/V1", ""))).toEqual([
      "/orders/1",
      "/orders/1/unhold",
      expect.stringMatching(/^\/invoices\?/),
      "/invoice/161/refund",
      "/orders/1/statuses",
      "/orders/1/cancel",
      "/orders/1/statuses"
    ]);
    expect(database.bindings[0]).toEqual([
      expect.any(String), "case-1", "decline", null, 987, null, null,
      "2026-06-18T12:00:00.000Z", "2026-06-18T12:00:00.000Z"
    ]);
    expect(database.bindings).toContainEqual(["declined", "2026-06-18T12:00:00.000Z", "case-1"]);
  });

  it("restores the hold when Magento rejects credit-memo creation", async () => {
    const responses = [
      orderResponse("holded"),
      jsonResponse(true),
      jsonResponse({ items: [{ entity_id: 161, state: 2 }] }),
      new Response(JSON.stringify({ message: "refund observer failed" }), { status: 500 }),
      jsonResponse(true)
    ];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(responses.shift()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(declineVerificationCase(
      { ...env(), DB: recordingDb().db, MAGENTO_ORDER_UPDATES_ENABLED: "true", MAGENTO_TOKEN: "token" },
      site(),
      verificationCase(),
      "2026-06-18T12:00:00.000Z"
    )).rejects.toThrow("refund observer failed");

    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe("https://staging.example.com/rest/V1/orders/1/hold");
  });
});

function verificationCase() {
  return {
    id: "case-1", reviewId: "review-1", siteId: "staging", magentoOrderId: 1,
    incrementId: "0001", customerEmail: "buyer@example.com", status: "submitted" as const,
    emailStatus: "skipped" as const, emailError: null, emailSentAt: null,
    documentUploadedAt: "2026-06-18T12:00:00.000Z", tokenExpiresAt: "2026-06-25T12:00:00.000Z",
    matchedRuleNames: [], createdAt: "2026-06-18T12:00:00.000Z", updatedAt: "2026-06-18T12:00:00.000Z"
  };
}

function orderResponse(status: string, customerId?: number): Response {
  return jsonResponse({
    entity_id: 1, status, customer_id: customerId, base_shipping_invoiced: 17.99,
    items: [{ item_id: 3274, qty_invoiced: 1, qty_refunded: 0 }]
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

function recordingDb(): { db: D1Database; bindings: unknown[][] } {
  const bindings: unknown[][] = [];
  const db = {
    prepare: vi.fn(() => ({
      bind: vi.fn((...values: unknown[]) => {
        bindings.push(values);
        return { run: vi.fn().mockResolvedValue({ success: true }) };
      })
    }))
  } as unknown as D1Database;
  return { db, bindings };
}

function site(): SiteConfig {
  return {
    id: "staging",
    name: "Staging Magento",
    baseUrl: "https://staging.example.com",
    accessTokenEnv: "MAGENTO_TOKEN",
    enabled: true,
    paymentFingerprintPaths: []
  };
}

function env(): Env {
  return {
    DB: {} as D1Database,
    FRAUD_SCAN_WORKFLOW: {} as Workflow,
    MAGENTO_SITES_JSON: "[]"
  };
}
