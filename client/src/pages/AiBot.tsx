import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  CalendarClock,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { format, parseISO } from "date-fns";
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
import { CompanyLogo } from "@/components/CompanyLogo";
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
};

type Opportunity = {
  ticker: string;
  companyName: string | null;
  thesis: string;
  horizon: "swing" | "long" | null;
  risks: string | null;
  whyNow: string | null;
  conviction: number | null;
};

type MarketNote = { title: string; detail: string };

type Brief = {
  id: string;
  portfolioId: string;
  slot: "preopen" | "preclose" | "manual";
  summary: string;
  analysis: {
    summary: string;
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

export default function AiBot({ embedded = false }: { embedded?: boolean }) {
  const { portfolios } = usePortfolio();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedBriefId, setSelectedBriefId] = useState<string | null>(null);

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
      const res = await fetch("/api/ai-bot/briefs?limit=14", { credentials: "include" });
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

  const createdLabel = useMemo(() => {
    if (!activeBrief?.createdAt) return null;
    try {
      return format(parseISO(activeBrief.createdAt), "d. M. yyyy HH:mm", { locale: sk });
    } catch {
      return activeBrief.createdAt;
    }
  }, [activeBrief?.createdAt]);

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
      {!embedded && (
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">AI Bot</h1>
        </div>
      )}

      <Card className="overflow-hidden">
        <CardContent className="space-y-3 p-3 md:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium">Automatické behy</p>
              <p className="text-[11px] leading-snug text-muted-foreground md:text-xs">
                Pred open (09:00 ET) a 15&nbsp;min pred close (15:45 ET), pracovné dni.
              </p>
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
            <Label className="text-xs text-muted-foreground">Portfólio na audit</Label>
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
                  <p className="text-xs leading-relaxed md:text-sm">{item.rationale}</p>
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
                  <p className="text-xs leading-relaxed md:text-sm">{item.thesis}</p>
                  {item.whyNow ? (
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground/80">Prečo teraz:</span>{" "}
                      {item.whyNow}
                    </p>
                  ) : null}
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

      {history.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-1.5 px-0.5 text-sm font-semibold">
            <CalendarClock className="h-4 w-4" />
            História briefov
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Button
              size="sm"
              variant={selectedBriefId == null ? "default" : "outline"}
              className="h-8 shrink-0 text-xs"
              onClick={() => setSelectedBriefId(null)}
            >
              Najnovší
            </Button>
            {history.map((b) => {
              let label = b.createdAt.slice(0, 10);
              try {
                label = format(parseISO(b.createdAt), "d.M.", { locale: sk });
              } catch {
                /* ignore */
              }
              return (
                <Button
                  key={b.id}
                  size="sm"
                  variant={selectedBriefId === b.id ? "default" : "outline"}
                  className="h-8 shrink-0 text-xs"
                  onClick={() => setSelectedBriefId(b.id)}
                >
                  {label} · {SLOT_LABEL[b.slot]}
                </Button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
