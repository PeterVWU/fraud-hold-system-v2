import { getAccessToken, getCursorOverlapMinutes, getHoldActionMode, getMagentoRequestHeaders, getSites } from "./config";
import {
  createReview,
  createRunLog,
  finishRunLog,
  getSiteCursor,
  getReviewSummary,
  markHoldAlreadySatisfied,
  markHoldNotAttempted,
  markHoldResult,
  markHoldSkipped,
  markSlackResult,
  recordOrderSignal,
  updateSiteCursor
} from "./db";
import { createMagentoClient, type MagentoClient } from "./magento";
import { sendVerificationEmail } from "./email";
import { buildOrderSignal, formatMagentoDate, getOrderCreatedAt, getOrderEntityId, parseMagentoDateMs } from "./normalizers";
import { evaluateFraudRules, formatFraudComment } from "./ruleEngine";
import { sendSlackHoldAlert } from "./slack";
import type {
  CompletedOrderHistoryLookup,
  Env,
  MagentoCustomer,
  MagentoOrder,
  RunStats,
  SiteConfig
} from "./types";
import { createVerificationCaseForHold } from "./verification";

const PAGE_SIZE = 100;
const DEFAULT_SCHEDULE_INTERVAL_MINUTES = 5;

export async function scanAllSites(env: Env, scheduledAt: Date): Promise<RunStats> {
  const aggregate: RunStats = { pagesFetched: 0, ordersEvaluated: 0, holdsAttempted: 0, holdsSucceeded: 0 };
  const sites = getSites(env);

  for (const site of sites) {
    try {
      const stats = await scanSite(env, site, scheduledAt);
      aggregate.pagesFetched += stats.pagesFetched;
      aggregate.ordersEvaluated += stats.ordersEvaluated;
      aggregate.holdsAttempted += stats.holdsAttempted;
      aggregate.holdsSucceeded += stats.holdsSucceeded;
    } catch (error) {
      console.error(`Fraud scan failed for site ${site.id}`, error);
    }
  }

  return aggregate;
}

export async function scanLatestOrdersAllSites(
  env: Env,
  limit: number,
  page: number,
  scannedAt: Date,
  includeDisabled = false,
  siteId?: string
): Promise<RunStats> {
  const aggregate: RunStats = { pagesFetched: 0, ordersEvaluated: 0, holdsAttempted: 0, holdsSucceeded: 0 };
  const configuredSites = getSites(env, includeDisabled);
  const sites = siteId ? configuredSites.filter((site) => site.id === siteId) : configuredSites;
  if (siteId && sites.length === 0) {
    throw new Error(`Magento site ${siteId} is not configured`);
  }

  for (const site of sites) {
    try {
      const stats = await scanLatestOrders(env, site, limit, page, scannedAt);
      aggregate.pagesFetched += stats.pagesFetched;
      aggregate.ordersEvaluated += stats.ordersEvaluated;
      aggregate.holdsAttempted += stats.holdsAttempted;
      aggregate.holdsSucceeded += stats.holdsSucceeded;
    } catch (error) {
      console.error(`Latest-order fraud scan failed for site ${site.id}`, error);
    }
  }

  return aggregate;
}

async function scanLatestOrders(
  env: Env,
  site: SiteConfig,
  limit: number,
  page: number,
  scannedAt: Date
): Promise<RunStats> {
  const startedAt = new Date().toISOString();
  const runLogId = await createRunLog(env.DB, site.id, startedAt);
  const stats: RunStats = { pagesFetched: 0, ordersEvaluated: 0, holdsAttempted: 0, holdsSucceeded: 0 };

  try {
    const client = createMagentoClient(site, getAccessToken(env, site), getMagentoRequestHeaders(env, site));
    const newestFirst = await client.listOrders({
      createdAtGte: "1970-01-01 00:00:00",
      pageSize: limit,
      currentPage: page,
      sortDirection: "DESC"
    });
    stats.pagesFetched = 1;

    for (const listOrder of newestFirst.slice().reverse()) {
      const orderId = getOrderEntityId(listOrder);
      const existingReview = await getReviewSummary(env.DB, site.id, orderId);
      if (existingReview && (existingReview.decision === "allow" || existingReview.holdSucceeded)) {
        continue;
      }
      const order = await ensureCompleteOrder(client, listOrder);
      await reviewOrder(env, site, client, order, scannedAt, stats, existingReview?.id ?? null);
    }

    await finishRunLog(env.DB, runLogId, new Date().toISOString(), "success", stats, null);
    return stats;
  } catch (error) {
    await finishRunLog(env.DB, runLogId, new Date().toISOString(), "failed", stats, errorToString(error));
    throw error;
  }
}

