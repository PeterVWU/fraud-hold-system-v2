import type { SiteConfig } from "./types";

export function buildMagentoAdminOrderUrl(site: SiteConfig, orderId: number): string | null {
  if (!site.adminBaseUrl) {
    return null;
  }
  return `${site.adminBaseUrl.replace(/\/+$/, "")}/sales/order/view/order_id/${orderId}/`;
}
