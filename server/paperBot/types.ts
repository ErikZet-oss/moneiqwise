export type PaperBotStatus = "running" | "paused" | "killed";

export type PaperStrategyId =
  | "ema_rsi_trend"
  | "ma_crossover"
  | "rsi_mean_reversion"
  | "dual_momentum"
  | "custom";

export type PaperBotRiskSettings = {
  dailyLossLimitPct: number;
  maxDrawdownPct: number;
  maxOpenPositions: number;
  maxPositionPct: number;
};

/** Exit rules — 0 = vypnuté. */
export type PaperBotExitSettings = {
  trailingAtrMult: number;
  takeProfitPct: number;
  hardStopPct: number;
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
  /** Custom strategy JSON when strategyId === "custom". */
  customStrategy: unknown | null;
  symbols: string[];
  candleTf: string;
  risk: PaperBotRiskSettings;
  exits: PaperBotExitSettings;
  aiInfluencePct: number;
  aiMinConfidence: number;
  notifyEmail: string | null;
  notifyOnTrade: boolean;
  dayStartEquity: number;
  peakEquity: number;
  lastTickAt: string | null;
  /** Last completed pipeline stage for UI signal chain. */
  lastPipelineStage: string | null;
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
  peakPrice: number;
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
  | "ai"
  | "pipeline";

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

export type PaperBotStats = {
  realizedPnl: number;
  returnPct: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  avgWin: number | null;
  avgLoss: number | null;
  openPositions: number;
  blockedEvents: number;
  openEvents: number;
  closeEvents: number;
  aiEvents: number;
};

export const DEFAULT_RISK: PaperBotRiskSettings = {
  dailyLossLimitPct: 2,
  maxDrawdownPct: 15,
  maxOpenPositions: 5,
  maxPositionPct: 20,
};

export const DEFAULT_EXITS: PaperBotExitSettings = {
  trailingAtrMult: 3.5,
  takeProfitPct: 12,
  hardStopPct: 8,
};

export const PIPELINE_STAGES = [
  "INGEST",
  "DEDUP",
  "SIGNAL",
  "AI",
  "RISK",
  "EXEC",
] as const;

export const STRATEGY_META: Record<
  PaperStrategyId,
  { label: string; description: string }
> = {
  ema_rsi_trend: {
    label: "EMA + RSI Trend",
    description:
      "Long: EMA50 > EMA200, close > SMA50, RSI 45–75. Exit: RSI > 75 alebo strata trendu + exit rules.",
  },
  ma_crossover: {
    label: "MA Crossover",
    description: "Long: SMA20 > SMA50. Exit: SMA20 < SMA50 + exit rules.",
  },
  rsi_mean_reversion: {
    label: "RSI Mean Reversion",
    description: "Long: RSI < 30 (prepredané). Exit: RSI > 55 alebo exit rules.",
  },
  dual_momentum: {
    label: "Dual Momentum",
    description:
      "Long: close > SMA200 a SMA50 > SMA200. Exit: close < SMA200 + exit rules.",
  },
  custom: {
    label: "Vlastná (editor)",
    description:
      "Podmienky ALL/ANY z editora — indikátory EMA/SMA/RSI/ATR/close oproti číslu alebo inému indikátoru.",
  },
};
