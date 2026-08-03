CREATE TABLE IF NOT EXISTS verification_information_requests (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  recipient TEXT,
  sender TEXT NOT NULL,
  requested_document_types TEXT NOT NULL,
  custom_message TEXT,
  status TEXT NOT NULL,
  message_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES verification_cases(id)
);

CREATE INDEX IF NOT EXISTS idx_verification_information_requests_case
  ON verification_information_requests (case_id, created_at);

ALTER TABLE verification_documents ADD COLUMN request_id TEXT;
ALTER TABLE verification_documents ADD COLUMN document_type TEXT;

CREATE INDEX IF NOT EXISTS idx_verification_documents_request
  ON verification_documents (request_id, uploaded_at);
