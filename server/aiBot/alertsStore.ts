import { sql } from "drizzle-orm";
import { db } from "../db";

export type AiAlertKind = "price" | "news";
export type AiAlertEmailStatus =
  | "sent"
  | "skipped_no_smtp"
  | "skipped_disabled"
  | "failed"
  | null;

export type AiAlertSettings = {
  userId: string;
  alertsEnabled: boolean;
  priceThresholdPct: number;
  emailEnabled: boolean;
  lastScanAt: string | null;
  updatedAt: string;
};

export type AiBotAlert = {
  id: string;
  userId: string;
  ticker: string;
  kind: AiAlertKind;
  title: string;
  body: string;
  changePct: number | null;
  newsTitle: string | null;
  newsLink: string | null;
  readAt: string | null;
  emailStatus: AiAlertEmailStatus;
  createdAt: string;
};

const COOLDOWN_HOURS = 4;
const MAX_ALERTS_PER_DAY = 8;

let tablesReady: Promise<void> | null = null;

export function ensureAiAlertTables(): Promise<void> {
  if (!tablesReady) {
    tablesReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ai_bot_alert_settings (
          user_id VARCHAR PRIMARY KEY,
          alerts_enabled BOOLEAN NOT NULL DEFAULT true,
          price_threshold_pct NUMERIC NOT NULL DEFAULT 4,
          email_enabled BOOLEAN NOT NULL DEFAULT false,
          last_scan_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ai_bot_alerts (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
          user_id VARCHAR NOT NULL,
          ticker TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          change_pct NUMERIC,
          news_title TEXT,
          news_link TEXT,
          read_at TIMESTAMPTZ,
          email_status TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS ai_bot_alerts_user_created_idx
          ON ai_bot_alerts (user_id, created_at DESC);
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS ai_bot_alerts_cooldown_idx
          ON ai_bot_alerts (user_id, ticker, kind, created_at DESC);
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS ai_bot_alerts_news_dedupe_idx
          ON ai_bot_alerts (user_id, news_title);
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

function clampThreshold(n: number): number {
  if (!Number.isFinite(n)) return 4;
  return Math.min(10, Math.max(2, Math.round(n * 10) / 10));
}

function mapSettings(row: any): AiAlertSettings {
  return {
    userId: String(row.user_id),
    alertsEnabled: row.alerts_enabled !== false,
    priceThresholdPct: clampThreshold(Number(row.price_threshold_pct ?? 4)),
    emailEnabled: row.email_enabled === true,
    lastScanAt: row.last_scan_at ? new Date(row.last_scan_at).toISOString() : null,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapAlert(row: any): AiBotAlert {
  const changeRaw = row.change_pct;
  const changePct =
    changeRaw != null && Number.isFinite(Number(changeRaw)) ? Number(changeRaw) : null;
  const emailStatusRaw = row.email_status != null ? String(row.email_status) : null;
  const emailStatus =
    emailStatusRaw === "sent" ||
    emailStatusRaw === "skipped_no_smtp" ||
    emailStatusRaw === "skipped_disabled" ||
    emailStatusRaw === "failed"
      ? emailStatusRaw
      : null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    ticker: String(row.ticker || "").toUpperCase(),
    kind: row.kind === "news" ? "news" : "price",
    title: String(row.title || ""),
    body: String(row.body || ""),
    changePct,
    newsTitle: row.news_title != null ? String(row.news_title) : null,
    newsLink: row.news_link != null ? String(row.news_link) : null,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    emailStatus,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function getAiAlertSettings(userId: string): Promise<AiAlertSettings> {
  await ensureAiAlertTables();
  const result = await db.execute(sql`
    SELECT user_id, alerts_enabled, price_threshold_pct, email_enabled, last_scan_at, updated_at
    FROM ai_bot_alert_settings WHERE user_id = ${userId}
  `);
  const row = asRows(result)[0];
  if (row) return mapSettings(row);
  await db.execute(sql`
    INSERT INTO ai_bot_alert_settings (user_id, alerts_enabled, price_threshold_pct, email_enabled)
    VALUES (${userId}, true, 4, false)
    ON CONFLICT (user_id) DO NOTHING
  `);
  return {
    userId,
    alertsEnabled: true,
    priceThresholdPct: 4,
    emailEnabled: false,
    lastScanAt: null,
    updatedAt: new Date().toISOString(),
  };
}

export async function saveAiAlertSettings(
  userId: string,
  patch: {
    alertsEnabled?: boolean;
    priceThresholdPct?: number;
    emailEnabled?: boolean;
  },
): Promise<AiAlertSettings> {
  await ensureAiAlertTables();
  const current = await getAiAlertSettings(userId);
  const alertsEnabled = patch.alertsEnabled ?? current.alertsEnabled;
  const priceThresholdPct =
    patch.priceThresholdPct != null
      ? clampThreshold(patch.priceThresholdPct)
      : current.priceThresholdPct;
  const emailEnabled = patch.emailEnabled ?? current.emailEnabled;
  await db.execute(sql`
    INSERT INTO ai_bot_alert_settings
      (user_id, alerts_enabled, price_threshold_pct, email_enabled, last_scan_at, updated_at)
    VALUES (
      ${userId},
      ${alertsEnabled},
      ${priceThresholdPct},
      ${emailEnabled},
      ${current.lastScanAt},
      NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      alerts_enabled = EXCLUDED.alerts_enabled,
      price_threshold_pct = EXCLUDED.price_threshold_pct,
      email_enabled = EXCLUDED.email_enabled,
      updated_at = NOW()
  `);
  return getAiAlertSettings(userId);
}

export async function touchAiAlertLastScan(userId: string): Promise<void> {
  await ensureAiAlertTables();
  await db.execute(sql`
    INSERT INTO ai_bot_alert_settings (user_id, last_scan_at, updated_at)
    VALUES (${userId}, NOW(), NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      last_scan_at = NOW(),
      updated_at = NOW()
  `);
}

export async function listEnabledAlertUsers(): Promise<AiAlertSettings[]> {
  await ensureAiAlertTables();
  const result = await db.execute(sql`
    SELECT user_id, alerts_enabled, price_threshold_pct, email_enabled, last_scan_at, updated_at
    FROM ai_bot_alert_settings
    WHERE alerts_enabled = true
  `);
  return asRows(result).map(mapSettings);
}

export async function listAiBotAlerts(
  userId: string,
  limit = 40,
): Promise<AiBotAlert[]> {
  await ensureAiAlertTables();
  const safeLimit = Math.min(Math.max(limit, 1), 80);
  const result = await db.execute(sql`
    SELECT * FROM ai_bot_alerts
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `);
  return asRows(result).map(mapAlert);
}

export async function countUnreadAiBotAlerts(userId: string): Promise<number> {
  await ensureAiAlertTables();
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM ai_bot_alerts
    WHERE user_id = ${userId} AND read_at IS NULL
  `);
  const row = asRows(result)[0] as { c?: number } | undefined;
  return Number(row?.c ?? 0);
}

export async function markAiBotAlertsRead(
  userId: string,
  opts: { alertId?: string; all?: boolean },
): Promise<number> {
  await ensureAiAlertTables();
  if (opts.all) {
    const result = await db.execute(sql`
      UPDATE ai_bot_alerts
      SET read_at = NOW()
      WHERE user_id = ${userId} AND read_at IS NULL
      RETURNING id
    `);
    return asRows(result).length;
  }
  const alertId = String(opts.alertId || "").trim();
  if (!alertId) return 0;
  const result = await db.execute(sql`
    UPDATE ai_bot_alerts
    SET read_at = NOW()
    WHERE user_id = ${userId} AND id = ${alertId} AND read_at IS NULL
    RETURNING id
  `);
  return asRows(result).length;
}

export async function countAlertsToday(userId: string): Promise<number> {
  await ensureAiAlertTables();
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM ai_bot_alerts
    WHERE user_id = ${userId}
      AND created_at >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date
                        AT TIME ZONE 'America/New_York'
  `);
  const row = asRows(result)[0] as { c?: number } | undefined;
  return Number(row?.c ?? 0);
}

export async function hasRecentAlertCooldown(
  userId: string,
  ticker: string,
  kind: AiAlertKind,
): Promise<boolean> {
  await ensureAiAlertTables();
  const t = ticker.toUpperCase();
  const result = await db.execute(sql`
    SELECT 1 FROM ai_bot_alerts
    WHERE user_id = ${userId}
      AND ticker = ${t}
      AND kind = ${kind}
      AND created_at > NOW() - INTERVAL '4 hours'
    LIMIT 1
  `);
  return asRows(result).length > 0;
}

export async function hasNewsTitleAlert(
  userId: string,
  newsTitle: string,
): Promise<boolean> {
  await ensureAiAlertTables();
  const title = newsTitle.trim();
  if (!title) return false;
  const result = await db.execute(sql`
    SELECT 1 FROM ai_bot_alerts
    WHERE user_id = ${userId}
      AND kind = 'news'
      AND lower(news_title) = lower(${title})
    LIMIT 1
  `);
  return asRows(result).length > 0;
}

export async function insertAiBotAlert(input: {
  userId: string;
  ticker: string;
  kind: AiAlertKind;
  title: string;
  body: string;
  changePct?: number | null;
  newsTitle?: string | null;
  newsLink?: string | null;
  emailStatus?: AiAlertEmailStatus;
}): Promise<AiBotAlert | null> {
  await ensureAiAlertTables();

  const todayCount = await countAlertsToday(input.userId);
  if (todayCount >= MAX_ALERTS_PER_DAY) return null;

  if (await hasRecentAlertCooldown(input.userId, input.ticker, input.kind)) {
    return null;
  }

  if (input.kind === "news" && input.newsTitle) {
    if (await hasNewsTitleAlert(input.userId, input.newsTitle)) return null;
  }

  const changePct =
    input.changePct != null && Number.isFinite(input.changePct) ? input.changePct : null;
  const emailStatus = input.emailStatus ?? null;

  const result = await db.execute(sql`
    INSERT INTO ai_bot_alerts
      (user_id, ticker, kind, title, body, change_pct, news_title, news_link, email_status)
    VALUES (
      ${input.userId},
      ${input.ticker.toUpperCase()},
      ${input.kind},
      ${input.title},
      ${input.body},
      ${changePct},
      ${input.newsTitle ?? null},
      ${input.newsLink ?? null},
      ${emailStatus}
    )
    RETURNING *
  `);
  const rows = (result as { rows?: any[] }).rows ?? asRows(result);
  const row = rows[0];
  if (!row) return null;
  return mapAlert(row);
}

export async function updateAlertEmailStatus(
  alertId: string,
  emailStatus: Exclude<AiAlertEmailStatus, null>,
): Promise<void> {
  await ensureAiAlertTables();
  await db.execute(sql`
    UPDATE ai_bot_alerts SET email_status = ${emailStatus} WHERE id = ${alertId}
  `);
}

export { COOLDOWN_HOURS, MAX_ALERTS_PER_DAY };
