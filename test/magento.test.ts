import { afterEach, describe, expect, it, vi } from "vitest";
import { createMagentoClient } from "../src/magento";
import type { SiteConfig } from "../src/types";

describe("Magento request headers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds a configured site-auth header to Magento requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createMagentoClient(site(), "magento-token", {
      "x-vwu-agent-auth": "site-auth-secret"
    });
    await client.listOrders({
      createdAtGte: "2026-07-29 00:00:00",
      pageSize: 50,
      currentPage: 1
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/rest/default/V1/orders?"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer magento-token",
          "x-vwu-agent-auth": "site-auth-secret"
        })
      })
    );
  });

  it("retries a GET once when Cloudflare returns a managed challenge", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("<title>Just a moment...</title>", {
        status: 403,
        headers: { "Content-Type": "text/html" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ entity_id: 161, state: 2 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createMagentoClient(site(), "magento-token", {
      "x-vwu-agent-auth": "site-auth-secret"
    });

    await expect(client.listInvoices(450200)).resolves.toEqual([{ entity_id: 161, state: 2 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ "x-vwu-agent-auth": "site-auth-secret" })
    }));
  });

  it("fetches the oldest completed order and total count before the current order", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [{ entity_id: 1, created_at: "2024-01-15 12:00:00" }],
          total_count: 12
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createMagentoClient(site(), "magento-token");
    const history = await client.getCompletedOrderHistory(42, "2026-07-30 09:00:00");

    expect(history).toEqual({
      totalCount: 12,
      oldestCompletedOrderCreatedAt: "2024-01-15 12:00:00"
    });
    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.searchParams.get("searchCriteria[filterGroups][0][filters][0][field]")).toBe("customer_id");
    expect(requestUrl.searchParams.get("searchCriteria[filterGroups][0][filters][0][value]")).toBe("42");
    expect(requestUrl.searchParams.get("searchCriteria[filterGroups][1][filters][0][field]")).toBe("status");
    expect(requestUrl.searchParams.get("searchCriteria[filterGroups][1][filters][0][value]")).toBe("complete");
    expect(requestUrl.searchParams.get("searchCriteria[filterGroups][2][filters][0][field]")).toBe("created_at");
    expect(requestUrl.searchParams.get("searchCriteria[filterGroups][2][filters][0][conditionType]")).toBe("lt");
    expect(requestUrl.searchParams.get("searchCriteria[sortOrders][0][field]")).toBe("created_at");
    expect(requestUrl.searchParams.get("searchCriteria[sortOrders][0][direction]")).toBe("ASC");
    expect(requestUrl.searchParams.get("searchCriteria[pageSize]")).toBe("1");
  });

  it("creates an offline invoice credit memo without asking the payment gateway to refund", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify("987"), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createMagentoClient(site(), "magento-token");
    await expect(client.refundInvoiceOffline(161, {
      items: [{ order_item_id: 3274, qty: 1 }],
      shippingAmount: 17.99,
      comment: "Fraud verification declined."
    })).resolves.toBe(987);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/rest/default/V1/invoice/161/refund");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      items: [{ order_item_id: 3274, qty: 1 }],
      isOnline: false,
      notify: false,
      appendComment: true,
      comment: { comment: "Fraud verification declined.", is_visible_on_front: 0 },
      arguments: {
        shipping_amount: 17.99,
        extension_attributes: { amstorecredit_base_amount: 0 }
      }
    });
  });
});

function site(): SiteConfig {
  return {
    id: "vwu",
    name: "vapewholesaleusa.com",
    baseUrl: "https://example.com",
    storeCode: "default",
    accessTokenEnv: "MAGENTO_TOKEN",
    enabled: true,
    paymentFingerprintPaths: []
  };
}
