import { getAccessToken, getMagentoRequestHeaders, isMagentoOrderUpdatesEnabled } from "./config";
import { createMagentoClient } from "./magento";
import type { Env, MagentoOrder, SiteConfig } from "./types";
import {
  recordAction,
  updateCaseStatus,
  type VerificationCase
} from "./verification";

export async function approveVerificationCase(
  env: Env,
  site: SiteConfig,
  verificationCase: VerificationCase,
  now: string
): Promise<void> {
  assertMagentoOrderUpdatesEnabled(env);
  const client = createMagentoClient(site, getAccessToken(env, site), getMagentoRequestHeaders(env, site));
  const order = await client.getOrder(verificationCase.magentoOrderId);
  if (!isHoldStatus(order.status)) {
    throw new Error(`Order status ${order.status ?? "unknown"} is not hold-like`);
  }
  const unheld = await client.unholdOrder(verificationCase.magentoOrderId);
  if (!unheld) {
    throw new Error("Magento returned false from unhold");
  }
  const statusAfter = await client.getOrderStatus(verificationCase.magentoOrderId);
  await client.addOrderComment(
    verificationCase.magentoOrderId,
    statusAfter,
    "Fraud verification approved."
  );
  if (statusAfter !== "processing") {
    throw new Error(`Expected Magento status processing after approval, got ${statusAfter}`);
  }
  await recordAction(env.DB, { caseId: verificationCase.id, action: "approve", staffNote: null, at: now });
  await updateCaseStatus(env.DB, verificationCase.id, "approved", now);
}

export async function declineVerificationCase(
  env: Env,
  site: SiteConfig,
  verificationCase: VerificationCase,
  now: string
): Promise<void> {
  assertMagentoOrderUpdatesEnabled(env);
  const client = createMagentoClient(site, getAccessToken(env, site), getMagentoRequestHeaders(env, site));
  const order = await client.getOrder(verificationCase.magentoOrderId);
  let releasedHold = false;
  if (isHoldStatus(order.status)) {
    const unheld = await client.unholdOrder(verificationCase.magentoOrderId);
    if (!unheld) {
      throw new Error("Magento returned false from unhold before cancellation");
    }
    releasedHold = true;
  }
  let creditmemoId: number;
  try {
    const invoices = await client.listInvoices(verificationCase.magentoOrderId);
    const invoice = invoices.find((candidate) => Number(candidate.state ?? 0) === 2) ?? invoices[0];
    if (!invoice) {
      throw new Error("Magento order has no invoice available for a credit memo");
    }
    creditmemoId = await client.refundInvoiceOffline(invoice.entity_id, {
      items: buildRefundItems(order),
      shippingAmount: refundableShipping(order),
      comment: "Fraud verification declined."
    });
  } catch (error) {
    if (releasedHold) {
      try {
        await client.holdOrder(verificationCase.magentoOrderId);
      } catch (rollbackError) {
        throw new Error(
          `${errorMessage(error)}; additionally failed to restore Magento hold: ${errorMessage(rollbackError)}`
        );
      }
    }
    throw error;
  }
  let statusAfter = await client.getOrderStatus(verificationCase.magentoOrderId);
  if (!["closed", "canceled"].includes(statusAfter)) {
    const canceled = await client.cancelOrder(verificationCase.magentoOrderId);
    statusAfter = await client.getOrderStatus(verificationCase.magentoOrderId);
    if (!canceled && !["closed", "canceled"].includes(statusAfter)) {
      throw new Error(`Credit memo ${creditmemoId} was created, but Magento could not close or cancel the order (status ${statusAfter})`);
    }
  }

  await recordAction(env.DB, {
    caseId: verificationCase.id,
    action: "decline",
    staffNote: null,
    magentoCreditmemoId: creditmemoId,
    at: now
  });
  await updateCaseStatus(env.DB, verificationCase.id, "declined", now);
}

function buildRefundItems(order: MagentoOrder): Array<{ order_item_id: number; qty: number }> {
  const items = (order.items ?? [])
    .map((item) => {
      const orderItemId = item.order_item_id ?? item.item_id;
      const qty = Number(item.qty_invoiced ?? 0) - Number(item.qty_refunded ?? 0);
      return orderItemId && qty > 0 ? { order_item_id: orderItemId, qty } : null;
    })
    .filter((item): item is { order_item_id: number; qty: number } => item !== null);
  if (items.length === 0) {
    throw new Error("Order has no refundable invoiced items");
  }
  return items;
}

function refundableShipping(order: MagentoOrder): number {
  const invoiced = Number(order["base_shipping_invoiced"] ?? order["shipping_invoiced"] ?? 0);
  const refunded = Number(order["base_shipping_refunded"] ?? order["shipping_refunded"] ?? 0);
  const value = invoiced - refunded;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function assertMagentoOrderUpdatesEnabled(env: Env): void {
  if (!isMagentoOrderUpdatesEnabled(env)) {
    throw new Error("Magento order updates are disabled by MAGENTO_ORDER_UPDATES_ENABLED");
  }
}

function isHoldStatus(status: string | undefined): boolean {
  return ["holded", "payment_review", "fraud"].includes(String(status ?? "").toLowerCase());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
