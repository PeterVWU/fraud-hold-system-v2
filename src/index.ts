import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { sendVerificationEmail, sendVerificationTestEmail } from "./email";
import {
  getCustomerHistoryExemptionMonths,
  isCustomerEmailEnabled,
  isFraudScanEnabled,
  isMagentoOrderUpdatesEnabled
} from "./config";
import { buildMagentoAdminOrderUrl } from "./magentoAdmin";
import { html, redirect, renderCustomerUploadPage, renderStaffCase, renderStaffList, renderStaffLogin } from "./pages";
import { approveVerificationCase, declineVerificationCase } from "./reviewActions";
import { scanAllSites, scanLatestOrdersAllSites } from "./scanner";
import { clearStaffSessionCookie, createStaffSessionCookie, isStaffRequest } from "./staffAuth";
import type { Env } from "./types";
import {
  fetchCaseMagentoOrder,
  getLastDeclineAction,
  getSiteForCase,
  getVerificationCaseByToken,
  getVerificationCaseDetail,
  listStaffCases,
  recordAction,
  recordDocumentUpload,
  rotateVerificationToken,
  updateCaseStatus
} from "./verification";

export class FraudScanWorkflow extends WorkflowEntrypoint<Env> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<void> {
    if (!isFraudScanEnabled(this.env)) {
      console.log("Fraud scan Workflow skipped because FRAUD_SCAN_ENABLED is not true");
      return;
    }
    const scheduledTime = getScheduledTime(event);
    await step.do("scan all Magento sites", { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" } }, async () => {
      await scanAllSites(this.env, scheduledTime);
    });
  }
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!isFraudScanEnabled(env)) {
      console.log("Scheduled fraud scan skipped because FRAUD_SCAN_ENABLED is not true");
      return;
    }
    ctx.waitUntil(
      env.FRAUD_SCAN_WORKFLOW.create({
        params: {
          triggeredBy: "cron",
          scheduledTime: controller.scheduledTime
        }
      })
    );
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, ...getCapabilities(env) });
    }

    if (url.pathname === "/run" && request.method === "POST") {
      const configuredSecretName = env.MANUAL_RUN_TOKEN_ENV ?? "MANUAL_RUN_TOKEN";
      const expectedToken = env[configuredSecretName];
      const actualToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

      if (typeof expectedToken !== "string" || actualToken !== expectedToken) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      if (!isFraudScanEnabled(env)) {
        return Response.json({ error: "fraud scanning is disabled by FRAUD_SCAN_ENABLED" }, { status: 409 });
      }

      if (env.LOCAL_RUN_DIRECT === "true") {
        const stats = await scanAllSites(env, new Date());
        return Response.json({ ok: true, mode: "direct", stats });
      }

      await env.FRAUD_SCAN_WORKFLOW.create({ params: { triggeredBy: "manual" } });
      return Response.json({ ok: true, mode: "workflow" });
    }

    if (url.pathname === "/run-latest" && request.method === "POST") {
      const authorizationError = authorizeManualRun(request, env);
      if (authorizationError) {
        return authorizationError;
      }
      if (!isFraudScanEnabled(env)) {
        return Response.json({ error: "fraud scanning is disabled by FRAUD_SCAN_ENABLED" }, { status: 409 });
      }
      const requestedSiteId = url.searchParams.get("site")?.trim() || undefined;
      if ((!requestedSiteId && isMagentoOrderUpdatesEnabled(env)) || isCustomerEmailEnabled(env)) {
        return Response.json(
          { error: "run-latest requires one explicit site when Magento updates are enabled; customer email must be disabled" },
          { status: 409 }
        );
      }
      const requestedLimit = Number(url.searchParams.get("limit") ?? "50");
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
        return Response.json({ error: "limit must be an integer from 1 to 100" }, { status: 400 });
      }
      const requestedPage = Number(url.searchParams.get("page") ?? "1");
      if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > 20) {
        return Response.json({ error: "page must be an integer from 1 to 20" }, { status: 400 });
      }
      const includeDisabled = url.searchParams.get("stores") === "all";
      const stats = await scanLatestOrdersAllSites(
        env,
        requestedLimit,
        requestedPage,
        new Date(),
        includeDisabled,
        requestedSiteId
      );
      return Response.json({
        ok: true,
        mode: "latest-test",
        limit: requestedLimit,
        page: requestedPage,
        site: requestedSiteId ?? null,
        stores: includeDisabled ? "all" : "enabled",
        stats
      });
    }

    const verifyMatch = url.pathname.match(/^\/verify\/([^/]+)$/);
    if (verifyMatch) {
      return handleCustomerVerify(request, env, verifyMatch[1]);
    }

    if (url.pathname === "/staff/login") {
      return handleStaffLogin(request, env);
    }

    if (url.pathname === "/staff/logout" && request.method === "POST") {
      return redirect("/staff/login", { "Set-Cookie": clearStaffSessionCookie() });
    }

    if (url.pathname === "/staff" || url.pathname.startsWith("/staff/")) {
      if (!(await isStaffRequest(request, env, new Date()))) {
        return redirect("/staff/login");
      }
      return handleStaff(request, env);
    }

    return Response.json({ error: "not found" }, { status: 404 });
  }
};

