import { getInformationRequestLabel, INFORMATION_REQUEST_OPTIONS } from "./informationRequests";
import type {
  VerificationCase,
  VerificationDocument,
  VerificationInformationRequest,
  StaffCaseStatusFilter
} from "./verification";

export function html(body: string, status = 200, headers: HeadersInit = {}): Response {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fraud Verification</title>${style()}</head><body>${body}</body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...headers }
  });
}

export function renderCustomerUploadPage(
  orderLabel: string,
  token: string,
  message = "",
  informationRequest: VerificationInformationRequest | null = null
): Response {
  const uploadAction = `/verify/${encodeURIComponent(token)}${informationRequest ? `?request=${encodeURIComponent(informationRequest.id)}` : ""}`;
  const requestedFields = informationRequest
    ? informationRequest.requestedDocumentTypes.length
      ? informationRequest.requestedDocumentTypes.map((type) => `<label>${escapeHtml(getInformationRequestLabel(type))}<input required type="file" multiple name="document:${type}" accept="image/jpeg,image/png,image/webp,application/pdf"></label>`).join("")
      : '<label>Requested document <input required type="file" multiple name="document:additional" accept="image/jpeg,image/png,image/webp,application/pdf"></label>'
    : '<label>Document <input required type="file" multiple name="document" accept="image/jpeg,image/png,image/webp,application/pdf"></label>';
  return html(`<main class="shell narrow">
<h1>Upload verification documents</h1>
${message ? `<p class="notice">${escapeHtml(message)}</p>` : ""}
<p>Order ${escapeHtml(orderLabel)} is temporarily on hold while our staff verifies the documents you submit.</p>
${informationRequest?.customMessage ? `<section><h2>Message from our team</h2><p class="preserve-lines">${escapeHtml(informationRequest.customMessage)}</p></section>` : ""}
${informationRequest?.requestedDocumentTypes.length ? `<section><h2>Requested documents</h2><ul>${informationRequest.requestedDocumentTypes.map((type) => `<li>${escapeHtml(getInformationRequestLabel(type))}</li>`).join("")}</ul></section>` : ""}
<form method="post" action="${uploadAction}" enctype="multipart/form-data">
${requestedFields}
${informationRequest?.requestedDocumentTypes.length ? '<label>Additional documents (optional)<input type="file" multiple name="document:additional" accept="image/jpeg,image/png,image/webp,application/pdf"></label>' : ""}
<button type="submit">Submit documents</button>
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

export function renderStaffList(
  cases: Array<VerificationCase & { adminOrderUrl: string | null; timeZone?: string }>,
  statusFilter: StaffCaseStatusFilter = "open"
): Response {
  const rows = cases
    .map(
      (item) => `<tr><td><a href="/staff/cases/${item.id}">${escapeHtml(item.incrementId ?? String(item.magentoOrderId))}</a></td><td>${item.adminOrderUrl ? `<a href="${escapeHtml(item.adminOrderUrl)}" target="_blank" rel="noopener noreferrer">Open in Magento</a>` : "Not configured"}</td><td>${escapeHtml(item.siteId)}</td><td>${escapeHtml(item.status)}</td><td>${renderRuleList(item.matchedRuleNames)}</td><td>${escapeHtml(item.emailStatus)}</td><td>${escapeHtml(item.customerEmail ?? "")}</td><td>${renderDateTime(item.updatedAt, item.timeZone)}</td></tr>`
    )
    .join("");
  return html(`<main class="shell">
<form method="post" action="/staff/logout" class="top"><button type="submit">Log out</button></form>
<h1>Verification queue</h1>
<form method="get" action="/staff" class="filters">
<label>Status <select name="status">${renderStatusOptions(statusFilter)}</select></label>
<button type="submit">Filter</button>
</form>
<table><thead><tr><th>Order</th><th>Magento</th><th>Site</th><th>Status</th><th>Flagged because</th><th>Email</th><th>Customer</th><th>Updated</th></tr></thead><tbody>${rows || "<tr><td colspan=\"8\">No cases need staff attention.</td></tr>"}</tbody></table>
</main>`);
}

function renderStatusOptions(selected: StaffCaseStatusFilter): string {
  const options: Array<{ value: StaffCaseStatusFilter; label: string }> = [
    { value: "open", label: "Open cases" },
    { value: "pending_review", label: "Pending review" },
    { value: "awaiting_customer", label: "Awaiting customer" },
    { value: "submitted", label: "Submitted" },
    { value: "action_failed", label: "Action failed" },
    { value: "approved", label: "Approved" },
    { value: "declined", label: "Declined" },
    { value: "all", label: "All cases" }
  ];
  return options.map((option) => `<option value="${option.value}"${option.value === selected ? " selected" : ""}>${option.label}</option>`).join("");
}

export function renderStaffCase(
  item: VerificationCase,
  documents: VerificationDocument[],
  informationRequests: VerificationInformationRequest[],
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
<section><h2>Documents</h2>${renderDocuments(item.id, documents, informationRequests)}</section>
<section><h2>Information request history</h2>${renderInformationRequestHistory(informationRequests)}</section>
${capabilities.customerEmailEnabled ? "" : `<form method="post" action="/staff/cases/${item.id}/open-test-link"><button type="submit">Open customer upload page</button></form>`}
${["pending_review", "awaiting_customer", "submitted"].includes(item.status) ? renderInformationRequestForm(item.id, capabilities.customerEmailEnabled) : ""}
${["approved", "declined"].includes(item.status)
    ? `<p class="notice">This case is ${escapeHtml(item.status)}. No further order action is available.</p>`
    : `<form method="post" action="/staff/cases/${item.id}/approve"><button type="submit" ${capabilities.magentoUpdatesEnabled ? "" : "disabled"}>Approve</button></form>
<form method="post" action="/staff/cases/${item.id}/decline" onsubmit="return confirm('This creates a Magento credit memo and closes or cancels the order. You must refund the payment manually in Authorize.net. Continue?')"><p class="warning"><strong>Reminder:</strong> Declining creates a Magento credit memo and closes or cancels the order. Refund the payment manually in Authorize.net.</p><button class="danger" type="submit" ${capabilities.magentoUpdatesEnabled ? "" : "disabled"}>Decline</button></form>`}
</main>`);
}

