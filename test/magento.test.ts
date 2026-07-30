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
