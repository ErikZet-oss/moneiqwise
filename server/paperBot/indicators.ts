/** Pure indicator helpers for paper bot strategies. */

export function sma(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

export function ema(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
  }
  return prev;
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i]! - values[i - 1]!;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

/** Wilder ATR from OHLC arrays (aligned). */
export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number | null {
  const n = Math.min(highs.length, lows.length, closes.length);
  if (n < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < n; i++) {
    const h = highs[i]!;
    const l = lows[i]!;
    const prevC = closes[i - 1]!;
    trs.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)));
  }
  if (trs.length < period) return null;
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]!) / period;
  }
  return atrVal;
}

/** MACD line / signal / histogram (EMA fast/slow/signal). */
export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { macd: number; signal: number; hist: number } | null {
  if (values.length < slow + signalPeriod) return null;
  const kFast = 2 / (fast + 1);
  const kSlow = 2 / (slow + 1);
  let emaFast = values.slice(0, fast).reduce((a, b) => a + b, 0) / fast;
  let emaSlow = values.slice(0, slow).reduce((a, b) => a + b, 0) / slow;
  const macdLine: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (i >= fast) emaFast = v * kFast + emaFast * (1 - kFast);
    if (i >= slow) emaSlow = v * kSlow + emaSlow * (1 - kSlow);
    if (i >= slow - 1) macdLine.push(emaFast - emaSlow);
  }
  if (macdLine.length < signalPeriod) return null;
  const kSig = 2 / (signalPeriod + 1);
  let sig =
    macdLine.slice(0, signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod;
  for (let i = signalPeriod; i < macdLine.length; i++) {
    sig = macdLine[i]! * kSig + sig * (1 - kSig);
  }
  const m = macdLine[macdLine.length - 1]!;
  return { macd: m, signal: sig, hist: m - sig };
}

/** Bollinger bands (SMA ± stdDev * σ). */
export function bollinger(
  values: number[],
  period = 20,
  stdDev = 2,
): { mid: number; upper: number; lower: number } | null {
  if (values.length < period || period <= 1) return null;
  const slice = values.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance =
    slice.reduce((a, b) => a + (b - mid) ** 2, 0) / (period - 1);
  const sigma = Math.sqrt(variance);
  return {
    mid,
    upper: mid + stdDev * sigma,
    lower: mid - stdDev * sigma,
  };
}

export type SignalDecision = {
  action: "BUY" | "SELL" | "HOLD";
  score: number;
  reason: string;
  indicators: Record<string, number | null>;
};

export function evaluateEmaRsiTrend(closes: number[]): SignalDecision {
  const close = closes[closes.length - 1] ?? null;
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const sma50 = sma(closes, 50);
  const rsi14 = rsi(closes, 14);
  const indicators = { close, ema50, ema200, sma50, rsi14 };

  if (
    close == null ||
    ema50 == null ||
    ema200 == null ||
    sma50 == null ||
    rsi14 == null
  ) {
    return {
      action: "HOLD",
      score: 0,
      reason: "Nedostatok dát pre indikátory",
      indicators,
    };
  }

  const longOk =
    ema50 > ema200 && close > sma50 && rsi14 >= 45 && rsi14 <= 75;
  if (longOk) {
    return {
      action: "BUY",
      score: Math.min(100, 50 + (rsi14 - 45)),
      reason: "EMA50>EMA200, close>SMA50, RSI 45–75",
      indicators,
    };
  }

  if (rsi14 > 75 || ema50 < ema200 || close < sma50) {
    return {
      action: "SELL",
      score: Math.min(100, rsi14 > 75 ? rsi14 : 60),
      reason:
        rsi14 > 75
          ? "RSI overbought (>75)"
          : ema50 < ema200
            ? "EMA50 pod EMA200"
            : "Close pod SMA50",
      indicators,
    };
  }

  return {
    action: "HOLD",
    score: 40,
    reason: "Podmienky pre vstup/výstup nesplnené",
    indicators,
  };
}

export function evaluateMaCrossover(closes: number[]): SignalDecision {
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const close = closes[closes.length - 1] ?? null;
  const indicators = { close, sma20, sma50 };

  if (sma20 == null || sma50 == null) {
    return {
      action: "HOLD",
      score: 0,
      reason: "Nedostatok dát pre SMA",
      indicators,
    };
  }

  if (sma20 > sma50) {
    return {
      action: "BUY",
      score: 70,
      reason: "SMA20 nad SMA50",
      indicators,
    };
  }
  if (sma20 < sma50) {
    return {
      action: "SELL",
      score: 70,
      reason: "SMA20 pod SMA50",
      indicators,
    };
  }
  return {
    action: "HOLD",
    score: 40,
    reason: "SMA20 ≈ SMA50",
    indicators,
  };
}

export function evaluateRsiMeanReversion(closes: number[]): SignalDecision {
  const close = closes[closes.length - 1] ?? null;
  const rsi14 = rsi(closes, 14);
  const indicators = { close, rsi14 };
  if (rsi14 == null) {
    return {
      action: "HOLD",
      score: 0,
      reason: "Nedostatok dát pre RSI",
      indicators,
    };
  }
  if (rsi14 < 30) {
    return {
      action: "BUY",
      score: Math.min(100, 40 + (30 - rsi14)),
      reason: `RSI prepredané (${rsi14.toFixed(1)})`,
      indicators,
    };
  }
  if (rsi14 > 55) {
    return {
      action: "SELL",
      score: Math.min(100, rsi14),
      reason: `RSI rebound exit (${rsi14.toFixed(1)})`,
      indicators,
    };
  }
  return {
    action: "HOLD",
    score: 40,
    reason: "RSI v neutrálnej zóne",
    indicators,
  };
}

