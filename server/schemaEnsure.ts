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
