-- When a low-chance file is opened, store the moment the person confirmed.

ALTER TABLE cases ADD COLUMN low_confirmed_at INTEGER;
