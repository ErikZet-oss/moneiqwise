import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import type { FinvizScreenerRow } from "./scraper";

/** 12h — menej requestov na Finviz/Yahoo, stále čerstvé screener dáta. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export async function ensureAiScannerCacheTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_scanner_cache (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      cache_key varchar(128) NOT NULL UNIQUE,
      strategy_id varchar(64) NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamp DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_scanner_cache_created_idx
    ON ai_scanner_cache (created_at);
  `);
}

export function screenerCacheKey(strategyId: string, filterFingerprint: string): string {
  const h = createHash("sha256").update(`${strategyId}|${filterFingerprint}`).digest("hex").slice(0, 32);
  return `screener:${strategyId}:${h}`;
}

export function evaluateCacheKey(strategyId: string, tickersFingerprint: string): string {
  const h = createHash("sha256").update(`${strategyId}|eval|${tickersFingerprint}`).digest("hex").slice(0, 32);
  return `eval:${strategyId}:${h}`;
}

export function tickerAnalyzeCacheKey(ticker: string): string {
  return `ticker:${ticker.toUpperCase()}`;
}

type CacheRow = {
  payload: unknown;
  created_at: Date | string;
};

export async function getCachePayload<T>(cacheKey: string): Promise<T | null> {
  const result = await db.execute(sql`
    SELECT payload, created_at FROM ai_scanner_cache WHERE cache_key = ${cacheKey} LIMIT 1
  `);
  const row = result.rows[0] as CacheRow | undefined;
  if (!row) return null;
  const created = new Date(row.created_at).getTime();
  if (!Number.isFinite(created) || Date.now() - created > CACHE_TTL_MS) {
    return null;
  }
  return row.payload as T;
}

export async function setCachePayload(cacheKey: string, strategyId: string, payload: unknown): Promise<void> {
  await db.execute(sql`
    INSERT INTO ai_scanner_cache (id, cache_key, strategy_id, payload, created_at)
    VALUES (gen_random_uuid(), ${cacheKey}, ${strategyId}, ${JSON.stringify(payload)}::jsonb, NOW())
    ON CONFLICT (cache_key)
    DO UPDATE SET payload = EXCLUDED.payload, strategy_id = EXCLUDED.strategy_id, created_at = NOW()
  `);
}

export type ScreenerCachePayload = {
  url: string;
  rows: FinvizScreenerRow[];
  fetchedAt: string;
  dataSource?: "finviz" | "yahoo";
};
