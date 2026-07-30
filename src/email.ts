import type { Env, MagentoOrder, SiteConfig } from "./types";
import { isCustomerEmailEnabled } from "./config";
import { recordEmailAttempt, type VerificationCase } from "./verification";

export async function sendVerificationEmail(
  env: Env,
  site: SiteConfig,
  order: MagentoOrder,
  verificationCase: VerificationCase,
  token: string,
  requestUrl: string,
  now: string
): Promise<void> {
  const sender = site.verificationEmailFrom;
  const recipient = order.customer_email ?? verificationCase.customerEmail;
  if (!isCustomerEmailEnabled(env)) {
    await recordEmailAttempt(env.DB, {
      caseId: verificationCase.id,
      recipient: recipient ?? null,
      sender: sender ?? "unconfigured",
      messageId: null,
      error: "disabled by CUSTOMER_EMAIL_ENABLED",
      attemptedAt: now,
      skipped: true
    });
    return;
  }
  if (!sender) {
    await recordEmailAttempt(env.DB, {
      caseId: verificationCase.id,
      recipient: recipient ?? null,
      sender: "unconfigured",
      messageId: null,
      error: "verificationEmailFrom is not configured for site",
      attemptedAt: now
    });
    return;
  }
  if (!recipient) {
    await recordEmailAttempt(env.DB, {
      caseId: verificationCase.id,
      recipient: null,
      sender,
      messageId: null,
      error: "order has no customer email",
      attemptedAt: now
    });
    return;
  }
  if (!env.EMAIL) {
    await recordEmailAttempt(env.DB, {
      caseId: verificationCase.id,
      recipient,
      sender,
      messageId: null,
      error: "EMAIL binding is not configured",
      attemptedAt: now
    });
    return;
  }

  const magicLink = new URL(`/verify/${encodeURIComponent(token)}`, requestUrl).toString();
  const subject = `Action needed for order ${order.increment_id ?? verificationCase.incrementId ?? verificationCase.magentoOrderId}`;
  const text = renderVerificationEmailText(site, order, magicLink);
  const html = renderVerificationEmailHtml(site, order, magicLink);

  try {
    const result = await env.EMAIL.send({
      to: recipient,
      from: sender,
      replyTo: site.verificationEmailReplyTo,
      subject,
      text,
      html
    });
    await recordEmailAttempt(env.DB, {
      caseId: verificationCase.id,
      recipient,
      sender,
      messageId: result.messageId,
      error: null,
      attemptedAt: now
    });
  } catch (error) {
    await recordEmailAttempt(env.DB, {
      caseId: verificationCase.id,
      recipient,
      sender,
      messageId: null,
      error: errorToString(error),
      attemptedAt: now
    });
  }
}

export async function sendVerificationTestEmail(
  env: Env,
  site: SiteConfig,
  order: MagentoOrder,
  verificationCase: VerificationCase,
  token: string,
  requestUrl: string,
  recipient: string
): Promise<string> {
  const sender = env.TEST_EMAIL_FROM ?? site.verificationEmailFrom;
  if (!sender) {
    throw new Error("verificationEmailFrom is not configured for site");
  }
  if (!env.EMAIL) {
    throw new Error("EMAIL binding is not configured");
  }

  const magicLink = new URL(`/verify/${encodeURIComponent(token)}`, requestUrl).toString();
  const orderNumber = order.increment_id ?? verificationCase.incrementId ?? verificationCase.magentoOrderId;
  const testIntro = "TEST EMAIL — no Magento order was changed and the original customer was not contacted.";
  const result = await env.EMAIL.send({
    to: recipient,
    from: sender,
    replyTo: site.verificationEmailReplyTo,
    subject: `[TEST] Verification email preview for order ${orderNumber}`,
    text: `${testIntro}\n\n${renderVerificationEmailText(site, order, magicLink)}`,
    html: `<div style="padding:12px;background:#fff4ce;border:1px solid #e6b800;font-family:Arial,sans-serif"><strong>${escapeHtml(testIntro)}</strong></div>${renderVerificationEmailHtml(site, order, magicLink)}`
  });
  return result.messageId;
}

export function renderVerificationEmailText(site: SiteConfig, order: MagentoOrder, magicLink: string): string {
  const orderNumber = order.increment_id ?? String(order.entity_id);
  return [
    `We need to verify order ${orderNumber}.`,
    "",
    `For customer protection, ${site.name} temporarily placed this order on hold while our team reviews verification documents.`,
    "",
    "Please upload one document using this secure link:",
    magicLink,
    "",
    "After you submit the document, our staff will review it and either release the order for processing or cancel/refund it if verification is declined.",
    "",
    "If you did not place this order, please contact us by replying to this email."
  ].join("\n");
}

export function renderVerificationEmailHtml(site: SiteConfig, order: MagentoOrder, magicLink: string): string {
  const escapedLink = escapeHtml(magicLink);
  const orderNumber = escapeHtml(order.increment_id ?? String(order.entity_id));
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033;line-height:1.5">
<h1 style="font-size:20px">Verification needed for order ${orderNumber}</h1>
<p>For customer protection, ${escapeHtml(site.name)} temporarily placed this order on hold while our team reviews verification documents.</p>
<p>Please upload one document using this secure link:</p>
<p><a href="${escapedLink}" style="display:inline-block;background:#0f766e;color:white;padding:10px 14px;text-decoration:none;border-radius:6px">Upload document</a></p>
<p>If the button does not work, open this link: <br><a href="${escapedLink}">${escapedLink}</a></p>
<p>After you submit the document, our staff will review it and either release the order for processing or cancel/refund it if verification is declined.</p>
<p>If you did not place this order, please contact us by replying to this email.</p>
</body></html>`;
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string): string {
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
