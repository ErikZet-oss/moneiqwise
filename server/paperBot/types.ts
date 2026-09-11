export type PaperBotStatus = "running" | "paused" | "killed";

export type PaperStrategyId =
  | "ema_rsi_trend"
  | "ma_crossover"
  | "rsi_mean_reversion"
  | "dual_momentum"
  | "macd_trend"
  | "bollinger_reversion"
  | "custom";

export type PaperCandleTf = "1d" | "1h" | "15m";

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
  candleTf: PaperCandleTf;
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
  /** Human-readable why this position was opened (strategy + AI). */
  openReason: string | null;
  openDetail: Record<string, unknown> | null;
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
  /** Structured decision trail (quant / AI / exit). */
  detail: Record<string, unknown> | null;
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

export const PIPELINE_STAGE_META: Record<
  (typeof PIPELINE_STAGES)[number],
  { label: string; description: string }
> = {
  INGEST: {
    label: "Načítanie dát",
    description:
      "Stiahne OHLCV z Yahoo podľa timeframe bota (1d/1h/15m) a počas LIVE/EXTENDED doplní čerstvý 1m mark pre MTM ceny.",
  },
  DEDUP: {
    label: "Príprava tickerov",
    description:
      "Zoskupí a pripraví universe tickerov na vyhodnotenie — odfiltruje neplatné / bez dát, pripraví mapu cien pred signálmi.",
  },
  SIGNAL: {
    label: "Kvant stratégia",
    description:
      "Spočíta indikátory (EMA, RSI, MACD, …) a podľa zvolenej stratégie (alebo custom editora) dá BUY / SELL / HOLD + skóre. Exity (ATR/TP/SL) majú prioritu pred strategickým SELL.",
  },
  AI: {
    label: "Claude nudge",
    description:
      "Ak je AI influence > 0, Claude zhodnotí správy + technický snapshot (RSI/EMA/MACD). AI trade sama nevytvára — len upraví skóre alebo môže zablokovať slabý BUY pri silnom bearish.",
  },
  RISK: {
    label: "Risk limity",
    description:
      "Kontrola denného loss limitu, max drawdownu, max počtu pozícií a veľkosti pozície (% equity). Pri prekročení sa nákup zablokuje (ostane v logu ako blocked).",
  },
  EXEC: {
    label: "Paper exekúcia",
    description:
      "Otvorí alebo zatvorí paper pozíciu v internom ledgeri (nie broker). Zapíše obchod, dôvod, aktualizuje cash/equity a voliteľne pošle e-mail.",
  },
};

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
  macd_trend: {
    label: "MACD Trend",
    description:
      "Long: MACD hist>0, MACD>signal, close>EMA200. Exit: hist<0 alebo close<EMA200 + exit rules.",
  },
  bollinger_reversion: {
    label: "Bollinger Reversion",
    description:
      "Long: close ≤ BB lower a RSI<35. Exit: close ≥ BB mid alebo RSI>55 + exit rules.",
  },
  custom: {
    label: "Vlastná (editor)",
    description:
      "Podmienky ALL/ANY — EMA/SMA/RSI/ATR/MACD/BB/volume/close oproti číslu alebo indikátoru.",
  },
};

export const CANDLE_TF_META: Record<
  PaperCandleTf,
  { label: string; description: string }
> = {
  "1d": {
    label: "Denné (1d)",
    description: "Klasické denné bary — menej šumu, pomalšie signály.",
  },
  "1h": {
    label: "Hodinové (1h)",
    description: "Intraday signály na 60m baroch (Yahoo).",
  },
  "15m": {
    label: "15-minútové",
    description: "Rýchlejšie signály; viac šumu, kratšia história (~60d).",
  },
};
