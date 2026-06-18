import type { Env, SiteConfig } from "./types";

export function getSites(env: Env): SiteConfig[] {
  const raw = env.MAGENTO_SITES_JSON;
  if (!raw) {
    throw new Error("MAGENTO_SITES_JSON is required");
  }

  const parsed = JSON.parse(raw) as SiteConfig[];
  return parsed
    .filter((site) => site.enabled)
    .map((site) => validateSite(site));
}

export function getAccessToken(env: Env, site: SiteConfig): string {
  const token = env[site.accessTokenEnv];
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error(`Missing Magento access token secret ${site.accessTokenEnv} for site ${site.id}`);
  }
  return token;
}

export function getHoldThreshold(env: Env, site: SiteConfig): number {
  if (typeof site.holdThreshold === "number" && Number.isFinite(site.holdThreshold)) {
    return site.holdThreshold;
  }
  const fallback = Number(env.DEFAULT_HOLD_THRESHOLD ?? "2");
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 2;
}

export function getCursorOverlapMinutes(site: SiteConfig): number {
  return site.cursorOverlapMinutes ?? 10;
}

export function getHoldActionMode(env: Env): "live" | "dry_run" {
  return env.HOLD_ACTION_MODE === "dry_run" ? "dry_run" : "live";
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
    paymentFingerprintPaths: site.paymentFingerprintPaths ?? []
  };
}
