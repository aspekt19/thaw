-- Daily counters, cache, check orders, used payments, and case credit.
-- Counters are rows, not the Workers rate limiter (that binding is a 10s or 60s window).

CREATE TABLE daily_counters (
  day TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, bucket)
);

CREATE TABLE spend_days (
  day TEXT PRIMARY KEY,
  micro INTEGER NOT NULL
);

CREATE TABLE chance_cache (
  cache_key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE check_orders (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  chain TEXT NOT NULL,
  amount_atomic TEXT NOT NULL,
  price_micro INTEGER NOT NULL,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL,
  client_key TEXT NOT NULL,
  tx_hash TEXT,
  result_json TEXT,
  fee_credit_micro INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX check_orders_open_amount
  ON check_orders (chain, amount_atomic)
  WHERE status = 'pending';

CREATE TABLE used_transfers (
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  order_id TEXT NOT NULL,
  PRIMARY KEY (chain, tx_hash)
);

CREATE TABLE cases (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  price_micro INTEGER NOT NULL,
  fee_credit_micro INTEGER NOT NULL,
  net_micro INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
