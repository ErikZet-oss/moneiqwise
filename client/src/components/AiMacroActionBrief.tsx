import { ChevronDown, Crosshair, Lightbulb, TrendingUp } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AiAuditorAction, AiAuditorActionBrief } from "@/lib/aiAuditor";
import { cn } from "@/lib/utils";

const ACTION_STYLE: Record<AiAuditorAction, string> = {
  BUY: "bg-emerald-600 text-white",
  SELL: "bg-red-600 text-white",
  TRIM: "bg-amber-500 text-white",
  HOLD: "bg-slate-500 text-white",
};

const SENTIMENT_LABEL: Record<
  NonNullable<AiAuditorActionBrief["marketOutlook"]>["sentiment"],
  string
> = {
  risk_on: "Risk-on",
  risk_off: "Risk-off",
  mixed: "Zmiešaná",
  uncertain: "Neistá",
};

function ActionBadge({ action }: { action: AiAuditorAction }) {
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

export function AiMacroActionBriefSection({
  brief,
  error,
}: {
  brief: AiAuditorActionBrief | null;
  error?: string | null;
}) {
  if (!brief && !error) return null;

  if (!brief && error) {
    return (
      <Card data-testid="card-ai-macro-actions-error">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-primary" />
            Akcie na pozíciách
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Makro audit prebehol, ale akcie sa nepodarilo doplniť: {error}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!brief) return null;

  const outlook = brief.marketOutlook;

  return (
    <>
      <Card data-testid="card-ai-macro-actions">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-primary" />
            Akcie na pozíciách
          </CardTitle>
          {brief.summary ? (
            <p className="text-xs text-muted-foreground leading-relaxed">{brief.summary}</p>
          ) : null}
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          {brief.portfolioAudit.length === 0 ? (
            <p className="text-xs text-muted-foreground">Žiadne akcie v tomto behu.</p>
          ) : (
            brief.portfolioAudit.map((row) => (
              <div
                key={row.ticker}
                className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1.5"
                data-testid={`row-ai-macro-action-${row.ticker}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold tabular-nums">{row.ticker}</span>
                  <ActionBadge action={row.action} />
                  {row.weightPct != null ? (
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {row.weightPct.toFixed(1)} %
                    </span>
                  ) : null}
                  {row.conviction != null ? (
                    <span className="text-[10px] text-muted-foreground">
                      Conviction {row.conviction}/5
                    </span>
                  ) : null}
                  {row.horizon ? (
                    <span className="text-[10px] uppercase text-muted-foreground">
                      {row.horizon}
                    </span>
                  ) : null}
                </div>
                {row.companyName ? (
                  <p className="text-[11px] text-muted-foreground">{row.companyName}</p>
                ) : null}
                <p className="text-xs leading-relaxed">{row.rationale}</p>
                {row.risks ? (
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground/80">Riziká: </span>
                    {row.risks}
                  </p>
                ) : null}
                {row.invalidation ? (
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground/80">Invalidácia: </span>
                    {row.invalidation}
                  </p>
                ) : null}
                {row.newsDrivers?.length ? (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {row.newsDrivers.map((d) => (
                      <span
                        key={d}
                        className="max-w-full truncate rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        title={d}
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {outlook || brief.newOpportunities.length > 0 ? (
        <Collapsible defaultOpen={false}>
          <Card>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 p-4 text-left"
              >
                <TrendingUp className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 text-base font-semibold">
                  Outlook &amp; príležitosti
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-3 px-4 pb-4 pt-0">
                {outlook ? (
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Trhový outlook</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">
                        {SENTIMENT_LABEL[outlook.sentiment]}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {outlook.narrative}
                    </p>
                    {outlook.drivers?.length ? (
                      <ul className="list-disc pl-4 text-[11px] text-muted-foreground space-y-0.5">
                        {outlook.drivers.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                {brief.newOpportunities.map((op) => (
                  <div
                    key={op.ticker}
                    className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1"
                  >
                    <div className="flex items-center gap-2">
                      <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                      <span className="text-sm font-semibold tabular-nums">{op.ticker}</span>
                      {op.companyName ? (
                        <span className="text-[11px] text-muted-foreground truncate">
                          {op.companyName}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs leading-relaxed">{op.thesis}</p>
                    {op.whyNow ? (
                      <p className="text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground/80">Prečo teraz: </span>
                        {op.whyNow}
                      </p>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      ) : null}
    </>
  );
}
