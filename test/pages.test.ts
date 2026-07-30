import { describe, expect, it } from "vitest";
import { renderStaffCase, renderStaffList } from "../src/pages";

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
      null,
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
    expect(body).not.toContain("Decline and refund");
  });
});
