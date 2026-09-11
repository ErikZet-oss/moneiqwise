import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  DEFAULT_EXITS,
  DEFAULT_RISK,
  type PaperBot,
  type PaperBotExitSettings,
  type PaperBotLog,
  type PaperBotRiskSettings,
  type PaperBotStatus,
  type PaperEquityTick,
  type PaperLogEventType,
  type PaperPosition,
  type PaperCandleTf,
  type PaperStrategyId,
  type PaperTrade,
} from "./types";

let tablesReady: Promise<void> | null = null;

function asRows<T = any>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] };
  return Array.isArray(r?.rows) ? r.rows : [];
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function mapRisk(raw: unknown): PaperBotRiskSettings {
  const r = parseJson<Partial<PaperBotRiskSettings>>(raw, {});
  return {
    dailyLossLimitPct: num(r.dailyLossLimitPct, DEFAULT_RISK.dailyLossLimitPct),
    maxDrawdownPct: num(r.maxDrawdownPct, DEFAULT_RISK.maxDrawdownPct),
    maxOpenPositions: Math.max(
      1,
      Math.floor(num(r.maxOpenPositions, DEFAULT_RISK.maxOpenPositions)),
    ),
    maxPositionPct: num(r.maxPositionPct, DEFAULT_RISK.maxPositionPct),
  };
}

function mapExits(raw: unknown): PaperBotExitSettings {
  const r = parseJson<Partial<PaperBotExitSettings>>(raw, {});
  return {
    trailingAtrMult: num(r.trailingAtrMult, DEFAULT_EXITS.trailingAtrMult),
    takeProfitPct: num(r.takeProfitPct, DEFAULT_EXITS.takeProfitPct),
    hardStopPct: num(r.hardStopPct, DEFAULT_EXITS.hardStopPct),
  };
}

function mapBot(row: any): PaperBot {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name || "Paper Bot"),
    status: (row.status as PaperBotStatus) || "paused",
    startingCash: num(row.starting_cash),
    cash: num(row.cash),
    currency: String(row.currency || "EUR"),
    strategyId: (row.strategy_id as PaperStrategyId) || "ema_rsi_trend",
    customStrategy: parseJson(row.strategy_json, null),
    symbols: parseJson<string[]>(row.symbols_json, []),
    candleTf: (["1d", "1h", "15m"].includes(String(row.candle_tf))
      ? String(row.candle_tf)
      : "1d") as PaperCandleTf,
    risk: mapRisk(row.risk_json),
    exits: mapExits(row.exit_json),
    aiInfluencePct: num(row.ai_influence_pct, 20),
    aiMinConfidence: num(row.ai_min_confidence, 60),
    notifyEmail: row.notify_email != null ? String(row.notify_email) : null,
    notifyOnTrade: row.notify_on_trade === true || row.notify_on_trade === "t",
    dayStartEquity: num(row.day_start_equity, num(row.starting_cash)),
    peakEquity: num(row.peak_equity, num(row.starting_cash)),
    lastTickAt: row.last_tick_at
      ? new Date(row.last_tick_at).toISOString()
      : null,
    lastPipelineStage:
      row.last_pipeline_stage != null ? String(row.last_pipeline_stage) : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapPosition(row: any): PaperPosition {
  const entry = num(row.entry_price);
  let openDetail: Record<string, unknown> | null = null;
  if (row.open_detail_json != null) {
    openDetail =
      typeof row.open_detail_json === "string"
        ? (JSON.parse(row.open_detail_json) as Record<string, unknown>)
        : (row.open_detail_json as Record<string, unknown>);
  }
  return {
    id: String(row.id),
    botId: String(row.bot_id),
    userId: String(row.user_id),
    symbol: String(row.symbol),
    qty: num(row.qty),
    entryPrice: entry,
    peakPrice: num(row.peak_price, entry),
    markPrice: null,
    unrealizedPnl: null,
    openedAt: new Date(row.opened_at).toISOString(),
    strategyId: row.strategy_id as PaperStrategyId,
    openReason: row.open_reason != null ? String(row.open_reason) : null,
    openDetail,
  };
}

