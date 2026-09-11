import type { PaperBot, PaperBotStats, PaperTrade } from "./types";
import { listPaperLogs, listPositions, listTrades } from "./store";

export type AiRealityBucket = {
  trades: number;
  wins: number;
  winRatePct: number;
  avgPnl: number | null;
};

export type AiRealityStats = {
  sampleSize: number;
  withAiApplied: AiRealityBucket;
  withoutAi: AiRealityBucket;
  byEntryBias: {
    bullish: AiRealityBucket;
    bearish: AiRealityBucket;
    neutral: AiRealityBucket;
  };
  note: string;
};

function emptyBucket(): AiRealityBucket {
  return { trades: 0, wins: 0, winRatePct: 0, avgPnl: null };
}

function finalizeBucket(
  pnls: number[],
): AiRealityBucket {
  if (pnls.length === 0) return emptyBucket();
  const wins = pnls.filter((p) => p > 0).length;
  const avg = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  return {
    trades: pnls.length,
    wins,
    winRatePct: Math.round((wins / pnls.length) * 1000) / 10,
    avgPnl: Math.round(avg * 100) / 100,
  };
}

function computeAiReality(sells: PaperTrade[]): AiRealityStats {
  const applied: number[] = [];
  const notApplied: number[] = [];
  const byBias: Record<"bullish" | "bearish" | "neutral", number[]> = {
    bullish: [],
    bearish: [],
    neutral: [],
  };

  for (const t of sells) {
    const pnl = t.pnl;
    if (pnl == null) continue;
    const d = t.detail || {};
    const entryAi = d.entryAi as
      | { bias?: string; confidence?: number }
      | null
      | undefined;
    const hasEntryMeta =
      d.entryAiApplied != null || entryAi != null || d.aiApplied != null;

    // Prefer entry-time AI (stored on close); fall back to open trade fields if present
    const aiApplied =
      d.entryAiApplied === true ||
      (d.entryAiApplied == null && d.aiApplied === true && d.kind === "open");
    const aiNotApplied =
      d.entryAiApplied === false ||
      (d.entryAiApplied == null && d.aiApplied === false);

    if (aiApplied) applied.push(pnl);
    else if (aiNotApplied || hasEntryMeta) notApplied.push(pnl);

    const biasRaw = String(entryAi?.bias || "").toLowerCase();
    const bias =
      biasRaw === "bullish" || biasRaw === "bearish" || biasRaw === "neutral"
        ? biasRaw
        : null;
    if (bias) byBias[bias].push(pnl);
  }

  const sampleSize =
    applied.length +
    notApplied.length +
    byBias.bullish.length +
    byBias.bearish.length +
    byBias.neutral.length > 0
      ? Math.max(
          applied.length + notApplied.length,
          byBias.bullish.length +
            byBias.bearish.length +
            byBias.neutral.length,
        )
      : 0;

  return {
    sampleSize: applied.length + notApplied.length,
    withAiApplied: finalizeBucket(applied),
    withoutAi: finalizeBucket(notApplied),
    byEntryBias: {
      bullish: finalizeBucket(byBias.bullish),
      bearish: finalizeBucket(byBias.bearish),
      neutral: finalizeBucket(byBias.neutral),
    },
    note:
      sampleSize === 0
        ? "Zatiaľ málo uzavretých obchodov s uloženým AI vstupom. Po nových close sa tu porovná win rate s/bez AI."
        : "Porovnanie uzavretých obchodov podľa AI pri vstupe (nie predpoveď % úspešnosti jedného trade).",
  };
}

export async function computePaperBotStats(
  bot: PaperBot,
  equity: number,
): Promise<PaperBotStats> {
  const [trades, logs, positions] = await Promise.all([
    listTrades(bot.id, bot.userId, 500),
    listPaperLogs(bot.id, bot.userId, 500),
    listPositions(bot.id, bot.userId),
  ]);

  const sells = trades.filter(
    (t: PaperTrade) => t.side === "SELL" && t.pnl != null,
  );
  const wins = sells.filter((t) => (t.pnl ?? 0) > 0);
  const losses = sells.filter((t) => (t.pnl ?? 0) < 0);
  const realizedPnl = sells.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const avgWin =
    wins.length > 0
      ? wins.reduce((s, t) => s + (t.pnl ?? 0), 0) / wins.length
      : null;
  const avgLoss =
    losses.length > 0
      ? losses.reduce((s, t) => s + (t.pnl ?? 0), 0) / losses.length
      : null;

  return {
    realizedPnl: Math.round(realizedPnl * 100) / 100,
    returnPct:
      bot.startingCash > 0
        ? Math.round(((equity - bot.startingCash) / bot.startingCash) * 10000) /
          100
        : 0,
    closedTrades: sells.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct:
      sells.length > 0
        ? Math.round((wins.length / sells.length) * 1000) / 10
        : 0,
    avgWin: avgWin != null ? Math.round(avgWin * 100) / 100 : null,
    avgLoss: avgLoss != null ? Math.round(avgLoss * 100) / 100 : null,
    openPositions: positions.length,
    blockedEvents: logs.filter((l) => l.eventType === "blocked").length,
    openEvents: logs.filter((l) => l.eventType === "open").length,
    closeEvents: logs.filter((l) => l.eventType === "close").length,
    aiEvents: logs.filter((l) => l.eventType === "ai").length,
    aiReality: computeAiReality(sells),
  };
}