function authorizeManualRun(request: Request, env: Env): Response | null {
  const configuredSecretName = env.MANUAL_RUN_TOKEN_ENV ?? "MANUAL_RUN_TOKEN";
  const expectedToken = env[configuredSecretName];
  const actualToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return typeof expectedToken === "string" && actualToken === expectedToken
    ? null
    : Response.json({ error: "unauthorized" }, { status: 401 });
}

async function handleCustomerVerify(request: Request, env: Env, token: string): Promise<Response> {
  const detail = await getVerificationCaseByToken(env.DB, token);
  if (!detail) {
    return html("<main class=\"shell narrow\"><h1>Link not found</h1><p>This verification link is invalid or expired.</p></main>", 404);
  }
  const orderLabel = detail.case.incrementId ?? String(detail.case.magentoOrderId);
  if (request.method === "GET") {
    const message = detail.case.status === "submitted" ? "Your document has been submitted." : "";
    return renderCustomerUploadPage(orderLabel, token, message);
  }
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }
  if (!env.VERIFY_DOCS_BUCKET) {
    return renderCustomerUploadPage(orderLabel, token, "Document storage is not configured. Please contact support.");
  }
  const form = await request.formData();
  const file = asUploadedFile(form.get("document"));
  if (!file) {
    return renderCustomerUploadPage(orderLabel, token, "Choose one document to upload.");
  }
  const validationError = validateUpload(file);
  if (validationError) {
    return renderCustomerUploadPage(orderLabel, token, validationError);
  }
  const uploadedAt = new Date().toISOString();
  const key = `${detail.case.siteId}/${detail.case.id}/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;
  await env.VERIFY_DOCS_BUCKET.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type }
  });
  await recordDocumentUpload(env.DB, {
    caseId: detail.case.id,
    r2Key: key,
    filename: file.name,
    contentType: file.type,
    size: file.size,
    uploadedAt
  });
  return renderCustomerUploadPage(orderLabel, token, "Thank you. Your document was submitted for review.");
}

async function handleStaffLogin(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    return renderStaffLogin();
  }
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const cookie = await createStaffSessionCookie(env, password, new Date());
  if (!cookie) {
    return renderStaffLogin("Invalid password or staff auth is not configured.");
  }
  return redirect("/staff", { "Set-Cookie": cookie });
}

async function handleStaff(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/staff") {
    const cases = await listStaffCases(env.DB);
    return renderStaffList(
      cases.map((item) => {
        const site = getSiteForCase(env, item.siteId);
        return {
          ...item,
          adminOrderUrl: buildMagentoAdminOrderUrl(site, item.magentoOrderId),
          timeZone: site.timeZone
        };
      })
    );
  }

  const documentMatch = url.pathname.match(/^\/staff\/cases\/([^/]+)\/document$/);
  if (documentMatch && request.method === "GET") {
    return handleStaffDocument(env, documentMatch[1]);
  }

  const actionMatch = url.pathname.match(/^\/staff\/cases\/([^/]+)\/(approve|decline|resend-email|send-test-email|open-test-link)$/);
  if (actionMatch && request.method === "POST") {
    return handleStaffAction(request, env, actionMatch[1], actionMatch[2]);
  }

  const caseMatch = url.pathname.match(/^\/staff\/cases\/([^/]+)$/);
  if (caseMatch && request.method === "GET") {
    const detail = await getVerificationCaseDetail(env.DB, caseMatch[1]);
    if (!detail) {
      return html("<main class=\"shell\"><h1>Case not found</h1></main>", 404);
    }
    return renderStaffCase(
      detail.case,
      detail.document,
      getCapabilities(env),
      "",
      url.searchParams.get("success") ?? "",
      buildMagentoAdminOrderUrl(getSiteForCase(env, detail.case.siteId), detail.case.magentoOrderId)
    );
  }

  return Response.json({ error: "not found" }, { status: 404 });
}

async function handleStaffDocument(env: Env, caseId: string): Promise<Response> {
  const detail = await getVerificationCaseDetail(env.DB, caseId);
  if (!detail?.document) {
    return Response.json({ error: "document not found" }, { status: 404 });
  }
  if (!env.VERIFY_DOCS_BUCKET) {
    return Response.json({ error: "document storage is not configured" }, { status: 500 });
  }
  const object = await env.VERIFY_DOCS_BUCKET.get(detail.document.r2Key);
  if (!object) {
    return Response.json({ error: "document missing from storage" }, { status: 404 });
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": detail.document.contentType,
      "Content-Disposition": `inline; filename="${detail.document.filename.replace(/"/g, "")}"`
    }
  });
}

