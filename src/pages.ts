import type { VerificationCase, VerificationDocument } from "./verification";

export function html(body: string, status = 200, headers: HeadersInit = {}): Response {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fraud Verification</title>${style()}</head><body>${body}</body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...headers }
  });
}

export function renderCustomerUploadPage(orderLabel: string, token: string, message = ""): Response {
  return html(`<main class="shell narrow">
<h1>Upload verification document</h1>
${message ? `<p class="notice">${escapeHtml(message)}</p>` : ""}
<p>Order ${escapeHtml(orderLabel)} is temporarily on hold while our staff verifies the document you submit.</p>
<form method="post" action="/verify/${encodeURIComponent(token)}" enctype="multipart/form-data">
<label>Document <input required type="file" name="document" accept="image/jpeg,image/png,image/webp,application/pdf"></label>
<button type="submit">Submit document</button>
</form>
</main>`);
}

export function renderStaffLogin(error = ""): Response {
  return html(`<main class="shell narrow">
<h1>Staff login</h1>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/staff/login">
<label>Password <input required type="password" name="password" autocomplete="current-password"></label>
<button type="submit">Log in</button>
</form>
</main>`);
}

export function renderStaffList(cases: Array<VerificationCase & { adminOrderUrl: string | null }>): Response {
  const rows = cases
    .map(
      (item) => `<tr><td><a href="/staff/cases/${item.id}">${escapeHtml(item.incrementId ?? String(item.magentoOrderId))}</a></td><td>${item.adminOrderUrl ? `<a href="${escapeHtml(item.adminOrderUrl)}" target="_blank" rel="noopener noreferrer">Open in Magento</a>` : "Not configured"}</td><td>${escapeHtml(item.siteId)}</td><td>${escapeHtml(item.status)}</td><td>${renderRuleList(item.matchedRuleNames)}</td><td>${escapeHtml(item.emailStatus)}</td><td>${escapeHtml(item.customerEmail ?? "")}</td><td>${escapeHtml(item.updatedAt)}</td></tr>`
    )
    .join("");
  return html(`<main class="shell">
<form method="post" action="/staff/logout" class="top"><button type="submit">Log out</button></form>
<h1>Verification queue</h1>
<table><thead><tr><th>Order</th><th>Magento</th><th>Site</th><th>Status</th><th>Flagged because</th><th>Email</th><th>Customer</th><th>Updated</th></tr></thead><tbody>${rows || "<tr><td colspan=\"8\">No cases need staff attention.</td></tr>"}</tbody></table>
</main>`);
}

export function renderStaffCase(
  item: VerificationCase,
  document: VerificationDocument | null,
  capabilities: { magentoUpdatesEnabled: boolean; customerEmailEnabled: boolean },
  error = "",
  success = "",
  adminOrderUrl: string | null = null
): Response {
  const magentoNotice = capabilities.magentoUpdatesEnabled
    ? ""
    : '<p class="notice">Test mode: Magento order updates are disabled.</p>';
  const emailNotice = capabilities.customerEmailEnabled
    ? ""
    : '<p class="notice">Test mode: customer email delivery is disabled.</p>';
  return html(`<main class="shell">
<p><a href="/staff">Back to queue</a></p>
<h1>Order ${escapeHtml(item.incrementId ?? String(item.magentoOrderId))}</h1>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
${success ? `<p class="notice">${escapeHtml(success)}</p>` : ""}
${magentoNotice}${emailNotice}
<dl>
<dt>Site</dt><dd>${escapeHtml(item.siteId)}</dd>
<dt>Magento order</dt><dd>${adminOrderUrl ? `<a href="${escapeHtml(adminOrderUrl)}" target="_blank" rel="noopener noreferrer">Open in Magento</a>` : "Admin link not configured"}</dd>
<dt>Status</dt><dd>${escapeHtml(item.status)}</dd>
<dt>Email status</dt><dd>${escapeHtml(item.emailStatus)} ${item.emailError ? escapeHtml(item.emailError) : ""}</dd>
<dt>Customer</dt><dd>${escapeHtml(item.customerEmail ?? "")}</dd>
<dt>Flagged because</dt><dd>${renderRuleList(item.matchedRuleNames)}</dd>
</dl>
<section><h2>Document</h2>${document ? `<p><a href="/staff/cases/${item.id}/document" target="_blank">${escapeHtml(document.filename)}</a> (${escapeHtml(document.contentType)}, ${document.size} bytes)</p>` : "<p>No document uploaded yet.</p>"}</section>
${capabilities.customerEmailEnabled ? "" : `<form method="post" action="/staff/cases/${item.id}/open-test-link"><button type="submit">Open customer upload page</button></form>`}
<form method="post" action="/staff/cases/${item.id}/resend-email"><button type="submit" ${capabilities.customerEmailEnabled ? "" : "disabled"}>Resend email</button></form>
${["approved", "declined"].includes(item.status)
    ? `<p class="notice">This case is ${escapeHtml(item.status)}. No further order action is available.</p>`
    : `<form method="post" action="/staff/cases/${item.id}/approve"><label>Staff note <textarea name="note"></textarea></label><button type="submit" ${capabilities.magentoUpdatesEnabled ? "" : "disabled"}>Approve</button></form>
<form method="post" action="/staff/cases/${item.id}/decline"><p class="warning"><strong>Reminder:</strong> Declining creates a Magento credit memo and closes or cancels the order. Refund the payment manually in Authorize.net.</p><label>Staff note <textarea name="note"></textarea></label><button class="danger" type="submit" ${capabilities.magentoUpdatesEnabled ? "" : "disabled"}>Decline</button></form>`}
</main>`);
}

function renderRuleList(ruleNames: string[]): string {
  return ruleNames.length > 0
    ? `<ul class="rules">${ruleNames.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>`
    : "No matched-rule details recorded.";
}

export function redirect(location: string, headers: HeadersInit = {}): Response {
  return new Response(null, { status: 303, headers: { Location: location, ...headers } });
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function style(): string {
  return `<style>
body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#172033;background:#f6f7f9}
.shell{max-width:1000px;margin:0 auto;padding:32px}.narrow{max-width:560px}
h1{font-size:26px;margin:0 0 18px}h2{font-size:18px;margin-top:28px}
form{margin:18px 0;display:grid;gap:12px}label{display:grid;gap:6px;font-weight:600}
input,textarea{font:inherit;padding:10px;border:1px solid #b9c0ca;border-radius:6px;background:#fff}
textarea{min-height:80px}button{width:max-content;padding:10px 14px;border:0;border-radius:6px;background:#0f766e;color:#fff;font-weight:700;cursor:pointer}.danger{background:#b42318}
button:disabled{background:#98a2b3;cursor:not-allowed}
table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:10px;border-bottom:1px solid #e0e4ea;text-align:left}.error{padding:10px;background:#fee4e2;color:#912018}.notice{padding:10px;background:#d1fadf;color:#054f31}.top{display:flex;justify-content:flex-end}
.warning{padding:10px;background:#fff4ce;color:#7a4e00;border:1px solid #e6b800;border-radius:6px}
dl{display:grid;grid-template-columns:140px 1fr;gap:8px;background:#fff;padding:16px}
.rules{margin:0;padding-left:18px;min-width:190px}.rules li+li{margin-top:4px}
</style>`;
}
