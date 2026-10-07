import { useQuery } from "@tanstack/react-query";
import { format, parse } from "date-fns";
import { sk } from "date-fns/locale";
import {
  ArrowDownRight,
  ArrowUpRight,
  Crosshair,
  Minus,
  Scale,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type AnalystRatingsResponse = {
  ticker: string;
  currency: string | null;
  currentPrice: number | null;
  targetMean: number | null;
  targetMedian: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  upsidePercent: number | null;
  recommendationKey: string | null;
  recommendationMean: number | null;
  numberOfAnalystOpinions: number | null;
  recommendationTrend: {
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
  } | null;
  history: Array<{
    date: string | null;
    firm: string;
    action: string | null;
    fromGrade: string | null;
    toGrade: string | null;
    priceTarget: number | null;
    priorPriceTarget: number | null;
    priceTargetAction: string | null;
  }>;
  source: "yahoo" | null;
};

type Props = {
  ticker: string;
  enabled?: boolean;
  formatPrice: (amount: number) => string;
};

function recommendationLabel(key: string | null): string {
  switch ((key ?? "").toLowerCase()) {
    case "strong_buy":
      return "Strong Buy";
    case "buy":
      return "Buy";
    case "hold":
      return "Hold";
    case "underperform":
    case "sell":
      return "Sell";
    case "strong_sell":
      return "Strong Sell";
    default:
      return key ? key.replace(/_/g, " ") : "—";
  }
}

function recommendationTone(key: string | null): string {
  switch ((key ?? "").toLowerCase()) {
    case "strong_buy":
    case "buy":
      return "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300";
    case "hold":
      return "bg-amber-500/15 text-amber-800 border-amber-500/30 dark:text-amber-300";
    case "underperform":
    case "sell":
    case "strong_sell":
      return "bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-300";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function actionLabel(action: string | null): string {
  switch ((action ?? "").toLowerCase()) {
    case "up":
      return "Upgrade";
    case "down":
      return "Downgrade";
    case "init":
      return "Init";
    case "main":
    case "reit":
      return "Maintain";
    default:
      return action || "—";
  }
}

function actionTone(action: string | null): string {
  switch ((action ?? "").toLowerCase()) {
    case "up":
      return "text-emerald-600 dark:text-emerald-400";
    case "down":
      return "text-rose-600 dark:text-rose-400";
    case "init":
      return "text-sky-600 dark:text-sky-400";
    default:
      return "text-muted-foreground";
  }
}

function gradeTone(grade: string | null): string {
  const g = (grade ?? "").toLowerCase();
  if (/(strong\s*buy|buy|outperform|overweight|accumulate|add|conviction)/.test(g)) {
    return "text-emerald-700 dark:text-emerald-300";
  }
  if (/(sell|underperform|underweight|reduce)/.test(g)) {
    return "text-rose-700 dark:text-rose-300";
  }
  if (/(hold|neutral|equal|market\s*perform|sector\s*perform)/.test(g)) {
    return "text-amber-700 dark:text-amber-300";
  }
  return "text-foreground";
}

export function AnalystRatingsCard({ ticker, enabled = true, formatPrice }: Props) {
  const { data, isLoading, isError } = useQuery<AnalystRatingsResponse>({
    queryKey: ["/api/assets", ticker, "analyst-ratings"],
    enabled: enabled && !!ticker && ticker.toUpperCase() !== "CASH",
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/assets/${encodeURIComponent(ticker)}/analyst-ratings`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("analyst-ratings");
      return res.json();
    },
  });

  const trend = data?.recommendationTrend;
  const buyCount = (trend?.strongBuy ?? 0) + (trend?.buy ?? 0);
  const holdCount = trend?.hold ?? 0;
  const sellCount = (trend?.sell ?? 0) + (trend?.strongSell ?? 0);
  const totalVotes = buyCount + holdCount + sellCount;
  const upside = data?.upsidePercent;
  const upsidePositive = upside != null && upside >= 0;
  const historyRows = data?.history.slice(0, 6) ?? [];

  return (
    <Card
      data-testid="asset-analyst-ratings"
      className="overflow-hidden border-border bg-card shadow-sm"
    >
      <CardHeader className="p-3 pb-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm md:text-base font-semibold flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            Analyst Ratings
          </CardTitle>
          {data?.recommendationKey && (
            <Badge
              variant="outline"
              className={cn("shrink-0 capitalize text-[10px]", recommendationTone(data.recommendationKey))}
              data-testid="analyst-recommendation-badge"
            >
              {recommendationLabel(data.recommendationKey)}
            </Badge>
          )}
        </div>
        <CardDescription className="text-[11px] md:text-xs">
          Konsenzus analytikov a cieľové ceny (Yahoo)
        </CardDescription>
      </CardHeader>
      <CardContent className="p-3 pt-1.5 space-y-3">
        {isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : isError ? (
          <p className="text-sm text-destructive">Analyst ratings sa nepodarilo načítať.</p>
        ) : !data ||
          (data.targetMean == null &&
            !data.recommendationTrend &&
            data.history.length === 0) ? (
          <p className="text-sm text-muted-foreground">
            Pre toto aktívum nie sú dostupné analyst ratings.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1.5 md:gap-2">
              <div className="rounded-md border border-border/70 bg-muted/20 px-2 py-1.5 md:px-2.5 md:py-2 min-w-0">
                <div className="flex items-center gap-1 text-[10px] md:text-[11px] font-medium text-muted-foreground">
                  <Target className="h-3 w-3 md:h-3.5 md:w-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                  Target (mean)
                </div>
                <div
                  className="mt-0.5 text-sm md:text-xl font-semibold tabular-nums truncate"
                  data-testid="analyst-target-mean"
                >
                  {data.targetMean != null ? formatPrice(data.targetMean) : "—"}
                </div>
                <p className="text-[10px] md:text-[11px] text-muted-foreground mt-0.5 truncate">
                  {data.numberOfAnalystOpinions != null
                    ? `${data.numberOfAnalystOpinions} analytikov`
                    : "Konsenzus analytikov"}
                </p>
              </div>

              <div className="rounded-md border border-border/70 bg-muted/20 px-2 py-1.5 md:px-2.5 md:py-2 min-w-0">
                <div className="flex items-center gap-1 text-[10px] md:text-[11px] font-medium text-muted-foreground">
                  {upsidePositive ? (
                    <ArrowUpRight className="h-3 w-3 md:h-3.5 md:w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3 md:h-3.5 md:w-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                  )}
                  Vs. aktuálna cena
                </div>
                <div
                  className={cn(
                    "mt-0.5 text-sm md:text-xl font-semibold tabular-nums truncate",
                    upside == null
                      ? "text-muted-foreground"
                      : upsidePositive
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400",
                  )}
                  data-testid="analyst-upside-percent"
                >
                  {upside == null ? "—" : `${upsidePositive ? "+" : ""}${upside.toFixed(1)}%`}
                </div>
                <p className="text-[10px] md:text-[11px] text-muted-foreground mt-0.5 truncate">
                  {data.currentPrice != null
                    ? `Cena: ${formatPrice(data.currentPrice)}`
                    : "Od mean targetu"}
                </p>
              </div>

              <div className="rounded-md border border-border/70 bg-muted/20 px-2 py-1.5 md:px-2.5 md:py-2 min-w-0">
                <div className="flex items-center gap-1 text-[10px] md:text-[11px] font-medium text-muted-foreground">
                  <Crosshair className="h-3 w-3 md:h-3.5 md:w-3.5 text-violet-600 dark:text-violet-400 shrink-0" />
                  Rozpätie targetov
                </div>
                <div className="mt-0.5 text-xs md:text-sm font-semibold tabular-nums leading-snug">
                  <span className="block truncate">
                    {data.targetLow != null ? formatPrice(data.targetLow) : "—"}
                    <span className="text-muted-foreground font-normal"> — </span>
                    {data.targetHigh != null ? formatPrice(data.targetHigh) : "—"}
                  </span>
                </div>
                <p className="text-[10px] md:text-[11px] text-muted-foreground mt-0.5 truncate">
                  Medián: {data.targetMedian != null ? formatPrice(data.targetMedian) : "—"}
                </p>
              </div>
            </div>

            <div
              className={cn(
                "grid gap-2.5",
                trend && totalVotes > 0 && historyRows.length > 0 && "lg:grid-cols-5",
              )}
            >
              {trend && totalVotes > 0 && (
                <div
                  className={cn(
                    "rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 space-y-2 min-w-0",
                    historyRows.length > 0 ? "lg:col-span-2" : "",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium">
                      <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      Buy / Hold / Sell
                    </div>
                    {data.recommendationMean != null && (
                      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                        Mean {data.recommendationMean.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="bg-emerald-500 transition-all"
                      style={{ width: `${(buyCount / totalVotes) * 100}%` }}
                      title={`Buy ${buyCount}`}
                    />
                    <div
                      className="bg-amber-400 transition-all"
                      style={{ width: `${(holdCount / totalVotes) * 100}%` }}
                      title={`Hold ${holdCount}`}
                    />
                    <div
                      className="bg-rose-500 transition-all"
                      style={{ width: `${(sellCount / totalVotes) * 100}%` }}
                      title={`Sell ${sellCount}`}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-center">
                    <div className="rounded-md bg-emerald-500/10 px-1.5 py-1.5 min-w-0">
                      <div className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                        <TrendingUp className="h-3 w-3" /> Buy
                      </div>
                      <div className="text-base font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                        {buyCount}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {trend.strongBuy > 0 ? `${trend.strongBuy} strong` : "\u00a0"}
                      </div>
                    </div>
                    <div className="rounded-md bg-amber-500/10 px-1.5 py-1.5 min-w-0">
                      <div className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wide text-amber-800 dark:text-amber-300">
                        <Minus className="h-3 w-3" /> Hold
                      </div>
                      <div className="text-base font-semibold tabular-nums text-amber-800 dark:text-amber-300">
                        {holdCount}
                      </div>
                      <div className="text-[10px] text-muted-foreground">&nbsp;</div>
                    </div>
                    <div className="rounded-md bg-rose-500/10 px-1.5 py-1.5 min-w-0">
                      <div className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wide text-rose-700 dark:text-rose-300">
                        <TrendingDown className="h-3 w-3" /> Sell
                      </div>
                      <div className="text-base font-semibold tabular-nums text-rose-700 dark:text-rose-300">
                        {sellCount}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {trend.strongSell > 0 ? `${trend.strongSell} strong` : "\u00a0"}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {historyRows.length > 0 && (
                <div
                  className={cn(
                    "min-w-0 space-y-1.5",
                    trend && totalVotes > 0 ? "lg:col-span-3" : "",
                  )}
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    <Scale className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    Posledné hodnotenia
                  </div>
                  <div className="divide-y divide-border/70 rounded-md border border-border/70 bg-muted/10 overflow-hidden">
                    {historyRows.map((row, idx) => (
                      <div
                        key={`${row.firm}-${row.date}-${idx}`}
                        className="flex items-start justify-between gap-3 px-2.5 py-2"
                        data-testid={`analyst-history-row-${idx}`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-sm font-medium truncate">{row.firm}</span>
                            <span className={cn("text-[11px] font-medium", actionTone(row.action))}>
                              {actionLabel(row.action)}
                            </span>
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5">
                            {row.date ? (
                              <span>
                                {format(parse(row.date, "yyyy-MM-dd", new Date()), "d. MMM yyyy", {
                                  locale: sk,
                                })}
                              </span>
                            ) : (
                              <span>Bez dátumu</span>
                            )}
                            {(row.fromGrade || row.toGrade) && (
                              <>
                                <span aria-hidden>·</span>
                                <span className="truncate">
                                  {row.fromGrade ? (
                                    <span className={gradeTone(row.fromGrade)}>{row.fromGrade}</span>
                                  ) : (
                                    "—"
                                  )}
                                  <span className="mx-1 text-muted-foreground">→</span>
                                  <span className={cn("font-medium", gradeTone(row.toGrade))}>
                                    {row.toGrade || "—"}
                                  </span>
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          {row.priceTarget != null ? (
                            <>
                              <div className="text-sm font-semibold tabular-nums">
                                {formatPrice(row.priceTarget)}
                              </div>
                              {row.priorPriceTarget != null && (
                                <div className="text-[10px] text-muted-foreground tabular-nums">
                                  pred: {formatPrice(row.priorPriceTarget)}
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="text-xs text-muted-foreground">Bez targetu</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
