export interface Env {
  DB: D1Database;
  FRAUD_SCAN_WORKFLOW: Workflow;
  VERIFY_DOCS_BUCKET?: R2Bucket;
  EMAIL?: SendEmail;
  MAGENTO_SITES_JSON: string;
  DEFAULT_HOLD_THRESHOLD?: string;
  MANUAL_RUN_TOKEN_ENV?: string;
  HOLD_ACTION_MODE?: string;
  FRAUD_SCAN_ENABLED?: string;
  MAGENTO_ORDER_UPDATES_ENABLED?: string;
  CUSTOMER_EMAIL_ENABLED?: string;
  LOCAL_RUN_DIRECT?: string;
  SLACK_WEBHOOK_URL?: string;
  SLACK_BOT_TOKEN?: string;
  SLACK_CHANNEL_ID?: string;
  STAFF_REVIEW_PASSWORD?: string;
  STAFF_SESSION_SECRET?: string;
  PUBLIC_BASE_URL?: string;
  TEST_EMAIL_FROM?: string;
  [key: string]: unknown;
}

export interface SiteConfig {
  id: string;
  name: string;
  baseUrl: string;
  adminBaseUrl?: string;
  storeCode?: string;
  accessTokenEnv: string;
  enabled: boolean;
  paymentFingerprintPaths: string[];
  holdThreshold?: number;
  cursorOverlapMinutes?: number;
  scanIntervalMinutes?: number;
  verificationEmailFrom?: string;
  verificationEmailReplyTo?: string;
  authNetApiLoginIdEnv?: string;
  authNetTransactionKeyEnv?: string;
  authNetEnvironment?: "production" | "sandbox";
  authNetTransactionIdPaths?: string[];
  authNetCardLast4Paths?: string[];
  requestAuthHeaderName?: string;
  requestAuthHeaderValueEnv?: string;
}

export interface MagentoInvoice {
  entity_id: number;
  order_id?: number;
  state?: number;
  items?: Array<{
    order_item_id?: number;
    qty?: number | string;
  }>;
}

export interface MagentoOrderAddress {
  firstname?: string;
  lastname?: string;
  street?: string[];
  city?: string;
  region?: string;
  region_code?: string;
  postcode?: string;
  country_id?: string;
  telephone?: string;
}

export interface MagentoOrder {
  entity_id: number;
  increment_id?: string;
  created_at: string;
  updated_at?: string;
  status?: string;
  state?: string;
  customer_id?: number;
  customer_email?: string;
  customer_firstname?: string;
  customer_lastname?: string;
  customer_is_guest?: number | boolean;
  grand_total?: number | string;
  total_qty_ordered?: number | string;
  remote_ip?: string;
  billing_address?: MagentoOrderAddress;
  extension_attributes?: Record<string, unknown>;
  payment?: Record<string, unknown>;
  items?: Array<{
    item_id?: number;
    order_item_id?: number;
    qty_ordered?: number | string;
    qty_invoiced?: number | string;
    qty_refunded?: number | string;
  }>;
  base_grand_total?: number | string;
  base_total_paid?: number | string;
  base_total_refunded?: number | string;
  total_paid?: number | string;
  total_refunded?: number | string;
  [key: string]: unknown;
}

export interface MagentoCustomer {
  id?: number;
  email?: string;
  firstname?: string;
  lastname?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface OrderSignal {
  customerKeyHash: string | null;
  customerEmailHash: string | null;
  remoteIp: string | null;
  billingNameNorm: string | null;
  paymentFingerprintHash: string | null;
  grandTotal: number;
  totalQty: number;
}

export interface RuleContext {
  site: SiteConfig;
  db: D1Database;
  now: Date;
  signal: OrderSignal;
  customer: MagentoCustomer | null;
  getCompletedOrderCount?: () => Promise<number>;
}

export interface RuleResult {
  ruleId: string;
  ruleName: string;
  matched: boolean;
  required: boolean;
  evidence: Record<string, unknown>;
}

export interface FraudRule {
  id: string;
  name: string;
  enabled: boolean;
  required: boolean;
  evaluate(order: MagentoOrder, context: RuleContext): Promise<Omit<RuleResult, "ruleId" | "ruleName" | "required">>;
}

export interface FraudDecision {
  decision: "hold" | "allow";
  holdThreshold: number;
  matchedCount: number;
  requiredMatchedCount: number;
  ruleResults: RuleResult[];
}

export interface RunStats {
  pagesFetched: number;
  ordersEvaluated: number;
  holdsAttempted: number;
  holdsSucceeded: number;
}
