import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Loader2,
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
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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

type PaperStrategyId =
  | "ema_rsi_trend"
  | "ma_crossover"
  | "rsi_mean_reversion"
  | "dual_momentum";
type PaperBotStatus = "running" | "paused" | "killed";

type PaperBot = {
  id: string;
  name: string;
  status: PaperBotStatus;
  startingCash: number;
  cash: number;
  currency: string;
  strategyId: PaperStrategyId;
  symbols: string[];
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

function money(n: number, currency = "EUR") {
  return `${n.toLocaleString("sk-SK", {
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

export default function AiPaperBot({ embedded = false }: { embedded?: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [name, setName] = useState("Môj Paper Bot");
  const [startingCash, setStartingCash] = useState("10000");
  const [symbols, setSymbols] = useState("AAPL, MSFT, NVDA, GOOGL, META");
  const [strategyId, setStrategyId] = useState<PaperStrategyId>("ema_rsi_trend");
  const [maxOpen, setMaxOpen] = useState("5");
  const [dailyLoss, setDailyLoss] = useState("2");
  const [maxDd, setMaxDd] = useState("15");
  const [maxPosPct, setMaxPosPct] = useState("20");
  const [trailAtr, setTrailAtr] = useState("3.5");
  const [takeProfit, setTakeProfit] = useState("12");
  const [hardStop, setHardStop] = useState("8");
  const [aiInfluence, setAiInfluence] = useState("20");
  const [aiMinConf, setAiMinConf] = useState("60");

  const { data: strategiesPayload } = useQuery<{
    strategies: Array<{ id: PaperStrategyId; label: string; description: string }>;
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

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/paper-bots", {
        name,
        startingCash: Number(startingCash),
        symbols,
        strategyId,
        dailyLossLimitPct: Number(dailyLoss),
        maxDrawdownPct: Number(maxDd),
        maxOpenPositions: Number(maxOpen),
        maxPositionPct: Number(maxPosPct),
        trailingAtrMult: Number(trailAtr),
        takeProfitPct: Number(takeProfit),
        hardStopPct: Number(hardStop),
        aiInfluencePct: Number(aiInfluence),
        aiMinConfidence: Number(aiMinConf),
      });
      return res.json() as Promise<{ bot: PaperBot }>;
    },
    onSuccess: (data) => {
      toast({ title: "Paper bot vytvorený" });
      setShowCreate(false);
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
                <Label>Názov</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Kapitál (EUR)</Label>
                <Input
                  inputMode="decimal"
                  value={startingCash}
                  onChange={(e) => setStartingCash(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Tickery (oddelené čiarkou)</Label>
                <Input
                  value={symbols}
                  onChange={(e) => setSymbols(e.target.value)}
                  placeholder="AAPL, MSFT, NVDA"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Stratégia</Label>
                <Select
                  value={strategyId}
                  onValueChange={(v) => setStrategyId(v as PaperStrategyId)}
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
              <div className="space-y-1.5">
                <Label>Max otvorené pozície</Label>
                <Input value={maxOpen} onChange={(e) => setMaxOpen(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Max % na 1 pozíciu</Label>
                <Input
                  value={maxPosPct}
                  onChange={(e) => setMaxPosPct(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Daily loss limit %</Label>
                <Input
                  value={dailyLoss}
                  onChange={(e) => setDailyLoss(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Max drawdown %</Label>
                <Input value={maxDd} onChange={(e) => setMaxDd(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Trailing ATR×</Label>
                <Input value={trailAtr} onChange={(e) => setTrailAtr(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Take profit %</Label>
                <Input
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Hard stop %</Label>
                <Input
                  value={hardStop}
                  onChange={(e) => setHardStop(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>AI influence %</Label>
                <Input
                  value={aiInfluence}
                  onChange={(e) => setAiInfluence(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>AI min confidence %</Label>
                <Input
                  value={aiMinConf}
                  onChange={(e) => setAiMinConf(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                Zrušiť
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
                {STATUS_LABEL[b.status]} · {money(b.cash, b.currency)}
              </div>
            </button>
          ))}
        </div>
      )}

      {activeId && detailLoading && !detail ? (
        <Skeleton className="h-64 w-full" />
      ) : detail ? (
        <div className="space-y-3">
          <Card>
            <CardContent className="space-y-3 pt-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{detail.bot.name}</h3>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium",
                        STATUS_STYLE[detail.bot.status],
                      )}
                    >
                      {STATUS_LABEL[detail.bot.status]}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {strategyLabel}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      AI {detail.bot.aiInfluencePct}%
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {detail.bot.symbols.join(", ")}
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
                    {detail.dayPnlPct.toFixed(2)} %)
                  </div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-[10px] text-muted-foreground">Drawdown</div>
                  <div className="text-sm font-semibold">
                    {detail.drawdownPct.toFixed(2)} %
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Risk: daily {detail.bot.risk.dailyLossLimitPct}% · DD{" "}
                {detail.bot.risk.maxDrawdownPct}% · max pos{" "}
                {detail.bot.risk.maxOpenPositions} · size{" "}
                {detail.bot.risk.maxPositionPct}% · exits ATR×
                {detail.bot.exits.trailingAtrMult} / TP{" "}
                {detail.bot.exits.takeProfitPct}% / SL{" "}
                {detail.bot.exits.hardStopPct}%
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
                        detail.stats.returnPct >= 0
                          ? "text-emerald-600"
                          : "text-red-600",
                      )}
                    >
                      {detail.stats.returnPct >= 0 ? "+" : ""}
                      {detail.stats.returnPct.toFixed(2)} %
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-[10px] text-muted-foreground">
                      Realizovaný P&L
                    </div>
                    <div
                      className={cn(
                        "text-sm font-semibold",
                        detail.stats.realizedPnl >= 0
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
                      {detail.stats.winRatePct.toFixed(1)} % (
                      {detail.stats.wins}/{detail.stats.closedTrades})
                    </div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-[10px] text-muted-foreground">
                      Open / Close / Block
                    </div>
                    <div className="text-sm font-semibold">
                      {detail.stats.openEvents} / {detail.stats.closeEvents} /{" "}
                      {detail.stats.blockedEvents}
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
                    <div className="h-48 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                          <XAxis dataKey="t" hide />
                          <YAxis
                            width={48}
                            tick={{ fontSize: 10 }}
                            domain={["auto", "auto"]}
                          />
                          <Tooltip
                            contentStyle={{ fontSize: 12 }}
                            formatter={(v: number) => [
                              money(v, detail.bot.currency),
                              "Equity",
                            ]}
                          />
                          <Line
                            type="monotone"
                            dataKey="equity"
                            stroke="hsl(var(--primary))"
                            strokeWidth={2}
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="positions" className="space-y-2">
              {detail.positions.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Žiadne otvorené pozície.
                </p>
              ) : (
                detail.positions.map((p) => (
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
              {detail.trades.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Zatiaľ žiadne obchody.
                </p>
              ) : (
                detail.trades.map((t) => (
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
              {detail.logs.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Log je prázdny.
                </p>
              ) : (
                <div className="max-h-[28rem] space-y-1.5 overflow-y-auto rounded-lg border p-2">
                  {detail.logs.map((l) => (
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
