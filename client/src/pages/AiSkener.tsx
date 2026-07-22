import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Brain,
  Loader2,
  Plus,
  Search,
  Sparkles,
  TrendingDown,
  Gem,
  Banknote,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanyLogo } from "@/components/CompanyLogo";
import { FinanceTermText } from "@/components/FinanceTermText";
import { AiSkenerChat } from "@/components/AiSkenerChat";
import { AiSkenerPromptsEditor } from "@/components/AiSkenerPromptsEditor";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type StrategyId = "dip_buyer" | "garp" | "dividend";

type StrategyMeta = {
  id: StrategyId;
  label: string;
  shortLabel: string;
  description: string;
};

type TopPick = {
  ticker: string;
  companyName: string;
  comment: string;
  risk: string;
  metrics: {
    price: number | null;
    changePercent: number | null;
    pe: number | null;
    marketCap: string | null;
    sector: string | null;
  };
};

type RunResult = {
  strategy: { id: string; label: string; description: string };
  insight: string;
  topPicks: TopPick[];
  scannedCount: number;
  cached: boolean;
  finvizUrl?: string;
  dataSource?: "finviz" | "yahoo";
  model: string | null;
};

type TickerVerdict = {
  ticker: string;
  companyName: string | null;
  verdict: "vhodna" | "opatrne" | "nevhodna" | "neiste";
  summary: string;
  pros: string[];
  cons: string[];
  metrics: {
    pe: string | null;
    price: string | null;
    change: string | null;
    rsi: string | null;
    marketCap: string | null;
  };
  model: string;
  cached: boolean;
};

type SearchHit = { ticker: string; name: string };

const STRATEGY_ICONS: Record<StrategyId, typeof TrendingDown> = {
  dip_buyer: TrendingDown,
  garp: Gem,
  dividend: Banknote,
};

