import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useToast } from "@/hooks/use-toast";
import { ensureAnalysisShape, type AiAuditorLatestResponse } from "@/lib/aiAuditor";
import { Button, Card, EmptyState, TopBar } from "@/redesign/ui";
import { PageBody } from "./mobileChrome";

export default function AiMacroAuditMobile() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { getQueryParam, selectedPortfolio, isAllPortfolios } = usePortfolio();
  const portfolioId = getQueryParam();
  const pfName = isAllPortfolios ? "VĹˇetky portfĂłliĂˇ" : selectedPortfolio?.name || "PortfĂłlio";
  const [scoreOpen, setScoreOpen] = useState(false);

  const { data, isLoading } = useQuery<AiAuditorLatestResponse>({
    queryKey: ["/api/ai-auditor/latest", portfolioId],
    queryFn: async () => {
      const res = await fetch(`/api/ai-auditor/latest?portfolioId=${encodeURIComponent(portfolioId)}`, {
        credentials: "include",
      });
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
      if (!res.ok) throw new Error(body?.message || "Spustenie zlyhalo");
      return body as AiAuditorLatestResponse;
    },
    onSuccess: (payload) => {
      queryClient.setQueryData(["/api/ai-auditor/latest", portfolioId], payload);
      const analysis = ensureAnalysisShape(payload.run?.analysis ?? null);
      toast({
        title: "Audit hotovĂ˝",
        description: `SkĂłre ${analysis?.healthScore ?? "â€”"}/100`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Nepodarilo sa spustiĹĄ audit",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const analysis = useMemo(
    () => ensureAnalysisShape(data?.run?.analysis ?? null),
    [data?.run?.analysis],
  );
  const usage = data?.usage;
  const limitReached = usage != null && usage.used >= usage.limit;

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline={pfName} title="AI Macro Audit" />
      <PageBody>
        <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">HÄşbkovĂˇ analĂ˝za portfĂłlia</p>
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="rd-type-overline text-[var(--rd-text-tertiary)]">
                Health score
              </p>
              <button
                type="button"
                className="mt-1 rd-type-display-hero text-[var(--rd-ai)]"
                onClick={() => setScoreOpen((v) => !v)}
              >
                {analysis?.healthScore != null ? `${analysis.healthScore}` : "â€”"}
                <span className="text-lg text-[var(--rd-text-tertiary)]"> / 100</span>
              </button>
              <p className="mt-1 text-xs text-[var(--rd-text-tertiary)]">
                Dnes {usage ? `${usage.used}/${usage.limit}` : "â€”"} Â· {pfName}
              </p>
            </div>
            <Button
              disabled={runMutation.isPending || limitReached}
              onClick={() => runMutation.mutate()}
            >
              {runMutation.isPending ? "BeĹľĂ­â€¦" : "SpustiĹĄ analĂ˝zu"}
            </Button>
          </div>
          {scoreOpen ? (
            <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
              SkĂłre je vĂˇĹľenĂ˝ sĂşÄŤet faktorov auditu. PodrobnĂ˝ rozklad je v klasickom zobrazenĂ­.
            </p>
          ) : null}
        </Card>

        {isLoading ? (
          <p className="text-sm text-[var(--rd-text-tertiary)]">NaÄŤĂ­tavamâ€¦</p>
        ) : !analysis ? (
          <EmptyState title="ZatiaÄľ Ĺľiadny audit" body="Spusti analĂ˝zu pre health score a makro rizikĂˇ." />
        ) : (
          <Card>
            <h3 className="text-[15px] font-semibold">Zhrnutie</h3>
            <p className="text-sm leading-5 text-[var(--rd-text-secondary)]">
              {analysis.summaryOneLiner || "Audit je hotovĂ˝. Detaily sĂş v klasickom zobrazenĂ­."}
            </p>
          </Card>
        )}
      </PageBody>
    </div>
  );
}
