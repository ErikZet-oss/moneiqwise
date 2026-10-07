import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { sk } from "date-fns/locale";
import {
  ArrowRight,
  Brain,
  Loader2,
  Newspaper,
  ShieldAlert,
  Sparkles,
  Target,
} from "lucide-react";
import { AiMacroScoreGauge } from "@/components/AiMacroScoreGauge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { usePortfolio } from "@/hooks/usePortfolio";
import {
  impactLabelSk,
  riskLabelSk,
  sentimentLabelSk,
  type AiAuditorImpact,
  type AiAuditorLatestResponse,
  type AiAuditorRiskLevel,
  type AiAuditorSentiment,
} from "@/lib/aiAuditor";
import { cn } from "@/lib/utils";

function impactPillClass(impact: AiAuditorImpact) {
  switch (impact) {
    case "positive":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    case "negative":
      return "bg-rose-500/15 text-rose-600 dark:text-rose-400";
    case "mixed":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function riskPillClass(level: AiAuditorRiskLevel) {
  switch (level) {
    case "low":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    case "high":
      return "bg-rose-500/15 text-rose-600 dark:text-rose-400";
    default:
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  }
}

function sentimentPillClass(s: AiAuditorSentiment) {
  return impactPillClass(
    s === "positive" ? "positive" : s === "negative" ? "negative" : "neutral",
  );
}

export default function AiMacroAudit() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { getQueryParam, selectedPortfolio, isAllPortfolios } = usePortfolio();
  const portfolioId = getQueryParam();
  const pfName = isAllPortfolios
    ? "Všetky portfóliá"
    : selectedPortfolio?.name || "Portfólio";

  const { data, isLoading } = useQuery<AiAuditorLatestResponse>({
    queryKey: ["/api/ai-auditor/latest", portfolioId],
    queryFn: async () => {
      const res = await fetch(
        `/api/ai-auditor/latest?portfolioId=${encodeURIComponent(portfolioId)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("latest");
      return res.json();
    },
    staleTime: 30_000,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ai-auditor/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolioId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(body?.message || "Spustenie zlyhalo") as Error & {
          usage?: unknown;
        };
        err.usage = body?.usage;
        throw err;
      }
      return body as AiAuditorLatestResponse;
    },
    onSuccess: (payload) => {
      queryClient.setQueryData(["/api/ai-auditor/latest", portfolioId], payload);
      toast({
        title: "Audit hotový",
        description: `Skóre ${payload.run?.analysis.healthScore ?? "—"}/100`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Nepodarilo sa spustiť audit",
        description: err.message,
        variant: "destructive",
      });
      void queryClient.invalidateQueries({
        queryKey: ["/api/ai-auditor/latest", portfolioId],
      });
    },
  });

  const run = data?.run ?? null;
  const analysis = run?.analysis ?? null;
  const usage = data?.usage;
  const limitReached = usage != null && usage.used >= usage.limit;
  const canRun = !runMutation.isPending && !limitReached;

  return (
    <div className="mx-auto max-w-3xl space-y-3 pb-8 md:space-y-4">
      <div className="space-y-3 px-0.5">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 shrink-0 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight md:text-xl">
            AI Macro Audit
          </h1>
          <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400">
            Beta
          </span>
        </div>
        <p className="text-xs text-muted-foreground md:text-sm max-w-xl">
          Hĺbková analýza portfólia voči Fedu, inflácii, sektorovej koncentrácii a
          aktuálnym správam. Manuálne spustenie, max. 3× denne na portfólio.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={!canRun}
            onClick={() => runMutation.mutate()}
            className="h-10 rounded-lg bg-white px-4 font-semibold text-black hover:bg-white/90 dark:bg-white dark:text-black"
            data-testid="button-ai-macro-audit-run"
          >
            {runMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzujem…
              </>
            ) : (
              <>
                Spustiť analýzu
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
          {usage ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              Dnes {usage.used}/{usage.limit} · {pfName}
            </span>
          ) : null}
        </div>
        {limitReached ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Denný limit pre toto portfólio je vyčerpaný. Skús znova zajtra.
          </p>
        ) : null}
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8">
            <Skeleton className="h-[140px] w-[220px] rounded-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </CardContent>
        </Card>
      ) : !analysis ? (
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Zatiaľ žiadny audit</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Spusti prvú analýzu pre {pfName}. Claude vyhodnotí health score, makro
              riziká, sentiment správ a konkrétne tipy.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card data-testid="card-ai-macro-health">
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 p-4 pb-2">
              <div>
                <CardTitle className="text-base font-semibold">Portfolio Health</CardTitle>
                {run?.createdAt ? (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Posledný update:{" "}
                    {format(new Date(run.createdAt), "d. M. yyyy HH:mm", {
                      locale: sk,
                    })}
                  </p>
                ) : null}
              </div>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                  riskPillClass(
                    analysis.healthScore >= 70
                      ? "low"
                      : analysis.healthScore >= 40
                        ? "medium"
                        : "high",
                  ),
                )}
              >
                {analysis.healthLabel}
              </span>
            </CardHeader>
            <CardContent className="px-4 pb-5 pt-1 space-y-3">
              <AiMacroScoreGauge
                score={analysis.healthScore}
                size="lg"
                label="Macro factors score"
              />
              <p className="text-sm text-muted-foreground leading-relaxed text-center max-w-lg mx-auto">
                {analysis.summaryOneLiner}
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-ai-macro-stress">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-primary" />
                Makro stres-test & riziká
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              {(
                [
                  ["Fed & sadzby", analysis.macroStress.fedRates] as const,
                  ["Inflácia", analysis.macroStress.inflation] as const,
                ] as const
              ).map(([title, block]) => (
                <div
                  key={title}
                  className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{title}</p>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        impactPillClass(block.impact),
                      )}
                    >
                      {impactLabelSk(block.impact)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {block.detail}
                  </p>
                </div>
              ))}

              <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Sektorová koncentrácia</p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      riskPillClass(analysis.macroStress.sectorConcentration.level),
                    )}
                  >
                    {riskLabelSk(analysis.macroStress.sectorConcentration.level)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {analysis.macroStress.sectorConcentration.detail}
                </p>
                {analysis.macroStress.sectorConcentration.topSectors.length > 0 ? (
                  <ul className="space-y-2 pt-1">
                    {analysis.macroStress.sectorConcentration.topSectors.map((s) => (
                      <li key={s.name} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-medium truncate">{s.name}</span>
                          <span className="tabular-nums text-muted-foreground shrink-0">
                            {s.weightPct.toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-foreground/80"
                            style={{
                              width: `${Math.max(2, Math.min(100, s.weightPct))}%`,
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-ai-macro-news">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Newspaper className="h-4 w-4 text-primary" />
                Správy & sentiment
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              {analysis.newsSentiment.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Žiadne relevantné správy k holdingom v tomto behu.
                </p>
              ) : (
                analysis.newsSentiment.map((n, i) => (
                  <div
                    key={`${n.ticker}-${i}`}
                    className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold tabular-nums">{n.ticker}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          sentimentPillClass(n.sentiment),
                        )}
                      >
                        {sentimentLabelSk(n.sentiment)}
                      </span>
                    </div>
                    <p className="text-xs font-medium leading-snug">{n.headline}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {n.whyItMatters}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-ai-macro-recs">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                Odporúčania AI
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              {analysis.recommendations.map((r, i) => (
                <div
                  key={`${r.title}-${i}`}
                  className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-snug">{r.title}</p>
                    <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      {r.priority === "high"
                        ? "Vysoká"
                        : r.priority === "low"
                          ? "Nízka"
                          : "Stredná"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {r.detail}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
