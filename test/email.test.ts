import { describe, expect, it, vi } from "vitest";
import {
  renderInformationRequestEmailHtml,
  renderInformationRequestEmailText,
  renderVerificationEmailHtml,
  renderVerificationEmailText,
  sendInformationRequestEmail,
  sendVerificationEmail
} from "../src/email";
import type { Env, MagentoOrder, SiteConfig } from "../src/types";

describe("verification email", () => {
  it("lists all initial requirements in plain text before the secure link", () => {
    const text = renderVerificationEmailText(site(), order(), "https://example.com/verify/token");

    expect(text).toContain("temporarily placed this order on hold");
    const expected = [
      "Proof of billing and shipping address",
      "Payment card showing only the last four digits and cardholder’s name",
      "Government-issued photo ID",
      "Selfie of the cardholder holding the ID"
    ];
    for (const requirement of expected) expect(text).toContain(`- ${requirement}`);
    expect(text.indexOf(expected[3])).toBeLessThan(text.indexOf("https://example.com/verify/token"));
    expect(text).toContain("Upload your documents");
    expect(text).toContain("submit the documents");
    expect(text).not.toContain("one document");
    expect(text).toContain("000009001");
  });

  it("lists all initial requirements in HTML before the plural upload button", () => {
    const html = renderVerificationEmailHtml(site(), order(), "https://example.com/verify/token");
    const expected = [
      "Proof of billing and shipping address",
      "Payment card showing only the last four digits and cardholder’s name",
      "Government-issued photo ID",
      "Selfie of the cardholder holding the ID"
    ];
    for (const requirement of expected) expect(html).toContain(`<li>${requirement}</li>`);
    expect(html.indexOf(expected[3])).toBeLessThan(html.indexOf(">Upload documents</a>"));
    expect(html).toContain("submit the documents");
    expect(html).not.toContain("Upload document</a>");
    expect(html).toContain("000009001");
    expect(html).toContain("https://example.com/verify/token");
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

  it("renders selected document requests, custom text, and the secure link", () => {
    const text = renderInformationRequestEmailText(
      site(),
      order(),
      "https://example.com/verify/token",
      ["cardholder_id", "shipping_address_proof"],
      "Please make sure the address is readable."
    );
    const html = renderInformationRequestEmailHtml(
      site(),
      order(),
      "https://example.com/verify/token",
      ["cardholder_id", "shipping_address_proof"],
      "Use <both> pages."
    );

    expect(text).toContain("ID of the Cardholder");
    expect(text).toContain("Proof of Shipping Address");
    expect(text).toContain("Please make sure the address is readable.");
    expect(text).toContain("https://example.com/verify/token");
    expect(html).toContain("Use &lt;both&gt; pages.");
    expect(html).not.toContain("Use <both> pages.");
  });

  it("records a failed information request without reporting it as sent", async () => {
    const bindings: unknown[][] = [];
    const statement = {
      bind: (...values: unknown[]) => {
        bindings.push(values);
        return statement;
      },
      run: vi.fn().mockResolvedValue({})
    };
    const env = {
      DB: {
        prepare: vi.fn(() => statement),
        batch: vi.fn().mockResolvedValue([])
      } as unknown as D1Database,
      FRAUD_SCAN_WORKFLOW: {} as Workflow,
      MAGENTO_SITES_JSON: "[]",
      CUSTOMER_EMAIL_ENABLED: "true",
      EMAIL: { send: vi.fn().mockRejectedValue(new Error("provider unavailable")) }
    } as Env;

    const result = await sendInformationRequestEmail(
      env,
      { ...site(), verificationEmailFrom: "no-reply@example.com" },
      { ...order(), customer_email: "buyer@example.com" },
      verificationCase(),
      "new-token",
      "https://example.com/staff/cases/case-1",
      ["cardholder_id"],
      "Please send a clear image.",
      "2026-06-18T12:00:00.000Z"
    );

    expect(result).toEqual({ sent: false, error: "provider unavailable" });
    expect(bindings.flat()).toContain('["cardholder_id"]');
    expect(bindings.flat()).toContain("Please send a clear image.");
    expect(bindings.flat()).toContain("failed");
    expect(bindings.flat()).toContain("provider unavailable");
  });

  it("sends an information request with the requested documents and fresh link", async () => {
    const bindings: unknown[][] = [];
    const statement = {
      bind: (...values: unknown[]) => {
        bindings.push(values);
        return statement;
      },
      run: vi.fn().mockResolvedValue({})
    };
    const send = vi.fn().mockResolvedValue({ messageId: "message-2" });
    const env = {
      DB: {
        prepare: vi.fn(() => statement),
        batch: vi.fn().mockResolvedValue([])
      } as unknown as D1Database,
      FRAUD_SCAN_WORKFLOW: {} as Workflow,
      MAGENTO_SITES_JSON: "[]",
      CUSTOMER_EMAIL_ENABLED: "true",
      EMAIL: { send }
    } as Env;

    const result = await sendInformationRequestEmail(
      env,
      { ...site(), verificationEmailFrom: "no-reply@example.com" },
      { ...order(), customer_email: "buyer@example.com" },
      verificationCase(),
      "new-token",
      "https://example.com/staff/cases/case-1",
      ["payment_card", "business_or_tobacco_license"],
      null,
      "2026-06-18T12:00:00.000Z"
    );

    expect(result).toEqual({ sent: true, error: null });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: "buyer@example.com",
      subject: "More information needed for order 000009001",
      text: expect.stringContaining("https://example.com/verify/new-token")
    }));
    expect(send.mock.calls[0][0].text).toContain("Copy of the payment card used (showing the last 4 digits and cardholder's name)");
    expect(send.mock.calls[0][0].text).toContain("Valid Business or Tobacco License");
    expect(bindings.flat()).toContain("message-2");
    expect(bindings.flat()).toContain("sent");
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

function verificationCase() {
  return {
    id: "case-1",
    reviewId: "review-1",
    siteId: "staging",
    magentoOrderId: 9001,
    incrementId: "000009001",
    customerEmail: "buyer@example.com",
    status: "awaiting_customer" as const,
    emailStatus: "sent" as const,
    emailError: null,
    emailSentAt: "2026-06-18T11:00:00.000Z",
    documentUploadedAt: null,
    tokenExpiresAt: "2026-06-25T12:00:00.000Z",
    matchedRuleNames: [],
    createdAt: "2026-06-18T11:00:00.000Z",
    updatedAt: "2026-06-18T11:00:00.000Z"
  };
}
