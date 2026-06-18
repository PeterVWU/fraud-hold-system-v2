import type { MagentoOrder, MagentoOrderAddress, OrderSignal, SiteConfig } from "./types";

export function normalizeWhitespace(value: string | undefined | null): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizePhone(value: string | undefined | null): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length > 10 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function normalizeName(address: MagentoOrderAddress | undefined): string {
  return normalizeWhitespace(`${address?.firstname ?? ""} ${address?.lastname ?? ""}`);
}

export function normalizeAddress(address: MagentoOrderAddress | undefined): string {
  if (!address) {
    return "";
  }

  return [
    ...(address.street ?? []),
    address.city,
    address.region_code ?? address.region,
    address.postcode,
    address.country_id
  ]
    .map(normalizeWhitespace)
    .filter(Boolean)
    .join("|");
}

export function parseNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseMagentoDateMs(value: string): number {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return Date.parse(normalized);
}

export function formatMagentoDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function getShippingAddress(order: MagentoOrder): MagentoOrderAddress | undefined {
  const extensionAttributes = order.extension_attributes;
  const shippingAssignments = extensionAttributes?.shipping_assignments;
  if (Array.isArray(shippingAssignments)) {
    const address = shippingAssignments[0]?.shipping?.address;
    if (address && typeof address === "object") {
      return address as MagentoOrderAddress;
    }
  }

  const direct = order.extension_attributes?.shipping_address;
  return direct && typeof direct === "object" ? (direct as MagentoOrderAddress) : undefined;
}

export async function buildOrderSignal(order: MagentoOrder, site: SiteConfig): Promise<OrderSignal> {
  const customerKey = order.customer_id
    ? `id:${order.customer_id}`
    : order.customer_email
      ? `email:${normalizeWhitespace(order.customer_email)}`
      : null;
  const customerEmail = order.customer_email ? normalizeWhitespace(order.customer_email) : null;
  const paymentFingerprint = findFirstPath(order, site.paymentFingerprintPaths);

  return {
    customerKeyHash: customerKey ? await sha256Hex(`${site.id}:${customerKey}`) : null,
    customerEmailHash: customerEmail ? await sha256Hex(`${site.id}:${customerEmail}`) : null,
    remoteIp: order.remote_ip ?? null,
    billingNameNorm: normalizeName(order.billing_address) || null,
    paymentFingerprintHash: paymentFingerprint ? await sha256Hex(`${site.id}:payment:${paymentFingerprint}`) : null,
    grandTotal: parseNumber(order.grand_total),
    totalQty: parseNumber(order.total_qty_ordered) || sumItemQty(order)
  };
}

export function findFirstPath(source: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = getByPath(source, path);
    if (typeof value === "string" || typeof value === "number") {
      const normalized = normalizeWhitespace(String(value));
      if (normalized) {
        return normalized;
      }
    }
  }
  return null;
}

export function getByPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (value && typeof value === "object" && key in value) {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

export function getOrderEntityId(order: MagentoOrder): number {
  if (!Number.isFinite(order.entity_id)) {
    throw new Error("Magento order is missing numeric entity_id");
  }
  return order.entity_id;
}

export function getOrderCreatedAt(order: MagentoOrder): string {
  if (!order.created_at) {
    throw new Error(`Magento order ${order.entity_id} is missing created_at`);
  }
  return order.created_at;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sumItemQty(order: MagentoOrder): number {
  return (order.items ?? []).reduce((sum, item) => sum + parseNumber(item.qty_ordered), 0);
}
