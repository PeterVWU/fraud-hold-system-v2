import type { FraudDecision, MagentoOrder, OrderSignal, SiteConfig } from "./types";
import { getOrderCreatedAt, getOrderEntityId } from "./normalizers";

export interface SiteCursor {
  lastSuccessCreatedAt: string | null;
  lastSuccessOrderId: number | null;
}

export interface CreateReviewInput {
  reviewId: string;
  site: SiteConfig;
  order: MagentoOrder;
  signal: OrderSignal;
  decision: FraudDecision;
  reviewedAt: string;
  actionMode: "live" | "dry_run";
}

export interface ReviewSummary {
  id: string;
  decision: "hold" | "allow";
  holdSucceeded: boolean;
  slackAttempted: boolean;
  slackSucceeded: boolean;
}

export async function getSiteCursor(db: D1Database, siteId: string): Promise<SiteCursor> {
  const row = await db
    .prepare("SELECT last_success_created_at, last_success_order_id FROM site_cursors WHERE site_id = ?")
    .bind(siteId)
    .first<{ last_success_created_at: string | null; last_success_order_id: number | null }>();

  return {
    lastSuccessCreatedAt: row?.last_success_created_at ?? null,
    lastSuccessOrderId: row?.last_success_order_id ?? null
  };
}

export async function updateSiteCursor(
  db: D1Database,
  siteId: string,
  createdAt: string,
  orderId: number,
  updatedAt: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO site_cursors (site_id, last_success_created_at, last_success_order_id, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(site_id) DO UPDATE SET
         last_success_created_at = excluded.last_success_created_at,
         last_success_order_id = excluded.last_success_order_id,
         updated_at = excluded.updated_at`
    )
    .bind(siteId, createdAt, orderId, updatedAt)
    .run();
}

export async function getReviewSummary(
  db: D1Database,
  siteId: string,
  orderId: number
): Promise<ReviewSummary | null> {
  const row = await db
    .prepare(
      `SELECT id, decision, hold_succeeded, slack_attempted, slack_succeeded
       FROM order_reviews
       WHERE site_id = ? AND magento_order_id = ?`
    )
    .bind(siteId, orderId)
    .first<{
      id: string;
      decision: "hold" | "allow";
      hold_succeeded: number;
      slack_attempted: number;
      slack_succeeded: number;
    }>();

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    decision: row.decision,
    holdSucceeded: row.hold_succeeded === 1,
    slackAttempted: row.slack_attempted === 1,
    slackSucceeded: row.slack_succeeded === 1
  };
}

export async function createReview(db: D1Database, input: CreateReviewInput): Promise<boolean> {
  const { reviewId, site, order, signal, decision, reviewedAt, actionMode } = input;
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO order_reviews (
        id, site_id, magento_order_id, increment_id, order_created_at, customer_key_hash,
        remote_ip, status_before, status_after, decision, action_mode, hold_threshold, matched_count,
        required_matched_count, reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      reviewId,
      site.id,
      getOrderEntityId(order),
      order.increment_id ?? null,
      getOrderCreatedAt(order),
      signal.customerKeyHash,
      signal.remoteIp,
      order.status ?? null,
      null,
      decision.decision,
      actionMode,
      decision.holdThreshold,
      decision.matchedCount,
      decision.requiredMatchedCount,
      reviewedAt
    )
    .run();

  if (!result.success || result.meta.changes === 0) {
    return false;
  }

  const statements = decision.ruleResults.map((ruleResult) =>
    db
      .prepare(
        `INSERT INTO order_rule_results (
          id, review_id, site_id, magento_order_id, rule_id, rule_name, matched,
          required, evidence_json, evaluated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        reviewId,
        site.id,
        getOrderEntityId(order),
        ruleResult.ruleId,
        ruleResult.ruleName,
        ruleResult.matched ? 1 : 0,
        ruleResult.required ? 1 : 0,
        JSON.stringify(ruleResult.evidence),
        reviewedAt
      )
  );

  if (statements.length > 0) {
    await db.batch(statements);
  }

  return true;
}

export async function recordOrderSignal(
  db: D1Database,
  site: SiteConfig,
  order: MagentoOrder,
  signal: OrderSignal,
  insertedAt: string
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO order_signals (
        id, site_id, magento_order_id, increment_id, order_created_at, customer_key_hash,
        customer_email_hash, remote_ip, billing_name_norm, payment_fingerprint_hash,
        grand_total, total_qty, inserted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      site.id,
      getOrderEntityId(order),
      order.increment_id ?? null,
      getOrderCreatedAt(order),
      signal.customerKeyHash,
      signal.customerEmailHash,
      signal.remoteIp,
      signal.billingNameNorm,
      signal.paymentFingerprintHash,
      signal.grandTotal,
      signal.totalQty,
      insertedAt
    )
    .run();
}

