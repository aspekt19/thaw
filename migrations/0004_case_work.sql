-- Case token, pipeline stage, and per-case spend. Payment status stays on cases.status.

ALTER TABLE cases ADD COLUMN case_token_hash TEXT;
ALTER TABLE cases ADD COLUMN stage TEXT NOT NULL DEFAULT 'awaiting_payment';
ALTER TABLE cases ADD COLUMN work_json TEXT;

CREATE TABLE case_spend (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  source TEXT NOT NULL,
  endpoint TEXT,
  amount_micro INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  outcome TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
