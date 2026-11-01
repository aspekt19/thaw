-- Case remainder: the case stays unpaid until a second USDC transfer is verified.
-- The same used_transfers table blocks replaying the check payment.

ALTER TABLE cases ADD COLUMN status TEXT NOT NULL DEFAULT 'awaiting_payment';
ALTER TABLE cases ADD COLUMN tier TEXT;
ALTER TABLE cases ADD COLUMN chain TEXT;
ALTER TABLE cases ADD COLUMN amount_atomic TEXT;
ALTER TABLE cases ADD COLUMN tx_hash TEXT;

ALTER TABLE used_transfers ADD COLUMN case_id TEXT;

CREATE UNIQUE INDEX cases_open_amount
  ON cases (chain, amount_atomic)
  WHERE status = 'awaiting_payment' AND amount_atomic IS NOT NULL;
