import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, Lightbulb, Newspaper, ShieldAlert, Sparkles, Target } from "lucide-react";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useToast } from "@/hooks/use-toast";
import {
  ensureAnalysisShape,
  impactLabelSk,
  riskLabelSk,
  sentimentLabelSk,
  type AiAuditorImpact,
  type AiAuditorLatestResponse,
  type AiAuditorNewsItem,
  type AiAuditorRiskLevel,
  type AiAuditorSentiment,
} from "@/lib/aiAuditor";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, Dialog, EmptyState, TopBar, type BadgeTone } from "@/redesign/ui";
import { PageBody } from "./mobileChrome";

function impactTone(impact: AiAuditorImpact): BadgeTone {
  if (impact === "positive") return "Profit";
  if (impact === "negative") return "Loss";
  if (impact === "mixed") return "Warning";
  return "Neutral";
}

function riskTone(level: AiAuditorRiskLevel): BadgeTone {
  if (level === "low") return "Profit";
  if (level === "high") return "Loss";
  return "Warning";
}

function sentimentTone(s: AiAuditorSentiment): BadgeTone {
  if (s === "positive") return "Profit";
  if (s === "negative") return "Loss";
  return "Neutral";
}

function priorityLabel(p: "high" | "medium" | "low") {
  if (p === "high") return "Vysoká";
  if (p === "low") return "Nízka";
  return "Stredná";
}

