import {
  evaluateBollingerReversion,
  evaluateDualMomentum,
  evaluateEmaRsiTrend,
  evaluateExitRules,
  evaluateMaCrossover,
  evaluateMacdTrend,
  evaluateRsiMeanReversion,
  atr,
} from "./indicators";
import {
  evaluateCustomStrategy,
  type CustomStrategyDef,
} from "./customStrategy";
import {
  candleTfQuery,
  fetchOhlc,
  normalizeCandleTf,
} from "./marketData";
import type {
  PaperBotExitSettings,
  PaperCandleTf,
  PaperStrategyId,
} from "./types";

export type BacktestTrade = {
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  qty: number;
  pnl: number | null;
  reason: string;
  barIndex: number;
};

export type BacktestResult = {
  startingCash: number;
  endingEquity: number;
  returnPct: number;
  trades: BacktestTrade[];
  wins: number;
  losses: number;
  winRatePct: number;
  equityCurve: Array<{ i: number; equity: number }>;
  barsUsed: number;
  candleTf: PaperCandleTf;
};

function evaluate(
  strategyId: PaperStrategyId | "custom",
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
  custom: CustomStrategyDef | null,
) {
  if (strategyId === "custom" && custom) {
    return evaluateCustomStrategy(custom, closes, highs, lows, volumes);
  }
  if (strategyId === "ma_crossover") return evaluateMaCrossover(closes);
  if (strategyId === "rsi_mean_reversion") return evaluateRsiMeanReversion(closes);
  if (strategyId === "dual_momentum") return evaluateDualMomentum(closes);
  if (strategyId === "macd_trend") return evaluateMacdTrend(closes);
  if (strategyId === "bollinger_reversion") {
    return evaluateBollingerReversion(closes);
  }
  return evaluateEmaRsiTrend(closes);
}

/**
 * Simple long-only bar-by-bar backtest on chosen TF OHLC (no AI nudge).
 */
