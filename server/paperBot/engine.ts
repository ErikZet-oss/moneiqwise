import {
  atr,
  evaluateDualMomentum,
  evaluateEmaRsiTrend,
  evaluateExitRules,
  evaluateMaCrossover,
  evaluateRsiMeanReversion,
  type SignalDecision,
} from "./indicators";
import { applyAiNudge, fetchPaperBotAiVerdicts, type AiSymbolVerdict } from "./aiLayer";
import { fetchDailyOhlc, type OhlcSeries } from "./marketData";
import {
  deletePosition,
  getPaperBot,
  insertEquityTick,
  insertPaperLog,
  insertPosition,
  insertTrade,
  listPositions,
  updatePaperBotLedger,
  updatePaperBotStatus,
  updatePositionPeak,
} from "./store";
import type { PaperBot, PaperPosition, PaperStrategyId } from "./types";

function evaluateStrategy(
  strategyId: PaperStrategyId,
  closes: number[],
): SignalDecision {
  if (strategyId === "ma_crossover") return evaluateMaCrossover(closes);
  if (strategyId === "rsi_mean_reversion") return evaluateRsiMeanReversion(closes);
  if (strategyId === "dual_momentum") return evaluateDualMomentum(closes);
  return evaluateEmaRsiTrend(closes);
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundQty(n: number): number {
  if (n >= 1) return Math.round(n * 10000) / 10000;
  return Math.round(n * 1e8) / 1e8;
}

async function markPositions(
  positions: PaperPosition[],
  prices: Map<string, number>,
): Promise<{ marked: PaperPosition[]; positionsValue: number }> {
  let positionsValue = 0;
  const marked: PaperPosition[] = [];
  for (const p of positions) {
    const mark = prices.get(p.symbol) ?? p.entryPrice;
    const peakPrice = Math.max(p.peakPrice || p.entryPrice, mark);
    if (peakPrice > (p.peakPrice || p.entryPrice)) {
      await updatePositionPeak(p.id, peakPrice);
    }
    const unrealizedPnl = (mark - p.entryPrice) * p.qty;
    positionsValue += mark * p.qty;
    marked.push({ ...p, markPrice: mark, peakPrice, unrealizedPnl });
  }
  return { marked, positionsValue };
}

function riskBlocksOpen(
  bot: PaperBot,
  equity: number,
  openCount: number,
): string | null {
  const dayPnlPct =
    bot.dayStartEquity > 0
      ? ((equity - bot.dayStartEquity) / bot.dayStartEquity) * 100
      : 0;
  if (dayPnlPct <= -bot.risk.dailyLossLimitPct) {
    return `Daily loss limit (${bot.risk.dailyLossLimitPct} %) — stop nových obchodov`;
  }
  const ddPct =
    bot.peakEquity > 0
      ? ((bot.peakEquity - equity) / bot.peakEquity) * 100
      : 0;
  if (ddPct >= bot.risk.maxDrawdownPct) {
    return `Max drawdown (${bot.risk.maxDrawdownPct} %) dosiahnutý`;
  }
  if (openCount >= bot.risk.maxOpenPositions) {
    return `Max open positions (${bot.risk.maxOpenPositions})`;
  }
  return null;
}

async function openLong(input: {
  bot: PaperBot;
  symbol: string;
  price: number;
  equity: number;
  reason: string;
  signal: SignalDecision;
}): Promise<{ cash: number; opened: boolean }> {
  const { bot, symbol, price, equity, reason, signal } = input;
  if (!(price > 0) || !(bot.cash > 0)) return { cash: bot.cash, opened: false };

  const budget = Math.min(
    bot.cash,
    equity * (bot.risk.maxPositionPct / 100),
  );
  if (budget < 1) {
    await insertPaperLog({
      botId: bot.id,
      userId: bot.userId,
      eventType: "blocked",
      symbol,
      message: `Príliš malý budget na nákup ${symbol}`,
      detail: { budget, cash: bot.cash },
    });
    return { cash: bot.cash, opened: false };
  }

  const qty = roundQty(budget / price);
  if (!(qty > 0)) return { cash: bot.cash, opened: false };
  const cost = roundMoney(qty * price);
  if (cost > bot.cash) return { cash: bot.cash, opened: false };

  const newCash = roundMoney(bot.cash - cost);
  await insertPosition({
    botId: bot.id,
    userId: bot.userId,
    symbol,
    qty,
    entryPrice: price,
    strategyId: bot.strategyId,
  });
  await insertTrade({
    botId: bot.id,
    userId: bot.userId,
    symbol,
    side: "BUY",
    qty,
    price,
    pnl: null,
    reason,
    strategyId: bot.strategyId,
  });
  await insertPaperLog({
    botId: bot.id,
    userId: bot.userId,
    eventType: "open",
    symbol,
    message: `OPEN LONG ${symbol} qty=${qty} @ ${price}`,
    detail: { qty, price, cost, reason, signal },
  });
  return { cash: newCash, opened: true };
}

async function closeLong(input: {
  bot: PaperBot;
  position: PaperPosition;
  price: number;
  reason: string;
  signal?: SignalDecision;
}): Promise<{ cash: number }> {
  const { bot, position, price, reason, signal } = input;
  const proceeds = roundMoney(position.qty * price);
  const pnl = roundMoney((price - position.entryPrice) * position.qty);
  const newCash = roundMoney(bot.cash + proceeds);

  await deletePosition(position.id);
  await insertTrade({
    botId: bot.id,
    userId: bot.userId,
    symbol: position.symbol,
    side: "SELL",
    qty: position.qty,
    price,
    pnl,
    reason,
    strategyId: bot.strategyId,
    openedAt: position.openedAt,
  });
  await insertPaperLog({
    botId: bot.id,
    userId: bot.userId,
    eventType: "close",
    symbol: position.symbol,
    message: `CLOSE ${position.symbol} qty=${position.qty} @ ${price} PnL=${pnl}`,
    detail: { qty: position.qty, price, pnl, reason, signal: signal ?? null },
  });
  return { cash: newCash };
}

export type TickResult = {
  botId: string;
  equity: number;
  cash: number;
  opens: number;
  closes: number;
  blocked: number;
  errors: number;
};

export async function tickPaperBot(
  botId: string,
  userId: string,
): Promise<TickResult | null> {
  const resolved = await getPaperBot(botId, userId);
  if (!resolved) return null;

  if (resolved.status === "killed") {
    return {
      botId: resolved.id,
      equity: resolved.cash,
      cash: resolved.cash,
      opens: 0,
      closes: 0,
      blocked: 0,
      errors: 0,
    };
  }

  let working: PaperBot = { ...resolved };
  let opens = 0;
  let closes = 0;
  let blocked = 0;
  let errors = 0;

  await insertPaperLog({
    botId: working.id,
    userId: working.userId,
    eventType: "tick",
    message: `Tick začal (${working.strategyId}, AI ${working.aiInfluencePct}%)`,
    detail: {
      symbols: working.symbols,
      cash: working.cash,
      exits: working.exits,
    },
  });

  const prices = new Map<string, number>();
  const ohlcBySymbol = new Map<string, OhlcSeries>();

  for (const symbol of working.symbols) {
    try {
      const ohlc = await fetchDailyOhlc(symbol);
      ohlcBySymbol.set(symbol, ohlc);
      if (ohlc.lastPrice != null) prices.set(symbol, ohlc.lastPrice);
    } catch (err) {
      errors += 1;
      await insertPaperLog({
        botId: working.id,
        userId: working.userId,
        eventType: "error",
        symbol,
        message: `Chyba dát pre ${symbol}`,
        detail: { error: String(err) },
      });
    }
  }

  // AI layer once per tick (only if influence > 0)
  let aiVerdicts = new Map<string, AiSymbolVerdict>();
  if (working.aiInfluencePct > 0) {
    const ai = await fetchPaperBotAiVerdicts({ symbols: working.symbols });
    aiVerdicts = ai.verdicts;
    await insertPaperLog({
      botId: working.id,
      userId: working.userId,
      eventType: "ai",
      message: ai.error
        ? `AI vrstva zlyhala — fallback na quant (${ai.error})`
        : `AI verdicts pre ${ai.verdicts.size} tickerov (news=${ai.newsCount})`,
      detail: {
        model: ai.model,
        error: ai.error,
        verdicts: [...ai.verdicts.values()],
      },
    });
  }

  let positions = await listPositions(working.id, working.userId);
  const { marked, positionsValue } = await markPositions(positions, prices);
  let equity = roundMoney(working.cash + positionsValue);

  const lastTickDay = working.lastTickAt
    ? working.lastTickAt.slice(0, 10)
    : null;
  const today = new Date().toISOString().slice(0, 10);
  let dayStartEquity = working.dayStartEquity;
  if (lastTickDay && lastTickDay !== today) {
    dayStartEquity = equity;
  }
  let peakEquity = Math.max(working.peakEquity, equity);
  working = { ...working, dayStartEquity, peakEquity };

  // Exits: absolute rules first, then strategy SELL
  for (const pos of marked) {
    const ohlc = ohlcBySymbol.get(pos.symbol);
    const price = prices.get(pos.symbol);
    if (price == null || !ohlc || ohlc.closes.length < 30) continue;

    const atrVal = atr(ohlc.highs, ohlc.lows, ohlc.closes, 14);
    const exitHit = evaluateExitRules({
      entryPrice: pos.entryPrice,
      peakPrice: pos.peakPrice,
      markPrice: price,
      atr: atrVal,
      trailingAtrMult: working.exits.trailingAtrMult,
      takeProfitPct: working.exits.takeProfitPct,
      hardStopPct: working.exits.hardStopPct,
    });

    if (exitHit.hit) {
      await insertPaperLog({
        botId: working.id,
        userId: working.userId,
        eventType: "signal",
        symbol: pos.symbol,
        message: `Exit rule — ${exitHit.reason}`,
        detail: exitHit.detail,
      });
      const res = await closeLong({
        bot: working,
        position: pos,
        price,
        reason: exitHit.reason,
      });
      working = { ...working, cash: res.cash };
      closes += 1;
      continue;
    }

    const signal = evaluateStrategy(working.strategyId, ohlc.closes);
    await insertPaperLog({
      botId: working.id,
      userId: working.userId,
      eventType: "signal",
      symbol: pos.symbol,
      message: `Signal ${signal.action} (open pos) — ${signal.reason}`,
      detail: signal,
    });
    if (signal.action === "SELL") {
      const res = await closeLong({
        bot: working,
        position: pos,
        price,
        reason: signal.reason,
        signal,
      });
      working = { ...working, cash: res.cash };
      closes += 1;
    }
  }

  positions = await listPositions(working.id, working.userId);
  const remount = await markPositions(positions, prices);
  equity = roundMoney(working.cash + remount.positionsValue);
  peakEquity = Math.max(peakEquity, equity);
  working = { ...working, peakEquity };

  // Entries
  for (const symbol of working.symbols) {
    if (positions.some((p) => p.symbol === symbol)) continue;
    const ohlc = ohlcBySymbol.get(symbol);
    const price = prices.get(symbol);
    if (price == null || !ohlc || ohlc.closes.length < 30) {
      await insertPaperLog({
        botId: working.id,
        userId: working.userId,
        eventType: "blocked",
        symbol,
        message: `Preskočené ${symbol} — málo dát`,
      });
      blocked += 1;
      continue;
    }

    const quant = evaluateStrategy(working.strategyId, ohlc.closes);
    const nudged = applyAiNudge({
      signal: quant,
      verdict: aiVerdicts.get(symbol) ?? null,
      influencePct: working.aiInfluencePct,
      minConfidence: working.aiMinConfidence,
    });

    await insertPaperLog({
      botId: working.id,
      userId: working.userId,
      eventType: "signal",
      symbol,
      message: `Signal ${nudged.action} — ${nudged.reason}`,
      detail: nudged,
    });

    if (nudged.aiBlocked || (nudged.aiApplied && nudged.action === "HOLD" && quant.action === "BUY")) {
      blocked += 1;
      await insertPaperLog({
        botId: working.id,
        userId: working.userId,
        eventType: "blocked",
        symbol,
        message: nudged.reason,
        detail: nudged,
      });
      continue;
    }

    if (nudged.action !== "BUY") continue;

    const blockReason = riskBlocksOpen(working, equity, positions.length);
    if (blockReason) {
      blocked += 1;
      await insertPaperLog({
        botId: working.id,
        userId: working.userId,
        eventType: "blocked",
        symbol,
        message: blockReason,
        detail: { equity, openPositions: positions.length },
      });
      continue;
    }

    const res = await openLong({
      bot: working,
      symbol,
      price,
      equity,
      reason: nudged.reason,
      signal: nudged,
    });
    working = { ...working, cash: res.cash };
    if (res.opened) {
      opens += 1;
      positions = await listPositions(working.id, working.userId);
      const m = await markPositions(positions, prices);
      equity = roundMoney(working.cash + m.positionsValue);
      peakEquity = Math.max(peakEquity, equity);
      working = { ...working, peakEquity };
    }
  }

  const finalPos = await listPositions(working.id, working.userId);
  const finalMark = await markPositions(finalPos, prices);
  equity = roundMoney(working.cash + finalMark.positionsValue);
  peakEquity = Math.max(peakEquity, equity);

  await updatePaperBotLedger(working.id, {
    cash: working.cash,
    dayStartEquity,
    peakEquity,
    lastTickAt: new Date(),
  });
  await insertEquityTick(working.id, equity, working.cash);

  await insertPaperLog({
    botId: working.id,
    userId: working.userId,
    eventType: "tick",
    message: `Tick hotový — equity ${equity}, opens=${opens}, closes=${closes}, blocked=${blocked}`,
    detail: { equity, cash: working.cash, opens, closes, blocked, errors },
  });

  return {
    botId: working.id,
    equity,
    cash: working.cash,
    opens,
    closes,
    blocked,
    errors,
  };
}

export async function killPaperBot(
  botId: string,
  userId: string,
  closePositions = true,
): Promise<PaperBot | null> {
  const bot = await getPaperBot(botId, userId);
  if (!bot) return null;

  if (closePositions) {
    const positions = await listPositions(botId, userId);
    let cash = bot.cash;
    for (const pos of positions) {
      const ohlc = await fetchDailyOhlc(pos.symbol, "5d");
      const price = ohlc.lastPrice ?? pos.entryPrice;
      const res = await closeLong({
        bot: { ...bot, cash },
        position: pos,
        price,
        reason: "Kill Switch — zatvorenie všetkých pozícií",
      });
      cash = res.cash;
    }
    await updatePaperBotLedger(botId, { cash, lastTickAt: new Date() });
  }

  return updatePaperBotStatus(botId, userId, "killed");
}

export async function computeBotEquity(
  botId: string,
  userId: string,
): Promise<{
  bot: PaperBot;
  equity: number;
  positions: PaperPosition[];
  dayPnl: number;
  dayPnlPct: number;
  drawdownPct: number;
} | null> {
  const bot = await getPaperBot(botId, userId);
  if (!bot) return null;
  const positions = await listPositions(botId, userId);
  const prices = new Map<string, number>();
  for (const p of positions) {
    const ohlc = await fetchDailyOhlc(p.symbol, "5d");
    if (ohlc.lastPrice != null) prices.set(p.symbol, ohlc.lastPrice);
  }
  const { marked, positionsValue } = await markPositions(positions, prices);
  const equity = roundMoney(bot.cash + positionsValue);
  const dayPnl = roundMoney(equity - bot.dayStartEquity);
  const dayPnlPct =
    bot.dayStartEquity > 0 ? (dayPnl / bot.dayStartEquity) * 100 : 0;
  const drawdownPct =
    bot.peakEquity > 0
      ? Math.max(0, ((bot.peakEquity - equity) / bot.peakEquity) * 100)
      : 0;
  return {
    bot,
    equity,
    positions: marked,
    dayPnl,
    dayPnlPct,
    drawdownPct,
  };
}
