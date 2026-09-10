import { sql } from "drizzle-orm";
import { db } from "../db";
import type {
  AiBotAnalysisPayload,
  AiBotBrief,
  AiBotSettings,
  AiBotSlot,
} from "./types";

let tablesReady: Promise<void> | null = null;

export function ensureAiBotTables(): Promise<void> {
  if (!tablesReady) {
    tablesReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ai_bot_settings (
          user_id VARCHAR PRIMARY KEY,
          enabled BOOLEAN NOT NULL DEFAULT true,
          portfolio_id TEXT NOT NULL DEFAULT 'all',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ai_bot_briefs (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
          user_id VARCHAR NOT NULL,
          portfolio_id TEXT NOT NULL,
          slot TEXT NOT NULL,
          summary TEXT NOT NULL,
          analysis_json JSONB NOT NULL,
          context_json JSONB,
          model TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS ai_bot_briefs_user_created_idx
          ON ai_bot_briefs (user_id, created_at DESC);
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ai_bot_schedule_locks (
          lock_key TEXT PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    })();
  }
  return tablesReady;
}

function asRows<T = any>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] };
  return Array.isArray(r?.rows) ? r.rows : [];
}

function mapSettings(row: any): AiBotSettings {
  return {
    userId: String(row.user_id),
    enabled: row.enabled !== false,
    portfolioId: String(row.portfolio_id || "all"),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function resolvePortfolioLabel(
  portfolioId: string,
  context: any,
): string {
  const fromCtx =
    context && typeof context === "object" && context.portfolioLabel != null
      ? String(context.portfolioLabel).trim()
      : "";
  if (fromCtx) return fromCtx;
  if (!portfolioId || portfolioId === "all") return "Všetky portfóliá";
  return portfolioId;
}

function mapBrief(row: any): AiBotBrief {
  const analysis =
    typeof row.analysis_json === "string"
      ? JSON.parse(row.analysis_json)
      : row.analysis_json;
  const context =
    typeof row.context_json === "string"
      ? JSON.parse(row.context_json)
      : row.context_json;
  const portfolioId = String(row.portfolio_id);
  return {
    id: String(row.id),
    userId: String(row.user_id),
    portfolioId,
    portfolioLabel: resolvePortfolioLabel(portfolioId, context),
    slot: row.slot as AiBotSlot,
    summary: String(row.summary || ""),
    analysis: analysis as AiBotAnalysisPayload,
    contextSnapshot: context ?? null,
    model: row.model != null ? String(row.model) : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function getAiBotSettings(userId: string): Promise<AiBotSettings> {
  await ensureAiBotTables();
  const result = await db.execute(sql`
    SELECT user_id, enabled, portfolio_id, updated_at
    FROM ai_bot_settings WHERE user_id = ${userId}
  `);
  const row = asRows(result)[0];
  if (row) return mapSettings(row);
  await db.execute(sql`
    INSERT INTO ai_bot_settings (user_id, enabled, portfolio_id)
    VALUES (${userId}, true, 'all')
    ON CONFLICT (user_id) DO NOTHING
  `);
  return {
    userId,
    enabled: true,
    portfolioId: "all",
    updatedAt: new Date().toISOString(),
  };
}

export async function saveAiBotSettings(
  userId: string,
  patch: { enabled?: boolean; portfolioId?: string },
): Promise<AiBotSettings> {
  await ensureAiBotTables();
  const current = await getAiBotSettings(userId);
  const enabled = patch.enabled ?? current.enabled;
  const portfolioId = patch.portfolioId ?? current.portfolioId;
  await db.execute(sql`
    INSERT INTO ai_bot_settings (user_id, enabled, portfolio_id, updated_at)
    VALUES (${userId}, ${enabled}, ${portfolioId}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      portfolio_id = EXCLUDED.portfolio_id,
      updated_at = NOW()
  `);
  return getAiBotSettings(userId);
}

export async function listEnabledAiBotUsers(): Promise<AiBotSettings[]> {
  await ensureAiBotTables();
  const result = await db.execute(sql`
    SELECT user_id, enabled, portfolio_id, updated_at
    FROM ai_bot_settings
    WHERE enabled = true
  `);
  return asRows(result).map(mapSettings);
}

export async function insertAiBotBrief(input: {
  userId: string;
  portfolioId: string;
  slot: AiBotSlot;
  summary: string;
  analysis: AiBotAnalysisPayload;
  contextSnapshot: unknown;
  model: string | null;
}): Promise<AiBotBrief> {
  await ensureAiBotTables();
  const analysisJson = JSON.stringify(input.analysis);
  const contextJson = JSON.stringify(input.contextSnapshot ?? null);
  const result = await db.execute(sql`
    INSERT INTO ai_bot_briefs
      (user_id, portfolio_id, slot, summary, analysis_json, context_json, model)
    VALUES (
      ${input.userId},
      ${input.portfolioId},
      ${input.slot},
      ${input.summary},
      ${analysisJson}::jsonb,
      ${contextJson}::jsonb,
      ${input.model}
    )
    RETURNING *
  `);
  const rows = (result as { rows?: any[] }).rows ?? asRows(result);
  const row = rows[0];
  if (!row) throw new Error("AI_BOT_INSERT_FAILED");
  return mapBrief(row);
}

export async function getLatestAiBotBrief(
  userId: string,
  portfolioId?: string | null,
): Promise<AiBotBrief | null> {
  await ensureAiBotTables();
  const pf = portfolioId != null ? String(portfolioId).trim() : "";
  if (pf) {
    const result = await db.execute(sql`
      SELECT * FROM ai_bot_briefs
      WHERE user_id = ${userId} AND portfolio_id = ${pf}
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const row = asRows(result)[0];
    return row ? mapBrief(row) : null;
  }
  const result = await db.execute(sql`
    SELECT * FROM ai_bot_briefs
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const row = asRows(result)[0];
  return row ? mapBrief(row) : null;
}

export async function listAiBotBriefs(
  userId: string,
  limit = 20,
): Promise<AiBotBrief[]> {
  await ensureAiBotTables();
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const result = await db.execute(sql`
    SELECT * FROM ai_bot_briefs
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `);
  return asRows(result).map(mapBrief);
}

export async function getAiBotBriefById(
  userId: string,
  briefId: string,
): Promise<AiBotBrief | null> {
  await ensureAiBotTables();
  const result = await db.execute(sql`
    SELECT * FROM ai_bot_briefs WHERE id = ${briefId} AND user_id = ${userId}
  `);
  const row = asRows(result)[0];
  return row ? mapBrief(row) : null;
}

export async function tryAcquireScheduleLock(lockKey: string): Promise<boolean> {
  await ensureAiBotTables();
  try {
    await db.execute(sql`
      INSERT INTO ai_bot_schedule_locks (lock_key) VALUES (${lockKey})
    `);
    return true;
  } catch {
    return false;
  }
}
