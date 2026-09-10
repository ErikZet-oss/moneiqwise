import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Calendar as CalendarIcon,
  ExternalLink,
  Loader2,
  Newspaper,
  Plus,
  RefreshCw,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import { format, isSameDay, parseISO, startOfDay } from "date-fns";
import { sk } from "date-fns/locale";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CompanyLogo } from "@/components/CompanyLogo";
import { HelpTip } from "@/components/HelpTip";
import { usePortfolio } from "@/hooks/usePortfolio";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type AiBotAction = "BUY" | "SELL" | "TRIM" | "HOLD";

type AuditItem = {
  ticker: string;
  companyName: string | null;
  action: AiBotAction;
  weightPct: number | null;
  horizon: "swing" | "long" | null;
  conviction: number | null;
  rationale: string;
  risks: string | null;
  invalidation: string | null;
  newsDrivers?: string[] | null;
};

type Opportunity = {
  ticker: string;
  companyName: string | null;
  thesis: string;
  horizon: "swing" | "long" | null;
  risks: string | null;
  whyNow: string | null;
  conviction: number | null;
  newsDrivers?: string[] | null;
};

type MarketNote = { title: string; detail: string };

type MarketOutlook = {
  sentiment: "risk_on" | "risk_off" | "mixed" | "uncertain";
  narrative: string;
  drivers: string[];
};

type SectorTrend = {
  sector: string;
  bias: "bullish" | "bearish" | "neutral";
  why: string;
};

type NewsDigestItem = {
  title: string;
  publisher: string | null;
  link: string | null;
  whyItMatters: string;
  relatedTickers: string[] | null;
};

type Brief = {
  id: string;
  portfolioId: string;
  portfolioLabel?: string;
  slot: "preopen" | "preclose" | "manual";
  summary: string;
  analysis: {
    summary: string;
    marketOutlook?: MarketOutlook | null;
    sectorTrends?: SectorTrend[];
    newsDigest?: NewsDigestItem[];
    portfolioAudit: AuditItem[];
    newOpportunities: Opportunity[];
    marketNotes: MarketNote[];
    model: string;
    sourcesUsed: string[];
  };
  model: string | null;
  createdAt: string;
};

type Settings = {
  enabled: boolean;
  portfolioId: string;
};

const ACTION_STYLE: Record<AiBotAction, string> = {
  BUY: "bg-emerald-600 text-white",
  SELL: "bg-red-600 text-white",
  TRIM: "bg-amber-500 text-white",
  HOLD: "bg-slate-500 text-white",
};

const SLOT_LABEL: Record<Brief["slot"], string> = {
  preopen: "Pred open",
  preclose: "Pred close",
  manual: "Manuálne",
};

const SENTIMENT_LABEL: Record<MarketOutlook["sentiment"], string> = {
  risk_on: "Risk-on",
  risk_off: "Risk-off",
  mixed: "Zmiešaná",
  uncertain: "Neistá",
};

const SENTIMENT_STYLE: Record<MarketOutlook["sentiment"], string> = {
  risk_on: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
  risk_off: "bg-red-600/15 text-red-700 dark:text-red-400",
  mixed: "bg-amber-500/15 text-amber-800 dark:text-amber-400",
  uncertain: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
};

const BIAS_LABEL: Record<SectorTrend["bias"], string> = {
  bullish: "Bullish",
  bearish: "Bearish",
  neutral: "Neutral",
};

const BIAS_STYLE: Record<SectorTrend["bias"], string> = {
  bullish: "text-emerald-600",
  bearish: "text-red-600",
  neutral: "text-muted-foreground",
};

function ActionBadge({ action }: { action: AiBotAction }) {
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        ACTION_STYLE[action] || ACTION_STYLE.HOLD,
      )}
    >
      {action}
    </span>
  );
}

