import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Gem, Loader2, RotateCcw, Save, Sparkles, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export type StrategyId = "dip_buyer" | "garp" | "dividend";

export type StrategyDraft = {
  id: StrategyId;
  label: string;
  shortLabel: string;
  description: string;
  filtersText: string;
};

type StrategiesResponse = {
  strategies: Array<{
    id: StrategyId;
    label: string;
    shortLabel: string;
    description: string;
    filters: string[];
  }>;
  isCustom: Record<StrategyId, boolean>;
  defaults: Array<{
    id: StrategyId;
    label: string;
    shortLabel: string;
    description: string;
    filters: string[];
  }>;
};

const STRATEGY_IDS: StrategyId[] = ["dip_buyer", "garp", "dividend"];

const FALLBACK_DRAFTS: Record<StrategyId, StrategyDraft> = {
  dip_buyer: {
    id: "dip_buyer",
    label: "The Dip Buyer",
    shortLabel: "Dip",
    description: "Akcie v poklese s prepredaným RSI — hľadanie zliav.",
    filtersText: "cap_midover, ta_rsi_nos30, ta_perf4w_u-10, sh_avgvol_o200",
  },
  garp: {
    id: "garp",
    label: "The GARP Strategy",
    shortLabel: "GARP",
    description: "Rýchlo rastúce firmy za rozumnú cenu — nízky PEG, rast EPS/sales, Debt/Eq < 1.",
    filtersText: "fa_peg_low, fa_estltgrowth_o15, fa_sales5years_o10, fa_debteq_u1",
  },
  dividend: {
    id: "dividend",
    label: "The Dividend Compounder",
    shortLabel: "Div.",
    description: "Stabilné dividendové mašiny — yield > 2 %, payout < 60 %, rastúce EPS, Large/Mega.",
    filtersText: "cap_largeover, fa_div_o2, fa_payoutratio_u60, fa_epsqoq_pos",
  },
};

const STRATEGY_ICONS: Record<StrategyId, typeof TrendingDown> = {
  dip_buyer: TrendingDown,
  garp: Gem,
  dividend: Banknote,
};

function toDrafts(strategies: StrategiesResponse["strategies"]): Record<StrategyId, StrategyDraft> {
  const next = { ...FALLBACK_DRAFTS };
  for (const s of strategies) {
    if (s.id !== "dip_buyer" && s.id !== "garp" && s.id !== "dividend") continue;
    next[s.id] = {
      id: s.id,
      label: s.label,
      shortLabel: s.shortLabel,
      description: s.description,
      filtersText: Array.isArray(s.filters) ? s.filters.join(", ") : FALLBACK_DRAFTS[s.id].filtersText,
    };
  }
  return next;
}

type Props = {
  selectedId: StrategyId;
  onSelect: (id: StrategyId) => void;
  onRun: () => void;
  runPending: boolean;
  runDisabled: boolean;
};