export async function scanSite(env: Env, site: SiteConfig, scheduledAt: Date): Promise<RunStats> {
  const startedAt = new Date().toISOString();
  const runLogId = await createRunLog(env.DB, site.id, startedAt);
  const stats: RunStats = { pagesFetched: 0, ordersEvaluated: 0, holdsAttempted: 0, holdsSucceeded: 0 };

  try {
    const client = createMagentoClient(site, getAccessToken(env, site), getMagentoRequestHeaders(env, site));
    const createdAtGte = await getScanStart(env.DB, site, scheduledAt);
    let currentPage = 1;
    let newestProcessed: { createdAt: string; orderId: number } | null = null;

    while (true) {
      const orders = await client.listOrders({ createdAtGte, pageSize: PAGE_SIZE, currentPage });
      stats.pagesFetched += 1;
      if (orders.length === 0) {
        break;
      }

      for (const listOrder of orders) {
        const orderId = getOrderEntityId(listOrder);
        const existingReview = await getReviewSummary(env.DB, site.id, orderId);
        if (existingReview && (existingReview.decision === "allow" || existingReview.holdSucceeded)) {
          newestProcessed = maxProcessed(newestProcessed, listOrder);
          continue;
        }

        const order = await ensureCompleteOrder(client, listOrder);
        await reviewOrder(env, site, client, order, scheduledAt, stats, existingReview?.id ?? null);
        newestProcessed = maxProcessed(newestProcessed, order);
      }

      if (orders.length < PAGE_SIZE) {
        break;
      }
      currentPage += 1;
    }

    if (newestProcessed) {
      await updateSiteCursor(env.DB, site.id, newestProcessed.createdAt, newestProcessed.orderId, new Date().toISOString());
    }

    await finishRunLog(env.DB, runLogId, new Date().toISOString(), "success", stats, null);
    return stats;
  } catch (error) {
    await finishRunLog(env.DB, runLogId, new Date().toISOString(), "failed", stats, errorToString(error));
    throw error;
  }
}

export async function reviewOrder(
  env: Env,
  site: SiteConfig,
  client: MagentoClient,
  order: MagentoOrder,
  scheduledAt: Date,
  stats: RunStats,
  existingReviewId: string | null = null
): Promise<void> {
  const signal = await buildOrderSignal(order, site);
  const [customer, completedOrderHistory] = await Promise.all([
    fetchCustomerIfAvailable(client, order),
    fetchCompletedOrderHistoryIfAvailable(client, site, order)
  ]);
  const decision = await evaluateFraudRules(env, site, order, {
    db: env.DB,
    now: scheduledAt,
    signal,
    customer,
    completedOrderHistory
  });
  const reviewedAt = new Date().toISOString();
  const reviewId = existingReviewId ?? crypto.randomUUID();
  const actionMode = getHoldActionMode(env);
  const inserted = existingReviewId
    ? true
    : await createReview(env.DB, { reviewId, site, order, signal, decision, reviewedAt, actionMode });

  if (!inserted) {
    return;
  }

  if (!existingReviewId) {
    stats.ordersEvaluated += 1;
  }

  if (decision.decision === "hold" && actionMode === "dry_run") {
    await markHoldSkipped(env.DB, reviewId, order.status ?? null, "dry run: Magento hold skipped");
    await createAndMaybeEmailVerificationCase(env, site, order, reviewId, reviewedAt);
  } else if (decision.decision === "hold" && isAlreadyHoldStatus(order.status)) {
    await markHoldAlreadySatisfied(env.DB, reviewId, order.status ?? null, actionMode);
  } else if (decision.decision === "hold" && !isHoldableStatus(order.status)) {
    await markHoldNotAttempted(
      env.DB,
      reviewId,
      order.status ?? null,
      `status ${order.status ?? "unknown"} is not holdable`,
      actionMode
    );
  } else if (decision.decision === "hold") {
    stats.holdsAttempted += 1;
    try {
      const held = await client.holdOrder(getOrderEntityId(order));
      const statusAfter = held ? await client.getOrderStatus(getOrderEntityId(order)) : order.status ?? null;
      await client.addOrderComment(getOrderEntityId(order), statusAfter, formatFraudComment(decision));
      await markHoldResult(env.DB, reviewId, held, statusAfter, held ? null : "Magento returned false", actionMode);
      if (held) {
        stats.holdsSucceeded += 1;
        try {
          await createAndMaybeEmailVerificationCase(env, site, order, reviewId, new Date().toISOString());
        } catch (error) {
          console.error(`Failed to create/send verification email for review ${reviewId}`, error);
        }
        const slackResult = await sendSlackHoldAlert(
          {
            webhookUrl: env.SLACK_WEBHOOK_URL,
            botToken: env.SLACK_BOT_TOKEN,
            channelId: env.SLACK_CHANNEL_ID
          },
          site,
          order,
          decision
        );
        if (slackResult.attempted) {
          await markSlackResult(env.DB, reviewId, slackResult.succeeded, slackResult.error);
        }
      }
    } catch (error) {
      await markHoldResult(env.DB, reviewId, false, order.status ?? null, errorToString(error), actionMode);
    }
  }

  await recordOrderSignal(env.DB, site, order, signal, reviewedAt);
}

