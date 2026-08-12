import { describe, expect, it } from "vitest";
import { renderCustomerUploadPage, renderStaffCase, renderStaffList } from "../src/pages";
import type { VerificationInformationRequest } from "../src/verification";

describe("staff verification queue", () => {
  it("renders a new-tab Magento admin link for each configured case", async () => {
    const response = renderStaffList([
      {
        id: "case-1",
        reviewId: "review-1",
        siteId: "vwu",
        magentoOrderId: 123,
        incrementId: "000123",
        customerEmail: "buyer@example.com",
        status: "awaiting_customer",
        emailStatus: "skipped",
        emailError: null,
        emailSentAt: null,
        documentUploadedAt: null,
        tokenExpiresAt: "2026-08-05T00:00:00.000Z",
        matchedRuleNames: ["Order total >= $150"],
        createdAt: "2026-07-29T00:00:00.000Z",
        updatedAt: "2026-07-29T00:00:00.000Z",
        adminOrderUrl: "https://admin.example.com/sales/order/view/order_id/123/",
        timeZone: "America/Los_Angeles"
      }
    ]);
    const body = await response.text();

    expect(body).toContain('href="https://admin.example.com/sales/order/view/order_id/123/"');
    expect(body).toContain('target="_blank"');
    expect(body).toContain('rel="noopener noreferrer"');
    expect(body).toContain('<time datetime="2026-07-29T00:00:00.000Z"');
    expect(body).toContain("Jul 28, 2026, 5:00 PM PDT");
    expect(body).toContain('title="2026-07-29T00:00:00.000Z (UTC)"');
    expect(body).toContain('<select name="status">');
    expect(body).toContain('<option value="open" selected>Open cases</option>');
    expect(body).toContain('<option value="approved">Approved</option>');
    expect(body).toContain('<option value="pending_review">Pending review</option>');
  });

  it("offers a manual information request for pending military review", async () => {
    const response = renderStaffCase({
      id: "case-military", reviewId: "review-1", siteId: "vwu", magentoOrderId: 123, incrementId: "000123",
      customerEmail: "buyer@example.com", status: "pending_review", emailStatus: "skipped",
      emailError: "Initial verification email suppressed by military-address review policy", emailSentAt: null,
      documentUploadedAt: null, tokenExpiresAt: "2026-08-19T00:00:00Z",
      matchedRuleNames: ["Overseas military shipping address"], createdAt: "2026-08-12T00:00:00Z", updatedAt: "2026-08-12T00:00:00Z"
    }, [], [], { magentoUpdatesEnabled: true, customerEmailEnabled: true });
    const body = await response.text();
    expect(body).toContain("pending_review");
    expect(body).toContain("Request more information");
    expect(body).toContain("military-address review policy");
  });

  it("labels the action Decline and reminds staff to refund manually", async () => {
    const response = renderStaffCase(
      {
        id: "case-1",
        reviewId: "review-1",
        siteId: "vwu",
        magentoOrderId: 123,
        incrementId: "000123",
        customerEmail: "buyer@example.com",
        status: "submitted",
        emailStatus: "sent",
        emailError: null,
        emailSentAt: "2026-07-29T00:00:00.000Z",
        documentUploadedAt: "2026-07-29T00:00:00.000Z",
        tokenExpiresAt: "2026-08-05T00:00:00.000Z",
        matchedRuleNames: ["Order total >= $150"],
        createdAt: "2026-07-29T00:00:00.000Z",
        updatedAt: "2026-07-29T00:00:00.000Z"
      },
      [],
      [],
      { magentoUpdatesEnabled: true, customerEmailEnabled: true },
      "",
      "",
      "https://admin.example.com/sales/order/view/order_id/123/"
    );
    const body = await response.text();

    expect(body).toContain('href="https://admin.example.com/sales/order/view/order_id/123/"');
    expect(body).toContain(">Open in Magento</a>");
    expect(body).toContain('target="_blank"');
    expect(body).toContain("Refund the payment manually in Authorize.net");
    expect(body).toContain(">Decline</button>");
    expect(body).toContain("onsubmit=\"return confirm('");
    expect(body).toContain("You must refund the payment manually in Authorize.net. Continue?");
    expect(body).not.toContain("Decline and refund");
    expect(body).not.toContain("Staff note");
    expect(body).toContain("Request more information");
    expect(body).toContain("ID of the Cardholder");
    expect(body).toContain("Copy of the payment card used (showing the last 4 digits and cardholder&#39;s name)");
    expect(body).toContain("Valid Business or Tobacco License");
    expect(body).not.toContain("Valid Business License");
    expect(body).not.toContain("Valid Tobacco License");
    expect(body).toContain('name="custom_message"');
  });

  it("shows labeled customer uploads and every document and request on the staff case", async () => {
    const informationRequest: VerificationInformationRequest = {
      id: "request-1",
      caseId: "case-1",
      recipient: "buyer@example.com",
      sender: "no-reply@example.com",
      requestedDocumentTypes: ["cardholder_id", "billing_address_proof"],
      customMessage: "Please include both sides.",
      status: "sent" as const,
      messageId: "message-1",
      error: null,
      createdAt: "2026-07-29T00:00:00.000Z",
      sentAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z"
    };
    const customerResponse = renderCustomerUploadPage("000123", "token", "", informationRequest);
    const customerBody = await customerResponse.text();

    expect(customerBody).toContain('name="document:cardholder_id"');
    expect(customerBody).toContain('name="document:billing_address_proof"');
    expect(customerBody).toContain('name="document:additional"');
    expect(customerBody).toContain('action="/verify/token?request=request-1"');
    expect(customerBody).toContain("Please include both sides.");

    const response = renderStaffCase(
      {
        id: "case-1",
        reviewId: "review-1",
        siteId: "vwu",
        magentoOrderId: 123,
        incrementId: "000123",
        customerEmail: "buyer@example.com",
        status: "submitted",
        emailStatus: "sent",
        emailError: null,
        emailSentAt: "2026-07-29T00:00:00.000Z",
        documentUploadedAt: "2026-07-29T00:00:00.000Z",
        tokenExpiresAt: "2026-08-05T00:00:00.000Z",
        matchedRuleNames: [],
        createdAt: "2026-07-29T00:00:00.000Z",
        updatedAt: "2026-07-29T00:00:00.000Z"
      },
      [
        {
          id: "document-1",
          caseId: "case-1",
          r2Key: "case/document-1",
          filename: "id-front.jpg",
          contentType: "image/jpeg",
          size: 100,
          uploadedAt: "2026-07-29T01:00:00.000Z",
          requestId: "request-1",
          documentType: "cardholder_id"
        },
        {
          id: "document-2",
          caseId: "case-1",
          r2Key: "case/document-2",
          filename: "bill.pdf",
          contentType: "application/pdf",
          size: 200,
          uploadedAt: "2026-07-29T01:01:00.000Z",
          requestId: "request-1",
          documentType: "billing_address_proof"
        }
      ],
      [informationRequest],
      { magentoUpdatesEnabled: true, customerEmailEnabled: true }
    );
    const body = await response.text();

    expect(body).toContain("id-front.jpg");
    expect(body).toContain("bill.pdf");
    expect(body).toContain("/staff/cases/case-1/documents/document-1");
    expect(body).toContain("Proof of Billing Address");
    expect(body).toContain("Please include both sides.");
  });
});
