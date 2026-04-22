-- Manuálna migrácia, keď ešte treba stĺpce (alebo chceš prejsť mimo drizzle push).
-- Spusti proti tej istej DB ako aplikácia, napr.:
--   psql "postgresql://..." -f scripts/add-transaction-columns.sql
-- (alebo v DBeaver / pgAdmin / Replit Shell s nastaveným DATABASE_URL)

-- Stĺpec `type` musí zmestiť "WITHDRAWAL" (10 znakov) — pôvodne bývalo max 8.
ALTER TABLE transactions
  ALTER COLUMN type TYPE varchar(12);

-- Ticker pre hotovosť: PORTFOLIO_CASH_FLOW (20 znakov); staré schémy mali často varchar(10).
ALTER TABLE transactions
  ALTER COLUMN ticker TYPE varchar(32);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transaction_id varchar(64);
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS original_currency varchar(3);
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS exchange_rate_at_transaction numeric(18, 8);
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS base_currency_amount numeric(18, 4);

CREATE INDEX IF NOT EXISTS transactions_transaction_id_lookup_idx
  ON transactions (transaction_id);

CREATE UNIQUE INDEX IF NOT EXISTS transactions_user_portfolio_transaction_id_uidx
  ON transactions (user_id, portfolio_id, transaction_id);

-- Voliteľné: jedinečnosť hasha tokenu (Drizzle už túto indexáciu nesynchronizuje).
-- Spusti po úspešnom `db:push` alebo ak v tabuľke ešte žiadny UNIQUE na token_hash nie je.
CREATE UNIQUE INDEX IF NOT EXISTS local_password_resets_token_hash_key
  ON local_password_resets (token_hash);