function renderInformationRequestForm(caseId: string, customerEmailEnabled: boolean): string {
  const options = INFORMATION_REQUEST_OPTIONS.map((option) => `<label class="check"><input type="checkbox" name="requested_document" value="${option.id}"> ${escapeHtml(option.label)}</label>`).join("");
  return `<section><h2>Request more information</h2>
<form method="post" action="/staff/cases/${caseId}/request-information">
<fieldset><legend>Default document requests</legend>${options}</fieldset>
<label>Custom message (optional)<textarea name="custom_message" maxlength="2000"></textarea></label>
<p>Select at least one document or enter a custom message.</p>
<button type="submit" ${customerEmailEnabled ? "" : "disabled"}>Send email to customer</button>
</form></section>`;
}

function renderDocuments(
  caseId: string,
  documents: VerificationDocument[],
  informationRequests: VerificationInformationRequest[]
): string {
  if (documents.length === 0) {
    return "<p>No documents uploaded yet.</p>";
  }
  const requestById = new Map(informationRequests.map((request) => [request.id, request]));
  const groups = new Map<string, VerificationDocument[]>();
  for (const document of documents) {
    const key = document.requestId && requestById.has(document.requestId) ? document.requestId : "legacy";
    groups.set(key, [...(groups.get(key) ?? []), document]);
  }
  return Array.from(groups.entries()).map(([requestId, groupedDocuments]) => {
    const request = requestById.get(requestId);
    const heading = request ? `Information request from ${renderDateTime(request.createdAt)}` : "Original verification uploads";
    return `<div class="document-group"><h3>${heading}</h3><ul class="documents">${groupedDocuments.map((document) => {
    const label = document.documentType === "additional"
      ? "Additional document"
      : document.documentType
        ? getInformationRequestLabel(document.documentType)
        : "Verification document";
    return `<li><strong>${escapeHtml(label)}:</strong> <a href="/staff/cases/${caseId}/documents/${document.id}" target="_blank" rel="noopener noreferrer">${escapeHtml(document.filename)}</a> (${escapeHtml(document.contentType)}, ${document.size} bytes; ${renderDateTime(document.uploadedAt)})</li>`;
    }).join("")}</ul></div>`;
  }).join("");
}

