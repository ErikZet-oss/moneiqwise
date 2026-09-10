import {
  atr,
  evaluateBollingerReversion,
  evaluateDualMomentum,
  evaluateEmaRsiTrend,
  evaluateExitRules,
  evaluateMaCrossover,
  evaluateMacdTrend,
  evaluateRsiMeanReversion,
  ema,
  macd,
  rsi,
  type SignalDecision,
} from "./indicators";
import {
  applyAiNudge,
  fetchPaperBotAiVerdicts,
  type AiMarketSnapshot,
  type AiSymbolVerdict,
} from "./aiLayer";
import {
  evaluateCustomStrategy,
  parseCustomStrategy,
} from "./customStrategy";
import {
  candleTfQuery,
  fetchOhlc,
  fetchLiveMark,
  normalizeCandleTf,
  type OhlcSeries,
} from "./marketData";
import { notifyPaperBotEvent } from "./notify";
import { getUsSession } from "./session";
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
import type { PaperBot, PaperPosition } from "./types";

function evaluateStrategy(
  bot: PaperBot,
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
): SignalDecision {
  if (bot.strategyId === "custom") {
    const custom = parseCustomStrategy(bot.customStrategy);
    if (custom) {
      return evaluateCustomStrategy(custom, closes, highs, lows, volumes);
    }
  }
  if (bot.strategyId === "ma_crossover") return evaluateMaCrossover(closes);
  if (bot.strategyId === "rsi_mean_reversion") {
    return evaluateRsiMeanReversion(closes);
  }
  if (bot.strategyId === "dual_momentum") return evaluateDualMomentum(closes);
  if (bot.strategyId === "macd_trend") return evaluateMacdTrend(closes);
  if (bot.strategyId === "bollinger_reversion") {
    return evaluateBollingerReversion(closes);
  }
  return evaluateEmaRsiTrend(closes);
}

async function logPipeline(
  bot: PaperBot,
  stage: string,
  message: string,
  detail?: Record<string, unknown>,
) {
  await insertPaperLog({
    botId: bot.id,
    userId: bot.userId,
    eventType: "pipeline",
    message: `[${stage}] ${message}`,
    detail: { stage, ...(detail || {}) },
  });
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
  void notifyPaperBotEvent({
    enabled: bot.notifyOnTrade,
    email: bot.notifyEmail,
    botName: bot.name,
    event: "open",
    message: `OPEN LONG ${symbol}\nqty=${qty} @ ${price}\n${reason}`,
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
  void notifyPaperBotEvent({
    enabled: bot.notifyOnTrade,
    email: bot.notifyEmail,
    botName: bot.name,
    event: "close",
    message: `CLOSE ${position.symbol}\nqty=${position.qty} @ ${price}\nPnL=${pnl}\n${reason}`,
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

  const candleTf = normalizeCandleTf(working.candleTf);
  const tfQ = candleTfQuery(candleTf);
  await insertPaperLog({
    botId: working.id,
    userId: working.userId,
    eventType: "tick",
    message: `Tick začal (${working.strategyId}, TF ${candleTf}, AI ${working.aiInfluencePct}%)`,
    detail: {
      symbols: working.symbols,
      cash: working.cash,
      exits: working.exits,
      candleTf,
    },
  });
  await logPipeline(
    working,
    "INGEST",
    `Načítavam Yahoo OHLCV (${candleTf}) / live mark`,
  );

  const prices = new Map<string, number>();
  const ohlcBySymbol = new Map<string, OhlcSeries>();
  const session = getUsSession();
  const live = session === "LIVE" || session === "EXTENDED";

  for (const symbol of working.symbols) {
    try {
      const ohlc = await fetchOhlc(symbol, { tf: candleTf });
      ohlcBySymbol.set(symbol, ohlc);
      let mark = ohlc.lastPrice;
      if (live) {
        const livePx = await fetchLiveMark(symbol);
        if (livePx != null) mark = livePx;
      }
      if (mark != null) prices.set(symbol, mark);
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
  await logPipeline(working, "DEDUP", `Pripravené ${prices.size} tickerov`);

  // AI layer once per tick (only if influence > 0)
  let aiVerdicts = new Map<string, AiSymbolVerdict>();
  if (working.aiInfluencePct > 0) {
    await logPipeline(working, "AI", "Claude news + market snapshot");
    const market: AiMarketSnapshot[] = working.symbols.map((symbol) => {
      const ohlc = ohlcBySymbol.get(symbol);
      const closes = ohlc?.closes ?? [];
      const m = closes.length ? macd(closes) : null;
      return {
        symbol,
        close: closes.length ? closes[closes.length - 1]! : null,
        rsi14: closes.length ? rsi(closes, 14) : null,
        ema50: closes.length ? ema(closes, 50) : null,
        ema200: closes.length ? ema(closes, 200) : null,
        macdHist: m?.hist ?? null,
      };
    });
    const ai = await fetchPaperBotAiVerdicts({
      symbols: working.symbols,
      market,
    });
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
        verdicts: Array.from(ai.verdicts.values()),
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
  await logPipeline(working, "SIGNAL", "Vyhodnocujem exits / signály");
  for (const pos of marked) {
    const ohlc = ohlcBySymbol.get(pos.symbol);
    const price = prices.get(pos.symbol);
    if (price == null || !ohlc || ohlc.closes.length < tfQ.minBars) continue;

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
      await logPipeline(working, "EXEC", `Close ${pos.symbol}: ${exitHit.reason}`);
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

    const signal = evaluateStrategy(
      working,
      ohlc.closes,
      ohlc.highs,
      ohlc.lows,
      ohlc.volumes,
    );
    await insertPaperLog({
      botId: working.id,
      userId: working.userId,
      eventType: "signal",
      symbol: pos.symbol,
      message: `Signal ${signal.action} (open pos) — ${signal.reason}`,
      detail: signal,
    });
    if (signal.action === "SELL") {
      await logPipeline(working, "EXEC", `Close ${pos.symbol}: ${signal.reason}`);
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
    if (price == null || !ohlc || ohlc.closes.length < tfQ.minBars) {
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

    const quant = evaluateStrategy(
      working,
      ohlc.closes,
      ohlc.highs,
      ohlc.lows,
      ohlc.volumes,
    );
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
      await logPipeline(working, "RISK", blockReason, { symbol });
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

    await logPipeline(working, "EXEC", `Open ${symbol}: ${nudged.reason}`);
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
    lastPipelineStage: "EXEC",
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
      const ohlc = await fetchOhlc(pos.symbol, { tf: "1d", range: "5d" });
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

  void notifyPaperBotEvent({
    enabled: bot.notifyOnTrade,
    email: bot.notifyEmail,
    botName: bot.name,
    event: "kill",
    message: `Kill Switch — bot ${bot.name} zastavený${closePositions ? ", pozície zatvorené" : ""}.`,
  });

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
    const ohlc = await fetchOhlc(p.symbol, { tf: "1d", range: "5d" });
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
