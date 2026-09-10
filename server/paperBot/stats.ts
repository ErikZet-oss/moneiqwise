import type { PaperBot, PaperBotStats, PaperTrade } from "./types";
import { listPaperLogs, listPositions, listTrades } from "./store";

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
  };
}
