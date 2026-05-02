import { pool } from "./db";

/**
 * Ensures portfolios.sort_order exists (deployments that shipped code before the
 * column was added never ran drizzle-kit push interactively).
 */
export async function ensurePortfolioSortOrderColumn(): Promise<void> {
  await pool.query(`
    ALTER TABLE portfolios
    ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0
  `);
}

/**
 * Doplní stĺpce pre import (XTB) a kľúče, ak beží staršia DB bez `db:push` na
 * Replite / inom hoste (identické s `scripts/add-transaction-columns.sql`).
 */
export async function ensureTransactionImportColumns(): Promise<void> {
  // WITHDRAWAL atď. = 10 znakov; staršie schémy mali kratšie.
  try {
    await pool.query(`
      ALTER TABLE transactions
      ALTER COLUMN type TYPE varchar(12)
    `);
  } catch (err) {
    console.warn(
      "schemaEnsure: could not widen transactions.type to varchar(12) (ok if already up to date):",
      err,
    );
  }

  // Sentinel pre vklady/výbery: PORTFOLIO_CASH_FLOW = 20 znakov; staré DB mali často varchar(10).
  try {
    await pool.query(`
      ALTER TABLE transactions
      ALTER COLUMN ticker TYPE varchar(32)
    `);
  } catch (err) {
    console.warn(
      "schemaEnsure: could not widen transactions.ticker to varchar(32) (ok if already up to date):",
      err,
    );
  }

  await pool.query(`
    ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS transaction_id varchar(64)
  `);
  await pool.query(`
    ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS original_currency varchar(3)
  `);
  await pool.query(`
    ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS exchange_rate_at_transaction numeric(18, 8)
  `);
  await pool.query(`
    ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS base_currency_amount numeric(18, 4)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS transactions_transaction_id_lookup_idx
    ON transactions (transaction_id)
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS transactions_user_portfolio_transaction_id_uidx
    ON transactions (user_id, portfolio_id, transaction_id)
  `);
}

/**
 * Tabuľka `exchange_rates` (cache Frankfurter) – staršie nasadenia ju nemajú.
 */
export async function ensureExchangeRatesTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exchange_rates (
      iso_date varchar(10) NOT NULL,
      currency varchar(3) NOT NULL,
      eur_per_unit numeric(20, 12) NOT NULL,
      fetched_at timestamptz DEFAULT now(),
      PRIMARY KEY (iso_date, currency)
    )
  `);
}

/** Schvaľovanie registrácií – staršie DB bez `db:push`. */
export async function ensureUserRegistrationStatusColumn(): Promise<void> {
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS registration_status varchar(20) NOT NULL DEFAULT 'approved'
  `);
}
