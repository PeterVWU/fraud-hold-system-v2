import { normalizeBaseUrl } from "./config";
import type { MagentoCustomer, MagentoOrder, SiteConfig } from "./types";

export interface MagentoClient {
  listOrders(params: ListOrdersParams): Promise<MagentoOrder[]>;
  getOrder(orderId: number): Promise<MagentoOrder>;
  getCustomer(customerId: number): Promise<MagentoCustomer>;
  holdOrder(orderId: number): Promise<boolean>;
  getOrderStatus(orderId: number): Promise<string>;
  addOrderComment(orderId: number, status: string | null, comment: string): Promise<boolean>;
}

export interface ListOrdersParams {
  createdAtGte: string;
  pageSize: number;
  currentPage: number;
}

export function createMagentoClient(site: SiteConfig, accessToken: string): MagentoClient {
  const storePath = site.storeCode ? `/${encodeURIComponent(site.storeCode)}` : "";
  const base = `${normalizeBaseUrl(site.baseUrl)}/rest${storePath}/V1`;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "FraudHoldSystem/1.0",
        Authorization: `Bearer ${accessToken}`,
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Magento ${site.id} ${init.method ?? "GET"} ${path} failed: ${response.status} ${body}`);
    }

    return (await response.json()) as T;
  }

  return {
    async listOrders(params) {
      const query = new URLSearchParams({
        "searchCriteria[filterGroups][0][filters][0][field]": "created_at",
        "searchCriteria[filterGroups][0][filters][0][value]": params.createdAtGte,
        "searchCriteria[filterGroups][0][filters][0][conditionType]": "gteq",
        "searchCriteria[sortOrders][0][field]": "created_at",
        "searchCriteria[sortOrders][0][direction]": "ASC",
        "searchCriteria[pageSize]": String(params.pageSize),
        "searchCriteria[currentPage]": String(params.currentPage)
      });
      const result = await request<{ items?: MagentoOrder[] }>(`/orders?${query.toString()}`);
      return result.items ?? [];
    },

    getOrder(orderId) {
      return request<MagentoOrder>(`/orders/${orderId}`);
    },

    getCustomer(customerId) {
      return request<MagentoCustomer>(`/customers/${customerId}`);
    },

    holdOrder(orderId) {
      return request<boolean>(`/orders/${orderId}/hold`, { method: "POST" });
    },

    getOrderStatus(orderId) {
      return request<string>(`/orders/${orderId}/statuses`);
    },

    addOrderComment(orderId, status, comment) {
      return request<boolean>(`/orders/${orderId}/comments`, {
        method: "POST",
        body: JSON.stringify({
          statusHistory: {
            comment,
            status: status ?? undefined,
            is_customer_notified: 0,
            is_visible_on_front: 0
          }
        })
      });
    }
  };
}
