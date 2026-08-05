import { normalizeBaseUrl } from "./config";
import type { CompletedOrderHistory, MagentoCustomer, MagentoInvoice, MagentoOrder, SiteConfig } from "./types";

export interface MagentoClient {
  listOrders(params: ListOrdersParams): Promise<MagentoOrder[]>;
  getOrder(orderId: number): Promise<MagentoOrder>;
  getCustomer(customerId: number): Promise<MagentoCustomer>;
  getCompletedOrderHistory(customerId: number, createdBefore: string): Promise<CompletedOrderHistory>;
  listInvoices(orderId: number): Promise<MagentoInvoice[]>;
  holdOrder(orderId: number): Promise<boolean>;
  unholdOrder(orderId: number): Promise<boolean>;
  cancelOrder(orderId: number): Promise<boolean>;
  getOrderStatus(orderId: number): Promise<string>;
  addOrderComment(orderId: number, status: string | null, comment: string): Promise<boolean>;
  refundInvoiceOffline(invoiceId: number, input: MagentoRefundInput): Promise<number>;
}

export interface ListOrdersParams {
  createdAtGte: string;
  pageSize: number;
  currentPage: number;
  sortDirection?: "ASC" | "DESC";
}

export interface MagentoRefundInput {
  items: Array<{ order_item_id: number; qty: number }>;
  comment: string;
  shippingAmount?: number;
}

export function createMagentoClient(
  site: SiteConfig,
  accessToken: string,
  requestHeaders: Record<string, string> = {}
): MagentoClient {
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
        ...requestHeaders,
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
        "searchCriteria[sortOrders][0][direction]": params.sortDirection ?? "ASC",
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

    async getCompletedOrderHistory(customerId, createdBefore) {
      const query = new URLSearchParams({
        "searchCriteria[filterGroups][0][filters][0][field]": "customer_id",
        "searchCriteria[filterGroups][0][filters][0][value]": String(customerId),
        "searchCriteria[filterGroups][0][filters][0][conditionType]": "eq",
        "searchCriteria[filterGroups][1][filters][0][field]": "status",
        "searchCriteria[filterGroups][1][filters][0][value]": "complete",
        "searchCriteria[filterGroups][1][filters][0][conditionType]": "eq",
        "searchCriteria[filterGroups][2][filters][0][field]": "created_at",
        "searchCriteria[filterGroups][2][filters][0][value]": createdBefore,
        "searchCriteria[filterGroups][2][filters][0][conditionType]": "lt",
        "searchCriteria[sortOrders][0][field]": "created_at",
        "searchCriteria[sortOrders][0][direction]": "ASC",
        "searchCriteria[pageSize]": "1",
        "searchCriteria[currentPage]": "1"
      });
      const result = await request<{ items?: MagentoOrder[]; total_count?: number }>(`/orders?${query.toString()}`);
      return {
        totalCount: Number(result.total_count ?? 0),
        oldestCompletedOrderCreatedAt: result.items?.[0]?.created_at ?? null
      };
    },

    async listInvoices(orderId) {
      const query = new URLSearchParams({
        "searchCriteria[filterGroups][0][filters][0][field]": "order_id",
        "searchCriteria[filterGroups][0][filters][0][value]": String(orderId),
        "searchCriteria[filterGroups][0][filters][0][conditionType]": "eq"
      });
      const result = await request<{ items?: MagentoInvoice[] }>(`/invoices?${query.toString()}`);
      return result.items ?? [];
    },

    holdOrder(orderId) {
      return request<boolean>(`/orders/${orderId}/hold`, { method: "POST" });
    },

    unholdOrder(orderId) {
      return request<boolean>(`/orders/${orderId}/unhold`, { method: "POST" });
    },

    cancelOrder(orderId) {
      return request<boolean>(`/orders/${orderId}/cancel`, { method: "POST" });
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
    },

    async refundInvoiceOffline(invoiceId, input) {
      const result = await request<number | string>(`/invoice/${invoiceId}/refund`, {
        method: "POST",
        body: JSON.stringify({
          items: input.items,
          isOnline: false,
          notify: false,
          appendComment: true,
          comment: {
            comment: input.comment,
            is_visible_on_front: 0
          },
          arguments: {
            shipping_amount: input.shippingAmount ?? 0,
            extension_attributes: {
              // Amasty Store Credit's refund plugins require this object even when no store credit is used.
              amstorecredit_base_amount: 0
            }
          }
        })
      });
      const creditmemoId = Number(result);
      if (!Number.isInteger(creditmemoId) || creditmemoId <= 0) {
        throw new Error(`Magento ${site.id} returned an invalid credit memo ID: ${String(result)}`);
      }
      return creditmemoId;
    }
  };
}
