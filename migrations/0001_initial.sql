CREATE TABLE IF NOT EXISTS site_cursors (
  site_id TEXT PRIMARY KEY,
  last_success_created_at TEXT,
  last_success_order_id INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_reviews (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  magento_order_id INTEGER NOT NULL,
  increment_id TEXT,
  order_created_at TEXT,
  customer_key_hash TEXT,
  remote_ip TEXT,
  status_before TEXT,
  status_after TEXT,
  decision TEXT NOT NULL,
  action_mode TEXT NOT NULL DEFAULT 'live',
  hold_threshold INTEGER NOT NULL,
  matched_count INTEGER NOT NULL,
  required_matched_count INTEGER NOT NULL,
  hold_attempted INTEGER NOT NULL DEFAULT 0,
  hold_succeeded INTEGER NOT NULL DEFAULT 0,
  hold_error TEXT,
  slack_attempted INTEGER NOT NULL DEFAULT 0,
  slack_succeeded INTEGER NOT NULL DEFAULT 0,
  slack_error TEXT,
  reviewed_at TEXT NOT NULL,
  UNIQUE (site_id, magento_order_id)
);

CREATE INDEX IF NOT EXISTS idx_order_reviews_site_created
  ON order_reviews (site_id, order_created_at);

CREATE TABLE IF NOT EXISTS order_rule_results (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  magento_order_id INTEGER NOT NULL,
  rule_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  matched INTEGER NOT NULL,
  required INTEGER NOT NULL,
  evidence_json TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  FOREIGN KEY (review_id) REFERENCES order_reviews(id)
);

CREATE INDEX IF NOT EXISTS idx_rule_results_review
  ON order_rule_results (review_id);

CREATE TABLE IF NOT EXISTS order_signals (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  magento_order_id INTEGER NOT NULL,
  increment_id TEXT,
  order_created_at TEXT NOT NULL,
  customer_key_hash TEXT,
  customer_email_hash TEXT,
  remote_ip TEXT,
  billing_name_norm TEXT,
  payment_fingerprint_hash TEXT,
  grand_total REAL,
  total_qty REAL,
  inserted_at TEXT NOT NULL,
  UNIQUE (site_id, magento_order_id)
);

CREATE INDEX IF NOT EXISTS idx_order_signals_customer_time
  ON order_signals (site_id, customer_key_hash, order_created_at);

CREATE INDEX IF NOT EXISTS idx_order_signals_email_time
  ON order_signals (site_id, customer_email_hash, order_created_at);

CREATE INDEX IF NOT EXISTS idx_order_signals_ip_time
  ON order_signals (site_id, remote_ip, order_created_at);

CREATE TABLE IF NOT EXISTS run_logs (
  id TEXT PRIMARY KEY,
  site_id TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  orders_evaluated INTEGER NOT NULL DEFAULT 0,
  holds_attempted INTEGER NOT NULL DEFAULT 0,
  holds_succeeded INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