function renderInformationRequestHistory(requests: VerificationInformationRequest[]): string {
  if (requests.length === 0) {
    return "<p>No additional information has been requested.</p>";
  }
  return `<ol class="history">${requests.map((request) => `<li>
<p><strong>${escapeHtml(request.status)}</strong> to ${escapeHtml(request.recipient ?? "No customer email")} at ${renderDateTime(request.createdAt)}</p>
${request.requestedDocumentTypes.length ? `<ul>${request.requestedDocumentTypes.map((type) => `<li>${escapeHtml(getInformationRequestLabel(type))}</li>`).join("")}</ul>` : ""}
${request.customMessage ? `<p class="preserve-lines">${escapeHtml(request.customMessage)}</p>` : ""}
${request.error ? `<p class="error">${escapeHtml(request.error)}</p>` : ""}
</li>`).join("")}</ol>`;
}

function renderRuleList(ruleNames: string[]): string {
  return ruleNames.length > 0
    ? `<ul class="rules">${ruleNames.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>`
    : "No matched-rule details recorded.";
}

function renderDateTime(value: string, timeZone = "UTC"): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return escapeHtml(value);
  }

  const effectiveTimeZone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const display = new Intl.DateTimeFormat("en-US", {
    timeZone: effectiveTimeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
  const utc = date.toISOString();
  return `<time datetime="${escapeHtml(utc)}" title="${escapeHtml(`${utc} (UTC)`)}">${escapeHtml(display)}</time>`;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
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
h1{font-size:26px;margin:0 0 18px}h2{font-size:18px;margin-top:28px}h3{font-size:15px;margin:16px 0 8px}
form{margin:18px 0;display:grid;gap:12px}label{display:grid;gap:6px;font-weight:600}
input,textarea,select{font:inherit;padding:10px;border:1px solid #b9c0ca;border-radius:6px;background:#fff}
textarea{min-height:80px}button{width:max-content;padding:10px 14px;border:0;border-radius:6px;background:#0f766e;color:#fff;font-weight:700;cursor:pointer}.danger{background:#b42318}
button:disabled{background:#98a2b3;cursor:not-allowed}
table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:10px;border-bottom:1px solid #e0e4ea;text-align:left}.error{padding:10px;background:#fee4e2;color:#912018}.notice{padding:10px;background:#d1fadf;color:#054f31}.top{display:flex;justify-content:flex-end}
.warning{padding:10px;background:#fff4ce;color:#7a4e00;border:1px solid #e6b800;border-radius:6px}
dl{display:grid;grid-template-columns:140px 1fr;gap:8px;background:#fff;padding:16px}
.rules{margin:0;padding-left:18px;min-width:190px}.rules li+li{margin-top:4px}
fieldset{display:grid;gap:8px;border:1px solid #d0d5dd;border-radius:6px;padding:12px}.check{display:flex;grid-template-columns:none;align-items:center;gap:8px;font-weight:400}.check input{padding:0}.documents li+li,.history>li+li{margin-top:10px}.preserve-lines{white-space:pre-wrap}
.filters{display:flex;align-items:end}.filters label{min-width:220px}
</style>`;
}
