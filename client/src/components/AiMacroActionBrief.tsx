import { useMemo, useState } from "react";
import { ChevronDown, Crosshair, ExternalLink, Lightbulb, TrendingUp } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card as ClassicCard, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AiAuditorAction, AiAuditorActionBrief } from "@/lib/aiAuditor";
import { cn } from "@/lib/utils";
import { Badge, Card, type BadgeTone } from "@/redesign/ui";

const PAGE_SIZE = 7;

const ACTION_ORDER: AiAuditorAction[] = ["BUY", "HOLD", "TRIM", "SELL"];

const ACTION_BADGE_TONE: Record<AiAuditorAction, BadgeTone> = {
  BUY: "Profit",
  HOLD: "Info",
  TRIM: "Warning",
  SELL: "Loss",
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

const SENTIMENT_TONE: Record<
  NonNullable<AiAuditorActionBrief["marketOutlook"]>["sentiment"],
  BadgeTone
> = {
  risk_on: "Profit",
  risk_off: "Loss",
  mixed: "Warning",
  uncertain: "Neutral",
};

function countByAction(rows: AiAuditorActionBrief["portfolioAudit"]) {
  const counts: Record<AiAuditorAction, number> = { BUY: 0, HOLD: 0, TRIM: 0, SELL: 0 };
  for (const row of rows) {
    if (row.action in counts) counts[row.action] += 1;
  }
  return counts;
}

function ActionCard({
  row,
  expanded,
  onToggle,
  redesign,
}: {
  row: AiAuditorActionBrief["portfolioAudit"][number];
  expanded: boolean;
  onToggle: () => void;
  redesign: boolean;
}) {
  const tone = ACTION_BADGE_TONE[row.action] ?? "Neutral";
  const shell = redesign
    ? "rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)] p-3"
    : "rounded-lg border border-border/60 bg-muted/20 p-3";

  return (
    <div
      className={cn(shell, "flex flex-col gap-1.5")}
      data-testid={`row-ai-macro-action-${row.ticker}`}
    >
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={onToggle}>
        <span
          className={cn(
            "shrink-0 font-semibold tabular-nums",
            redesign ? "rd-type-body-strong text-[var(--rd-text-primary)]" : "text-sm",
          )}
        >
          {row.ticker}
        </span>
        {redesign ? (
          <Badge label={row.action} tone={tone} />
        ) : (
          <span
            className={cn(
              "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              row.action === "BUY" && "bg-emerald-600/20 text-emerald-500",
              row.action === "HOLD" && "bg-sky-600/20 text-sky-400",
              row.action === "TRIM" && "bg-amber-500/20 text-amber-400",
              row.action === "SELL" && "bg-rose-600/20 text-rose-400",
            )}
          >
            {row.action}
          </span>
        )}
        <span
          className={cn(
            "min-w-0 flex-1 text-right tabular-nums",
            redesign
              ? "rd-type-body-sm text-[var(--rd-text-tertiary)]"
              : "text-[11px] text-muted-foreground",
          )}
        >
          {row.weightPct != null ? `${row.weightPct.toFixed(1).replace(".", ",")} %` : ""}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-[var(--rd-text-tertiary,#6b727c)] transition-transform",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {row.companyName ? (
        <p
          className={cn(
            redesign
              ? "rd-type-body-sm text-[var(--rd-text-tertiary)]"
              : "text-[11px] text-muted-foreground",
          )}
        >
          {row.companyName}
        </p>
      ) : null}

      <p
        className={cn(
          redesign ? "rd-type-body-sm" : "text-xs leading-relaxed",
          expanded
            ? redesign
              ? "text-[var(--rd-text-primary)]"
              : "text-foreground"
            : redesign
              ? "line-clamp-2 text-[var(--rd-text-secondary)]"
              : "line-clamp-2 text-muted-foreground",
        )}
      >
        {row.rationale}
      </p>

      {expanded ? (
        <>
          {row.risks ? (
            <div className="flex flex-col gap-0.5">
              <p
                className={cn(
                  "uppercase tracking-[0.08em]",
                  redesign
                    ? "rd-type-overline text-[var(--rd-text-tertiary)]"
                    : "text-[10px] font-semibold text-muted-foreground",
                )}
              >
                Riziká
              </p>
              <p
                className={cn(
                  redesign
                    ? "rd-type-body-sm text-[var(--rd-text-secondary)]"
                    : "text-[11px] text-muted-foreground",
                )}
              >
                {row.risks}
              </p>
            </div>
          ) : null}
          {row.invalidation ? (
            <div className="flex flex-col gap-0.5">
              <p
                className={cn(
                  "uppercase tracking-[0.08em]",
                  redesign
                    ? "rd-type-overline text-[var(--rd-text-tertiary)]"
                    : "text-[10px] font-semibold text-muted-foreground",
                )}
              >
                Invalidácia
              </p>
              <p
                className={cn(
                  redesign
                    ? "rd-type-body-sm text-[var(--rd-text-secondary)]"
                    : "text-[11px] text-muted-foreground",
                )}
              >
                {row.invalidation}
              </p>
            </div>
          ) : null}
          {row.newsDrivers?.length ? (
            <div className="flex flex-col gap-1">
              {row.newsDrivers.map((d) => (
                <div
                  key={d}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1.5",
                    redesign
                      ? "bg-[var(--rd-bg-surface-hover)]"
                      : "bg-muted",
                  )}
                >
                  <p
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      redesign
                        ? "rd-type-body-sm text-[var(--rd-text-secondary)]"
                        : "text-[11px] text-muted-foreground",
                    )}
                    title={d}
                  >
                    {d}
                  </p>
                  <ExternalLink
                    className={cn(
                      "size-3 shrink-0",
                      redesign ? "text-[var(--rd-text-tertiary)]" : "text-muted-foreground",
                    )}
                    aria-hidden
                  />
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function AiMacroActionBriefSection({
  brief,
  error,
  showEmptyHint = false,
  pending = false,
  variant = "classic",
}: {
  brief: AiAuditorActionBrief | null;
  error?: string | null;
  /** Starý audit bez pass 2 — ukáž kartu s výzvou Spustiť znova. */
  showEmptyHint?: boolean;
  /** Pass 2 práve beží na pozadí. */
  pending?: boolean;
  variant?: "classic" | "redesign";
}) {
  const redesign = variant === "redesign";
  const [filter, setFilter] = useState<AiAuditorAction | null>(null);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(() =>
    brief?.portfolioAudit[0]?.ticker ?? null,
  );
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const counts = useMemo(
    () => (brief ? countByAction(brief.portfolioAudit) : null),
    [brief],
  );

  const filtered = useMemo(() => {
    if (!brief) return [];
    const rows = filter
      ? brief.portfolioAudit.filter((r) => r.action === filter)
      : brief.portfolioAudit;
    return rows;
  }, [brief, filter]);

  const visible = filtered.slice(0, visibleCount);
  const remaining = Math.max(0, filtered.length - visibleCount);

  if (!brief && error) {
    if (redesign) {
      return (
        <Card className="gap-2 p-3" data-testid="card-ai-macro-actions-error">
          <div className="flex items-center gap-1.5">
            <Crosshair className="size-4 shrink-0 text-[var(--rd-ai)]" aria-hidden />
            <h3 className="rd-type-h3 text-[var(--rd-text-primary)]">Akcie na pozíciách</h3>
          </div>
          <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
            Makro audit prebehol, ale akcie sa nepodarilo doplniť: {error}
          </p>
        </Card>
      );
    }
    return (
      <ClassicCard data-testid="card-ai-macro-actions-error">
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
      </ClassicCard>
    );
  }

  if (!brief) {
    if (pending) {
      if (redesign) {
        return (
          <Card className="gap-2 p-3" data-testid="card-ai-macro-actions-pending">
            <div className="flex items-center gap-1.5">
              <Crosshair className="size-4 shrink-0 text-[var(--rd-ai)]" aria-hidden />
              <h3 className="rd-type-h3 text-[var(--rd-text-primary)]">Akcie na pozíciách</h3>
            </div>
            <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
              Makro audit je hotový. Dopĺňam BUY/SELL/TRIM/HOLD na pozície…
            </p>
          </Card>
        );
      }
      return (
        <ClassicCard data-testid="card-ai-macro-actions-pending">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Crosshair className="h-4 w-4 text-primary" />
              Akcie na pozíciách
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Makro audit je hotový. Dopĺňam BUY/SELL/TRIM/HOLD na pozície…
            </p>
          </CardContent>
        </ClassicCard>
      );
    }
    if (!showEmptyHint) return null;
    if (redesign) {
      return (
        <Card className="gap-2 p-3" data-testid="card-ai-macro-actions-empty">
          <div className="flex items-center gap-1.5">
            <Crosshair className="size-4 shrink-0 text-[var(--rd-ai)]" aria-hidden />
            <h3 className="rd-type-h3 text-[var(--rd-text-primary)]">Akcie na pozíciách</h3>
          </div>
          <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
            Táto analýza ešte nemá BUY/SELL/TRIM/HOLD. Stlač{" "}
            <span className="font-medium text-[var(--rd-text-primary)]">Spustiť analýzu</span>
            {" — "}najprv prebehne makro health, potom akcie na každú pozíciu.
          </p>
        </Card>
      );
    }
    return (
      <ClassicCard data-testid="card-ai-macro-actions-empty">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-primary" />
            Akcie na pozíciách
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Táto analýza ešte nemá BUY/SELL/TRIM/HOLD. Stlač{" "}
            <span className="font-medium text-foreground">Spustiť analýzu</span>
            {" — "}najprv prebehne makro health, potom akcie na každú pozíciu.
          </p>
        </CardContent>
      </ClassicCard>
    );
  }

  const outlook = brief.marketOutlook;
  const summaryLong = brief.summary.length > 160;

  const actionsBody = (
    <>
      {brief.summary ? (
        <div className="flex flex-col gap-1">
          <p
            className={cn(
              redesign
                ? "rd-type-body-sm text-[var(--rd-text-secondary)]"
                : "text-xs text-muted-foreground leading-relaxed",
              !summaryOpen && summaryLong ? "line-clamp-3" : undefined,
            )}
          >
            {brief.summary}
          </p>
          {summaryLong ? (
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1 self-start",
                redesign
                  ? "rd-type-label text-[var(--rd-text-secondary)]"
                  : "text-xs font-medium text-muted-foreground",
              )}
              onClick={() => setSummaryOpen((v) => !v)}
            >
              {summaryOpen ? "Skryť zhrnutie" : "Zobraziť celé zhrnutie"}
              <ChevronDown
                className={cn("size-3 transition-transform", summaryOpen && "rotate-180")}
              />
            </button>
          ) : null}
        </div>
      ) : null}

      {counts ? (
        <div
          className="flex flex-wrap gap-1.5"
          data-testid="actions-counts-filter"
          role="group"
          aria-label="Filter akcií"
        >
          {ACTION_ORDER.map((action) => {
            const n = counts[action];
            const active = filter === action;
            return (
              <button
                key={action}
                type="button"
                disabled={n === 0}
                onClick={() => {
                  setFilter((prev) => (prev === action ? null : action));
                  setVisibleCount(PAGE_SIZE);
                }}
                className={cn(
                  "transition-opacity",
                  n === 0 && "opacity-40",
                  active && "ring-1 ring-[var(--rd-border-strong,#383e46)] rounded-[6px]",
                )}
              >
                {redesign ? (
                  <Badge label={`${action} ${n}`} tone={ACTION_BADGE_TONE[action]} />
                ) : (
                  <span
                    className={cn(
                      "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      action === "BUY" && "bg-emerald-600/20 text-emerald-500",
                      action === "HOLD" && "bg-sky-600/20 text-sky-400",
                      action === "TRIM" && "bg-amber-500/20 text-amber-400",
                      action === "SELL" && "bg-rose-600/20 text-rose-400",
                    )}
                  >
                    {action} {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {visible.length === 0 ? (
          <p
            className={cn(
              redesign
                ? "rd-type-body-sm text-[var(--rd-text-tertiary)]"
                : "text-xs text-muted-foreground",
            )}
          >
            Žiadne akcie v tomto filtri.
          </p>
        ) : (
          visible.map((row) => (
            <ActionCard
              key={row.ticker}
              row={row}
              redesign={redesign}
              expanded={expandedTicker === row.ticker}
              onToggle={() =>
                setExpandedTicker((prev) => (prev === row.ticker ? null : row.ticker))
              }
            />
          ))
        )}
      </div>

      {remaining > 0 ? (
        <button
          type="button"
          className={cn(
            "w-full rounded-[var(--rd-radius-sm,8px)] border border-[var(--rd-border-subtle,#272c32)] py-2",
            redesign
              ? "rd-type-label text-[var(--rd-text-secondary)] bg-[var(--rd-bg-surface-raised)]"
              : "text-xs font-medium text-muted-foreground border-border/60 bg-muted/30",
          )}
          onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
          data-testid="button-ai-macro-actions-more"
        >
          Viac · ďalších {remaining}
        </button>
      ) : null}
    </>
  );

  const outlookBlock =
    outlook || brief.newOpportunities.length > 0 ? (
      <Collapsible defaultOpen>
        {redesign ? (
          <Card className="gap-0 overflow-hidden p-0">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 p-3 text-left"
                data-testid="button-ai-macro-outlook-toggle"
              >
                <TrendingUp className="size-4 shrink-0 text-[var(--rd-ai)]" aria-hidden />
                <span className="min-w-0 flex-1 rd-type-h3 text-[var(--rd-text-primary)]">
                  Outlook &amp; príležitosti
                </span>
                <ChevronDown className="size-4 shrink-0 text-[var(--rd-text-tertiary)]" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex flex-col gap-2 px-3 pb-3">
                {outlook ? (
                  <div className="rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)] p-3 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="rd-type-body-strong text-[var(--rd-text-primary)]">
                        Trhový outlook
                      </span>
                      <Badge
                        label={SENTIMENT_LABEL[outlook.sentiment]}
                        tone={SENTIMENT_TONE[outlook.sentiment]}
                      />
                    </div>
                    <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
                      {outlook.narrative}
                    </p>
                    {outlook.drivers?.length ? (
                      <ul className="list-disc space-y-0.5 pl-4 rd-type-body-sm text-[var(--rd-text-tertiary)]">
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
                    className="rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)] p-3 flex flex-col gap-1"
                  >
                    <div className="flex items-center gap-2">
                      <Lightbulb className="size-3.5 text-[var(--rd-warning)]" aria-hidden />
                      <span className="rd-type-body-strong tabular-nums text-[var(--rd-text-primary)]">
                        {op.ticker}
                      </span>
                      {op.companyName ? (
                        <span className="truncate rd-type-body-sm text-[var(--rd-text-tertiary)]">
                          {op.companyName}
                        </span>
                      ) : null}
                    </div>
                    <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">{op.thesis}</p>
                    {op.whyNow ? (
                      <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                        <span className="font-medium text-[var(--rd-text-secondary)]">
                          Prečo teraz:{" "}
                        </span>
                        {op.whyNow}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Card>
        ) : (
          <ClassicCard>
            <CollapsibleTrigger asChild>
              <button type="button" className="flex w-full items-center gap-2 p-4 text-left">
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
                  </div>
                ))}
              </CardContent>
            </CollapsibleContent>
          </ClassicCard>
        )}
      </Collapsible>
    ) : null;

  if (redesign) {
    return (
      <>
        <Card className="gap-2 p-3" data-testid="card-ai-macro-actions">
          <div className="flex items-center gap-1.5">
            <Crosshair className="size-4 shrink-0 text-[var(--rd-ai)]" aria-hidden />
            <h3 className="rd-type-h3 text-[var(--rd-text-primary)]">Akcie na pozíciách</h3>
          </div>
          {actionsBody}
        </Card>
        {outlookBlock}
      </>
    );
  }

  return (
    <>
      <ClassicCard data-testid="card-ai-macro-actions">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-primary" />
            Akcie na pozíciách
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">{actionsBody}</CardContent>
      </ClassicCard>
      {outlookBlock}
    </>
  );
}
