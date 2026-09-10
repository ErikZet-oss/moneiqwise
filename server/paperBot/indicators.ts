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
