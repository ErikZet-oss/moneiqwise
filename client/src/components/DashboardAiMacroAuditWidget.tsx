import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { sk } from "date-fns/locale";
import { ChevronRight, ExternalLink, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { HealthScoreBar, scoreToBarColor } from "@/components/AiMacroScoreGauge";
import { usePortfolio } from "@/hooks/usePortfolio";
import {
  ensureAnalysisShape,
  impactLabelSk,
  riskLabelSk,
  type AiAuditorImpact,
  type AiAuditorLatestResponse,
  type AiAuditorRiskLevel,
} from "@/lib/aiAuditor";
import { cn } from "@/lib/utils";

function impactPill(impact: AiAuditorImpact) {
  if (impact === "positive") return "bg-emerald-500/15 text-emerald-500";
  if (impact === "negative") return "bg-rose-500/15 text-rose-400";
  if (impact === "mixed") return "bg-amber-500/15 text-amber-400";
  return "bg-muted text-muted-foreground";
}

function riskPill(level: AiAuditorRiskLevel) {
  if (level === "low") return "bg-emerald-500/15 text-emerald-500";
  if (level === "high") return "bg-rose-500/15 text-rose-400";
  return "bg-amber-500/15 text-amber-400";
}

function actionPill(action: "BUY" | "HOLD" | "TRIM" | "SELL") {
  if (action === "BUY") return "bg-emerald-500/15 text-emerald-500";
  if (action === "HOLD") return "bg-sky-500/15 text-sky-400";
  if (action === "TRIM") return "bg-amber-500/15 text-amber-400";
  return "bg-rose-500/15 text-rose-400";
}

export function DashboardAiMacroAuditWidget() {
  const [, setLocation] = useLocation();
  const { getQueryParam, selectedPortfolio, isAllPortfolios } = usePortfolio();
  const portfolioId = getQueryParam();

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
    staleTime: 60_000,
  });

  const analysis = ensureAnalysisShape(data?.run?.analysis ?? null);
  const usage = data?.usage;
  const score = analysis?.healthScore ?? null;
  const scoreColor = score == null ? undefined : scoreToBarColor(score);
  const pfName = isAllPortfolios
    ? "Všetky portfóliá"
    : selectedPortfolio?.name || "Portfólio";
  const createdAt = data?.run?.createdAt
    ? format(new Date(data.run.createdAt), "HH:mm", { locale: sk })
    : null;
  const metaParts = [
    createdAt ? `Dnes ${createdAt}` : null,
    usage ? `Dnes ${usage.used}/${usage.limit} analýz` : null,
    pfName,
  ].filter(Boolean);

  const counts = { BUY: 0, HOLD: 0, TRIM: 0, SELL: 0 };
  for (const row of analysis?.actionBrief?.portfolioAudit ?? []) {
    if (row.action in counts) counts[row.action] += 1;
  }
  const showActions = counts.BUY + counts.HOLD + counts.TRIM + counts.SELL > 0;

  return (
    <Card className="h-full overflow-hidden" data-testid="card-dashboard-ai-macro-audit">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 p-4 pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          AI Macro Audit
        </CardTitle>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300 transition-colors shrink-0"
          onClick={() => setLocation("/ai-macro-audit")}
          data-testid="button-ai-macro-audit-see-more"
        >
          Viac
          <ExternalLink className="h-3 w-3" />
        </button>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0 space-y-2.5">
        {isLoading ? (
          <div className="flex flex-col gap-2 py-1">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-5 w-3/4" />
          </div>
        ) : analysis ? (
          <>
            <div className="flex items-start gap-3">
              <div className="flex w-[84px] shrink-0 flex-col gap-1">
                <div className="flex items-end gap-1">
                  <span
                    className="text-2xl font-bold tabular-nums leading-none"
                    style={scoreColor ? { color: scoreColor } : undefined}
                  >
                    {score ?? "—"}
                  </span>
                  <span className="pb-0.5 text-xs text-muted-foreground">/ 100</span>
                </div>
                <HealthScoreBar score={score} className="h-1" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium leading-snug line-clamp-2">
                  {analysis.healthLabel || analysis.summaryOneLiner}
                </p>
                {metaParts.length > 0 ? (
                  <p className="text-[11px] text-muted-foreground truncate">
                    {metaParts.join(" · ")}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <div className="rounded-md border border-border/50 bg-muted/30 p-2 space-y-1">
                <p className="text-[11px] text-muted-foreground">Fed</p>
                <span
                  className={cn(
                    "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    impactPill(analysis.macroStress.fedRates.impact),
                  )}
                >
                  {impactLabelSk(analysis.macroStress.fedRates.impact)}
                </span>
              </div>
              <div className="rounded-md border border-border/50 bg-muted/30 p-2 space-y-1">
                <p className="text-[11px] text-muted-foreground">Inflácia</p>
                <span
                  className={cn(
                    "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    impactPill(analysis.macroStress.inflation.impact),
                  )}
                >
                  {impactLabelSk(analysis.macroStress.inflation.impact)}
                </span>
              </div>
              <div className="rounded-md border border-border/50 bg-muted/30 p-2 space-y-1">
                <p className="text-[11px] text-muted-foreground">Sektor</p>
                <span
                  className={cn(
                    "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    riskPill(analysis.macroStress.sectorConcentration.level),
                  )}
                >
                  {riskLabelSk(analysis.macroStress.sectorConcentration.level)}
                </span>
              </div>
            </div>

            {showActions || analysis.actionBriefPending ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="min-w-0 flex-1 text-[11px] font-medium">
                  {analysis.actionBriefPending ? "Dopĺňam akcie…" : "Akcie na pozíciách"}
                </p>
                {showActions ? (
                  <>
                    {(["BUY", "HOLD", "TRIM", "SELL"] as const).map((action) =>
                      counts[action] > 0 ? (
                        <span
                          key={action}
                          className={cn(
                            "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            actionPill(action),
                          )}
                        >
                          {action} {counts[action]}
                        </span>
                      ) : null,
                    )}
                  </>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                className="inline-flex w-full items-center justify-center gap-1 text-xs font-medium text-sky-400"
                onClick={() => setLocation("/ai-macro-audit")}
              >
                Otvoriť AI Macro Audit
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        ) : (
          <div className="space-y-2 py-1">
            <p className="text-xs text-muted-foreground text-center">
              Zatiaľ bez auditu — spusti analýzu v sekcii AI Macro Audit.
            </p>
            <button
              type="button"
              className="inline-flex w-full items-center justify-center gap-1 text-xs font-medium text-sky-400"
              onClick={() => setLocation("/ai-macro-audit")}
            >
              Otvoriť AI Macro Audit
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
