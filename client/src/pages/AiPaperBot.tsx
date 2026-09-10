import { Component, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Loader2,
  Mail,
  OctagonX,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
  Trash2,
  Wallet,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { sk } from "date-fns/locale";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { HelpTip } from "@/components/HelpTip";

type PaperStrategyId =
  | "ema_rsi_trend"
  | "ma_crossover"
  | "rsi_mean_reversion"
  | "dual_momentum"
  | "macd_trend"
  | "bollinger_reversion"
  | "custom";
type PaperCandleTf = "1d" | "1h" | "15m";
type PaperBotStatus = "running" | "paused" | "killed";

type IndicatorKind =
  | "ema"
  | "sma"
  | "rsi"
  | "close"
  | "atr"
  | "volume"
  | "volume_sma"
  | "macd"
  | "macd_signal"
  | "macd_hist"
  | "bb_upper"
  | "bb_mid"
  | "bb_lower";
type RightIndicatorKind = Exclude<IndicatorKind, "close" | "volume">;
type ConditionOp = "gt" | "gte" | "lt" | "lte";

type ConditionLeft = { kind: IndicatorKind; period?: number };
type ConditionRight =
  | { kind: "number"; value: number }
  | { kind: RightIndicatorKind; period?: number };

type StrategyCondition = {
  left: ConditionLeft;
  op: ConditionOp;
  right: ConditionRight;
};

type CustomStrategyDef = {
  entryLogic: "all" | "any";
  exitLogic: "all" | "any";
  entry: StrategyCondition[];
  exit: StrategyCondition[];
};

type PaperBot = {
  id: string;
  name: string;
  status: PaperBotStatus;
  startingCash: number;
  cash: number;
  currency: string;
  strategyId: PaperStrategyId;
  symbols: string[];
  candleTf?: PaperCandleTf;
  risk: {
    dailyLossLimitPct: number;
    maxDrawdownPct: number;
    maxOpenPositions: number;
    maxPositionPct: number;
  };
  exits: {
    trailingAtrMult: number;
    takeProfitPct: number;
    hardStopPct: number;
  };
  aiInfluencePct: number;
  aiMinConfidence: number;
  lastTickAt: string | null;
  createdAt: string;
  customStrategy?: unknown | null;
  notifyEmail?: string | null;
  notifyOnTrade?: boolean;
  lastPipelineStage?: string | null;
};

type PaperPosition = {
  id: string;
  symbol: string;
  qty: number;
  entryPrice: number;
  peakPrice: number;
  markPrice: number | null;
  unrealizedPnl: number | null;
  openedAt: string;
};

type PaperTrade = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  pnl: number | null;
  reason: string;
  closedAt: string;
};

type PaperLog = {
  id: string;
  eventType: string;
  symbol: string | null;
  message: string;
  createdAt: string;
};

