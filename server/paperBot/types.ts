export type PaperBotStatus = "running" | "paused" | "killed";

export type PaperStrategyId = "ema_rsi_trend" | "ma_crossover";

export type PaperBotRiskSettings = {
  dailyLossLimitPct: number;
  maxDrawdownPct: number;
  maxOpenPositions: number;
  maxPositionPct: number;
};

export type PaperBot = {
  id: string;
  userId: string;
  name: string;
  status: PaperBotStatus;
  startingCash: number;
  cash: number;
  currency: string;
  strategyId: PaperStrategyId;
  symbols: string[];
  candleTf: string;
  risk: PaperBotRiskSettings;
  /** 0–100; Claude nudge of quant score (0 = quant only for now). */
  aiInfluencePct: number;
  dayStartEquity: number;
  peakEquity: number;
  lastTickAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaperPosition = {
  id: string;
  botId: string;
  userId: string;
  symbol: string;
  qty: number;
  entryPrice: number;
  markPrice: number | null;
  unrealizedPnl: number | null;
  openedAt: string;
  strategyId: PaperStrategyId;
};

export type PaperTrade = {
  id: string;
  botId: string;
  userId: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  pnl: number | null;
  reason: string;
  strategyId: PaperStrategyId;
  openedAt: string | null;
  closedAt: string;
};

export type PaperLogEventType =
  | "tick"
  | "signal"
  | "open"
  | "close"
  | "blocked"
  | "mark"
  | "kill"
  | "status"
  | "error"
  | "ai";

export type PaperBotLog = {
  id: string;
  botId: string;
  userId: string;
  eventType: PaperLogEventType;
  symbol: string | null;
  message: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
};

export type PaperEquityTick = {
  ts: string;
  equity: number;
  cash: number;
};

export const DEFAULT_RISK: PaperBotRiskSettings = {
  dailyLossLimitPct: 2,
  maxDrawdownPct: 15,
  maxOpenPositions: 5,
  maxPositionPct: 20,
};

export const STRATEGY_META: Record<
  PaperStrategyId,
  { label: string; description: string }
> = {
  ema_rsi_trend: {
    label: "EMA + RSI Trend",
    description:
      "Long: EMA50 > EMA200, close > SMA50, RSI 45–75. Exit: RSI > 75 alebo strata trendu.",
  },
  ma_crossover: {
    label: "MA Crossover",
    description: "Long: SMA20 > SMA50. Exit: SMA20 < SMA50.",
  },
};
