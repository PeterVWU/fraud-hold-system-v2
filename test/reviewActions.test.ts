import { describe, expect, it } from "vitest";
import { approveVerificationCase } from "../src/reviewActions";
import type { Env, SiteConfig } from "../src/types";

describe("staff review actions", () => {
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
        null,
        "2026-06-18T12:00:00.000Z"
      )
    ).rejects.toThrow("Magento order updates are disabled");
  });
});

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
