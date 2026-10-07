import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ExternalLink, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AiMacroScoreGauge } from "@/components/AiMacroScoreGauge";
import { usePortfolio } from "@/hooks/usePortfolio";
import type { AiAuditorLatestResponse } from "@/lib/aiAuditor";

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

  const score = data?.run?.analysis?.healthScore ?? null;
  const label = data?.run?.analysis?.healthLabel;
  const oneLiner = data?.run?.analysis?.summaryOneLiner;
  const usage = data?.usage;
  const pfName = isAllPortfolios
    ? "Všetky portfóliá"
    : selectedPortfolio?.name || "Portfólio";

  return (
    <Card className="h-full overflow-hidden" data-testid="card-dashboard-ai-macro-audit">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 p-4 pb-2">
        <div className="min-w-0 space-y-0.5">
          <CardTitle className="text-base font-semibold flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            AI Macro Audit
          </CardTitle>
          <p className="text-[11px] text-muted-foreground truncate">{pfName}</p>
        </div>
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
      <CardContent className="px-3 pb-3 pt-0 space-y-2">
        {isLoading ? (
          <div className="flex flex-col items-center gap-2 py-2">
            <Skeleton className="h-[110px] w-[180px] rounded-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ) : (
          <>
            <AiMacroScoreGauge score={score} size="sm" label="Health score" />
            {label ? (
              <div className="flex justify-center">
                <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  {label}
                </span>
              </div>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                Zatiaľ bez auditu — spusti analýzu v sekcii
              </p>
            )}
            {oneLiner ? (
              <p className="text-[11px] leading-snug text-muted-foreground line-clamp-2 text-center px-1">
                {oneLiner}
              </p>
            ) : null}
            {usage ? (
              <p className="text-center text-[10px] text-muted-foreground tabular-nums">
                Dnes {usage.used}/{usage.limit} analýz
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