function NewsDrivers({ drivers }: { drivers?: string[] | null }) {
  if (!drivers?.length) return null;
  return (
    <div className="flex flex-wrap gap-1 pt-0.5">
      {drivers.map((d) => (
        <span
          key={d}
          className="max-w-full truncate rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
          title={d}
        >
          {d}
        </span>
      ))}
    </div>
  );
}

export default function AiBot({ embedded = false }: { embedded?: boolean }) {
  const { portfolios } = usePortfolio();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedBriefId, setSelectedBriefId] = useState<string | null>(null);
  const [historyDate, setHistoryDate] = useState<Date | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const { data: settings, isLoading: settingsLoading } = useQuery<Settings>({
    queryKey: ["/api/ai-bot/settings"],
    queryFn: async () => {
      const res = await fetch("/api/ai-bot/settings", { credentials: "include" });
      if (!res.ok) throw new Error("settings");
      return res.json();
    },
  });

  const portfolioId = settings?.portfolioId || "all";

  const { data: latestPayload, isLoading: latestLoading } = useQuery<{ brief: Brief | null }>({
    queryKey: ["/api/ai-bot/brief/latest", portfolioId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (portfolioId) params.set("portfolio", portfolioId);
      const res = await fetch(`/api/ai-bot/brief/latest?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("latest");
      return res.json();
    },
    enabled: !!settings,
  });

  const { data: historyPayload } = useQuery<{ briefs: Brief[] }>({
    queryKey: ["/api/ai-bot/briefs"],
    queryFn: async () => {
      const res = await fetch("/api/ai-bot/briefs?limit=40", { credentials: "include" });
      if (!res.ok) throw new Error("briefs");
      return res.json();
    },
  });

  const { data: selectedPayload, isFetching: selectedFetching } = useQuery<{ brief: Brief }>({
    queryKey: ["/api/ai-bot/briefs", selectedBriefId],
    queryFn: async () => {
      const res = await fetch(`/api/ai-bot/briefs/${selectedBriefId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("brief");
      return res.json();
    },
    enabled: !!selectedBriefId,
  });

  const activeBrief = selectedBriefId
    ? selectedPayload?.brief ?? null
    : latestPayload?.brief ?? null;

  const saveSettings = useMutation({
    mutationFn: async (patch: Partial<Settings>) => {
      const res = await apiRequest("PUT", "/api/ai-bot/settings", patch);
      return res.json() as Promise<Settings>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-bot/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-bot/brief/latest"] });
    },
    onError: () => {
      toast({ title: "Nastavenia sa neuložili", variant: "destructive" });
    },
  });

  const runBot = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai-bot/run", {
        portfolioId,
      });
      return res.json() as Promise<{ brief: Brief }>;
    },
    onSuccess: (data) => {
      setSelectedBriefId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/ai-bot/brief/latest"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-bot/briefs"] });
      queryClient.setQueryData(["/api/ai-bot/brief/latest", portfolioId], {
        brief: data.brief,
      });
      toast({ title: "AI Bot hotový", description: "Nový brief je pripravený." });
    },
    onError: (err: Error) => {
      toast({
        title: "Spustenie zlyhalo",
        description: err.message || "Skús znova o chvíľu.",
        variant: "destructive",
      });
    },
  });

  const addWatchlist = useMutation({
    mutationFn: async (item: Opportunity) => {
      await apiRequest("POST", "/api/watchlist", {
        ticker: item.ticker,
        companyName: item.companyName || item.ticker,
      });
    },
    onSuccess: (_d, item) => {
      toast({ title: "Pridané do watchlistu", description: item.ticker });
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
    },
    onError: (err: any) => {
      const msg = String(err?.message || "");
      toast({
        title: msg.includes("409") ? "Už je vo watchliste" : "Nepodarilo sa pridať",
        variant: "destructive",
      });
    },
  });

  const history = historyPayload?.briefs ?? [];
  const analysis = activeBrief?.analysis;

  const portfolioNameById = useMemo(() => {
    const map = new Map<string, string>();
    map.set("all", "Všetky portfóliá");
    for (const p of portfolios) map.set(p.id, p.name);
    return map;
  }, [portfolios]);

  function briefPortfolioLabel(b: Brief): string {
    if (b.portfolioLabel) return b.portfolioLabel;
    return portfolioNameById.get(b.portfolioId) || "Portfólio";
  }

  const briefDates = useMemo(() => {
    const dates: Date[] = [];
    const seen = new Set<string>();
    for (const b of history) {
      try {
        const d = startOfDay(parseISO(b.createdAt));
        const key = format(d, "yyyy-MM-dd");
        if (!seen.has(key)) {
          seen.add(key);
          dates.push(d);
        }
      } catch {
        /* ignore */
      }
    }
    return dates;
  }, [history]);

  const briefsOnSelectedDay = useMemo(() => {
    if (!historyDate) return [];
    return history.filter((b) => {
      try {
        return isSameDay(parseISO(b.createdAt), historyDate);
      } catch {
        return false;
      }
    });
  }, [history, historyDate]);

  const createdLabel = useMemo(() => {
    if (!activeBrief?.createdAt) return null;
    try {
      return format(parseISO(activeBrief.createdAt), "d. M. yyyy HH:mm", { locale: sk });
    } catch {
      return activeBrief.createdAt;
    }
  }, [activeBrief?.createdAt]);

  function selectLatest() {
    setHistoryDate(null);
    setSelectedBriefId(null);
  }

  function pickHistoryDate(day: Date | undefined) {
    if (!day) return;
    setHistoryDate(startOfDay(day));
    setCalendarOpen(false);
    const onDay = history.filter((b) => {
      try {
        return isSameDay(parseISO(b.createdAt), day);
      } catch {
        return false;
      }
    });
    setSelectedBriefId(onDay[0]?.id ?? null);
  }

  if (settingsLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className={cn("space-y-3 md:space-y-4", !embedded && "mx-auto max-w-3xl pb-8")}>
      <div className="flex items-center justify-between gap-2">
        {!embedded ? (
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">AI Bot</h1>
          </div>
        ) : (
          <span className="text-sm font-medium text-muted-foreground">História</span>
        )}
        <div className="flex items-center gap-1.5">
          {historyDate ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 gap-1 px-2 text-xs"
              onClick={selectLatest}
            >
              <X className="h-3.5 w-3.5" />
              Najnovší
            </Button>
          ) : null}
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant={historyDate ? "default" : "outline"}
                className="h-9 w-9 shrink-0"
                aria-label="História briefov – výber dátumu"
                data-testid="button-ai-bot-history-calendar"
                disabled={history.length === 0}
              >
                <CalendarIcon className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                locale={sk}
                selected={historyDate ?? undefined}
                onSelect={pickHistoryDate}
                disabled={(day) =>
                  !briefDates.some((d) => isSameDay(d, day))
                }
                modifiers={{ hasBrief: briefDates }}
                modifiersClassNames={{
                  hasBrief: "font-semibold underline decoration-primary/60",
                }}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {historyDate ? (
        <Card>
          <CardContent className="space-y-2 p-3">
            <p className="text-xs font-medium">
              Briefy · {format(historyDate, "d. M. yyyy", { locale: sk })}
            </p>
            {briefsOnSelectedDay.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Pre tento deň nie je žiadny brief.
              </p>
            ) : (
              <div className="space-y-1.5">
                {briefsOnSelectedDay.map((b) => {
                  let timeLabel = "";
                  try {
                    timeLabel = format(parseISO(b.createdAt), "HH:mm", { locale: sk });
                  } catch {
                    /* ignore */
                  }
                  const active = selectedBriefId === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSelectedBriefId(b.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                        active
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/60",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">
                          {briefPortfolioLabel(b)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {SLOT_LABEL[b.slot]}
                          {timeLabel ? ` · ${timeLabel}` : ""}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardContent className="space-y-3 p-3 md:p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="text-sm font-medium">Automatické behy</p>
              <HelpTip title="Automatické behy">
                <p>
                  Pred open ~15:00–15:29 SEČ/SELČ (do US open 15:30) a pred close
                  ~21:45–21:59 (US close 22:00), pracovné dni.
                </p>
                <p>
                  Automat spraví brief pre{" "}
                  <span className="font-medium">každé portfólio</span> zvlášť aj pre{" "}
                  <span className="font-medium">Všetky portfóliá</span>.
                </p>
              </HelpTip>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Label htmlFor="ai-bot-enabled" className="text-xs text-muted-foreground">
                Zapnuté
              </Label>
              <Switch
                id="ai-bot-enabled"
                checked={settings?.enabled ?? true}
                onCheckedChange={(v) => saveSettings.mutate({ enabled: v })}
                data-testid="switch-ai-bot-enabled"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Portfólio (manuálny beh / zobrazenie)
            </Label>
            <Select
              value={portfolioId}
              onValueChange={(v) => saveSettings.mutate({ portfolioId: v })}
            >
              <SelectTrigger className="h-10" data-testid="select-ai-bot-portfolio">
                <SelectValue placeholder="Portfólio" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Všetky portfóliá</SelectItem>
                {portfolios.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            className="h-11 w-full gap-2 text-sm"
            onClick={() => runBot.mutate()}
            disabled={runBot.isPending}
            data-testid="button-ai-bot-run"
          >
            {runBot.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Spustiť teraz
          </Button>
        </CardContent>
      </Card>

      {(latestLoading || selectedFetching) && !activeBrief ? (
        <Skeleton className="h-36 w-full" />
      ) : activeBrief ? (
        <Card>
          <CardContent className="space-y-2 p-3 md:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Dnešný brief</span>
              <Badge variant="secondary" className="text-[10px]">
                {SLOT_LABEL[activeBrief.slot]}
              </Badge>
              <Badge variant="outline" className="max-w-[11rem] truncate text-[10px]">
                {briefPortfolioLabel(activeBrief)}
              </Badge>
              {createdLabel && (
                <span className="text-[10px] text-muted-foreground md:text-xs">
                  {createdLabel}
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-foreground/90">
              {analysis?.summary || activeBrief.summary}
            </p>
            {analysis?.sourcesUsed?.length ? (
              <p className="text-[10px] text-muted-foreground">
                Zdroje: {analysis.sourcesUsed.join(", ")}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4 text-center text-sm text-muted-foreground">
            Zatiaľ žiadny brief. Spusti AI Bot manuálne alebo počkaj na automatický beh.
          </CardContent>
        </Card>
      )}

      {analysis?.marketOutlook ? (
        <Card>
          <CardContent className="space-y-2 p-3 md:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Nálada trhu</span>
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                  SENTIMENT_STYLE[analysis.marketOutlook.sentiment],
                )}
              >
                {SENTIMENT_LABEL[analysis.marketOutlook.sentiment]}
              </span>
            </div>
            <p className="text-xs leading-relaxed md:text-sm">
              {analysis.marketOutlook.narrative}
            </p>
            {analysis.marketOutlook.drivers?.length ? (
              <div className="flex flex-wrap gap-1">
                {analysis.marketOutlook.drivers.map((d) => (
                  <Badge key={d} variant="secondary" className="max-w-full truncate text-[10px]">
                    {d}
                  </Badge>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {analysis?.sectorTrends?.length ? (
        <section className="space-y-2">
          <h2 className="px-0.5 text-sm font-semibold">Trendy v sektore</h2>
          <div className="space-y-2">
            {analysis.sectorTrends.map((s) => (
              <div key={s.sector} className="rounded-lg border px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-medium">{s.sector}</p>
                  <span className={cn("text-[10px] font-semibold", BIAS_STYLE[s.bias])}>
                    {BIAS_LABEL[s.bias]}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground md:text-xs">
                  {s.why}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {analysis?.newsDigest?.length ? (
        <section className="space-y-2">
          <h2 className="flex items-center gap-1.5 px-0.5 text-sm font-semibold">
            <Newspaper className="h-4 w-4" />
            Kľúčové novinky
          </h2>
          <div className="space-y-2">
            {analysis.newsDigest.map((n, i) => (
              <Card key={`${n.title}-${i}`}>
                <CardContent className="space-y-1.5 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium leading-snug md:text-sm">{n.title}</p>
                    {n.link ? (
                      <a
                        href={n.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label="Otvoriť článok"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                  {n.publisher ? (
                    <p className="text-[10px] text-muted-foreground">{n.publisher}</p>
                  ) : null}
                  <p className="text-[11px] leading-relaxed text-muted-foreground md:text-xs">
                    {n.whyItMatters}
                  </p>
                  {n.relatedTickers?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {n.relatedTickers.map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px]">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {analysis?.portfolioAudit?.length ? (
        <section className="space-y-2">
          <h2 className="px-0.5 text-sm font-semibold">Audit portfólia</h2>
          <div className="space-y-2">
            {analysis.portfolioAudit.map((item) => (
              <Card key={item.ticker} className="overflow-hidden">
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start gap-2.5">
                    <CompanyLogo ticker={item.ticker} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">{item.ticker}</span>
                        <ActionBadge action={item.action} />
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {item.companyName || "—"}
                        {item.weightPct != null
                          ? ` · ${item.weightPct.toFixed(1)}% portf.`
                          : ""}
                        {item.horizon ? ` · ${item.horizon}` : ""}
                        {item.conviction != null ? ` · conf. ${item.conviction}/5` : ""}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed md:text-sm whitespace-pre-line">
                    {item.rationale}
                  </p>
                  <NewsDrivers drivers={item.newsDrivers} />
                  {item.risks ? (
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground/80">Riziká:</span> {item.risks}
                    </p>
                  ) : null}
                  {item.invalidation ? (
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground/80">Invalidácia:</span>{" "}
                      {item.invalidation}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {analysis?.newOpportunities?.length ? (
        <section className="space-y-2">
          <h2 className="px-0.5 text-sm font-semibold">Nové tipy od AI</h2>
          <div className="space-y-2">
            {analysis.newOpportunities.map((item) => (
              <Card key={item.ticker}>
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start gap-2.5">
                    <CompanyLogo ticker={item.ticker} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{item.ticker}</span>
                        {item.horizon && (
                          <Badge variant="outline" className="text-[10px]">
                            {item.horizon}
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {item.companyName || "—"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0 gap-1 px-2 text-xs"
                      disabled={addWatchlist.isPending}
                      onClick={() => addWatchlist.mutate(item)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Watchlist
                    </Button>
                  </div>
                  <p className="text-xs leading-relaxed md:text-sm">
                    <span className="font-medium text-foreground/80">Téza: </span>
                    {item.thesis}
                  </p>
                  {item.whyNow && item.whyNow !== item.thesis ? (
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground/80">Prečo teraz:</span>{" "}
                      {item.whyNow}
                    </p>
                  ) : null}
                  <NewsDrivers drivers={item.newsDrivers} />
                  {item.risks ? (
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground/80">Riziká:</span> {item.risks}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {analysis?.marketNotes?.length ? (
        <section className="space-y-2">
          <h2 className="px-0.5 text-sm font-semibold">Denník / poznámky</h2>
          <div className="space-y-2">
            {analysis.marketNotes.map((n, i) => (
              <div
                key={`${n.title}-${i}`}
                className="rounded-lg border px-3 py-2"
              >
                <p className="text-xs font-medium">{n.title}</p>
                <p className="text-[11px] leading-relaxed text-muted-foreground md:text-xs">
                  {n.detail}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