export async function runPaperBacktest(input: {
  symbols: string[];
  strategyId: PaperStrategyId | "custom";
  customStrategy?: CustomStrategyDef | null;
  startingCash: number;
  maxPositionPct: number;
  maxOpenPositions: number;
  exits: PaperBotExitSettings;
  lookbackBars?: number;
  candleTf?: PaperCandleTf | string;
}): Promise<BacktestResult> {
  const cash0 = Math.max(100, input.startingCash);
  let cash = cash0;
  const positions = new Map<
    string,
    { qty: number; entry: number; peak: number; openBar: number }
  >();
  const trades: BacktestTrade[] = [];
  const equityCurve: Array<{ i: number; equity: number }> = [];
  const candleTf = normalizeCandleTf(input.candleTf);
  const tfQ = candleTfQuery(candleTf);

  const series = new Map<
    string,
    { closes: number[]; highs: number[]; lows: number[]; volumes: number[] }
  >();
  let maxLen = 0;
  for (const sym of input.symbols) {
    const ohlc = await fetchOhlc(sym, { tf: candleTf });
    if (ohlc.closes.length < tfQ.minBars) continue;
    series.set(sym, {
      closes: ohlc.closes,
      highs: ohlc.highs,
      lows: ohlc.lows,
      volumes: ohlc.volumes,
    });
    maxLen = Math.max(maxLen, ohlc.closes.length);
  }

  const defaultLookback = candleTf === "1d" ? 180 : candleTf === "1h" ? 400 : 600;
  const start = Math.max(
    tfQ.minBars,
    maxLen - (input.lookbackBars ?? defaultLookback),
  );
  const warmup = Math.max(55, Math.floor(tfQ.minBars * 0.9));

  for (let i = start; i < maxLen; i++) {
    for (const [sym, pos] of Array.from(positions.entries())) {
      const s = series.get(sym);
      if (!s || i >= s.closes.length) continue;
      const price = s.closes[i]!;
      pos.peak = Math.max(pos.peak, price);
      const sliceC = s.closes.slice(0, i + 1);
      const sliceH = s.highs.slice(0, i + 1);
      const sliceL = s.lows.slice(0, i + 1);
      const sliceV = s.volumes.slice(0, i + 1);
      const atrVal = atr(sliceH, sliceL, sliceC, 14);
      const hit = evaluateExitRules({
        entryPrice: pos.entry,
        peakPrice: pos.peak,
        markPrice: price,
        atr: atrVal,
        trailingAtrMult: input.exits.trailingAtrMult,
        takeProfitPct: input.exits.takeProfitPct,
        hardStopPct: input.exits.hardStopPct,
      });
      let sellReason: string | null = hit.hit ? hit.reason : null;
      if (!sellReason && i >= warmup) {
        const sig = evaluate(
          input.strategyId,
          sliceC,
          sliceH,
          sliceL,
          sliceV,
          input.customStrategy ?? null,
        );
        if (sig.action === "SELL") sellReason = sig.reason;
      }
      if (sellReason) {
        const pnl = (price - pos.entry) * pos.qty;
        cash += pos.qty * price;
        trades.push({
          symbol: sym,
          side: "SELL",
          price,
          qty: pos.qty,
          pnl,
          reason: sellReason,
          barIndex: i,
        });
        positions.delete(sym);
      }
    }

    if (i >= warmup) {
      let equity =
        cash +
        Array.from(positions.entries()).reduce((sum, [sym, pos]) => {
          const s = series.get(sym);
          const px = s && i < s.closes.length ? s.closes[i]! : pos.entry;
          return sum + pos.qty * px;
        }, 0);

      for (const sym of input.symbols) {
        if (positions.has(sym)) continue;
        if (positions.size >= input.maxOpenPositions) break;
        const s = series.get(sym);
        if (!s || i >= s.closes.length) continue;
        const sliceC = s.closes.slice(0, i + 1);
        const sliceH = s.highs.slice(0, i + 1);
        const sliceL = s.lows.slice(0, i + 1);
        const sliceV = s.volumes.slice(0, i + 1);
        const sig = evaluate(
          input.strategyId,
          sliceC,
          sliceH,
          sliceL,
          sliceV,
          input.customStrategy ?? null,
        );
        if (sig.action !== "BUY") continue;
        const price = s.closes[i]!;
        const budget = Math.min(cash, equity * (input.maxPositionPct / 100));
        if (budget < 1 || !(price > 0)) continue;
        const qty = budget / price;
        cash -= qty * price;
        positions.set(sym, { qty, entry: price, peak: price, openBar: i });
        trades.push({
          symbol: sym,
          side: "BUY",
          price,
          qty,
          pnl: null,
          reason: sig.reason,
          barIndex: i,
        });
        equity =
          cash +
          Array.from(positions.entries()).reduce((sum, [sy, po]) => {
            const ss = series.get(sy);
            const px = ss && i < ss.closes.length ? ss.closes[i]! : po.entry;
            return sum + po.qty * px;
          }, 0);
      }
    }

    const eq =
      cash +
      Array.from(positions.entries()).reduce((sum, [sym, pos]) => {
        const s = series.get(sym);
        const px = s && i < s.closes.length ? s.closes[i]! : pos.entry;
        return sum + pos.qty * px;
      }, 0);
    if (i % 5 === 0 || i === maxLen - 1) {
      equityCurve.push({ i, equity: Math.round(eq * 100) / 100 });
    }
  }

  const lastI = maxLen - 1;
  for (const [sym, pos] of Array.from(positions.entries())) {
    const s = series.get(sym);
    const price = s && lastI < s.closes.length ? s.closes[lastI]! : pos.entry;
    const pnl = (price - pos.entry) * pos.qty;
    cash += pos.qty * price;
    trades.push({
      symbol: sym,
      side: "SELL",
      price,
      qty: pos.qty,
      pnl,
      reason: "End of backtest",
      barIndex: lastI,
    });
  }
  positions.clear();

  const sells = trades.filter((t) => t.side === "SELL" && t.pnl != null);
  const wins = sells.filter((t) => (t.pnl ?? 0) > 0);
  const losses = sells.filter((t) => (t.pnl ?? 0) < 0);
  const endingEquity = cash;

  return {
    startingCash: cash0,
    endingEquity: Math.round(endingEquity * 100) / 100,
    returnPct:
      Math.round(((endingEquity - cash0) / cash0) * 10000) / 100,
    trades: trades.slice(-80),
    wins: wins.length,
    losses: losses.length,
    winRatePct:
      sells.length > 0
        ? Math.round((wins.length / sells.length) * 1000) / 10
        : 0,
    equityCurve,
    barsUsed: Math.max(0, maxLen - start),
    candleTf,
  };
}
