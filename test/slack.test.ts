import { afterEach, describe, expect, it, vi } from "vitest";
import { sendSlackHoldAlert } from "../src/slack";
import type { FraudDecision, MagentoOrder, SiteConfig } from "../src/types";

describe("Slack alerts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts a hold alert to Slack Web API when bot token and channel are configured", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await sendSlackHoldAlert(
      { botToken: "xoxb-test", channelId: "C0BBH9RE3GV", webhookUrl: "https://hooks.slack.test/services/example" },
      site(),
      order(),
      decision()
    );

    expect(result).toEqual({ attempted: true, succeeded: true, error: null });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer xoxb-test" });
    expect(String(init?.body)).toContain("C0BBH9RE3GV");
    expect(String(init?.body)).toContain("Order: 000000265");
    expect(String(init?.body)).toContain("Order total >= $150");
    expect(String(init?.body)).toContain(
      "Magento admin: <https://as.vapewholesaleusa.com/admin_N7zuJfehzDnf/sales/order/view/order_id/265/|Open order>"
    );
  });

  it("returns Slack API errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "not_in_channel" }), { status: 200 })
    );

    const result = await sendSlackHoldAlert({ botToken: "xoxb-test", channelId: "C0BBH9RE3GV" }, site(), order(), decision());

    expect(result).toEqual({ attempted: true, succeeded: false, error: "Slack API error: not_in_channel" });
  });

  it("falls back to webhook when no bot token is configured", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));

    const result = await sendSlackHoldAlert(
      { webhookUrl: "https://hooks.slack.test/services/example" },
      site(),
      order(),
      decision()
    );

    expect(result).toEqual({ attempted: true, succeeded: true, error: null });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toContain("Order: 000000265");
    expect(String(init?.body)).toContain("Order total >= $150");
    expect(String(init?.body)).toContain(
      "Magento admin: <https://as.vapewholesaleusa.com/admin_N7zuJfehzDnf/sales/order/view/order_id/265/|Open order>"
    );
  });

  it("skips cleanly when no webhook is configured", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await sendSlackHoldAlert({}, site(), order(), decision());

    expect(result).toEqual({ attempted: false, succeeded: false, error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function site(): SiteConfig {
  return {
    id: "staging",
    name: "Staging Magento",
    baseUrl: "https://staging.example.com",
    adminBaseUrl: "https://as.vapewholesaleusa.com/admin_N7zuJfehzDnf",
    accessTokenEnv: "MAGENTO_TOKEN",
    enabled: true,
    paymentFingerprintPaths: []
  };
}

function order(): MagentoOrder {
  return {
    entity_id: 265,
    increment_id: "000000265",
    created_at: "2026-06-16 12:41:29"
  };
}

function decision(): FraudDecision {
  return {
    decision: "hold",
    holdThreshold: 2,
    matchedCount: 2,
    requiredMatchedCount: 0,
    ruleResults: [
      {
        ruleId: "order_total_gte_150",
        ruleName: "Order total >= $150",
        matched: true,
        required: false,
        evidence: {}
      }
    ]
  };
}