export function AiSkenerStrategiesPanel({
  selectedId,
  onSelect,
  onRun,
  runPending,
  runDisabled,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<StrategyId, StrategyDraft> | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<StrategiesResponse>({
    queryKey: ["/api/ai-scanner/strategies"],
    queryFn: async () => {
      const res = await fetch("/api/ai-scanner/strategies", { credentials: "include" });
      if (!res.ok) throw new Error("strategies");
      return res.json();
    },
    retry: 1,
  });

  useEffect(() => {
    if (data?.strategies) {
      setDrafts(toDrafts(data.strategies));
    }
  }, [data]);

  const dirty = useMemo(() => {
    if (!data?.strategies || !drafts) return false;
    return STRATEGY_IDS.some((id) => {
      const s = data.strategies.find((x) => x.id === id);
      const d = drafts[id];
      if (!s || !d) return false;
      return (
        d.label !== s.label ||
        d.shortLabel !== s.shortLabel ||
        d.description !== s.description ||
        d.filtersText !== (Array.isArray(s.filters) ? s.filters.join(", ") : "")
      );
    });
  }, [data, drafts]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const source = drafts ?? FALLBACK_DRAFTS;
      const payload = STRATEGY_IDS.map((id) => {
        const d = source[id];
        return {
          id,
          label: d.label,
          shortLabel: d.shortLabel,
          description: d.description,
          filters: d.filtersText
            .split(/[\n,]+/)
            .map((f) => f.trim())
            .filter(Boolean),
        };
      });
      const res = await apiRequest("PUT", "/api/ai-scanner/strategies", { strategies: payload });
      return res.json() as Promise<StrategiesResponse>;
    },
    onSuccess: (res) => {
      queryClient.setQueryData(["/api/ai-scanner/strategies"], res);
      setDrafts(toDrafts(res.strategies));
      toast({ title: "Stratégie uložené" });
    },
    onError: (err: Error) => {
      toast({ title: "Uloženie zlyhalo", description: err.message, variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async (keys?: StrategyId[]) => {
      const res = await apiRequest("POST", "/api/ai-scanner/strategies/reset", keys ? { keys } : {});
      return res.json() as Promise<StrategiesResponse>;
    },
    onSuccess: (res) => {
      queryClient.setQueryData(["/api/ai-scanner/strategies"], res);
      setDrafts(toDrafts(res.strategies));
      toast({ title: "Obnovené pôvodné stratégie" });
    },
    onError: (err: Error) => {
      toast({ title: "Obnova zlyhala", description: err.message, variant: "destructive" });
    },
  });

  const updateDraft = (id: StrategyId, patch: Partial<StrategyDraft>) => {
    setDrafts((prev) => (prev ? { ...prev, [id]: { ...prev[id], ...patch } } : prev));
  };

  if (isLoading && !drafts) {
    return (
      <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />
        Načítavam stratégie…
      </div>
    );
  }

  if (isError && !drafts) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-xs text-muted-foreground">
        <p>Nepodarilo sa načítať stratégie.</p>
        <Button type="button" variant="outline" size="sm" className="h-8 text-[10px]" onClick={() => refetch()}>
          Skúsiť znova
        </Button>
      </div>
    );
  }

  const safeDrafts = drafts ?? FALLBACK_DRAFTS;
  const customFlags = data?.isCustom ?? {
    dip_buyer: false,
    garp: false,
    dividend: false,
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3">
        {STRATEGY_IDS.map((id) => {
          const draft = safeDrafts[id];
          const Icon = STRATEGY_ICONS[id];
          const active = selectedId === id;
          const isCustom = customFlags[id];

          return (
            <Card
              key={id}
              className={cn(
                "transition-colors",
                active ? "border-primary ring-1 ring-primary/30" : "hover:border-primary/40",
              )}
            >
              <CardContent className="p-3 space-y-2">
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-2 text-left"
                  onClick={() => onSelect(id)}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="text-[10px] font-semibold truncate">{draft.label || id}</span>
                  </div>
                  {isCustom ? (
                    <Badge variant="secondary" className="text-[8px] shrink-0">
                      Upravené
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[8px] shrink-0">
                      Predvolené
                    </Badge>
                  )}
                </button>

                <div className="space-y-1.5">
                  <div>
                    <Label htmlFor={`${id}-label`} className="text-[9px] text-muted-foreground">
                      Názov
                    </Label>
                    <Input
                      id={`${id}-label`}
                      value={draft.label}
                      onChange={(e) => updateDraft(id, { label: e.target.value })}
                      onFocus={() => onSelect(id)}
                      className="h-7 text-[10px] mt-0.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${id}-short`} className="text-[9px] text-muted-foreground">
                      Skratka
                    </Label>
                    <Input
                      id={`${id}-short`}
                      value={draft.shortLabel}
                      onChange={(e) => updateDraft(id, { shortLabel: e.target.value })}
                      onFocus={() => onSelect(id)}
                      className="h-7 text-[10px] mt-0.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${id}-desc`} className="text-[9px] text-muted-foreground">
                      Popis
                    </Label>
                    <Textarea
                      id={`${id}-desc`}
                      value={draft.description}
                      onChange={(e) => updateDraft(id, { description: e.target.value })}
                      onFocus={() => onSelect(id)}
                      className="min-h-[52px] text-[10px] leading-snug resize-y mt-0.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${id}-filters`} className="text-[9px] text-muted-foreground">
                      Finviz filtre
                    </Label>
                    <Textarea
                      id={`${id}-filters`}
                      value={draft.filtersText}
                      onChange={(e) => updateDraft(id, { filtersText: e.target.value })}
                      onFocus={() => onSelect(id)}
                      placeholder="fa_peg_low, cap_midover…"
                      className="min-h-[56px] text-[10px] font-mono leading-snug resize-y mt-0.5"
                    />
                    <p className="text-[8px] text-muted-foreground mt-0.5">
                      Kódy oddelené čiarkou alebo novým riadkom
                    </p>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 w-full text-[9px]"
                  disabled={resetMutation.isPending}
                  onClick={() => resetMutation.mutate([id])}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Obnoviť pôvodné
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          type="button"
          variant="secondary"
          className="h-9 text-xs flex-1"
          disabled={saveMutation.isPending || !dirty}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5 mr-1.5" />
          )}
          Uložiť stratégie
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-9 text-xs flex-1"
          disabled={resetMutation.isPending}
          onClick={() => resetMutation.mutate(undefined)}
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          Obnoviť všetky pôvodné
        </Button>
        <Button
          type="button"
          className="h-9 text-xs flex-1 sm:flex-[1.2]"
          disabled={runDisabled || runPending}
          onClick={onRun}
        >
          {runPending ? (
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
    </div>
  );
}