export function ensurePaperBotTables(): Promise<void> {
  if (!tablesReady) {
    tablesReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS paper_bots (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
          user_id VARCHAR NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'paused',
          starting_cash DOUBLE PRECISION NOT NULL,
          cash DOUBLE PRECISION NOT NULL,
          currency TEXT NOT NULL DEFAULT 'EUR',
          strategy_id TEXT NOT NULL DEFAULT 'ema_rsi_trend',
          symbols_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          candle_tf TEXT NOT NULL DEFAULT '1d',
          risk_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          exit_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          ai_influence_pct DOUBLE PRECISION NOT NULL DEFAULT 20,
          ai_min_confidence DOUBLE PRECISION NOT NULL DEFAULT 60,
          day_start_equity DOUBLE PRECISION NOT NULL,
          peak_equity DOUBLE PRECISION NOT NULL,
          last_tick_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await db.execute(sql`
        ALTER TABLE paper_bots
          ADD COLUMN IF NOT EXISTS exit_json JSONB NOT NULL DEFAULT '{}'::jsonb
      `);
      await db.execute(sql`
        ALTER TABLE paper_bots
          ADD COLUMN IF NOT EXISTS ai_min_confidence DOUBLE PRECISION NOT NULL DEFAULT 60
      `);
      await db.execute(sql`
        ALTER TABLE paper_bots
          ADD COLUMN IF NOT EXISTS strategy_json JSONB
      `);
      await db.execute(sql`
        ALTER TABLE paper_bots
          ADD COLUMN IF NOT EXISTS notify_email TEXT
      `);
      await db.execute(sql`
        ALTER TABLE paper_bots
          ADD COLUMN IF NOT EXISTS notify_on_trade BOOLEAN NOT NULL DEFAULT false
      `);
      await db.execute(sql`
        ALTER TABLE paper_bots
          ADD COLUMN IF NOT EXISTS last_pipeline_stage TEXT
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS paper_bots_user_idx
          ON paper_bots (user_id, created_at DESC);
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS paper_bots_running_idx
          ON paper_bots (status) WHERE status = 'running';
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS paper_positions (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
          bot_id VARCHAR NOT NULL REFERENCES paper_bots(id) ON DELETE CASCADE,
          user_id VARCHAR NOT NULL,
          symbol TEXT NOT NULL,
          qty DOUBLE PRECISION NOT NULL,
          entry_price DOUBLE PRECISION NOT NULL,
          peak_price DOUBLE PRECISION,
          opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          strategy_id TEXT NOT NULL
        );
      `);
      await db.execute(sql`
        ALTER TABLE paper_positions
          ADD COLUMN IF NOT EXISTS peak_price DOUBLE PRECISION
      `);
      await db.execute(sql`
        UPDATE paper_positions
        SET peak_price = entry_price
        WHERE peak_price IS NULL
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS paper_positions_bot_symbol_idx
          ON paper_positions (bot_id, symbol);
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS paper_trades (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
          bot_id VARCHAR NOT NULL REFERENCES paper_bots(id) ON DELETE CASCADE,
          user_id VARCHAR NOT NULL,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL,
          qty DOUBLE PRECISION NOT NULL,
          price DOUBLE PRECISION NOT NULL,
          pnl DOUBLE PRECISION,
          reason TEXT NOT NULL,
          strategy_id TEXT NOT NULL,
          opened_at TIMESTAMPTZ,
          closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS paper_trades_bot_closed_idx
          ON paper_trades (bot_id, closed_at DESC);
      `);
      await db.execute(sql`
        ALTER TABLE paper_trades
          ADD COLUMN IF NOT EXISTS detail_json JSONB
      `);
      await db.execute(sql`
        ALTER TABLE paper_positions
          ADD COLUMN IF NOT EXISTS open_reason TEXT
      `);
      await db.execute(sql`
        ALTER TABLE paper_positions
          ADD COLUMN IF NOT EXISTS open_detail_json JSONB
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS paper_bot_logs (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
          bot_id VARCHAR NOT NULL REFERENCES paper_bots(id) ON DELETE CASCADE,
          user_id VARCHAR NOT NULL,
          event_type TEXT NOT NULL,
          symbol TEXT,
          message TEXT NOT NULL,
          detail_json JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS paper_bot_logs_bot_created_idx
          ON paper_bot_logs (bot_id, created_at DESC);
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS paper_equity_ticks (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
          bot_id VARCHAR NOT NULL REFERENCES paper_bots(id) ON DELETE CASCADE,
          equity DOUBLE PRECISION NOT NULL,
          cash DOUBLE PRECISION NOT NULL,
          ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS paper_equity_ticks_bot_ts_idx
          ON paper_equity_ticks (bot_id, ts DESC);
      `);
    })();
  }
  return tablesReady;
}