type PaperStats = {
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

type EquityPoint = { ts: string; equity: number; cash: number };

type BotDetail = {
  bot: PaperBot;
  equity: number;
  positions: PaperPosition[];
  dayPnl: number;
  dayPnlPct: number;
  drawdownPct: number;
  trades: PaperTrade[];
  logs: PaperLog[];
  equityCurve: EquityPoint[];
  stats: PaperStats;
};

type BacktestResult = {
  returnPct: number;
  winRatePct: number;
  endingEquity: number;
  trades: unknown[];
};

const STATUS_LABEL: Record<PaperBotStatus, string> = {
  running: "Beží",
  paused: "Pauza",
  killed: "Kill",
};

const STATUS_STYLE: Record<PaperBotStatus, string> = {
  running: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
  paused: "bg-amber-500/15 text-amber-800 dark:text-amber-400",
  killed: "bg-red-600/15 text-red-700 dark:text-red-400",
};

const DEFAULT_CUSTOM_STRATEGY: CustomStrategyDef = {
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

const LEFT_KINDS: IndicatorKind[] = [
  "ema",
  "sma",
  "rsi",
  "close",
  "atr",
  "volume",
  "volume_sma",
  "macd",
  "macd_signal",
  "macd_hist",
  "bb_upper",
  "bb_mid",
  "bb_lower",
];
const RIGHT_IND_KINDS: RightIndicatorKind[] = [
  "ema",
  "sma",
  "rsi",
  "atr",
  "volume_sma",
  "macd",
  "macd_signal",
  "macd_hist",
  "bb_upper",
  "bb_mid",
  "bb_lower",
];
const OPS: { value: ConditionOp; label: string }[] = [
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
];

const MAX_ENTRY = 6;
const MAX_EXIT = 4;

const PERIOD_FREE_KINDS = new Set<string>([
  "close",
  "volume",
  "macd",
  "macd_signal",
  "macd_hist",
]);

function needsPeriod(kind: string): boolean {
  return !PERIOD_FREE_KINDS.has(kind);
}

function FieldLabel({
  children,
  tipTitle,
  tip,
}: {
  children: ReactNode;
  tipTitle: string;
  tip: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      <Label className="leading-none">{children}</Label>
      <HelpTip title={tipTitle}>{tip}</HelpTip>
    </div>
  );
}

function money(n: number | null | undefined, currency = "EUR") {
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  return `${safe.toLocaleString("sk-SK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function fmtTime(iso: string) {
  try {
    return format(parseISO(iso), "d.M. HH:mm:ss", { locale: sk });
  } catch {
    return iso;
  }
}

function defaultPeriod(kind: IndicatorKind | RightIndicatorKind): number {
  if (kind === "rsi" || kind === "atr") return 14;
  if (kind === "volume_sma") return 20;
  if (kind.startsWith("bb_")) return 20;
  if (kind === "ema") return 50;
  return 50;
}

function newCondition(): StrategyCondition {
  return {
    left: { kind: "rsi", period: 14 },
    op: "gt",
    right: { kind: "number", value: 50 },
  };
}

function EquitySparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 320;
  const h = 120;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const coords = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * (w - 8) + 4;
      const y = h - 8 - ((v - min) / span) * (h - 16);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-40 w-full text-primary"
      role="img"
      aria-label="Equity krivka"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        points={coords}
      />
    </svg>
  );
}

function ConditionRow({
  cond,
  onChange,
  onRemove,
  canRemove,
}: {
  cond: StrategyCondition;
  onChange: (c: StrategyCondition) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const rightIsNumber = cond.right.kind === "number";
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Select
        value={cond.left.kind}
        onValueChange={(v) => {
          const kind = v as IndicatorKind;
          onChange({
            ...cond,
            left: needsPeriod(kind)
              ? { kind, period: cond.left.period ?? defaultPeriod(kind) }
              : ({ kind } as ConditionLeft),
          });
        }}
      >
        <SelectTrigger className="h-8 w-[100px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LEFT_KINDS.map((k) => (
            <SelectItem key={k} value={k}>
              {k}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {needsPeriod(cond.left.kind) ? (
        <Input
          className="h-8 w-14 text-xs"
          inputMode="numeric"
          value={cond.left.period ?? ""}
          onChange={(e) =>
            onChange({
              ...cond,
              left: {
                ...cond.left,
                period: Number(e.target.value) || undefined,
              },
            })
          }
        />
      ) : null}
      <Select
        value={cond.op}
        onValueChange={(v) => onChange({ ...cond, op: v as ConditionOp })}
      >
        <SelectTrigger className="h-8 w-14 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={rightIsNumber ? "number" : (cond.right as { kind: string }).kind}
        onValueChange={(v) => {
          if (v === "number") {
            onChange({
              ...cond,
              right: {
                kind: "number",
                value:
                  cond.right.kind === "number" ? cond.right.value : 50,
              },
            });
          } else {
            const kind = v as RightIndicatorKind;
            onChange({
              ...cond,
              right: needsPeriod(kind)
                ? {
                    kind,
                    period:
                      cond.right.kind !== "number" && needsPeriod(cond.right.kind)
                        ? cond.right.period
                        : defaultPeriod(kind),
                  }
                : ({ kind } as ConditionRight),
            });
          }
        }}
      >
        <SelectTrigger className="h-8 w-[100px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="number">číslo</SelectItem>
          {RIGHT_IND_KINDS.map((k) => (
            <SelectItem key={k} value={k}>
              {k}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {rightIsNumber ? (
        <Input
          className="h-8 w-16 text-xs"
          inputMode="decimal"
          value={cond.right.kind === "number" ? cond.right.value : ""}
          onChange={(e) =>
            onChange({
              ...cond,
              right: { kind: "number", value: Number(e.target.value) || 0 },
            })
          }
        />
      ) : needsPeriod((cond.right as { kind: string }).kind) ? (
        <Input
          className="h-8 w-14 text-xs"
          inputMode="numeric"
          value={
            cond.right.kind !== "number" ? cond.right.period : ""
          }
          onChange={(e) =>
            onChange({
              ...cond,
              right: {
                kind: (cond.right as { kind: RightIndicatorKind }).kind,
                period: Number(e.target.value) || 1,
              },
            })
          }
        />
      ) : (
        <span className="text-[10px] text-muted-foreground">12/26/9</span>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 w-8 p-0"
        disabled={!canRemove}
        onClick={onRemove}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

function CustomStrategyEditor({
  value,
  onChange,
}: {
  value: CustomStrategyDef;
  onChange: (v: CustomStrategyDef) => void;
}) {
  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3 sm:col-span-2">
      <div className="flex items-center gap-1 text-xs font-medium">
        Vlastná stratégia (podmienky)
        <HelpTip title="Vlastná stratégia">
          <p>
            Entry/exit podmienky s logikou ALL (všetky) alebo ANY (aspoň jedna). Indikátory:
            EMA, SMA, RSI, ATR, MACD, Bollinger, volume. Porovnávaš indikátor s číslom alebo
            iným indikátorom.
          </p>
        </HelpTip>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Entry logika</span>
        <Select
          value={value.entryLogic}
          onValueChange={(v) =>
            onChange({ ...value, entryLogic: v as "all" | "any" })
          }
        >
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">všetky (AND)</SelectItem>
            <SelectItem value="any">ktorákoľvek (OR)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        {value.entry.map((c, i) => (
          <ConditionRow
            key={`entry-${i}`}
            cond={c}
            canRemove={value.entry.length > 1}
            onChange={(next) => {
              const entry = [...value.entry];
              entry[i] = next;
              onChange({ ...value, entry });
            }}
            onRemove={() =>
              onChange({
                ...value,
                entry: value.entry.filter((_, j) => j !== i),
              })
            }
          />
        ))}
        {value.entry.length < MAX_ENTRY ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() =>
              onChange({ ...value, entry: [...value.entry, newCondition()] })
            }
          >
            <Plus className="mr-1 h-3 w-3" />
            Entry podmienka
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-2">
        <span className="text-[11px] text-muted-foreground">Exit logika</span>
        <Select
          value={value.exitLogic}
          onValueChange={(v) =>
            onChange({ ...value, exitLogic: v as "all" | "any" })
          }
        >
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">všetky (AND)</SelectItem>
            <SelectItem value="any">ktorákoľvek (OR)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        {value.exit.map((c, i) => (
          <ConditionRow
            key={`exit-${i}`}
            cond={c}
            canRemove={value.exit.length > 1}
            onChange={(next) => {
              const exit = [...value.exit];
              exit[i] = next;
              onChange({ ...value, exit });
            }}
            onRemove={() =>
              onChange({
                ...value,
                exit: value.exit.filter((_, j) => j !== i),
              })
            }
          />
        ))}
        {value.exit.length < MAX_EXIT ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() =>
              onChange({ ...value, exit: [...value.exit, newCondition()] })
            }
          >
            <Plus className="mr-1 h-3 w-3" />
            Exit podmienka
          </Button>
        ) : null}
      </div>
    </div>
  );
}

class PaperBotErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Card>
          <CardContent className="space-y-2 py-8 text-center text-sm">
            <p className="font-medium text-destructive">
              Paper Bot sa nepodarilo zobraziť.
            </p>
            <p className="text-muted-foreground">{this.state.error.message}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => this.setState({ error: null })}
            >
              Skúsiť znova
            </Button>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}

export default function AiPaperBot({ embedded = false }: { embedded?: boolean }) {
  return (
    <PaperBotErrorBoundary>
      <AiPaperBotInner embedded={embedded} />
    </PaperBotErrorBoundary>
  );
}

function AiPaperBotInner({ embedded = false }: { embedded?: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [name, setName] = useState("Môj Paper Bot");
  const [startingCash, setStartingCash] = useState("10000");
  const [symbols, setSymbols] = useState("AAPL, MSFT, NVDA, GOOGL, META");
  const [strategyId, setStrategyId] = useState<PaperStrategyId>("ema_rsi_trend");
  const [candleTf, setCandleTf] = useState<PaperCandleTf>("1d");
  const [maxOpen, setMaxOpen] = useState("5");
  const [dailyLoss, setDailyLoss] = useState("2");
  const [maxDd, setMaxDd] = useState("15");
  const [maxPosPct, setMaxPosPct] = useState("20");
  const [trailAtr, setTrailAtr] = useState("3.5");
  const [takeProfit, setTakeProfit] = useState("12");
  const [hardStop, setHardStop] = useState("8");
  const [aiInfluence, setAiInfluence] = useState("20");
  const [aiMinConf, setAiMinConf] = useState("60");
  const [notifyOnTrade, setNotifyOnTrade] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [customStrategy, setCustomStrategy] = useState<CustomStrategyDef>(
    () => structuredClone(DEFAULT_CUSTOM_STRATEGY),
  );
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(
    null,
  );

  const { data: strategiesPayload } = useQuery<{
    strategies: Array<{ id: PaperStrategyId; label: string; description: string }>;
    candleTfs?: Array<{ id: PaperCandleTf; label: string; description: string }>;
    pipelineStages?: string[];
    smtpConfigured?: boolean;
    session?: string;
    tickMs?: number;
    defaultCustomStrategy?: CustomStrategyDef;
  }>({
    queryKey: ["/api/paper-bots/strategies"],
    queryFn: async () => {
      const res = await fetch("/api/paper-bots/strategies", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("strategies");
      return res.json();
    },
  });

  const { data: listPayload, isLoading: listLoading } = useQuery<{
    bots: PaperBot[];
  }>({
    queryKey: ["/api/paper-bots"],
    queryFn: async () => {
      const res = await fetch("/api/paper-bots", { credentials: "include" });
      if (!res.ok) throw new Error("list");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const bots = listPayload?.bots ?? [];
  const activeId = selectedId ?? bots[0]?.id ?? null;

  const { data: detail, isLoading: detailLoading, isFetching: detailFetching } =
    useQuery<BotDetail>({
      queryKey: ["/api/paper-bots", activeId],
      queryFn: async () => {
        const res = await fetch(`/api/paper-bots/${activeId}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("detail");
        return res.json();
      },
      enabled: !!activeId,
      refetchInterval: (q) =>
        q.state.data?.bot.status === "running" ? 20_000 : 60_000,
    });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/paper-bots"] });
    if (activeId) {
      queryClient.invalidateQueries({ queryKey: ["/api/paper-bots", activeId] });
    }
  };

  const formPayload = () => ({
    name,
    startingCash: Number(startingCash),
    symbols,
    strategyId,
    candleTf,
    dailyLossLimitPct: Number(dailyLoss),
    maxDrawdownPct: Number(maxDd),
    maxOpenPositions: Number(maxOpen),
    maxPositionPct: Number(maxPosPct),
    trailingAtrMult: Number(trailAtr),
    takeProfitPct: Number(takeProfit),
    hardStopPct: Number(hardStop),
    aiInfluencePct: Number(aiInfluence),
    aiMinConfidence: Number(aiMinConf),
    notifyOnTrade,
    notifyEmail: notifyEmail.trim() || undefined,
    ...(strategyId === "custom" ? { customStrategy } : {}),
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/paper-bots", formPayload());
      return res.json() as Promise<{ bot: PaperBot }>;
    },
    onSuccess: (data) => {
      toast({ title: "Paper bot vytvorený" });
      setShowCreate(false);
      setBacktestResult(null);
      setSelectedId(data.bot.id);
      invalidate();
    },
    onError: (err: Error) => {
      toast({
        title: "Vytvorenie zlyhalo",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const backtestMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/paper-bots/backtest", formPayload());
      return res.json() as Promise<{ result: BacktestResult }>;
    },
    onSuccess: (data) => {
      setBacktestResult(data.result);
      toast({
        title: "Backtest hotový",
        description: `Return ${data.result.returnPct?.toFixed?.(1) ?? data.result.returnPct} % · win ${(data.result.winRatePct ?? 0).toFixed(0)} %`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Backtest zlyhal",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const actionMut = useMutation({
    mutationFn: async (action: "start" | "pause" | "kill" | "tick" | "delete") => {
      if (!activeId) throw new Error("no bot");
      if (action === "delete") {
        await apiRequest("DELETE", `/api/paper-bots/${activeId}`);
        return { action };
      }
      const res = await apiRequest("POST", `/api/paper-bots/${activeId}/${action}`, {});
      return res.json();
    },
    onSuccess: (_data, action) => {
      if (action === "delete") {
        setSelectedId(null);
        toast({ title: "Bot zmazaný" });
      } else if (action === "kill") {
        toast({ title: "Kill Switch", description: "Pozície zatvorené, bot zastavený." });
      } else if (action === "tick") {
        toast({ title: "Tick hotový" });
      }
      invalidate();
    },
    onError: (err: Error) => {
      toast({
        title: "Akcia zlyhala",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const strategyLabel = useMemo(() => {
    const id = detail?.bot.strategyId;
    return (
      strategiesPayload?.strategies.find((s) => s.id === id)?.label ?? id ?? "—"
    );
  }, [detail?.bot.strategyId, strategiesPayload]);

  const chartData = useMemo(() => {
    return (detail?.equityCurve ?? []).map((p) => ({
      t: fmtTime(p.ts),
      equity: Math.round(p.equity * 100) / 100,
    }));
  }, [detail?.equityCurve]);

  const pipelineStages =
    strategiesPayload?.pipelineStages ?? [
      "INGEST",
      "DEDUP",
      "SIGNAL",
      "AI",
      "RISK",
      "EXEC",
    ];

  return (
    <div className={cn("space-y-3", !embedded && "mx-auto max-w-3xl pb-8")}>
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
        PAPER TRADING — fiktívne peniaze. Quant stratégia + Claude AI nudge
        (news) + exit rules. Claude sám trade nevytvára.
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold tracking-tight md:text-lg">
            Paper Bot
          </h2>
          <p className="text-xs text-muted-foreground">
            Viac botov, každý s vlastným kapitálom, AI a kompletným logom.
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => invalidate()}
            disabled={detailFetching}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", detailFetching && "animate-spin")}
            />
          </Button>
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Nový bot
          </Button>
        </div>
      </div>

      {showCreate ? (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <FieldLabel
                  tipTitle="Názov"
                  tip={<p>Len pre teba — ako bota rozlíšiš v zozname (napr. „EMA US tech“).</p>}
                >
                  Názov
                </FieldLabel>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <FieldLabel
                  tipTitle="Kapitál (EUR)"
                  tip={
                    <p>
                      Fiktívny počiatočný kapitál paper účtu. Nie sú to reálne peniaze — bot s nimi
                      obchoduje v simulácii.
                    </p>
                  }
                >
                  Kapitál (EUR)
                </FieldLabel>
                <Input
                  inputMode="decimal"
                  value={startingCash}
                  onChange={(e) => setStartingCash(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <FieldLabel
                  tipTitle="Tickery"
                  tip={
                    <p>
                      Universe symbolov, ktoré bot sleduje (Yahoo formát, oddelené čiarkou). Príklad:
                      AAPL, MSFT, NVDA. Čím viac tickerov, tým viac dát a AI volaní pri ticku.
                    </p>
                  }
                >
                  Tickery (oddelené čiarkou)
                </FieldLabel>
                <Input
                  value={symbols}
                  onChange={(e) => setSymbols(e.target.value)}
                  placeholder="AAPL, MSFT, NVDA"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <FieldLabel
                  tipTitle="Stratégia"
                  tip={
                    <p>
                      Pravidlá, kedy bot chce BUY / SELL / HOLD. Prednastavené stratégie sú hotové
                      kvant pravidlá; „Vlastná“ = editor podmienok ALL/ANY. Claude AI trade sám
                      nevytvára — len môže upraviť skóre.
                    </p>
                  }
                >
                  Stratégia
                </FieldLabel>
                <Select
                  value={strategyId}
                  onValueChange={(v) => {
                    const id = v as PaperStrategyId;
                    setStrategyId(id);
                    if (
                      id === "custom" &&
                      strategiesPayload?.defaultCustomStrategy
                    ) {
                      setCustomStrategy(
                        structuredClone(
                          strategiesPayload.defaultCustomStrategy,
                        ),
                      );
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(strategiesPayload?.strategies ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {
                    strategiesPayload?.strategies.find((s) => s.id === strategyId)
                      ?.description
                  }
                </p>
              </div>

              {strategyId === "custom" ? (
                <CustomStrategyEditor
                  value={customStrategy}
                  onChange={setCustomStrategy}
                />
              ) : null}

              <div className="space-y-1.5 sm:col-span-2">
                <FieldLabel
                  tipTitle="Timeframe signálov"
                  tip={
                    <>
                      <p>
                        Veľkosť sviečky, na ktorej sa počítajú indikátory a signály stratégie:
                      </p>
                      <p>
                        <strong>1d</strong> — denné bary (menej šumu, pomalšie).{" "}
                        <strong>1h</strong> — hodinové. <strong>15m</strong> — rýchlejšie, viac
                        šumu, kratšia história (~60 dní).
                      </p>
                      <p>Mark-to-market počas LIVE stále používa čerstvejšie 1m ceny.</p>
                    </>
                  }
                >
                  Timeframe signálov
                </FieldLabel>
                <Select
                  value={candleTf}
                  onValueChange={(v) => setCandleTf(v as PaperCandleTf)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      strategiesPayload?.candleTfs ?? [
                        {
                          id: "1d" as PaperCandleTf,
                          label: "Denné (1d)",
                          description: "",
                        },
                        {
                          id: "1h" as PaperCandleTf,
                          label: "Hodinové (1h)",
                          description: "",
                        },
                        {
                          id: "15m" as PaperCandleTf,
                          label: "15-minútové",
                          description: "",
                        },
                      ]
                    ).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {
                    strategiesPayload?.candleTfs?.find((t) => t.id === candleTf)
                      ?.description
                  }
                </p>
              </div>

              <div className="space-y-1.5">
                <FieldLabel
                  tipTitle="Max otvorené pozície"
                  tip={
                    <p>
                      Horný počet súčasne otvorených long pozícií. Keď je limit plný, bot
                      neotvára nové nákupy (môže stále zatvárať).
                    </p>
                  }
                >
                  Max otvorené pozície
                </FieldLabel>
                <Input value={maxOpen} onChange={(e) => setMaxOpen(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <FieldLabel
                  tipTitle="Max % na 1 pozíciu"
                  tip={
                    <p>
                      Koľko percent aktuálnej equity smie ísť do jedného nákupu. Napr. 20 % pri
                      10 000 € ≈ max ~2 000 € na ticker.
                    </p>
                  }
                >
                  Max % na 1 pozíciu
                </FieldLabel>
                <Input
                  value={maxPosPct}
                  onChange={(e) => setMaxPosPct(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel
                  tipTitle="Daily loss limit %"
                  tip={
                    <p>
                      Ak denná strata equity dosiahne tento %, bot prestane otvárať nové
                      pozície do konca dňa (ochrana pred „zlým dňom“).
                    </p>
                  }
                >
                  Daily loss limit %
                </FieldLabel>
                <Input
                  value={dailyLoss}
                  onChange={(e) => setDailyLoss(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel
                  tipTitle="Max drawdown %"
                  tip={
                    <p>
                      Maximálny pokles od peak equity. Po dosiahnutí limitu bot neotvára nové
                      nákupy, kým sa DD nezlepší / bot neresetuješ.
                    </p>
                  }
                >
                  Max drawdown %
                </FieldLabel>
                <Input value={maxDd} onChange={(e) => setMaxDd(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <FieldLabel
                  tipTitle="Trailing ATR×"
                  tip={
                    <p>
                      Posuvný stop pod peak cenou: vzdialenosť = násobok ATR (volatilita). 0 =
                      vypnuté. Príklad: 3.5×ATR — keď cena klesne o 3.5 ATR od maxima, zatvorí.
                    </p>
                  }
                >
                  Trailing ATR×
                </FieldLabel>
                <Input value={trailAtr} onChange={(e) => setTrailAtr(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <FieldLabel
                  tipTitle="Take profit %"
                  tip={
                    <p>
                      Cieľový zisk od entry. Napr. 12 % — pri +12 % od nákupnej ceny bot pozíciu
                      zatvorí. 0 = vypnuté.
                    </p>
                  }
                >
                  Take profit %
                </FieldLabel>
                <Input
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel
                  tipTitle="Hard stop %"
                  tip={
                    <p>
                      Pevný stop-loss od entry. Napr. 8 % — pri −8 % od nákupu zatvorí ihneď. 0 =
                      vypnuté. Má prioritu pred trailingom.
                    </p>
                  }
                >
                  Hard stop %
                </FieldLabel>
                <Input
                  value={hardStop}
                  onChange={(e) => setHardStop(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel
                  tipTitle="AI influence %"
                  tip={
                    <p>
                      Váha Claude AI pri mixe so skóre stratégie. 0 = čistý quant. 20 = 80 %
                      stratégia + 20 % AI sentiment zo správ a technického snapshotu. AI nikdy
                      neotvorí trade sama.
                    </p>
                  }
                >
                  AI influence %
                </FieldLabel>
                <Input
                  value={aiInfluence}
                  onChange={(e) => setAiInfluence(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel
                  tipTitle="AI min confidence %"
                  tip={
                    <p>
                      Minimálna istota AI verdictu, aby sa vôbec použil. Pod týmto prahom bot
                      ignoruje AI a ide podľa kvant skóre. Silný bearish s vysokou confidence
                      môže zablokovať BUY.
                    </p>
                  }
                >
                  AI min confidence %
                </FieldLabel>
                <Input
                  value={aiMinConf}
                  onChange={(e) => setAiMinConf(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between gap-2 space-y-0 rounded-md border px-3 py-2 sm:col-span-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1">
                    <Label htmlFor="notify-trade" className="text-sm">
                      Notifikácia pri obchode
                    </Label>
                    <HelpTip title="Notifikácia pri obchode">
                      <p>
                        Pošle e-mail pri open / close / kill (ak je na serveri SMTP). Bez SMTP
                        ostane udalosť len v logu bota.
                      </p>
                    </HelpTip>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {strategiesPayload?.smtpConfigured
                      ? "SMTP je nastavené — e-mail pôjde von."
                      : "SMTP nie je nastavené — notifikácie môžu zostať len v logu."}
                  </p>
                </div>
                <Switch
                  id="notify-trade"
                  checked={notifyOnTrade}
                  onCheckedChange={setNotifyOnTrade}
                />
              </div>
              {notifyOnTrade ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <FieldLabel
                    tipTitle="E-mail"
                    tip={
                      <p>
                        Kam posielať notifikácie. Prázdne = e-mail z tvojho účtu (ak ho appka
                        pozná).
                      </p>
                    }
                  >
                    E-mail (voliteľné)
                  </FieldLabel>
                  <Input
                    type="email"
                    value={notifyEmail}
                    onChange={(e) => setNotifyEmail(e.target.value)}
                    placeholder="nechaj prázdne = účet"
                  />
                </div>
              ) : null}
            </div>

            {backtestResult ? (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <div className="font-medium">Výsledok backtestu</div>
                <div className="mt-1 text-muted-foreground">
                  Return{" "}
                  <span
                    className={cn(
                      "font-semibold",
                      (backtestResult.returnPct ?? 0) >= 0
                        ? "text-emerald-600"
                        : "text-red-600",
                    )}
                  >
                    {(backtestResult.returnPct ?? 0) >= 0 ? "+" : ""}
                    {(backtestResult.returnPct ?? 0).toFixed(2)} %
                  </span>
                  {" · "}win rate {(backtestResult.winRatePct ?? 0).toFixed(1)} %
                  {" · "}equity {money(backtestResult.endingEquity)}
                  {" · "}obchody {backtestResult.trades?.length ?? 0}
                </div>
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                Zrušiť
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={backtestMut.isPending}
                onClick={() => backtestMut.mutate()}
              >
                {backtestMut.isPending ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Activity className="mr-1 h-3.5 w-3.5" />
                )}
                Backtest
              </Button>
              <Button
                size="sm"
                disabled={createMut.isPending}
                onClick={() => createMut.mutate()}
              >
                {createMut.isPending ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wallet className="mr-1 h-3.5 w-3.5" />
                )}
                Vytvoriť
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {listLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : bots.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Zatiaľ žiadny paper bot. Vytvor prvého a zadaj mu fiktívny kapitál.
          </CardContent>
        </Card>
      ) : (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {bots.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setSelectedId(b.id)}
              className={cn(
                "shrink-0 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                activeId === b.id
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/60",
              )}
            >
              <div className="font-medium">{b.name}</div>
              <div className="text-[10px] text-muted-foreground">
                {STATUS_LABEL[b.status] ?? b.status} · {money(b.cash, b.currency)}
              </div>
            </button>
          ))}
        </div>
      )}

      {activeId && detailLoading && !detail ? (
        <Skeleton className="h-64 w-full" />
      ) : detail ? (
        <div className="space-y-3">
          <div className="rounded-lg border px-3 py-2">
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-1">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Signal Chain
              </div>
              {(strategiesPayload?.session || strategiesPayload?.tickMs) && (
                <div className="text-[10px] text-muted-foreground">
                  {strategiesPayload.session
                    ? `session ${strategiesPayload.session}`
                    : null}
                  {strategiesPayload.session && strategiesPayload.tickMs
                    ? " · "
                    : null}
                  {strategiesPayload.tickMs
                    ? `tick ${Math.round(strategiesPayload.tickMs / 1000)}s`
                    : null}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {pipelineStages.map((stage) => {
                const active =
                  detail.bot.lastPipelineStage === stage ||
                  detail.bot.lastPipelineStage?.toUpperCase() ===
                    stage.toUpperCase();
                return (
                  <span
                    key={stage}
                    className={cn(
                      "rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {stage}
                  </span>
                );
              })}
            </div>
          </div>

          <Card>
            <CardContent className="space-y-3 pt-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{detail.bot.name}</h3>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium",
                        STATUS_STYLE[detail.bot.status] ?? STATUS_STYLE.paused,
                      )}
                    >
                      {STATUS_LABEL[detail.bot.status] ?? detail.bot.status}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {strategyLabel}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      AI {detail.bot.aiInfluencePct ?? 0}%
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      TF {detail.bot.candleTf || "1d"}
                    </Badge>
                    {detail.bot.notifyOnTrade ? (
                      <Badge variant="secondary" className="text-[10px]">
                        <Mail className="mr-0.5 h-3 w-3" />
                        Notify
                        {detail.bot.notifyEmail
                          ? ` · ${detail.bot.notifyEmail}`
                          : ""}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {(Array.isArray(detail.bot.symbols) ? detail.bot.symbols : []).join(
                      ", ",
                    ) || "—"}
                    {detail.bot.lastTickAt
                      ? ` · posledný tick ${fmtTime(detail.bot.lastTickAt)}`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {detail.bot.status !== "running" &&
                  detail.bot.status !== "killed" ? (
                    <Button
                      size="sm"
                      onClick={() => actionMut.mutate("start")}
                      disabled={actionMut.isPending}
                    >
                      <Play className="mr-1 h-3.5 w-3.5" />
                      Štart
                    </Button>
                  ) : null}
                  {detail.bot.status === "running" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => actionMut.mutate("pause")}
                      disabled={actionMut.isPending}
                    >
                      <Pause className="mr-1 h-3.5 w-3.5" />
                      Pauza
                    </Button>
                  ) : null}
                  {detail.bot.status !== "killed" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => actionMut.mutate("tick")}
                        disabled={actionMut.isPending}
                      >
                        <Activity className="mr-1 h-3.5 w-3.5" />
                        Tick teraz
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => actionMut.mutate("kill")}
                        disabled={actionMut.isPending}
                      >
                        <OctagonX className="mr-1 h-3.5 w-3.5" />
                        Kill
                      </Button>
                    </>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => actionMut.mutate("delete")}
                    disabled={actionMut.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-md border p-2">
                  <div className="text-[10px] text-muted-foreground">Equity</div>
                  <div className="text-sm font-semibold">
                    {money(detail.equity, detail.bot.currency)}
                  </div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[10px] text-muted-foreground">Hotovosť</div>
                  <div className="text-sm font-semibold">
                    {money(detail.bot.cash, detail.bot.currency)}
                  </div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[10px] text-muted-foreground">Dnes</div>
                  <div
                    className={cn(
                      "text-sm font-semibold",
                      detail.dayPnl >= 0 ? "text-emerald-600" : "text-red-600",
                    )}
                  >
                    {detail.dayPnl >= 0 ? "+" : ""}
                    {money(detail.dayPnl, detail.bot.currency)} (
                    {(detail.dayPnlPct ?? 0).toFixed(2)} %)
                  </div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[10px] text-muted-foreground">Drawdown</div>
                  <div className="text-sm font-semibold">
                    {(detail.drawdownPct ?? 0).toFixed(2)} %
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Risk: daily {detail.bot.risk?.dailyLossLimitPct ?? 2}% · DD{" "}
                {detail.bot.risk?.maxDrawdownPct ?? 15}% · max pos{" "}
                {detail.bot.risk?.maxOpenPositions ?? 5} · size{" "}
                {detail.bot.risk?.maxPositionPct ?? 20}% · exits ATR×
                {detail.bot.exits?.trailingAtrMult ?? 3.5} / TP{" "}
                {detail.bot.exits?.takeProfitPct ?? 12}% / SL{" "}
                {detail.bot.exits?.hardStopPct ?? 8}%
              </p>
            </CardContent>
          </Card>

          <Tabs defaultValue="perf">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="perf">Výkon</TabsTrigger>
              <TabsTrigger value="positions">Otvorené</TabsTrigger>
              <TabsTrigger value="trades">Obchody</TabsTrigger>
              <TabsTrigger value="log">
                <ScrollText className="mr-1 h-3.5 w-3.5" />
                Log
              </TabsTrigger>
            </TabsList>

            <TabsContent value="perf" className="space-y-3">
              {detail.stats ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-md border p-2">
                    <div className="text-[10px] text-muted-foreground">Return</div>
                    <div
                      className={cn(
                        "text-sm font-semibold",
                        (detail.stats.returnPct ?? 0) >= 0
                          ? "text-emerald-600"
                          : "text-red-600",
                      )}
                    >
                      {detail.stats.returnPct >= 0 ? "+" : ""}
                      {(detail.stats.returnPct ?? 0).toFixed(2)} %
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-[10px] text-muted-foreground">
                      Realizovaný P&L
                    </div>
                    <div
                      className={cn(
                        "text-sm font-semibold",
                        (detail.stats.realizedPnl ?? 0) >= 0
                          ? "text-emerald-600"
                          : "text-red-600",
                      )}
                    >
                      {money(detail.stats.realizedPnl, detail.bot.currency)}
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-[10px] text-muted-foreground">Win rate</div>
                    <div className="text-sm font-semibold">
                      {(detail.stats.winRatePct ?? 0).toFixed(1)} % (
                      {detail.stats.wins ?? 0}/{detail.stats.closedTrades ?? 0})
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-[10px] text-muted-foreground">
                      Open / Close / Block
                    </div>
                    <div className="text-sm font-semibold">
                      {detail.stats.openEvents ?? 0} / {detail.stats.closeEvents ?? 0} /{" "}
                      {detail.stats.blockedEvents ?? 0}
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-[10px] text-muted-foreground">Avg win</div>
                    <div className="text-sm font-semibold">
                      {detail.stats.avgWin != null
                        ? money(detail.stats.avgWin, detail.bot.currency)
                        : "—"}
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-[10px] text-muted-foreground">Avg loss</div>
                    <div className="text-sm font-semibold">
                      {detail.stats.avgLoss != null
                        ? money(detail.stats.avgLoss, detail.bot.currency)
                        : "—"}
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-[10px] text-muted-foreground">
                      Otvorené pozície
                    </div>
                    <div className="text-sm font-semibold">
                      {detail.stats.openPositions}
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-[10px] text-muted-foreground">AI eventy</div>
                    <div className="text-sm font-semibold">
                      {detail.stats.aiEvents}
                    </div>
                  </div>
                </div>
              ) : null}

              <Card>
                <CardContent className="pt-4">
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    Equity v čase
                  </div>
                  {chartData.length < 2 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Po niekoľkých tickoch sa tu zobrazí equity krivka.
                    </p>
                  ) : (
                    <EquitySparkline points={chartData.map((p) => p.equity)} />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="positions" className="space-y-2">
              {(detail.positions ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Žiadne otvorené pozície.
                </p>
              ) : (
                (detail.positions ?? []).map((p) => (
                  <Card key={p.id}>
                    <CardContent className="flex items-center justify-between gap-2 py-3">
                      <div>
                        <div className="font-medium">{p.symbol}</div>
                        <div className="text-[11px] text-muted-foreground">
                          qty {p.qty} · entry {p.entryPrice.toFixed(2)} · mark{" "}
                          {(p.markPrice ?? p.entryPrice).toFixed(2)} · peak{" "}
                          {(p.peakPrice ?? p.entryPrice).toFixed(2)}
                        </div>
                      </div>
                      <div
                        className={cn(
                          "text-sm font-semibold",
                          (p.unrealizedPnl ?? 0) >= 0
                            ? "text-emerald-600"
                            : "text-red-600",
                        )}
                      >
                        {(p.unrealizedPnl ?? 0) >= 0 ? "+" : ""}
                        {(p.unrealizedPnl ?? 0).toFixed(2)}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            <TabsContent value="trades" className="space-y-2">
              {(detail.trades ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Zatiaľ žiadne obchody.
                </p>
              ) : (
                (detail.trades ?? []).map((t) => (
                  <Card key={t.id}>
                    <CardContent className="space-y-1 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge
                            className={cn(
                              "text-[10px]",
                              t.side === "BUY"
                                ? "bg-emerald-600 text-white"
                                : "bg-red-600 text-white",
                            )}
                          >
                            {t.side}
                          </Badge>
                          <span className="font-medium">{t.symbol}</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          {fmtTime(t.closedAt)}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        qty {t.qty} @ {t.price.toFixed(2)}
                        {t.pnl != null
                          ? ` · PnL ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}`
                          : ""}
                      </div>
                      <div className="text-[11px]">{t.reason}</div>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            <TabsContent value="log" className="space-y-1.5">
              {(detail.logs ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Log je prázdny.
                </p>
              ) : (
                <div className="max-h-[28rem] space-y-1.5 overflow-y-auto rounded-lg border p-2">
                  {(detail.logs ?? []).map((l) => (
                    <div
                      key={l.id}
                      className="border-b border-border/60 pb-1.5 last:border-0"
                    >
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span>{fmtTime(l.createdAt)}</span>
                        <Badge variant="outline" className="text-[9px] uppercase">
                          {l.eventType}
                        </Badge>
                        {l.symbol ? <span>{l.symbol}</span> : null}
                      </div>
                      <div className="text-xs leading-snug">{l.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      ) : null}
    </div>
  );
}
