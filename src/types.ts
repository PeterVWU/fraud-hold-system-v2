export interface Env {
  DB: D1Database;
  FRAUD_SCAN_WORKFLOW: Workflow;
  MAGENTO_SITES_JSON: string;
  DEFAULT_HOLD_THRESHOLD?: string;
  MANUAL_RUN_TOKEN_ENV?: string;
  HOLD_ACTION_MODE?: string;
  LOCAL_RUN_DIRECT?: string;
  SLACK_WEBHOOK_URL?: string;
  SLACK_BOT_TOKEN?: string;
  SLACK_CHANNEL_ID?: string;
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
  initialLookbackHours?: number;
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
  items?: Array<{ qty_ordered?: number | string }>;
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
