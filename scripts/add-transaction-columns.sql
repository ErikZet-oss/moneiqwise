-- Manuálna migrácia, keď `npm run db:push` zlyhá (napr. konflikt na `local_password_resets`).
-- Spusti proti tej istej DB ako aplikácia, napr.:
--   psql "postgresql://..." -f scripts/add-transaction-columns.sql
-- (alebo v DBeaver / pgAdmin / Replit Shell s nastaveným DATABASE_URL)

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
