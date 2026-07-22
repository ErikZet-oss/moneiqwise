import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  ChevronDown,
  Gem,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
  TrendingDown,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export type StrategyId = "dip_buyer" | "garp" | "dividend";
export type CategoryId = string;

export type StrategyDraft = {
  id: StrategyId;
  label: string;
  shortLabel: string;
  description: string;
  category: CategoryId;
  filtersText: string;
};

type StrategiesResponse = {
  strategies: Array<{
    id: StrategyId;
    label: string;
    shortLabel: string;
    description: string;
    category: CategoryId;
    filters: string[];
  }>;
  isCustom: Record<StrategyId, boolean>;
  defaults: Array<{
    id: StrategyId;
    label: string;
    shortLabel: string;
    description: string;
    category: CategoryId;
    filters: string[];
  }>;
  categories: Array<{ id: CategoryId; label: string }>;
};

const STRATEGY_IDS: StrategyId[] = ["dip_buyer", "garp", "dividend"];

const FALLBACK_CATEGORIES: Array<{ id: CategoryId; label: string }> = [
  { id: "all", label: "Všetky sektory" },
  { id: "technology", label: "Technológie" },
  { id: "healthcare", label: "Zdravotníctvo" },
  { id: "financial", label: "Financie" },
  { id: "energy", label: "Energetika" },
  { id: "utilities", label: "Utility" },
  { id: "consumer_cyclical", label: "Spotrebný tovar — cyklický" },
  { id: "consumer_defensive", label: "Spotrebný tovar — defenzívny" },
  { id: "industrials", label: "Priemysel" },
  { id: "basic_materials", label: "Materiály" },
  { id: "communication", label: "Komunikácie" },
  { id: "real_estate", label: "Nehnuteľnosti" },
];

