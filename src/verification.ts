import { getAccessToken, getMagentoRequestHeaders } from "./config";
import { createMagentoClient } from "./magento";
import { getOrderEntityId } from "./normalizers";
import type { Env, MagentoOrder, SiteConfig } from "./types";
import {
  isInformationRequestType,
  parseInformationRequestTypes,
  type InformationRequestType,
  type VerificationDocumentType
} from "./informationRequests";

export type VerificationCaseStatus =
  | "pending_review"
  | "awaiting_customer"
  | "submitted"
  | "approved"
  | "declined"
  | "action_failed";

export type StaffCaseStatusFilter = VerificationCaseStatus | "open" | "all";

export interface VerificationCase {
  id: string;
  reviewId: string;
  siteId: string;
  magentoOrderId: number;
  incrementId: string | null;
  customerEmail: string | null;
  status: VerificationCaseStatus;
  emailStatus: "not_sent" | "sent" | "failed" | "skipped";
  emailError: string | null;
  emailSentAt: string | null;
  documentUploadedAt: string | null;
  tokenExpiresAt: string;
  matchedRuleNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VerificationDocument {
  id: string;
  caseId: string;
  r2Key: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  requestId: string | null;
  documentType: VerificationDocumentType;
}

export interface VerificationInformationRequest {
  id: string;
  caseId: string;
  recipient: string | null;
  sender: string;
  requestedDocumentTypes: InformationRequestType[];
  customMessage: string | null;
  status: "pending" | "sent" | "failed";
  messageId: string | null;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  updatedAt: string;
}

export interface VerificationCaseDetail {
  case: VerificationCase;
  documents: VerificationDocument[];
  informationRequests: VerificationInformationRequest[];
}

export async function createVerificationCaseForHold(
  env: Env,
  site: SiteConfig,
  order: MagentoOrder,
  reviewId: string,
  now: string,
  initialStatus: "pending_review" | "awaiting_customer" = "awaiting_customer"
): Promise<{ verificationCase: VerificationCase; token: string; created: boolean }> {
  const existing = await getVerificationCaseByReviewId(env.DB, reviewId);
  if (existing) {
    return { verificationCase: existing, token: "", created: false };
  }

  const token = generateToken();
  const id = crypto.randomUUID();
  const tokenHash = await sha256Hex(token);
  const tokenExpiresAt = addDays(now, 7);
  await env.DB.prepare(
    `INSERT INTO verification_cases (
      id, review_id, site_id, magento_order_id, increment_id, customer_email,
      customer_token_hash, token_expires_at, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      reviewId,
      site.id,
      getOrderEntityId(order),
      order.increment_id ?? null,
      order.customer_email ?? null,
      tokenHash,
      tokenExpiresAt,
      initialStatus,
      now,
      now
    )
    .run();

  const verificationCase = await getVerificationCaseById(env.DB, id);
  if (!verificationCase) {
    throw new Error("Verification case was not created");
  }

  return { verificationCase, token, created: true };
}

export async function getVerificationCaseByToken(db: D1Database, token: string): Promise<VerificationCaseDetail | null> {
  const row = await db
    .prepare(
      `SELECT id, review_id, site_id, magento_order_id, increment_id, customer_email, status,
        email_status, email_error, email_sent_at, document_uploaded_at, token_expires_at, created_at, updated_at,
        ${matchedRuleNamesSql()}
       FROM verification_cases vc
       WHERE customer_token_hash = ?
         AND token_expires_at > ?
         AND status IN ('pending_review', 'awaiting_customer', 'submitted')`
    )
    .bind(await sha256Hex(token), new Date().toISOString())
    .first<VerificationCaseRow>();

  if (!row) {
    return null;
  }
  return getVerificationCaseRelations(db, mapCase(row));
}

export async function rotateVerificationToken(
  db: D1Database,
  caseId: string,
  updatedAt: string
): Promise<string> {
  const token = generateToken();
  await db
    .prepare("UPDATE verification_cases SET customer_token_hash = ?, token_expires_at = ?, updated_at = ? WHERE id = ?")
    .bind(await sha256Hex(token), addDays(updatedAt, 7), updatedAt, caseId)
    .run();
  return token;
}

export async function getVerificationCaseDetail(db: D1Database, caseId: string): Promise<VerificationCaseDetail | null> {
  const verificationCase = await getVerificationCaseById(db, caseId);
  if (!verificationCase) {
    return null;
  }
  return getVerificationCaseRelations(db, verificationCase);
}

export async function listStaffCases(
  db: D1Database,
  statusFilter: StaffCaseStatusFilter = "open"
): Promise<VerificationCase[]> {
  const statusClause = statusFilter === "open"
    ? "AND status NOT IN ('approved', 'declined')"
    : statusFilter === "all"
      ? ""
      : "AND status = ?";
  const statement = db.prepare(
    `SELECT id, review_id, site_id, magento_order_id, increment_id, customer_email, status,
        email_status, email_error, email_sent_at, document_uploaded_at, token_expires_at, created_at, updated_at,
        ${matchedRuleNamesSql()}
       FROM verification_cases vc
       WHERE 1 = 1
       ${statusClause}
       ORDER BY updated_at DESC
       LIMIT 100`
  );
  const result = await statement
    .bind(...(statusFilter === "open" || statusFilter === "all" ? [] : [statusFilter]))
    .all<VerificationCaseRow>();

  return (result.results ?? []).map(mapCase);
}

export async function recordDocumentUploads(
  db: D1Database,
  inputs: Array<{
    caseId: string;
    r2Key: string;
    filename: string;
    contentType: string;
    size: number;
    uploadedAt: string;
    requestId: string | null;
    documentType: VerificationDocumentType;
  }>
): Promise<void> {
  if (inputs.length === 0) {
    return;
  }
  const latest = inputs[inputs.length - 1];
  await db.batch([
    ...inputs.map((input) => db
      .prepare(
        `INSERT INTO verification_documents (
          id, case_id, r2_key, filename, content_type, size, uploaded_at, request_id, document_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        input.caseId,
        input.r2Key,
        input.filename,
        input.contentType,
        input.size,
        input.uploadedAt,
        input.requestId,
        input.documentType
      )),
    db
      .prepare(
        `UPDATE verification_cases
         SET status = 'submitted', document_uploaded_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(latest.uploadedAt, latest.uploadedAt, latest.caseId)
  ]);
}

export async function createInformationRequest(
  db: D1Database,
  input: {
    caseId: string;
    recipient: string | null;
    sender: string;
    requestedDocumentTypes: InformationRequestType[];
    customMessage: string | null;
    at: string;
  }
): Promise<VerificationInformationRequest> {
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO verification_information_requests (
      id, case_id, recipient, sender, requested_document_types, custom_message,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(
    id,
    input.caseId,
    input.recipient,
    input.sender,
    JSON.stringify(input.requestedDocumentTypes),
    input.customMessage,
    input.at,
    input.at
  ).run();
  return {
    id,
    caseId: input.caseId,
    recipient: input.recipient,
    sender: input.sender,
    requestedDocumentTypes: input.requestedDocumentTypes,
    customMessage: input.customMessage,
    status: "pending",
    messageId: null,
    error: null,
    createdAt: input.at,
    sentAt: null,
    updatedAt: input.at
  };
}

export async function completeInformationRequest(
  db: D1Database,
  request: VerificationInformationRequest,
  result: { messageId: string | null; error: string | null; at: string }
): Promise<void> {
  const status = result.error ? "failed" : "sent";
  await db.batch([
    db.prepare(
      `UPDATE verification_information_requests
       SET status = ?, message_id = ?, error = ?, sent_at = ?, updated_at = ?
       WHERE id = ?`
    ).bind(status, result.messageId, result.error, result.error ? null : result.at, result.at, request.id),
    db.prepare(
      `INSERT INTO verification_email_attempts (id, case_id, recipient, sender, message_id, error, attempted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      request.caseId,
      request.recipient,
      request.sender,
      result.messageId,
      result.error,
      result.at
    ),
    db.prepare(
      `UPDATE verification_cases
       SET email_status = ?, email_error = ?,
         email_sent_at = CASE WHEN ? IS NULL THEN ? ELSE email_sent_at END,
         status = CASE WHEN ? IS NULL AND status = 'pending_review' THEN 'awaiting_customer' ELSE status END,
         updated_at = ?
       WHERE id = ?`
    ).bind(status, result.error, result.error, result.at, result.error, result.at, request.caseId)
  ]);
}