export async function markHoldResult(
  db: D1Database,
  reviewId: string,
  succeeded: boolean,
  statusAfter: string | null,
  error: string | null,
  actionMode: "live" | "dry_run" = "live"
): Promise<void> {
  await db
    .prepare(
      `UPDATE order_reviews
       SET action_mode = ?, hold_attempted = 1, hold_succeeded = ?, status_after = ?, hold_error = ?
       WHERE id = ?`
    )
    .bind(actionMode, succeeded ? 1 : 0, statusAfter, error, reviewId)
    .run();
}

export async function markHoldSkipped(
  db: D1Database,
  reviewId: string,
  statusAfter: string | null,
  reason: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE order_reviews
       SET action_mode = 'dry_run', hold_attempted = 0, hold_succeeded = 0, status_after = ?, hold_error = ?
       WHERE id = ?`
    )
    .bind(statusAfter, reason, reviewId)
    .run();
}

export async function markHoldNotAttempted(
  db: D1Database,
  reviewId: string,
  statusAfter: string | null,
  reason: string,
  actionMode: "live" | "dry_run" = "live"
): Promise<void> {
  await db
    .prepare(
      `UPDATE order_reviews
       SET action_mode = ?, hold_attempted = 0, hold_succeeded = 0, status_after = ?, hold_error = ?
       WHERE id = ?`
    )
    .bind(actionMode, statusAfter, reason, reviewId)
    .run();
}

export async function markHoldAlreadySatisfied(
  db: D1Database,
  reviewId: string,
  statusAfter: string | null,
  actionMode: "live" | "dry_run" = "live"
): Promise<void> {
  await db
    .prepare(
      `UPDATE order_reviews
       SET action_mode = ?, hold_attempted = 0, hold_succeeded = 1, status_after = ?, hold_error = NULL
       WHERE id = ?`
    )
    .bind(actionMode, statusAfter, reviewId)
    .run();
}

export async function markSlackResult(
  db: D1Database,
  reviewId: string,
  succeeded: boolean,
  error: string | null
): Promise<void> {
  await db
    .prepare(
      `UPDATE order_reviews
       SET slack_attempted = 1, slack_succeeded = ?, slack_error = ?
       WHERE id = ?`
    )
    .bind(succeeded ? 1 : 0, error, reviewId)
    .run();
}

export async function createRunLog(db: D1Database, siteId: string | null, startedAt: string): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO run_logs (id, site_id, started_at, status) VALUES (?, ?, ?, ?)")
    .bind(id, siteId, startedAt, "running")
    .run();
  return id;
}

export async function finishRunLog(
  db: D1Database,
  id: string,
  finishedAt: string,
  status: "success" | "failed",
  stats: {
    pagesFetched: number;
    ordersEvaluated: number;
    holdsAttempted: number;
    holdsSucceeded: number;
  },
  error: string | null
): Promise<void> {
  await db
    .prepare(
      `UPDATE run_logs
       SET finished_at = ?, status = ?, pages_fetched = ?, orders_evaluated = ?,
         holds_attempted = ?, holds_succeeded = ?, error = ?
       WHERE id = ?`
    )
    .bind(
      finishedAt,
      status,
      stats.pagesFetched,
      stats.ordersEvaluated,
      stats.holdsAttempted,
      stats.holdsSucceeded,
      error,
      id
    )
    .run();
}

export async function countRecentRelatedOrders(
  db: D1Database,
  siteId: string,
  signal: OrderSignal,
  since: string
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM order_signals
       WHERE site_id = ?
         AND datetime(order_created_at) >= datetime(?)
         AND (
           (? IS NOT NULL AND customer_key_hash = ?)
           OR (? IS NOT NULL AND customer_email_hash = ?)
           OR (? IS NOT NULL AND remote_ip = ?)
         )`
    )
    .bind(
      siteId,
      since,
      signal.customerKeyHash,
      signal.customerKeyHash,
      signal.customerEmailHash,
      signal.customerEmailHash,
      signal.remoteIp,
      signal.remoteIp
    )
    .first<{ count: number }>();

  return row?.count ?? 0;
}

export async function hasDifferentPaymentOrBillingToday(
  db: D1Database,
  siteId: string,
  signal: OrderSignal,
  dayStart: string
): Promise<boolean> {
  if (!signal.customerKeyHash && !signal.customerEmailHash) {
    return false;
  }

  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM order_signals
       WHERE site_id = ?
         AND datetime(order_created_at) >= datetime(?)
         AND (
           (? IS NOT NULL AND customer_key_hash = ?)
           OR (? IS NOT NULL AND customer_email_hash = ?)
         )
         AND (
           (? IS NOT NULL AND payment_fingerprint_hash IS NOT NULL AND payment_fingerprint_hash != ?)
           OR (? IS NOT NULL AND billing_name_norm IS NOT NULL AND billing_name_norm != ?)
         )`
    )
    .bind(
      siteId,
      dayStart,
      signal.customerKeyHash,
      signal.customerKeyHash,
      signal.customerEmailHash,
      signal.customerEmailHash,
      signal.paymentFingerprintHash,
      signal.paymentFingerprintHash,
      signal.billingNameNorm,
      signal.billingNameNorm
    )
    .first<{ count: number }>();

  return (row?.count ?? 0) > 0;
}