const FALLBACK_DRAFTS: Record<StrategyId, StrategyDraft> = {
  dip_buyer: {
    id: "dip_buyer",
    label: "The Dip Buyer",
    shortLabel: "Dip",
    description: "Akcie v poklese s prepredaným RSI — hľadanie zliav.",
    category: "all",
    filtersText: "cap_midover, ta_rsi_nos30, ta_perf4w_u-10, sh_avgvol_o200",
  },
  garp: {
    id: "garp",
    label: "The GARP Strategy",
    shortLabel: "GARP",
    description: "Rýchlo rastúce firmy za rozumnú cenu — nízky PEG, rast EPS/sales, Debt/Eq < 1.",
    category: "all",
    filtersText: "fa_peg_low, fa_estltgrowth_o15, fa_sales5years_o10, fa_debteq_u1",
  },
  dividend: {
    id: "dividend",
    label: "The Dividend Compounder",
    shortLabel: "Div.",
    description: "Stabilné dividendové mašiny — yield > 2 %, payout < 60 %, rastúce EPS, Large/Mega.",
    category: "all",
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
      category: s.category || "all",
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
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const safeDrafts = drafts ?? FALLBACK_DRAFTS;
  const selectedDraft = safeDrafts[selectedId];
  const categories = data?.categories?.length ? data.categories : FALLBACK_CATEGORIES;
  const customFlags = data?.isCustom ?? {
    dip_buyer: false,
    garp: false,
    dividend: false,
  };

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
        d.category !== (s.category || "all") ||
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
          category: d.category || "all",
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
      toast({ title: "Stratégia uložená" });
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
      toast({ title: "Obnovené pôvodné nastavenia" });
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
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />
        Načítavam stratégie…
      </div>
    );
  }

  if (isError && !drafts) {
    return (
      <div className="flex flex-col items-center gap-2 py-4 text-xs text-muted-foreground">
        <p>Nepodarilo sa načítať stratégie.</p>
        <Button type="button" variant="outline" size="sm" className="h-8 text-[10px]" onClick={() => refetch()}>
          Skúsiť znova
        </Button>
      </div>
    );
  }

  const SelectedIcon = STRATEGY_ICONS[selectedId];
  const isCustom = customFlags[selectedId];
  const categoryLabel =
    categories.find((c) => c.id === selectedDraft.category)?.label ?? "Všetky sektory";

  return (
    <div className="flex flex-col gap-2">
      <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen} className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <Select
            value={selectedId}
            onValueChange={(v) => {
              onSelect(v as StrategyId);
            }}
          >
            <SelectTrigger className="h-9 flex-1 text-xs">
              <SelectValue placeholder="Vyber stratégiu" />
            </SelectTrigger>
            <SelectContent>
              {STRATEGY_IDS.map((id) => {
                const d = safeDrafts[id];
                const Icon = STRATEGY_ICONS[id];
                return (
                  <SelectItem key={id} value={id} className="text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 text-primary" />
                      {d.label}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label="Nastavenia stratégie"
              aria-expanded={settingsOpen}
            >
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", settingsOpen && "rotate-180")}
              />
            </Button>
          </CollapsibleTrigger>
        </div>

        <p className="text-[10px] text-muted-foreground leading-snug px-0.5">
          {selectedDraft.description}
          {selectedDraft.category !== "all" && (
            <span className="text-foreground/80"> · Sektor: {categoryLabel}</span>
          )}
        </p>

        <CollapsibleContent>
          <Card className="border-dashed">
            <CardContent className="p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <SelectedIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="text-[10px] font-semibold truncate">Nastavenia stratégie</span>
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
              </div>

              <div className="space-y-1.5">
                <div>
                  <Label htmlFor={`${selectedId}-category`} className="text-[9px] text-muted-foreground">
                    Kategória / sektor
                  </Label>
                  <Select
                    value={selectedDraft.category || "all"}
                    onValueChange={(v) => updateDraft(selectedId, { category: v })}
                  >
                    <SelectTrigger id={`${selectedId}-category`} className="h-8 text-[10px] mt-0.5">
                      <SelectValue placeholder="Všetky sektory" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor={`${selectedId}-label`} className="text-[9px] text-muted-foreground">
                    Názov
                  </Label>
                  <Input
                    id={`${selectedId}-label`}
                    value={selectedDraft.label}
                    onChange={(e) => updateDraft(selectedId, { label: e.target.value })}
                    className="h-8 text-[10px] mt-0.5"
                  />
                </div>

                <div>
                  <Label htmlFor={`${selectedId}-short`} className="text-[9px] text-muted-foreground">
                    Skratka
                  </Label>
                  <Input
                    id={`${selectedId}-short`}
                    value={selectedDraft.shortLabel}
                    onChange={(e) => updateDraft(selectedId, { shortLabel: e.target.value })}
                    className="h-8 text-[10px] mt-0.5"
                  />
                </div>

                <div>
                  <Label htmlFor={`${selectedId}-desc`} className="text-[9px] text-muted-foreground">
                    Popis
                  </Label>
                  <Textarea
                    id={`${selectedId}-desc`}
                    value={selectedDraft.description}
                    onChange={(e) => updateDraft(selectedId, { description: e.target.value })}
                    className="min-h-[48px] text-[10px] leading-snug resize-y mt-0.5"
                  />
                </div>

                <div>
                  <Label htmlFor={`${selectedId}-filters`} className="text-[9px] text-muted-foreground">
                    Finviz filtre
                  </Label>
                  <Textarea
                    id={`${selectedId}-filters`}
                    value={selectedDraft.filtersText}
                    onChange={(e) => updateDraft(selectedId, { filtersText: e.target.value })}
                    placeholder="fa_peg_low, cap_midover…"
                    className="min-h-[52px] text-[10px] font-mono leading-snug resize-y mt-0.5"
                  />
                  <p className="text-[8px] text-muted-foreground mt-0.5">
                    Kódy oddelené čiarkou. Sektor sa pridá automaticky podľa kategórie.
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-1.5 pt-0.5">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 text-[10px] flex-1"
                  disabled={saveMutation.isPending || !dirty}
                  onClick={() => saveMutation.mutate()}
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3 mr-1" />
                  )}
                  Uložiť
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-[10px] flex-1"
                  disabled={resetMutation.isPending}
                  onClick={() => resetMutation.mutate([selectedId])}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Obnoviť pôvodné
                </Button>
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>

      <Button
        type="button"
        className="h-9 text-xs w-full"
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
      </Collapsible>
    </div>
  );
}
