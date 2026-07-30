import type { Env, SiteConfig } from "./types";

export function getSites(env: Env, includeDisabled = false): SiteConfig[] {
  const raw = env.MAGENTO_SITES_JSON;
  if (!raw) {
    throw new Error("MAGENTO_SITES_JSON is required");
  }

  const parsed = JSON.parse(raw) as SiteConfig[];
  return parsed
    .filter((site) => includeDisabled || site.enabled)
    .map((site) => validateSite(site));
}

export function getAccessToken(env: Env, site: SiteConfig): string {
  const token = env[site.accessTokenEnv];
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error(`Missing Magento access token secret ${site.accessTokenEnv} for site ${site.id}`);
  }
  return token;
}

export function getMagentoRequestHeaders(env: Env, site: SiteConfig): Record<string, string> {
  if (!site.requestAuthHeaderName && !site.requestAuthHeaderValueEnv) {
    return {};
  }
  if (!site.requestAuthHeaderName || !site.requestAuthHeaderValueEnv) {
    throw new Error(`Magento request auth header is incompletely configured for site ${site.id}`);
  }
  const value = env[site.requestAuthHeaderValueEnv];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing Magento request header secret ${site.requestAuthHeaderValueEnv} for site ${site.id}`);
  }
  return { [site.requestAuthHeaderName]: value };
}

export function getHoldThreshold(env: Env, site: SiteConfig): number {
  if (typeof site.holdThreshold === "number" && Number.isFinite(site.holdThreshold)) {
    return site.holdThreshold;
  }
  const fallback = Number(env.DEFAULT_HOLD_THRESHOLD ?? "2");
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 2;
}

export function getCustomerHistoryExemptionMonths(env: Env): number {
  const configured = Number(env.CUSTOMER_HISTORY_EXEMPTION_MONTHS);
  return Number.isInteger(configured) && configured > 0 ? configured : 12;
}

export function getCursorOverlapMinutes(site: SiteConfig): number {
  return site.cursorOverlapMinutes ?? 10;
}

export function getHoldActionMode(env: Env): "live" | "dry_run" {
  return isMagentoOrderUpdatesEnabled(env) && env.HOLD_ACTION_MODE !== "dry_run" ? "live" : "dry_run";
}

export function isMagentoOrderUpdatesEnabled(env: Env): boolean {
  return env.MAGENTO_ORDER_UPDATES_ENABLED === "true";
}

export function isCustomerEmailEnabled(env: Env): boolean {
  return env.CUSTOMER_EMAIL_ENABLED === "true";
}

export function isFraudScanEnabled(env: Env): boolean {
  return env.FRAUD_SCAN_ENABLED === "true";
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function validateSite(site: SiteConfig): SiteConfig {
  const required = ["id", "name", "baseUrl", "accessTokenEnv"] as const;
  for (const field of required) {
    if (!site[field]) {
      throw new Error(`Magento site config is missing ${field}`);
    }
  }

  return {
    ...site,
    baseUrl: normalizeBaseUrl(site.baseUrl),
    paymentFingerprintPaths: site.paymentFingerprintPaths ?? [],
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
