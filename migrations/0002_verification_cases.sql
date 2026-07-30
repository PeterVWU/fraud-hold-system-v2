CREATE TABLE IF NOT EXISTS verification_cases (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL UNIQUE,
  site_id TEXT NOT NULL,
  magento_order_id INTEGER NOT NULL,
  increment_id TEXT,
  customer_email TEXT,
  customer_token_hash TEXT NOT NULL UNIQUE,
  token_expires_at TEXT NOT NULL,
  status TEXT NOT NULL,
  email_status TEXT NOT NULL DEFAULT 'not_sent',
  email_error TEXT,
  email_sent_at TEXT,
  document_uploaded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (review_id) REFERENCES order_reviews(id)
);

CREATE INDEX IF NOT EXISTS idx_verification_cases_status
  ON verification_cases (status, updated_at);

CREATE TABLE IF NOT EXISTS verification_documents (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES verification_cases(id)
);

CREATE INDEX IF NOT EXISTS idx_verification_documents_case
  ON verification_documents (case_id, uploaded_at);

CREATE TABLE IF NOT EXISTS verification_actions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  action TEXT NOT NULL,
  staff_note TEXT,
  magento_creditmemo_id INTEGER,
  authnet_refund_transaction_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES verification_cases(id)
);

CREATE INDEX IF NOT EXISTS idx_verification_actions_case
  ON verification_actions (case_id, created_at);

CREATE TABLE IF NOT EXISTS verification_email_attempts (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  recipient TEXT,
  sender TEXT NOT NULL,
  message_id TEXT,
  error TEXT,
  attempted_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES verification_cases(id)
);