async function handleStaffAction(request: Request, env: Env, caseId: string, action: string): Promise<Response> {
  const detail = await getVerificationCaseDetail(env.DB, caseId);
  if (!detail) {
    return html("<main class=\"shell\"><h1>Case not found</h1></main>", 404);
  }
  const form = await request.formData();
  const note = optionalText(form.get("note"));
  const now = new Date().toISOString();
  const site = getSiteForCase(env, detail.case.siteId);

  try {
    if (action === "open-test-link") {
      const token = await rotateVerificationToken(env.DB, detail.case.id, now);
      return redirect(`/verify/${encodeURIComponent(token)}`);
    }
    if (action === "resend-email") {
      if (!isCustomerEmailEnabled(env)) {
        throw new Error("Customer email is disabled by CUSTOMER_EMAIL_ENABLED");
      }
      const order = await fetchCaseMagentoOrder(env, detail.case);
      const token = await rotateVerificationToken(env.DB, detail.case.id, now);
      await sendVerificationEmail(env, site, order, detail.case, token, request.url, now);
      return redirect(`/staff/cases/${detail.case.id}?success=${encodeURIComponent("Verification email sent.")}`);
    }
    if (action === "send-test-email") {
      if (isCustomerEmailEnabled(env)) {
        throw new Error("Test email is available only while normal customer email is disabled");
      }
      const recipient = String(form.get("recipient") ?? "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
        throw new Error("Enter a valid test recipient email address");
      }
      const order = await fetchCaseMagentoOrder(env, detail.case);
      const token = await rotateVerificationToken(env.DB, detail.case.id, now);
      await sendVerificationTestEmail(env, site, order, detail.case, token, request.url, recipient);
      return redirect(`/staff/cases/${detail.case.id}?success=${encodeURIComponent("Test verification email sent.")}`);
    }
    if (action === "approve") {
      await approveVerificationCase(env, site, detail.case, note, now);
      return redirect(`/staff/cases/${detail.case.id}?success=${encodeURIComponent("Order approved and released for processing.")}`);
    }
    if (action === "decline") {
      await declineVerificationCase(env, site, detail.case, note, now);
      return redirect(`/staff/cases/${detail.case.id}?success=${encodeURIComponent("Order declined. Magento credit memo created and order closed or canceled. Remember to refund it manually in Authorize.net.")}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const alreadyRecordedDecline = action === "decline" && (await getLastDeclineAction(env.DB, detail.case.id));
    if (action === "approve" || (action === "decline" && !alreadyRecordedDecline)) {
      await recordAction(env.DB, {
        caseId: detail.case.id,
        action,
        staffNote: note,
        error: message,
        at: now
      });
    }
    await updateCaseStatus(env.DB, detail.case.id, "action_failed", now);
    return renderStaffCase(
      { ...detail.case, status: "action_failed" },
      detail.document,
      getCapabilities(env),
      message,
      "",
      buildMagentoAdminOrderUrl(site, detail.case.magentoOrderId)
    );
  }

  return Response.json({ error: "not found" }, { status: 404 });
}

function getCapabilities(
  env: Env
): {
  fraudScanEnabled: boolean;
  magentoUpdatesEnabled: boolean;
  customerEmailEnabled: boolean;
  customerHistoryExemptionMonths: number;
} {
  return {
    fraudScanEnabled: isFraudScanEnabled(env),
    magentoUpdatesEnabled: isMagentoOrderUpdatesEnabled(env),
    customerEmailEnabled: isCustomerEmailEnabled(env),
    customerHistoryExemptionMonths: getCustomerHistoryExemptionMonths(env)
  };
}

function getScheduledTime(event: WorkflowEvent<unknown>): Date {
  const schedule = event.schedule as { scheduledTime?: number } | undefined;
  if (typeof schedule?.scheduledTime === "number") {
    return new Date(schedule.scheduledTime);
  }
  return new Date();
}

interface UploadedFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function asUploadedFile(value: unknown): UploadedFile | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<UploadedFile>;
  return typeof candidate.name === "string" &&
    typeof candidate.type === "string" &&
    typeof candidate.size === "number" &&
    typeof candidate.arrayBuffer === "function"
    ? (candidate as UploadedFile)
    : null;
}

function validateUpload(file: UploadedFile): string | null {
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  if (!allowedTypes.has(file.type)) {
    return "Upload a PDF, JPEG, PNG, or WebP file.";
  }
  if (file.size <= 0) {
    return "The selected file is empty.";
  }
  if (file.size > 8 * 1024 * 1024) {
    return "The selected file is too large. The limit is 8 MB.";
  }
  return null;
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "document";
}

function optionalText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}