export function evaluateDualMomentum(closes: number[]): SignalDecision {
  const close = closes[closes.length - 1] ?? null;
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const indicators = { close, sma50, sma200 };
  if (close == null || sma50 == null || sma200 == null) {
    return {
      action: "HOLD",
      score: 0,
      reason: "Nedostatok dát pre momentum",
      indicators,
    };
  }
  if (close > sma200 && sma50 > sma200) {
    return {
      action: "BUY",
      score: 72,
      reason: "Dual momentum: close a SMA50 nad SMA200",
      indicators,
    };
  }
  if (close < sma200) {
    return {
      action: "SELL",
      score: 68,
      reason: "Close pod SMA200",
      indicators,
    };
  }
  return {
    action: "HOLD",
    score: 40,
    reason: "Momentum neutrálne",
    indicators,
  };
}

export function evaluateMacdTrend(closes: number[]): SignalDecision {
  const close = closes[closes.length - 1] ?? null;
  const m = macd(closes);
  const ema200 = ema(closes, 200);
  const indicators = {
    close,
    macd: m?.macd ?? null,
    macdSignal: m?.signal ?? null,
    macdHist: m?.hist ?? null,
    ema200,
  };
  if (!m || ema200 == null || close == null) {
    return {
      action: "HOLD",
      score: 0,
      reason: "Nedostatok dát pre MACD",
      indicators,
    };
  }
  if (m.hist > 0 && m.macd > m.signal && close > ema200) {
    return {
      action: "BUY",
      score: Math.min(100, 55 + Math.abs(m.hist) * 50),
      reason: "MACD hist>0, MACD>signal, close>EMA200",
      indicators,
    };
  }
  if (m.hist < 0 || close < ema200) {
    return {
      action: "SELL",
      score: 65,
      reason: m.hist < 0 ? "MACD hist záporný" : "Close pod EMA200",
      indicators,
    };
  }
  return {
    action: "HOLD",
    score: 40,
    reason: "MACD neutrálne",
    indicators,
  };
}

export function evaluateBollingerReversion(closes: number[]): SignalDecision {
  const close = closes[closes.length - 1] ?? null;
  const bb = bollinger(closes, 20, 2);
  const rsi14 = rsi(closes, 14);
  const indicators = {
    close,
    bbMid: bb?.mid ?? null,
    bbUpper: bb?.upper ?? null,
    bbLower: bb?.lower ?? null,
    rsi14,
  };
  if (!bb || close == null || rsi14 == null) {
    return {
      action: "HOLD",
      score: 0,
      reason: "Nedostatok dát pre Bollinger",
      indicators,
    };
  }
  if (close <= bb.lower && rsi14 < 35) {
    return {
      action: "BUY",
      score: Math.min(100, 50 + (35 - rsi14)),
      reason: `Close pri/pod BB lower, RSI ${rsi14.toFixed(1)}`,
      indicators,
    };
  }
  if (close >= bb.mid || rsi14 > 55) {
    return {
      action: "SELL",
      score: 62,
      reason:
        close >= bb.mid
          ? "Close späť k BB mid"
          : `RSI rebound (${rsi14.toFixed(1)})`,
      indicators,
    };
  }
  return {
    action: "HOLD",
    score: 40,
    reason: "Bollinger neutrálne",
    indicators,
  };
}

export type ExitHit = {
  hit: boolean;
  reason: string;
  detail: Record<string, number | null>;
};

/** Absolute exit rules — whichever hits first. */
export function evaluateExitRules(input: {
  entryPrice: number;
  peakPrice: number;
  markPrice: number;
  atr: number | null;
  trailingAtrMult: number;
  takeProfitPct: number;
  hardStopPct: number;
}): ExitHit {
  const {
    entryPrice,
    peakPrice,
    markPrice,
    atr: atrVal,
    trailingAtrMult,
    takeProfitPct,
    hardStopPct,
  } = input;
  const detail: Record<string, number | null> = {
    entryPrice,
    peakPrice,
    markPrice,
    atr: atrVal,
  };

  if (hardStopPct > 0) {
    const stop = entryPrice * (1 - hardStopPct / 100);
    detail.hardStop = stop;
    if (markPrice <= stop) {
      return {
        hit: true,
        reason: `Hard stop −${hardStopPct}%`,
        detail,
      };
    }
  }

  if (takeProfitPct > 0) {
    const tp = entryPrice * (1 + takeProfitPct / 100);
    detail.takeProfit = tp;
    if (markPrice >= tp) {
      return {
        hit: true,
        reason: `Take profit +${takeProfitPct}%`,
        detail,
      };
    }
  }

  if (trailingAtrMult > 0 && atrVal != null && atrVal > 0) {
    const trail = peakPrice - trailingAtrMult * atrVal;
    detail.trailStop = trail;
    if (markPrice <= trail && peakPrice > entryPrice) {
      return {
        hit: true,
        reason: `Trailing stop ${trailingAtrMult}×ATR`,
        detail,
      };
    }
  }

  return { hit: false, reason: "", detail };
}