export default function AiMacroAuditMobile() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { getQueryParam, selectedPortfolio, isAllPortfolios } = usePortfolio();
  const portfolioId = getQueryParam();
  const pfName = isAllPortfolios ? "Všetky portfóliá" : selectedPortfolio?.name || "Portfólio";
  const [scoreOpen, setScoreOpen] = useState(false);
  const [openRisk, setOpenRisk] = useState<string | null>(null);
  const [newsDetail, setNewsDetail] = useState<AiAuditorNewsItem | null>(null);

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
      void queryClient.invalidateQueries({ queryKey: ["/api/ai-auditor/latest", portfolioId] });
      const analysis = ensureAnalysisShape(payload.run?.analysis ?? null);
      toast({
        title: "Audit hotový",
        description: `Skóre ${analysis?.healthScore ?? "—"}/100`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Nepodarilo sa spustiť audit",
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

  const riskItems = analysis
    ? ([
        {
          id: "fed",
          title: "Fed & sadzby",
          detail: analysis.macroStress.fedRates.detail,
          deepDive: analysis.macroStress.fedRates.deepDive,
          mitigation: analysis.macroStress.fedRates.mitigation,
          badge: (
            <Badge
              label={impactLabelSk(analysis.macroStress.fedRates.impact)}
              tone={impactTone(analysis.macroStress.fedRates.impact)}
            />
          ),
        },
        {
          id: "inflation",
          title: "Inflácia",
          detail: analysis.macroStress.inflation.detail,
          deepDive: analysis.macroStress.inflation.deepDive,
          mitigation: analysis.macroStress.inflation.mitigation,
          badge: (
            <Badge
              label={impactLabelSk(analysis.macroStress.inflation.impact)}
              tone={impactTone(analysis.macroStress.inflation.impact)}
            />
          ),
        },
        {
          id: "sector",
          title: "Sektorová koncentrácia",
          detail: analysis.macroStress.sectorConcentration.detail,
          deepDive: analysis.macroStress.sectorConcentration.deepDive,
          mitigation: analysis.macroStress.sectorConcentration.mitigation,
          badge: (
            <Badge
              label={riskLabelSk(analysis.macroStress.sectorConcentration.level)}
              tone={riskTone(analysis.macroStress.sectorConcentration.level)}
            />
          ),
        },
      ] as const)
    : [];

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline={pfName} title="AI Macro Audit" />
      <PageBody>
        <Card className="gap-2 p-3">
          <div className="flex items-center gap-1.5">
            <Sparkles className="size-4 shrink-0 text-[var(--rd-ai)]" aria-hidden />
            <p className="rd-type-h3 min-w-0 flex-1 text-[var(--rd-text-primary)]">
              Hĺbková analýza portfólia
            </p>
            <Badge label="AI" tone="AI" />
          </div>
          <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
            Analýza voči Fedu, inflácii, sektorovej koncentrácii a aktuálnym správam. Manuálne
            spustenie, max. 3× denne na portfólio.
          </p>
          <Button
            className="w-full"
            disabled={runMutation.isPending || limitReached}
            onClick={() => runMutation.mutate()}
            data-testid="button-ai-macro-audit-run"
          >
            {runMutation.isPending ? "Beží…" : "Spustiť analýzu"}
          </Button>
          <p className="rd-type-overline text-[var(--rd-text-tertiary)]">
            Dnes {usage ? `${usage.used}/${usage.limit}` : "—"} · {pfName}
          </p>
        </Card>

        {isLoading ? (
          <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">Načítavam…</p>
        ) : !analysis ? (
          <EmptyState
            title="Zatiaľ žiadny audit"
            body={`Spusti prvú analýzu pre ${pfName}. Claude vyhodnotí health score, makro riziká, sentiment správ a konkrétne tipy.`}
          />
        ) : (
          <>
            <Card className="gap-2 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Health score</p>
                  <button
                    type="button"
                    className="mt-1 text-left"
                    onClick={() => setScoreOpen((v) => !v)}
                    aria-expanded={scoreOpen}
                    data-testid="button-ai-macro-score-expand"
                  >
                    <span className="rd-type-display-hero text-[var(--rd-ai)]">
                      {analysis.healthScore}
                    </span>
                    <span className="text-lg text-[var(--rd-text-tertiary)]"> / 100</span>
                  </button>
                  <p className="mt-0.5 rd-type-body-sm text-[var(--rd-text-secondary)]">
                    {analysis.healthLabel}
                  </p>
                </div>
                <ChevronDown
                  className={cn(
                    "mt-2 size-4 shrink-0 text-[var(--rd-text-tertiary)] transition-transform",
                    scoreOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </div>
              {scoreOpen ? (
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["sectorConcentration", "Sektorová koncentrácia"],
                      ["fedSensitivity", "Citlivosť na Fed"],
                      ["newsSentiment", "News & sentiment"],
                      ["inflationResilience", "Inflačná odolnosť"],
                    ] as const
                  ).map(([key, title]) => {
                    const factor = analysis.scoreBreakdown[key];
                    return (
                      <div
                        key={key}
                        className="rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-2"
                      >
                        <p className="rd-type-data-sm text-[var(--rd-ai)]">{factor.score}/100</p>
                        <p className="rd-type-overline text-[var(--rd-text-primary)]">{title}</p>
                        <p className="mt-0.5 rd-type-body-sm text-[var(--rd-text-tertiary)]">
                          {factor.detail}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </Card>

            <Card className="gap-1.5 p-3">
              <h3 className="rd-type-h3 text-[var(--rd-text-primary)]">Zhrnutie</h3>
              <p className="rd-type-body text-[var(--rd-text-secondary)]">
                {analysis.summaryOneLiner || "Analýza portfólia voči aktuálnemu makro prostrediu."}
              </p>
            </Card>

            <Card className="gap-2 p-3">
              <div className="flex items-center gap-1.5">
                <ShieldAlert className="size-4 shrink-0 text-[var(--rd-ai)]" aria-hidden />
                <h3 className="rd-type-h3 text-[var(--rd-text-primary)]">Makro stres-test & riziká</h3>
              </div>
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                Klikni na panel pre hĺbkový rozbor a návrh riešenia
              </p>
              <div className="flex flex-col gap-2">
                {riskItems.map((item) => {
                  const open = openRisk === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setOpenRisk((cur) => (cur === item.id ? null : item.id))}
                      className={cn(
                        "w-full rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-3 text-left",
                        open && "border-[var(--rd-ai)]/40",
                      )}
                      aria-expanded={open}
                      data-testid={`button-ai-macro-risk-${item.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="rd-type-body-strong flex items-center gap-1 text-[var(--rd-text-primary)]">
                          {item.title}
                          <ChevronDown
                            className={cn(
                              "size-3.5 text-[var(--rd-text-tertiary)] transition-transform",
                              open && "rotate-180",
                            )}
                            aria-hidden
                          />
                        </p>
                        {item.badge}
                      </div>
                      <p className="mt-1 rd-type-body-sm text-[var(--rd-text-secondary)]">
                        {item.detail}
                      </p>
                      {open ? (
                        <div className="mt-2 flex flex-col gap-2">
                          <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
                            {item.deepDive}
                          </p>
                          <div className="rounded-[var(--rd-radius-xs)] border border-[var(--rd-warning)]/25 bg-[var(--rd-warning-dim)] p-2">
                            <p className="mb-0.5 flex items-center gap-1 rd-type-overline text-[var(--rd-warning)]">
                              <Lightbulb className="size-3" aria-hidden />
                              Návrh na riešenie
                            </p>
                            <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
                              {item.mitigation}
                            </p>
                          </div>
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </Card>

            <Card className="gap-2 p-3" data-testid="card-ai-macro-news">
              <div className="flex items-center gap-1.5">
                <Newspaper className="size-4 shrink-0 text-[var(--rd-ai)]" aria-hidden />
                <h3 className="rd-type-h3 text-[var(--rd-text-primary)]">Správy & sentiment</h3>
              </div>
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                Klikni na kartu pre detail a odkaz na článok
              </p>
              {analysis.newsSentiment.length === 0 ? (
                <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                  Žiadne relevantné správy k holdingom v tomto behu.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {analysis.newsSentiment.map((n, i) => (
                    <button
                      key={`${n.ticker}-${i}`}
                      type="button"
                      onClick={() => setNewsDetail(n)}
                      className="w-full rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-3 text-left"
                      data-testid={`button-ai-macro-news-${n.ticker}-${i}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="rd-type-body-strong tabular-nums text-[var(--rd-text-primary)]">
                          {n.ticker}
                        </span>
                        <Badge label={sentimentLabelSk(n.sentiment)} tone={sentimentTone(n.sentiment)} />
                      </div>
                      <p className="mt-1 rd-type-body-strong text-[var(--rd-text-primary)]">
                        {n.headline}
                      </p>
                      <p className="mt-0.5 line-clamp-2 rd-type-body-sm text-[var(--rd-text-tertiary)]">
                        {n.whyItMatters}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </Card>

            <Card className="gap-2 p-3" data-testid="card-ai-macro-recs">
              <div className="flex items-center gap-1.5">
                <Target className="size-4 shrink-0 text-[var(--rd-ai)]" aria-hidden />
                <h3 className="rd-type-h3 text-[var(--rd-text-primary)]">Odporúčania AI</h3>
              </div>
              {analysis.recommendations.length === 0 ? (
                <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                  V tomto behu AI nevrátila odporúčania. Skús spustiť analýzu znova.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {analysis.recommendations.map((r, i) => (
                    <div
                      key={`${r.title}-${i}`}
                      className="rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="rd-type-body-strong text-[var(--rd-text-primary)]">{r.title}</p>
                        <Badge label={priorityLabel(r.priority)} tone="Neutral" />
                      </div>
                      <p className="mt-1 rd-type-body-sm text-[var(--rd-text-secondary)]">{r.detail}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </PageBody>

      <Dialog
        open={!!newsDetail}
        title={newsDetail?.ticker ?? "Správa"}
        onClose={() => setNewsDetail(null)}
        showHelpIcon={false}
      >
        {newsDetail ? (
          <div className="mt-2 flex flex-col gap-2">
            <Badge
              label={sentimentLabelSk(newsDetail.sentiment)}
              tone={sentimentTone(newsDetail.sentiment)}
              className="self-start"
            />
            <p className="rd-type-body-strong text-[var(--rd-text-primary)]">{newsDetail.headline}</p>
            <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">{newsDetail.whyItMatters}</p>
            {newsDetail.portfolioImpactDetail ? (
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                {newsDetail.portfolioImpactDetail}
              </p>
            ) : null}
            {newsDetail.sourceUrl ? (
              <a
                href={newsDetail.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rd-type-label text-[var(--rd-profit)]"
              >
                Otvoriť článok
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
