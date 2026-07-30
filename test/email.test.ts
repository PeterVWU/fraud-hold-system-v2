import { describe, expect, it, vi } from "vitest";
import { renderVerificationEmailText, sendVerificationEmail } from "../src/email";
import type { Env, MagentoOrder, SiteConfig } from "../src/types";

describe("verification email", () => {
  it("explains why the order is held and includes the magic link", () => {
    const text = renderVerificationEmailText(site(), order(), "https://example.com/verify/token");

    expect(text).toContain("temporarily placed this order on hold");
    expect(text).toContain("upload one document");
    expect(text).toContain("https://example.com/verify/token");
    expect(text).toContain("000009001");
  });

  it("records a skipped attempt without calling the email binding when delivery is disabled", async () => {
    const bindings: unknown[][] = [];
    const statement = {
      bind: (...values: unknown[]) => {
        bindings.push(values);
        return statement;
      }
    };
    const emailSend = vi.fn();
    const env = {
      DB: {
        prepare: vi.fn(() => statement),
        batch: vi.fn().mockResolvedValue([])
      } as unknown as D1Database,
      FRAUD_SCAN_WORKFLOW: {} as Workflow,
      MAGENTO_SITES_JSON: "[]",
      CUSTOMER_EMAIL_ENABLED: "false",
      EMAIL: { send: emailSend }
    } as Env;

    await sendVerificationEmail(
      env,
      { ...site(), verificationEmailFrom: "no-reply@example.com" },
      { ...order(), customer_email: "buyer@example.com" },
      {
        id: "case-1",
        reviewId: "review-1",
        siteId: "staging",
        magentoOrderId: 9001,
        incrementId: "000009001",
        customerEmail: "buyer@example.com",
        status: "awaiting_customer",
        emailStatus: "not_sent",
        emailError: null,
        emailSentAt: null,
        documentUploadedAt: null,
        tokenExpiresAt: "2026-06-25T12:00:00.000Z",
        matchedRuleNames: [],
        createdAt: "2026-06-18T12:00:00.000Z",
        updatedAt: "2026-06-18T12:00:00.000Z"
      },
      "token",
      "https://example.com",
      "2026-06-18T12:00:00.000Z"
    );

    expect(emailSend).not.toHaveBeenCalled();
    expect(bindings.flat()).toContain("disabled by CUSTOMER_EMAIL_ENABLED");
    expect(bindings.flat()).toContain("skipped");
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

function order(): MagentoOrder {
  return {
    entity_id: 9001,
    increment_id: "000009001",
    created_at: "2026-06-18 11:30:00"
  };
}
