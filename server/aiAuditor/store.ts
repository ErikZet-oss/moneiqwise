import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  AI_AUDITOR_DAILY_LIMIT,
  type AiAuditorAnalysis,
  type AiAuditorRun,
  type AiAuditorUsage,
} from "./types";

let tablesReady: Promise<void> | null = null;

export function ensureAiAuditorTables(): Promise<void> {
  if (!tablesReady) {
    tablesReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ai_auditor_runs (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
          user_id VARCHAR NOT NULL,
          portfolio_id TEXT NOT NULL,
          portfolio_label TEXT NOT NULL DEFAULT '',
          analysis_json JSONB NOT NULL,
          model TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS ai_auditor_runs_user_pf_created_idx
          ON ai_auditor_runs (user_id, portfolio_id, created_at DESC);
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ai_auditor_usage (
          user_id VARCHAR NOT NULL,
          portfolio_id TEXT NOT NULL,
          day_key TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, portfolio_id, day_key)
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

/** Calendar day in Europe/Bratislava (YYYY-MM-DD). */
export function auditorDayKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bratislava",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function auditorResetsAtIso(now = new Date()): string {
  const dayKey = auditorDayKey(now);
  // Next midnight Bratislava ≈ dayKey + 1 day at 00:00+02/+01 — use noon UTC of next day as safe reset hint
  const [y, m, d] = dayKey.split("-").map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1, 22, 0, 0));
  return next.toISOString();
}

function mapRun(row: any): AiAuditorRun {
  const analysis =
    typeof row.analysis_json === "string"
      ? JSON.parse(row.analysis_json)
      : row.analysis_json;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    portfolioId: String(row.portfolio_id),
    portfolioLabel: String(row.portfolio_label || ""),
    analysis: analysis as AiAuditorAnalysis,
    model: row.model != null ? String(row.model) : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function getLatestAiAuditorRun(
  userId: string,
  portfolioId: string,
): Promise<AiAuditorRun | null> {
  await ensureAiAuditorTables();
  const result = await db.execute(sql`
    SELECT id, user_id, portfolio_id, portfolio_label, analysis_json, model, created_at
    FROM ai_auditor_runs
    WHERE user_id = ${userId} AND portfolio_id = ${portfolioId}
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const row = asRows(result)[0];
  return row ? mapRun(row) : null;
}

export async function insertAiAuditorRun(input: {
  userId: string;
  portfolioId: string;
  portfolioLabel: string;
  analysis: AiAuditorAnalysis;
  model: string | null;
}): Promise<AiAuditorRun> {
  await ensureAiAuditorTables();
  const result = await db.execute(sql`
    INSERT INTO ai_auditor_runs (user_id, portfolio_id, portfolio_label, analysis_json, model)
    VALUES (
      ${input.userId},
      ${input.portfolioId},
      ${input.portfolioLabel},
      ${JSON.stringify(input.analysis)}::jsonb,
      ${input.model}
    )
    RETURNING id, user_id, portfolio_id, portfolio_label, analysis_json, model, created_at
  `);
  const row = asRows(result)[0];
  if (!row) throw new Error("AI_AUDITOR_INSERT_FAILED");
  return mapRun(row);
}

export async function getAiAuditorUsage(
  userId: string,
  portfolioId: string,
): Promise<AiAuditorUsage> {
  await ensureAiAuditorTables();
  const dayKey = auditorDayKey();
  const result = await db.execute(sql`
    SELECT count FROM ai_auditor_usage
    WHERE user_id = ${userId}
      AND portfolio_id = ${portfolioId}
      AND day_key = ${dayKey}
  `);
  const row = asRows(result)[0] as { count?: number } | undefined;
  const used = Math.min(AI_AUDITOR_DAILY_LIMIT, Math.max(0, Number(row?.count) || 0));
  return {
    portfolioId,
    used,
    limit: AI_AUDITOR_DAILY_LIMIT,
    resetsAt: auditorResetsAtIso(),
    dayKey,
  };
}

/** Atomically consume one run. Returns null if limit reached. */
export async function tryConsumeAiAuditorQuota(
  userId: string,
  portfolioId: string,
): Promise<AiAuditorUsage | null> {
  await ensureAiAuditorTables();
  const dayKey = auditorDayKey();
  const result = await db.execute(sql`
    INSERT INTO ai_auditor_usage (user_id, portfolio_id, day_key, count)
    VALUES (${userId}, ${portfolioId}, ${dayKey}, 1)
    ON CONFLICT (user_id, portfolio_id, day_key) DO UPDATE
      SET count = ai_auditor_usage.count + 1
      WHERE ai_auditor_usage.count < ${AI_AUDITOR_DAILY_LIMIT}
    RETURNING count
  `);
  const row = asRows(result)[0] as { count?: number } | undefined;
  if (!row) {
    return null;
  }
  return {
    portfolioId,
    used: Number(row.count) || 0,
    limit: AI_AUDITOR_DAILY_LIMIT,
    resetsAt: auditorResetsAtIso(),
    dayKey,
  };
}