export async function createPaperBot(input: {
  userId: string;
  name: string;
  startingCash: number;
  currency?: string;
  strategyId?: PaperStrategyId;
  customStrategy?: unknown | null;
  symbols: string[];
  candleTf?: PaperCandleTf | string;
  risk?: Partial<PaperBotRiskSettings>;
  exits?: Partial<PaperBotExitSettings>;
  aiInfluencePct?: number;
  aiMinConfidence?: number;
  notifyEmail?: string | null;
  notifyOnTrade?: boolean;
}): Promise<PaperBot> {
  await ensurePaperBotTables();
  const cash = Math.max(1, Number(input.startingCash) || 0);
  const risk = { ...DEFAULT_RISK, ...(input.risk || {}) };
  const exits = { ...DEFAULT_EXITS, ...(input.exits || {}) };
  const strategyId = input.strategyId || "ema_rsi_trend";
  const candleTfRaw = String(input.candleTf || "1d").toLowerCase();
  const candleTf: PaperCandleTf =
    candleTfRaw === "15m" || candleTfRaw === "1h" ? candleTfRaw : "1d";
  const symbols = input.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  const currency = (input.currency || "EUR").toUpperCase();
  const name = input.name.trim() || "Paper Bot";
  const aiInfluencePct = Math.min(
    100,
    Math.max(0, num(input.aiInfluencePct, 20)),
  );
  const aiMinConfidence = Math.min(
    100,
    Math.max(0, num(input.aiMinConfidence, 60)),
  );
  const notifyEmail = input.notifyEmail?.trim() || null;
  const notifyOnTrade = !!input.notifyOnTrade && !!notifyEmail;
  const riskJson = JSON.stringify(risk);
  const exitJson = JSON.stringify(exits);
  const symbolsJson = JSON.stringify(symbols);
  const strategyJson =
    input.customStrategy != null
      ? JSON.stringify(input.customStrategy)
      : null;

  const result = await db.execute(sql`
    INSERT INTO paper_bots (
      user_id, name, status, starting_cash, cash, currency,
      strategy_id, strategy_json, symbols_json, candle_tf, risk_json, exit_json,
      ai_influence_pct, ai_min_confidence,
      notify_email, notify_on_trade,
      day_start_equity, peak_equity
    ) VALUES (
      ${input.userId}, ${name}, 'paused', ${cash}, ${cash}, ${currency},
      ${strategyId}, ${strategyJson}::jsonb, ${symbolsJson}::jsonb, ${candleTf},
      ${riskJson}::jsonb, ${exitJson}::jsonb,
      ${aiInfluencePct}, ${aiMinConfidence},
      ${notifyEmail}, ${notifyOnTrade},
      ${cash}, ${cash}
    )
    RETURNING *
  `);
  const rows = (result as { rows?: any[] }).rows ?? asRows(result);
  const row = rows[0];
  if (!row) throw new Error("PAPER_BOT_INSERT_FAILED");
  const bot = mapBot(row);
  await insertPaperLog({
    botId: bot.id,
    userId: input.userId,
    eventType: "status",
    message: `Bot vytvorený s kapitálom ${cash} ${currency}`,
    detail: {
      strategyId,
      candleTf,
      symbols,
      risk,
      exits,
      aiInfluencePct,
      notifyOnTrade,
    },
  });
  await insertEquityTick(bot.id, cash, cash);
  return bot;
}

export async function listPaperBots(userId: string): Promise<PaperBot[]> {
  await ensurePaperBotTables();
  const result = await db.execute(sql`
    SELECT * FROM paper_bots
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `);
  return asRows(result).map(mapBot);
}

export async function getPaperBot(
  botId: string,
  userId: string,
): Promise<PaperBot | null> {
  await ensurePaperBotTables();
  const result = await db.execute(sql`
    SELECT * FROM paper_bots
    WHERE id = ${botId} AND user_id = ${userId}
  `);
  const row = asRows(result)[0];
  return row ? mapBot(row) : null;
}