async function createAndMaybeEmailVerificationCase(
  env: Env,
  site: SiteConfig,
  order: MagentoOrder,
  reviewId: string,
  now: string
): Promise<void> {
  try {
    const verification = await createVerificationCaseForHold(env, site, order, reviewId, now);
    if (verification.created) {
      await sendVerificationEmail(
        env,
        site,
        order,
        verification.verificationCase,
        verification.token,
        getPublicBaseUrl(env),
        now
      );
    }
  } catch (error) {
    console.error(`Failed to create/send verification email for review ${reviewId}`, error);
  }
}

export async function getScanStart(db: D1Database, site: SiteConfig, scheduledAt: Date): Promise<string> {
  const cursor = await getSiteCursor(db, site.id);
  const base = cursor.lastSuccessCreatedAt
    ? parseMagentoDateMs(cursor.lastSuccessCreatedAt)
    : scheduledAt.getTime() - (site.scanIntervalMinutes ?? DEFAULT_SCHEDULE_INTERVAL_MINUTES) * 60_000;
  const overlapMs = getCursorOverlapMinutes(site) * 60_000;
  return formatMagentoDate(new Date(base - overlapMs));
}

async function ensureCompleteOrder(client: MagentoClient, order: MagentoOrder): Promise<MagentoOrder> {
  if (order.billing_address && order.extension_attributes) {
    return order;
  }
  return client.getOrder(getOrderEntityId(order));
}

async function fetchCustomerIfAvailable(client: MagentoClient, order: MagentoOrder): Promise<MagentoCustomer | null> {
  if (!order.customer_id) {
    return null;
  }

  try {
    return await client.getCustomer(order.customer_id);
  } catch {
    return null;
  }
}

async function fetchCompletedOrderHistoryIfAvailable(
  client: MagentoClient,
  site: SiteConfig,
  order: MagentoOrder
): Promise<CompletedOrderHistoryLookup> {
  if (!order.customer_id) {
    return { status: "not_applicable" };
  }

  try {
    return {
      status: "available",
      history: await client.getCompletedOrderHistory(order.customer_id, order.created_at)
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "completed_order_history_lookup_failed",
        siteId: site.id,
        orderId: getOrderEntityId(order),
        incrementId: order.increment_id ?? null,
        customerId: order.customer_id,
        error: errorToString(error)
      })
    );
    return { status: "unavailable" };
  }
}

function maxProcessed(
  current: { createdAt: string; orderId: number } | null,
  order: MagentoOrder
): { createdAt: string; orderId: number } {
  const next = { createdAt: getOrderCreatedAt(order), orderId: getOrderEntityId(order) };
  if (!current) {
    return next;
  }

  if (next.createdAt > current.createdAt) {
    return next;
  }
  if (next.createdAt === current.createdAt && next.orderId > current.orderId) {
    return next;
  }
  return current;
}

function isAlreadyHoldStatus(status: string | undefined): boolean {
  return ["holded", "payment_review", "fraud"].includes(String(status ?? "").toLowerCase());
}

function isHoldableStatus(status: string | undefined): boolean {
  return ["pending", "processing"].includes(String(status ?? "").toLowerCase());
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getPublicBaseUrl(env: Env): string {
  return env.PUBLIC_BASE_URL ?? "https://fraud-hold-system-v2.info-ba2.workers.dev";
}
