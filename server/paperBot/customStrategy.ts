import { atr, ema, rsi, sma, type SignalDecision } from "./indicators";

export type IndicatorRef =
  | { kind: "close" }
  | { kind: "ema" | "sma" | "rsi" | "atr"; period: number };

export type ConditionSide =
  | IndicatorRef
  | { kind: "number"; value: number };

export type StrategyCondition = {
  left: IndicatorRef;
  op: "gt" | "gte" | "lt" | "lte";
  right: ConditionSide;
};

export type CustomStrategyDef = {
  entryLogic: "all" | "any";
  entry: StrategyCondition[];
  exitLogic: "all" | "any";
  exit: StrategyCondition[];
};

export const DEFAULT_CUSTOM_STRATEGY: CustomStrategyDef = {
  entryLogic: "all",
  entry: [
    {
      left: { kind: "ema", period: 50 },
      op: "gt",
      right: { kind: "ema", period: 200 },
    },
    {
      left: { kind: "close" },
      op: "gt",
      right: { kind: "sma", period: 50 },
    },
    {
      left: { kind: "rsi", period: 14 },
      op: "gt",
      right: { kind: "number", value: 45 },
    },
    {
      left: { kind: "rsi", period: 14 },
      op: "lt",
      right: { kind: "number", value: 75 },
    },
  ],
  exitLogic: "any",
  exit: [
    {
      left: { kind: "rsi", period: 14 },
      op: "gt",
      right: { kind: "number", value: 75 },
    },
    {
      left: { kind: "ema", period: 50 },
      op: "lt",
      right: { kind: "ema", period: 200 },
    },
  ],
};

function resolveIndicator(
  ref: IndicatorRef,
  closes: number[],
  highs: number[],
  lows: number[],
): number | null {
  if (ref.kind === "close") {
    return closes.length ? closes[closes.length - 1]! : null;
  }
  if (ref.kind === "ema") return ema(closes, ref.period);
  if (ref.kind === "sma") return sma(closes, ref.period);
  if (ref.kind === "rsi") return rsi(closes, ref.period);
  if (ref.kind === "atr") return atr(highs, lows, closes, ref.period);
  return null;
}

function resolveSide(
  side: ConditionSide,
  closes: number[],
  highs: number[],
  lows: number[],
): number | null {
  if (side.kind === "number") return side.value;
  return resolveIndicator(side, closes, highs, lows);
}

function cmp(op: StrategyCondition["op"], a: number, b: number): boolean {
  if (op === "gt") return a > b;
  if (op === "gte") return a >= b;
  if (op === "lt") return a < b;
  return a <= b;
}

function evalConditions(
  logic: "all" | "any",
  conditions: StrategyCondition[],
  closes: number[],
  highs: number[],
  lows: number[],
): { ok: boolean; detail: string } {
  if (!conditions.length) return { ok: false, detail: "Žiadne podmienky" };
  const results: boolean[] = [];
  const parts: string[] = [];
  for (const c of conditions) {
    const l = resolveIndicator(c.left, closes, highs, lows);
    const r = resolveSide(c.right, closes, highs, lows);
    if (l == null || r == null) {
      results.push(false);
      parts.push("n/a");
      continue;
    }
    const pass = cmp(c.op, l, r);
    results.push(pass);
    parts.push(`${l.toFixed(2)} ${c.op} ${r.toFixed(2)}=${pass ? "Y" : "N"}`);
  }
  const ok = logic === "all" ? results.every(Boolean) : results.some(Boolean);
  return { ok, detail: parts.join("; ") };
}

export function evaluateCustomStrategy(
  def: CustomStrategyDef,
  closes: number[],
  highs: number[] = closes,
  lows: number[] = closes,
): SignalDecision {
  const entry = evalConditions(def.entryLogic, def.entry, closes, highs, lows);
  const exit = evalConditions(def.exitLogic, def.exit, closes, highs, lows);
  const indicators: Record<string, number | null> = {
    close: closes[closes.length - 1] ?? null,
  };

  if (entry.ok) {
    return {
      action: "BUY",
      score: 70,
      reason: `Custom entry (${def.entryLogic}): ${entry.detail}`,
      indicators,
    };
  }
  if (exit.ok) {
    return {
      action: "SELL",
      score: 70,
      reason: `Custom exit (${def.exitLogic}): ${exit.detail}`,
      indicators,
    };
  }
  return {
    action: "HOLD",
    score: 40,
    reason: "Custom: entry/exit nesplnené",
    indicators,
  };
}

export function parseCustomStrategy(raw: unknown): CustomStrategyDef | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<CustomStrategyDef>;
  if (!Array.isArray(o.entry) || !Array.isArray(o.exit)) return null;
  return {
    entryLogic: o.entryLogic === "any" ? "any" : "all",
    exitLogic: o.exitLogic === "any" ? "any" : "all",
    entry: o.entry as StrategyCondition[],
    exit: o.exit as StrategyCondition[],
  };
}