export async function listRunningPaperBots(): Promise<PaperBot[]> {
  await ensurePaperBotTables();
  const result = await db.execute(sql`
    SELECT * FROM paper_bots WHERE status = 'running'
  `);
  return asRows(result).map(mapBot);
}

export async function updatePaperBotStatus(
  botId: string,
  userId: string,
  status: PaperBotStatus,
): Promise<PaperBot | null> {
  await ensurePaperBotTables();
  const result = await db.execute(sql`
    UPDATE paper_bots
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${botId} AND user_id = ${userId}
    RETURNING *
  `);
  const row = asRows(result)[0];
  if (!row) return null;
  const bot = mapBot(row);
  await insertPaperLog({
    botId,
    userId,
    eventType: status === "killed" ? "kill" : "status",
    message:
      status === "running"
        ? "Bot spustený"
        : status === "paused"
          ? "Bot pozastavený"
          : "Kill Switch — bot zastavený",
  });
  return bot;
}

export async function updatePaperBotSettings(
  botId: string,
  userId: string,
  input: {
    name?: string;
    strategyId?: PaperStrategyId;
    customStrategy?: unknown | null;
    symbols?: string[];
    candleTf?: PaperCandleTf | string;
    risk?: Partial<PaperBotRiskSettings>;
    exits?: Partial<PaperBotExitSettings>;
    aiInfluencePct?: number;
    aiMinConfidence?: number;
    notifyEmail?: string | null;
    notifyOnTrade?: boolean;
  },
): Promise<PaperBot | null> {
  await ensurePaperBotTables();
  const existing = await getPaperBot(botId, userId);
  if (!existing) return null;
  if (existing.status === "killed") {
    throw new Error("PAPER_BOT_KILLED");
  }

  const name = (input.name ?? existing.name).trim() || existing.name;
  const strategyId = input.strategyId ?? existing.strategyId;
  const candleTfRaw = String(input.candleTf ?? existing.candleTf).toLowerCase();
  const candleTf: PaperCandleTf =
    candleTfRaw === "15m" || candleTfRaw === "1h" ? candleTfRaw : "1d";
  const symbols = (
    input.symbols ?? existing.symbols
  )
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (symbols.length === 0) throw new Error("PAPER_BOT_NO_SYMBOLS");

  const risk = { ...existing.risk, ...(input.risk || {}) };
  const exits = { ...existing.exits, ...(input.exits || {}) };
  const aiInfluencePct = Math.min(
    100,
    Math.max(
      0,
      num(
        input.aiInfluencePct != null
          ? input.aiInfluencePct
          : existing.aiInfluencePct,
        20,
      ),
    ),
  );
  const aiMinConfidence = Math.min(
    100,
    Math.max(
      0,
      num(
        input.aiMinConfidence != null
          ? input.aiMinConfidence
          : existing.aiMinConfidence,
        60,
      ),
    ),
  );
  const notifyEmail =
    input.notifyEmail !== undefined
      ? input.notifyEmail?.trim() || null
      : existing.notifyEmail;
  const notifyOnTrade =
    input.notifyOnTrade !== undefined
      ? !!input.notifyOnTrade && !!notifyEmail
      : existing.notifyOnTrade && !!notifyEmail;

  let customStrategy = existing.customStrategy;
  if (strategyId === "custom") {
    if (input.customStrategy !== undefined) {
      customStrategy = input.customStrategy;
    }
  } else if (input.strategyId && input.strategyId !== "custom") {
    customStrategy = null;
  }

  const riskJson = JSON.stringify(risk);
  const exitJson = JSON.stringify(exits);
  const symbolsJson = JSON.stringify(symbols);
  const strategyJson =
    customStrategy != null ? JSON.stringify(customStrategy) : null;

  const result = await db.execute(sql`
    UPDATE paper_bots SET
      name = ${name},
      strategy_id = ${strategyId},
      strategy_json = ${strategyJson}::jsonb,
      symbols_json = ${symbolsJson}::jsonb,
      candle_tf = ${candleTf},
      risk_json = ${riskJson}::jsonb,
      exit_json = ${exitJson}::jsonb,
      ai_influence_pct = ${aiInfluencePct},
      ai_min_confidence = ${aiMinConfidence},
      notify_email = ${notifyEmail},
      notify_on_trade = ${notifyOnTrade},
      updated_at = NOW()
    WHERE id = ${botId} AND user_id = ${userId}
    RETURNING *
  `);
  const row = asRows(result)[0];
  if (!row) return null;
  const bot = mapBot(row);
  await insertPaperLog({
    botId,
    userId,
    eventType: "status",
    message: `Nastavenia aktualizované (${strategyId}, TF ${candleTf})`,
    detail: {
      name,
      strategyId,
      candleTf,
      symbols,
      risk,
      exits,
      aiInfluencePct,
      aiMinConfidence,
      notifyOnTrade,
    },
  });
  return bot;
}