function formatPct(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function changeColor(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "text-muted-foreground";
  return n > 0 ? "text-green-500" : "text-red-500";
}

function verdictBadge(v: TickerVerdict["verdict"]) {
  switch (v) {
    case "vhodna":
      return { label: "Vhodná", className: "bg-green-600 hover:bg-green-600" };
    case "opatrne":
      return { label: "Opatrne", className: "bg-amber-600 hover:bg-amber-600" };
    case "nevhodna":
      return { label: "Nevhodná", className: "bg-red-600 hover:bg-red-600" };
    default:
      return { label: "Neisté", className: "bg-muted-foreground hover:bg-muted-foreground" };
  }
}

export default function AiSkener() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [strategyId, setStrategyId] = useState<StrategyId>("dip_buyer");
  const [search, setSearch] = useState("");
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [tickerResult, setTickerResult] = useState<TickerVerdict | null>(null);
  const [mode, setMode] = useState<"strategy" | "ticker">("strategy");

  const { data: strategiesData } = useQuery<{ strategies: StrategyMeta[] }>({
    queryKey: ["/api/ai-scanner/strategies"],
    queryFn: async () => {
      const res = await fetch("/api/ai-scanner/strategies", { credentials: "include" });
      if (!res.ok) throw new Error("strategies");
      return res.json();
    },
  });

  const strategies = strategiesData?.strategies ?? [];

  const debouncedSearch = search.trim();
  const { data: searchHits, isFetching: searchLoading } = useQuery<SearchHit[]>({
    queryKey: ["/api/stocks/search", "ai-skener", debouncedSearch],
    enabled: debouncedSearch.length >= 1 && mode === "ticker",
    queryFn: async () => {
      const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(debouncedSearch)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("search");
      return res.json();
    },
  });

  const runMutation = useMutation({
    mutationFn: async (payload: { strategyId: StrategyId; refresh?: boolean }) => {
      const res = await apiRequest("POST", "/api/ai-scanner/run", payload);
      return (await res.json()) as RunResult;
    },
    onSuccess: (data) => {
      setMode("strategy");
      setTickerResult(null);
      setRunResult(data);
      toast({
        title: "Skener hotový",
        description: data.cached ? "Výsledok z cache (24h)." : "Nové dáta z Finviz + Claude.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Skener zlyhal", description: err.message, variant: "destructive" });
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async (ticker: string) => {
      const res = await apiRequest("POST", "/api/ai-scanner/analyze-ticker", { ticker });
      return (await res.json()) as TickerVerdict;
    },
    onSuccess: (data) => {
      setMode("ticker");
      setRunResult(null);
      setTickerResult(data);
      setSearch("");
      toast({ title: `Vyhodnotené: ${data.ticker}` });
    },
    onError: (err: Error) => {
      toast({ title: "Analýza zlyhala", description: err.message, variant: "destructive" });
    },
  });

  const addWatchlistMutation = useMutation({
    mutationFn: async (payload: { ticker: string; companyName: string }) => {
      return apiRequest("POST", "/api/watchlist", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({ title: "Pridané do Watchlistu" });
    },
    onError: (err: Error) => {
      const msg = err.message.includes("409") ? "Ticker už je vo watchliste." : err.message;
      toast({ title: "Nepodarilo sa pridať", description: msg, variant: "destructive" });
    },
  });

  const isBusy = runMutation.isPending || analyzeMutation.isPending;

  const selectedStrategy = useMemo(
    () => strategies.find((s) => s.id === strategyId),
    [strategies, strategyId],
  );

  return (
    <div className="flex flex-col gap-3 md:gap-6 pb-6 md:pb-8">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold flex items-center gap-2 flex-wrap">
            <Brain className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
            AI Skener
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Finviz filtre + Claude vyhodnotenie — stratégie alebo jedna akcia
          </p>
        </div>
        <AiSkenerPromptsEditor />
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setMode("ticker");
          }}
          placeholder="Vyhodnoť ticker alebo názov firmy…"
          className="h-9 pl-8 text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter" && search.trim()) {
              const hit = searchHits?.[0];
              analyzeMutation.mutate((hit?.ticker || search.trim()).toUpperCase());
            }
          }}
        />
        {mode === "ticker" && debouncedSearch.length >= 1 && (
          <Card className="absolute z-20 mt-1 w-full shadow-lg">
            <CardContent className="p-0 max-h-48 overflow-y-auto">
              {searchLoading ? (
                <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Hľadám…
                </div>
              ) : !searchHits?.length ? (
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-xs hover:bg-muted/60"
                  disabled={isBusy}
                  onClick={() => analyzeMutation.mutate(debouncedSearch.toUpperCase())}
                >
                  Vyhodnotiť <span className="font-semibold">{debouncedSearch.toUpperCase()}</span>
                </button>
              ) : (
                searchHits
                  .filter((r) => r.ticker !== "CASH")
                  .slice(0, 6)
                  .map((hit) => (
                    <button
                      key={hit.ticker}
                      type="button"
                      disabled={isBusy}
                      onClick={() => analyzeMutation.mutate(hit.ticker)}
                      className="flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left last:border-0 hover:bg-muted/60 disabled:opacity-50"
                    >
                      <CompanyLogo ticker={hit.ticker} companyName={hit.name} size="xs" />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold">{hit.ticker}</div>
                        <div className="truncate text-[10px] text-muted-foreground">{hit.name}</div>
                      </div>
                    </button>
                  ))
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[10px] text-muted-foreground">Rýchle stratégie</p>
        <div className="flex flex-wrap gap-1.5">
          {(strategies.length
            ? strategies
            : [
                { id: "dip_buyer" as const, label: "The Dip Buyer", shortLabel: "Dip", description: "" },
                { id: "garp" as const, label: "GARP Strategy", shortLabel: "GARP", description: "" },
                { id: "dividend" as const, label: "Dividend Compounder", shortLabel: "Div.", description: "" },
              ]
          ).map((s) => {
            const Icon = STRATEGY_ICONS[s.id] ?? Sparkles;
            const active = strategyId === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setStrategyId(s.id);
                  setMode("strategy");
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/50 text-muted-foreground border-border hover:bg-muted",
                )}
              >
                <Icon className="h-3 w-3 shrink-0" />
                {s.label}
              </button>
            );
          })}
        </div>
        {selectedStrategy?.description && (
          <p className="text-[10px] text-muted-foreground">{selectedStrategy.description}</p>
        )}
        <Button
          className="h-9 text-xs w-full sm:w-auto sm:self-start"
          disabled={isBusy}
          onClick={() => runMutation.mutate({ strategyId })}
        >
          {runMutation.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Spúšťam Claude…
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Spustiť AI Skener
            </>
          )}
        </Button>
      </div>

      {(isBusy && !runResult && !tickerResult) && (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      )}

      {mode === "strategy" && runResult && (
        <div className="flex flex-col gap-2">
          <Card className="border-primary/20 bg-primary/[0.04]">
            <CardContent className="p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Sparkles className="h-3 w-3 text-primary" />
                AI Insight · {runResult.strategy.label}
                {runResult.cached && <Badge variant="outline" className="text-[8px] h-4 px-1">cache</Badge>}
                {runResult.dataSource === "yahoo" && (
                  <Badge variant="outline" className="text-[8px] h-4 px-1">
                    Yahoo fallback
                  </Badge>
                )}
              </div>
              <FinanceTermText text={runResult.insight} as="p" className="text-xs leading-relaxed" />
              <p className="text-[9px] text-muted-foreground">
                Prehľadaných {runResult.scannedCount} akcií · TOP {runResult.topPicks.length}
              </p>
            </CardContent>
          </Card>

          {runResult.topPicks.length === 0 ? (
            <Card>
              <CardContent className="p-4 text-center text-xs text-muted-foreground">
                Žiadne výsledky pre túto stratégiu.
              </CardContent>
            </Card>
          ) : (
            runResult.topPicks.map((pick) => {
              const ch = pick.metrics.changePercent;
              return (
                <Card key={pick.ticker} className="relative overflow-hidden">
                  {ch != null && ch !== 0 && (
                    <div
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute inset-0 bg-gradient-to-l from-35% to-transparent",
                        ch > 0 ? "from-green-500/10 dark:from-green-500/15" : "from-red-500/10 dark:from-red-500/15",
                      )}
                    />
                  )}
                  <CardContent className="relative p-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <CompanyLogo ticker={pick.ticker} companyName={pick.companyName} size="xs" />
                      <div className="min-w-0 flex-1 leading-tight">
                        <div className="text-xs font-semibold">{pick.ticker}</div>
                        <p className="truncate text-[9px] text-muted-foreground">{pick.companyName}</p>
                      </div>
                      <div className="shrink-0 flex items-center gap-1 leading-none">
                        {formatPct(ch) && (
                          <span className={`text-[10px] font-medium tabular-nums ${changeColor(ch)}`}>
                            {formatPct(ch)}
                          </span>
                        )}
                        {pick.metrics.price != null && (
                          <span className="text-xs font-semibold tabular-nums">
                            ${pick.metrics.price.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                    <FinanceTermText
                      text={pick.comment}
                      as="p"
                      className="text-[10px] leading-snug text-foreground/90"
                    />
                    {pick.risk ? (
                      <FinanceTermText
                        text={`Riziko: ${pick.risk}`}
                        as="p"
                        className="text-[9px] text-muted-foreground leading-snug"
                      />
                    ) : null}
                    <div className="flex items-center justify-between gap-2 text-[8px] text-muted-foreground">
                      <span className="flex gap-x-2 flex-wrap">
                        <span>
                          <FinanceTermText text="P/E" className="inline" />{" "}
                          <span className="text-foreground font-medium tabular-nums">
                            {pick.metrics.pe != null ? pick.metrics.pe.toFixed(1) : "—"}
                          </span>
                        </span>
                        {pick.metrics.marketCap && (
                          <span>
                            <FinanceTermText text="Cap" className="inline" />{" "}
                            <span className="text-foreground font-medium">{pick.metrics.marketCap}</span>
                          </span>
                        )}
                        {pick.metrics.sector && (
                          <span className="truncate max-w-[8rem]">{pick.metrics.sector}</span>
                        )}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[9px] px-2 shrink-0"
                        disabled={addWatchlistMutation.isPending}
                        onClick={() =>
                          addWatchlistMutation.mutate({
                            ticker: pick.ticker,
                            companyName: pick.companyName,
                          })
                        }
                      >
                        <Plus className="h-3 w-3 mr-0.5" />
                        Watchlist
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}

          <AiSkenerChat
            kind="strategy"
            title={`Stratégia ${runResult.strategy.label}`}
            contextKey={`strategy:${runResult.strategy.id}:${runResult.insight.slice(0, 40)}`}
            context={{
              strategy: runResult.strategy,
              insight: runResult.insight,
              topPicks: runResult.topPicks,
              scannedCount: runResult.scannedCount,
            }}
          />
        </div>
      )}

      {mode === "ticker" && tickerResult && (
        <div className="flex flex-col gap-2">
          <Card className="border-primary/20 bg-primary/[0.04]">
            <CardContent className="p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Sparkles className="h-3 w-3 text-primary" />
                <span className="text-[10px] text-muted-foreground">Claude verdikt</span>
                <Badge className={`text-[8px] h-4 px-1.5 ${verdictBadge(tickerResult.verdict).className}`}>
                  {verdictBadge(tickerResult.verdict).label}
                </Badge>
                {tickerResult.cached && (
                  <Badge variant="outline" className="text-[8px] h-4 px-1">
                    cache
                  </Badge>
                )}
              </div>
              <FinanceTermText text={tickerResult.summary} as="p" className="text-xs leading-relaxed" />
              {(tickerResult.pros.length > 0 || tickerResult.cons.length > 0) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {tickerResult.pros.length > 0 && (
                    <div>
                      <p className="text-[9px] font-medium text-green-600 dark:text-green-400 mb-0.5">Plusy</p>
                      <ul className="text-[9px] text-muted-foreground space-y-0.5 list-disc pl-3">
                        {tickerResult.pros.map((p, i) => (
                          <li key={i}>
                            <FinanceTermText text={p} className="inline" />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {tickerResult.cons.length > 0 && (
                    <div>
                      <p className="text-[9px] font-medium text-red-500 mb-0.5">Riziká</p>
                      <ul className="text-[9px] text-muted-foreground space-y-0.5 list-disc pl-3">
                        {tickerResult.cons.map((c, i) => (
                          <li key={i}>
                            <FinanceTermText text={c} className="inline" />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden">
            <CardContent className="relative p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <CompanyLogo
                  ticker={tickerResult.ticker}
                  companyName={tickerResult.companyName ?? tickerResult.ticker}
                  size="xs"
                />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="text-xs font-semibold">{tickerResult.ticker}</div>
                  <p className="truncate text-[9px] text-muted-foreground">
                    {tickerResult.companyName || tickerResult.ticker}
                  </p>
                </div>
                <div className="text-right shrink-0 leading-tight">
                  {tickerResult.metrics.change && (
                    <div className="text-[10px] font-medium tabular-nums text-muted-foreground">
                      {tickerResult.metrics.change}
                    </div>
                  )}
                  {tickerResult.metrics.price && (
                    <div className="text-xs font-semibold tabular-nums">{tickerResult.metrics.price}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 text-[8px] text-muted-foreground">
                <span className="flex gap-x-2 flex-wrap">
                  <span>
                    <FinanceTermText text="P/E" className="inline" />{" "}
                    <span className="text-foreground font-medium tabular-nums">
                      {tickerResult.metrics.pe || "—"}
                    </span>
                  </span>
                  <span>
                    <FinanceTermText text="RSI" className="inline" />{" "}
                    <span className="text-foreground font-medium tabular-nums">
                      {tickerResult.metrics.rsi || "—"}
                    </span>
                  </span>
                  {tickerResult.metrics.marketCap && (
                    <span>
                      <FinanceTermText text="Cap" className="inline" />{" "}
                      <span className="text-foreground font-medium">{tickerResult.metrics.marketCap}</span>
                    </span>
                  )}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[9px] px-2 shrink-0"
                  disabled={addWatchlistMutation.isPending}
                  onClick={() =>
                    addWatchlistMutation.mutate({
                      ticker: tickerResult.ticker,
                      companyName: tickerResult.companyName || tickerResult.ticker,
                    })
                  }
                >
                  <Plus className="h-3 w-3 mr-0.5" />
                  Watchlist
                </Button>
              </div>
            </CardContent>
          </Card>

          <AiSkenerChat
            kind="ticker"
            title={`Ticker ${tickerResult.ticker}`}
            contextKey={`ticker:${tickerResult.ticker}:${tickerResult.summary.slice(0, 40)}`}
            context={{
              ticker: tickerResult.ticker,
              companyName: tickerResult.companyName,
              verdict: tickerResult.verdict,
              summary: tickerResult.summary,
              pros: tickerResult.pros,
              cons: tickerResult.cons,
              metrics: tickerResult.metrics,
            }}
          />
        </div>
      )}

      {!isBusy && !runResult && !tickerResult && (
        <Card>
          <CardContent className="p-4 text-center text-xs text-muted-foreground space-y-1">
            <p>Vyber stratégiu a spusti skener, alebo vyhľadaj ticker pre Claude verdikt.</p>
            <p>Pod výsledkom môžeš písať do chatu — celá konverzácia sa ukladá do histórie.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