export async function getVerificationDocument(
  db: D1Database,
  caseId: string,
  documentId: string
): Promise<VerificationDocument | null> {
  const row = await db.prepare(
    `SELECT id, case_id, r2_key, filename, content_type, size, uploaded_at, request_id, document_type
     FROM verification_documents
     WHERE case_id = ? AND id = ?`
  ).bind(caseId, documentId).first<VerificationDocumentRow>();
  return row ? mapDocument(row) : null;
}

export async function recordEmailAttempt(
  db: D1Database,
  input: {
    caseId: string;
    recipient: string | null;
    sender: string;
    messageId: string | null;
    error: string | null;
    attemptedAt: string;
    skipped?: boolean;
  }
): Promise<void> {
  const emailStatus = input.skipped ? "skipped" : input.error ? "failed" : "sent";
  await db.batch([
    db
      .prepare(
        `INSERT INTO verification_email_attempts (id, case_id, recipient, sender, message_id, error, attempted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), input.caseId, input.recipient, input.sender, input.messageId, input.error, input.attemptedAt),
    db
      .prepare(
        `UPDATE verification_cases
         SET email_status = ?, email_error = ?, email_sent_at = CASE WHEN ? IS NULL THEN ? ELSE email_sent_at END,
           updated_at = ?
         WHERE id = ?`
      )
      .bind(emailStatus, input.error, input.error, input.attemptedAt, input.attemptedAt, input.caseId)
  ]);
}

export async function getVerificationCaseByReviewId(
  db: D1Database,
  reviewId: string
): Promise<VerificationCase | null> {
  const row = await db
    .prepare(
      `SELECT id, review_id, site_id, magento_order_id, increment_id, customer_email, status,
        email_status, email_error, email_sent_at, document_uploaded_at, token_expires_at, created_at, updated_at,
        ${matchedRuleNamesSql()}
       FROM verification_cases vc
       WHERE review_id = ?`
    )
    .bind(reviewId)
    .first<VerificationCaseRow>();
  return row ? mapCase(row) : null;
}

export async function updateCaseStatus(
  db: D1Database,
  caseId: string,
  status: VerificationCaseStatus,
  updatedAt: string
): Promise<void> {
  await db.prepare("UPDATE verification_cases SET status = ?, updated_at = ? WHERE id = ?").bind(status, updatedAt, caseId).run();
}

export async function recordAction(
  db: D1Database,
  input: {
    caseId: string;
    action: "approve" | "decline";
    staffNote: string | null;
    magentoCreditmemoId?: number | null;
    authnetRefundTransactionId?: string | null;
    error?: string | null;
    at: string;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO verification_actions (
        id, case_id, action, staff_note, magento_creditmemo_id, authnet_refund_transaction_id,
        error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      input.caseId,
      input.action,
      input.staffNote,
      input.magentoCreditmemoId ?? null,
      input.authnetRefundTransactionId ?? null,
      input.error ?? null,
      input.at,
      input.at
    )
    .run();
}

export async function getLastDeclineAction(db: D1Database, caseId: string): Promise<{
  magentoCreditmemoId: number | null;
  authnetRefundTransactionId: string | null;
} | null> {
  const row = await db
    .prepare(
      `SELECT magento_creditmemo_id, authnet_refund_transaction_id
       FROM verification_actions
       WHERE case_id = ? AND action = 'decline'
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(caseId)
    .first<{ magento_creditmemo_id: number | null; authnet_refund_transaction_id: string | null }>();
  return row
    ? {
        magentoCreditmemoId: row.magento_creditmemo_id,
        authnetRefundTransactionId: row.authnet_refund_transaction_id
      }
    : null;
}

export function getSiteForCase(env: Env, siteId: string): SiteConfig {
  const sites = JSON.parse(env.MAGENTO_SITES_JSON || "[]") as SiteConfig[];
  const site = sites.find((candidate) => candidate.id === siteId);
  if (!site) {
    throw new Error(`Unknown site ${siteId}`);
  }
  return {
    ...site,
    baseUrl: site.baseUrl.replace(/\/+$/, ""),
    paymentFingerprintPaths: site.paymentFingerprintPaths ?? [],
    authNetApiLoginIdEnv: site.authNetApiLoginIdEnv,
    authNetTransactionKeyEnv: site.authNetTransactionKeyEnv,
    authNetEnvironment: site.authNetEnvironment,
    authNetTransactionIdPaths: site.authNetTransactionIdPaths ?? [
      "payment.last_trans_id",
      "payment.cc_trans_id",
      "payment.additional_information.transaction_id",
      "payment.additional_information.authnet_transaction_id",
      "extension_attributes.authnet_transaction_id"
    ],
    authNetCardLast4Paths: site.authNetCardLast4Paths ?? [
      "payment.cc_last4",
      "payment.additional_information.cc_last4",
      "payment.additional_information.card_last4",
      "extension_attributes.cc_last4"
    ]
  };
}

export async function fetchCaseMagentoOrder(env: Env, verificationCase: VerificationCase): Promise<MagentoOrder> {
  const site = getSiteForCase(env, verificationCase.siteId);
  const client = createMagentoClient(site, getAccessToken(env, site), getMagentoRequestHeaders(env, site));
  return client.getOrder(verificationCase.magentoOrderId);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getVerificationCaseById(db: D1Database, caseId: string): Promise<VerificationCase | null> {
  const row = await db
    .prepare(
      `SELECT id, review_id, site_id, magento_order_id, increment_id, customer_email, status,
        email_status, email_error, email_sent_at, document_uploaded_at, token_expires_at, created_at, updated_at,
        ${matchedRuleNamesSql()}
       FROM verification_cases vc
       WHERE id = ?`
    )
    .bind(caseId)
    .first<VerificationCaseRow>();
  return row ? mapCase(row) : null;
}

async function getVerificationCaseRelations(
  db: D1Database,
  verificationCase: VerificationCase
): Promise<VerificationCaseDetail> {
  const [documents, informationRequests] = await Promise.all([
    getDocuments(db, verificationCase.id),
    getInformationRequests(db, verificationCase.id)
  ]);
  return { case: verificationCase, documents, informationRequests };
}

async function getDocuments(db: D1Database, caseId: string): Promise<VerificationDocument[]> {
  const result = await db
    .prepare(
      `SELECT id, case_id, r2_key, filename, content_type, size, uploaded_at, request_id, document_type
       FROM verification_documents
       WHERE case_id = ?
       ORDER BY uploaded_at DESC, id DESC`
    )
    .bind(caseId)
    .all<VerificationDocumentRow>();
  return (result.results ?? []).map(mapDocument);
}

async function getInformationRequests(db: D1Database, caseId: string): Promise<VerificationInformationRequest[]> {
  const result = await db.prepare(
    `SELECT id, case_id, recipient, sender, requested_document_types, custom_message,
      status, message_id, error, created_at, sent_at, updated_at
     FROM verification_information_requests
     WHERE case_id = ?
     ORDER BY created_at DESC, id DESC`
  ).bind(caseId).all<VerificationInformationRequestRow>();
  return (result.results ?? []).map(mapInformationRequest);
}

interface VerificationCaseRow {
  id: string;
  review_id: string;
  site_id: string;
  magento_order_id: number;
  increment_id: string | null;
  customer_email: string | null;
  status: VerificationCaseStatus;
  email_status: "not_sent" | "sent" | "failed" | "skipped";
  email_error: string | null;
  email_sent_at: string | null;
  document_uploaded_at: string | null;
  token_expires_at: string;
  matched_rule_names: string;
  created_at: string;
  updated_at: string;
}

interface VerificationDocumentRow {
  id: string;
  case_id: string;
  r2_key: string;
  filename: string;
  content_type: string;
  size: number;
  uploaded_at: string;
  request_id: string | null;
  document_type: string | null;
}

interface VerificationInformationRequestRow {
  id: string;
  case_id: string;
  recipient: string | null;
  sender: string;
  requested_document_types: string;
  custom_message: string | null;
  status: "pending" | "sent" | "failed";
  message_id: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  updated_at: string;
}

function mapCase(row: VerificationCaseRow): VerificationCase {
  return {
    id: row.id,
    reviewId: row.review_id,
    siteId: row.site_id,
    magentoOrderId: row.magento_order_id,
    incrementId: row.increment_id,
    customerEmail: row.customer_email,
    status: row.status,
    emailStatus: row.email_status,
    emailError: row.email_error,
    emailSentAt: row.email_sent_at,
    documentUploadedAt: row.document_uploaded_at,
    tokenExpiresAt: row.token_expires_at,
    matchedRuleNames: row.matched_rule_names ? row.matched_rule_names.split("||") : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDocument(row: VerificationDocumentRow): VerificationDocument {
  const documentType = row.document_type === "additional"
    ? "additional"
    : row.document_type && isInformationRequestType(row.document_type)
      ? row.document_type
      : null;
  return {
    id: row.id,
    caseId: row.case_id,
    r2Key: row.r2_key,
    filename: row.filename,
    contentType: row.content_type,
    size: row.size,
    uploadedAt: row.uploaded_at,
    requestId: row.request_id,
    documentType
  };
}

function mapInformationRequest(row: VerificationInformationRequestRow): VerificationInformationRequest {
  return {
    id: row.id,
    caseId: row.case_id,
    recipient: row.recipient,
    sender: row.sender,
    requestedDocumentTypes: parseInformationRequestTypes(row.requested_document_types),
    customMessage: row.custom_message,
    status: row.status,
    messageId: row.message_id,
    error: row.error,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    updatedAt: row.updated_at
  };
}

function matchedRuleNamesSql(): string {
  return `(SELECT group_concat(rule_name, '||')
    FROM order_rule_results rr
    WHERE rr.review_id = vc.review_id AND rr.matched = 1) AS matched_rule_names`;
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(isoDate) + days * 86_400_000).toISOString();
}