export async function updatePaperBotLedger(
  botId: string,
  patch: {
    cash?: number;
    dayStartEquity?: number;
    peakEquity?: number;
    lastTickAt?: Date;
    lastPipelineStage?: string | null;
  },
): Promise<void> {
  await ensurePaperBotTables();
  const cash = patch.cash;
  const dayStart = patch.dayStartEquity;
  const peak = patch.peakEquity;
  const tick = patch.lastTickAt ?? new Date();
  const stage = patch.lastPipelineStage;
  await db.execute(sql`
    UPDATE paper_bots SET
      cash = COALESCE(${cash ?? null}, cash),
      day_start_equity = COALESCE(${dayStart ?? null}, day_start_equity),
      peak_equity = COALESCE(${peak ?? null}, peak_equity),
      last_tick_at = ${tick},
      last_pipeline_stage = COALESCE(${stage ?? null}, last_pipeline_stage),
      updated_at = NOW()
    WHERE id = ${botId}
  `);
}

export async function deletePaperBot(
  botId: string,
  userId: string,
): Promise<boolean> {
  await ensurePaperBotTables();
  const result = await db.execute(sql`
    DELETE FROM paper_bots
    WHERE id = ${botId} AND user_id = ${userId}
    RETURNING id
  `);
  return asRows(result).length > 0;
}

export async function listPositions(
  botId: string,
  userId: string,
): Promise<PaperPosition[]> {
  await ensurePaperBotTables();
  const result = await db.execute(sql`
    SELECT * FROM paper_positions
    WHERE bot_id = ${botId} AND user_id = ${userId}
    ORDER BY opened_at DESC
  `);
  return asRows(result).map(mapPosition);
}

export async function insertPosition(input: {
  botId: string;
  userId: string;
  symbol: string;
  qty: number;
  entryPrice: number;
  strategyId: PaperStrategyId;
  openReason?: string | null;
  openDetail?: Record<string, unknown> | null;
}): Promise<PaperPosition> {
  await ensurePaperBotTables();
  const openReason = input.openReason?.trim() || null;
  const detailJson =
    input.openDetail != null ? JSON.stringify(input.openDetail) : null;
  const result = await db.execute(sql`
    INSERT INTO paper_positions (
      bot_id, user_id, symbol, qty, entry_price, peak_price, strategy_id,
      open_reason, open_detail_json
    ) VALUES (
      ${input.botId}, ${input.userId}, ${input.symbol},
      ${input.qty}, ${input.entryPrice}, ${input.entryPrice}, ${input.strategyId},
      ${openReason}, ${detailJson}::jsonb
    )
    RETURNING *
  `);
  const row = asRows(result)[0] as any;
  const pos = mapPosition(row);
  return {
    ...pos,
    markPrice: input.entryPrice,
    unrealizedPnl: 0,
  };
}

export async function updatePositionPeak(
  positionId: string,
  peakPrice: number,
): Promise<void> {
  await ensurePaperBotTables();
  await db.execute(sql`
    UPDATE paper_positions
    SET peak_price = ${peakPrice}
    WHERE id = ${positionId} AND peak_price < ${peakPrice}
  `);
}

export async function deletePosition(positionId: string): Promise<void> {
  await ensurePaperBotTables();
  await db.execute(sql`
    DELETE FROM paper_positions WHERE id = ${positionId}
  `);
}

