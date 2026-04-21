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