export async function insertTrade(input: {
  botId: string;
  userId: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  pnl: number | null;
  reason: string;
  strategyId: PaperStrategyId;
  openedAt?: string | null;
  detail?: Record<string, unknown> | null;
}): Promise<PaperTrade> {
  await ensurePaperBotTables();
  const openedAt = input.openedAt ? new Date(input.openedAt) : null;
  const detailJson =
    input.detail != null ? JSON.stringify(input.detail) : null;
  const result = await db.execute(sql`
    INSERT INTO paper_trades (
      bot_id, user_id, symbol, side, qty, price, pnl, reason, strategy_id, opened_at,
      detail_json
    ) VALUES (
      ${input.botId}, ${input.userId}, ${input.symbol}, ${input.side},
      ${input.qty}, ${input.price}, ${input.pnl}, ${input.reason},
      ${input.strategyId}, ${openedAt}, ${detailJson}::jsonb
    )
    RETURNING *
  `);
  const row = asRows(result)[0] as any;
  return mapTrade(row);
}

function mapTrade(row: any): PaperTrade {
  let detail: Record<string, unknown> | null = null;
  if (row.detail_json != null) {
    detail =
      typeof row.detail_json === "string"
        ? (JSON.parse(row.detail_json) as Record<string, unknown>)
        : (row.detail_json as Record<string, unknown>);
  }
  return {
    id: String(row.id),
    botId: String(row.bot_id),
    userId: String(row.user_id),
    symbol: String(row.symbol),
    side: row.side as "BUY" | "SELL",
    qty: num(row.qty),
    price: num(row.price),
    pnl: row.pnl == null ? null : num(row.pnl),
    reason: String(row.reason),
    strategyId: row.strategy_id as PaperStrategyId,
    openedAt: row.opened_at ? new Date(row.opened_at).toISOString() : null,
    closedAt: new Date(row.closed_at).toISOString(),
    detail,
  };
}

export async function listTrades(
  botId: string,
  userId: string,
  limit = 50,
): Promise<PaperTrade[]> {
  await ensurePaperBotTables();
  const result = await db.execute(sql`
    SELECT * FROM paper_trades
    WHERE bot_id = ${botId} AND user_id = ${userId}
    ORDER BY closed_at DESC
    LIMIT ${limit}
  `);
  return asRows(result).map((row: any) => mapTrade(row));
}

export async function insertPaperLog(input: {
  botId: string;
  userId: string;
  eventType: PaperLogEventType;
  message: string;
  symbol?: string | null;
  detail?: Record<string, unknown> | null;
}): Promise<void> {
  await ensurePaperBotTables();
  const detailJson = input.detail ? JSON.stringify(input.detail) : null;
  await db.execute(sql`
    INSERT INTO paper_bot_logs (
      bot_id, user_id, event_type, symbol, message, detail_json
    ) VALUES (
      ${input.botId}, ${input.userId}, ${input.eventType},
      ${input.symbol ?? null}, ${input.message},
      ${detailJson}::jsonb
    )
  `);
}

export async function listPaperLogs(
  botId: string,
  userId: string,
  limit = 100,
): Promise<PaperBotLog[]> {
  await ensurePaperBotTables();
  const result = await db.execute(sql`
    SELECT * FROM paper_bot_logs
    WHERE bot_id = ${botId} AND user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);
  return asRows(result).map((row: any) => ({
    id: String(row.id),
    botId: String(row.bot_id),
    userId: String(row.user_id),
    eventType: row.event_type as PaperLogEventType,
    symbol: row.symbol != null ? String(row.symbol) : null,
    message: String(row.message),
    detail: parseJson<Record<string, unknown> | null>(row.detail_json, null),
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function insertEquityTick(
  botId: string,
  equity: number,
  cash: number,
): Promise<void> {
  await ensurePaperBotTables();
  await db.execute(sql`
    INSERT INTO paper_equity_ticks (bot_id, equity, cash)
    VALUES (${botId}, ${equity}, ${cash})
  `);
}

export async function listEquityTicks(
  botId: string,
  userId: string,
  limit = 120,
): Promise<PaperEquityTick[]> {
  await ensurePaperBotTables();
  const owned = await getPaperBot(botId, userId);
  if (!owned) return [];
  const result = await db.execute(sql`
    SELECT equity, cash, ts FROM paper_equity_ticks
    WHERE bot_id = ${botId}
    ORDER BY ts DESC
    LIMIT ${limit}
  `);
  return asRows(result)
    .map((row: any) => ({
      ts: new Date(row.ts).toISOString(),
      equity: num(row.equity),
      cash: num(row.cash),
    }))
    .reverse();
}
