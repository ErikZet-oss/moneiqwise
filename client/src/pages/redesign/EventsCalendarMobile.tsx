import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { sk } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePortfolio } from "@/hooks/usePortfolio";
import { fetchUpcomingEnvelope } from "@/lib/upcomingEvents";
import { Avatar, Badge, Card, Dialog, TopBar } from "@/redesign/ui";
import { cn } from "@/lib/utils";
import { HelpButton, PageBody } from "./mobileChrome";

type EventType = "earnings" | "dividend" | "macro";
type EarningsSession = "BMO" | "AMC" | null;

type CalEvent = {
  type: EventType;
  date: string;
  title: string;
  subtitle: string;
  listTitle: string;
  listSubtitle: string;
  ticker?: string;
  shortLabel?: string;
  session?: EarningsSession;
};

const WEEKDAYS = ["Po", "Ut", "St", "Št", "Pi", "So", "Ne"];

function RoundNav({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)] text-[var(--rd-text-primary)]"
    >
      {children}
    </button>
  );
}

function FilterChip({
  active,
  letter,
  letterTone,
  label,
  onClick,
}: {
  active: boolean;
  letter: string;
  letterTone: "info" | "profit" | "warning";
  label: string;
  onClick: () => void;
}) {
  const tone =
    letterTone === "info"
      ? "bg-[var(--rd-info-dim)] text-[var(--rd-info)]"
      : letterTone === "profit"
        ? "bg-[var(--rd-profit-dim)] text-[var(--rd-profit)]"
        : "bg-[var(--rd-warning-dim)] text-[var(--rd-warning)]";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[12px] font-medium leading-4",
        active
          ? "border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-hover)] text-[var(--rd-text-primary)]"
          : "border border-transparent text-[var(--rd-text-tertiary)] opacity-55",
      )}
    >
      <span className={cn("inline-flex size-[18px] items-center justify-center rounded-[var(--rd-radius-xs)] text-[10px] font-medium", tone)}>
        {letter}
      </span>
      {label}
    </button>
  );
}

function dayMarker(events: CalEvent[]): { text: string; color: string } | null {
  if (events.length === 0) return null;
  const macros = events.filter((e) => e.type === "macro");
  const dividends = events.filter((e) => e.type === "dividend");
  const earnings = events.filter((e) => e.type === "earnings");

  if (macros.length > 0) {
    const label = macros[0].shortLabel || macros[0].title.slice(0, 4);
    const extra = events.length > 1 ? ` · ${events.length}` : "";
    return { text: `${label}${extra}`, color: "text-[var(--rd-warning)]" };
  }
  if (dividends.length > 0 && earnings.length === 0) {
    return { text: String(dividends.length), color: "text-[var(--rd-profit)]" };
  }
  if (earnings.length > 0 && dividends.length === 0 && macros.length === 0) {
    return { text: String(earnings.length), color: "text-[var(--rd-info)]" };
  }
  const primary = dividends.length ? "text-[var(--rd-profit)]" : "text-[var(--rd-info)]";
  return { text: String(events.length), color: primary };
}

function typeBadge(type: EventType) {
  if (type === "earnings") return <Badge label="Earnings" tone="Info" />;
  if (type === "dividend") return <Badge label="Dividendy" tone="Profit" />;
  return <Badge label="Makro" tone="Warning" />;
}

function typeLetterMeta(type: EventType): { letter: string; className: string } {
  if (type === "earnings") {
    return { letter: "E", className: "bg-[var(--rd-info-dim)] text-[var(--rd-info)]" };
  }
  if (type === "dividend") {
    return { letter: "D", className: "bg-[var(--rd-profit-dim)] text-[var(--rd-profit)]" };
  }
  return { letter: "M", className: "bg-[var(--rd-warning-dim)] text-[var(--rd-warning)]" };
}

function sessionLabel(session?: EarningsSession): string | null {
  if (session === "BMO") return "pred otvorením";
  if (session === "AMC") return "po zatvorení";
  return null;
}

function daysUntilLabel(dateIso: string, today: Date): string {
  const days = differenceInCalendarDays(new Date(`${dateIso}T12:00:00`), startOfDay(today));
  if (days <= 0) return "dnes";
  if (days === 1) return "o 1 deň";
  if (days >= 2 && days <= 4) return `o ${days} dni`;
  return `o ${days} dní`;
}

function eventsCountLabel(count: number): string {
  if (count === 1) return "1 udalosť";
  if (count >= 2 && count <= 4) return `${count} udalosti`;
  return `${count} udalostí`;
}

function weekdayShortSk(dateIso: string): string {
  return format(new Date(`${dateIso}T12:00:00`), "EEEEEE", { locale: sk }).toUpperCase();
}

export default function EventsCalendarMobile() {
  const { getQueryParam } = usePortfolio();
  const portfolioParam = getQueryParam();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [showEarnings, setShowEarnings] = useState(true);
  const [showDividends, setShowDividends] = useState(true);
  const [showMacro, setShowMacro] = useState(true);
  const [dayKey, setDayKey] = useState<string | null>(null);

  type EarningsRow = {
    ticker: string;
    date: string;
    companyName?: string;
    session?: EarningsSession;
  };
  type DividendRow = {
    ticker: string;
    date: string;
    companyName?: string;
    kind?: "ex_dividend" | "payout";
    estimatedGrossInUserCcy?: number | null;
  };
  type MacroRow = { date: string; title: string; shortLabel?: string; code?: string };

  const { data: earnings, isError: earningsError, isFetching: earningsFetching } = useQuery({
    queryKey: ["/api/holdings/next-earnings", portfolioParam],
    queryFn: () =>
      fetchUpcomingEnvelope<EarningsRow>(
        `/api/holdings/next-earnings?portfolio=${encodeURIComponent(portfolioParam)}`,
      ),
    staleTime: 45 * 60 * 1000,
    refetchOnMount: "always",
  });

  const { data: dividends, isError: dividendsError, isFetching: dividendsFetching } = useQuery({
    queryKey: ["/api/dividends/upcoming", portfolioParam],
    queryFn: () =>
      fetchUpcomingEnvelope<DividendRow>(
        `/api/dividends/upcoming?portfolio=${encodeURIComponent(portfolioParam)}`,
      ),
    staleTime: 45 * 60 * 1000,
    refetchOnMount: "always",
  });

  const { data: macro, isError: macroError, isFetching: macroFetching } = useQuery({
    queryKey: ["/api/macro-events/upcoming"],
    queryFn: () => fetchUpcomingEnvelope<MacroRow>("/api/macro-events/upcoming"),
    staleTime: 30 * 60 * 1000,
    refetchOnMount: "always",
  });

  const calendarLoading = earningsFetching || dividendsFetching || macroFetching;
  const calendarError = earningsError || dividendsError || macroError;

  const events = useMemo(() => {
    const list: CalEvent[] = [];
    if (showEarnings) {
      for (const e of earnings?.all ?? []) {
        const t = e.ticker.toUpperCase();
        const company = e.companyName || t;
        const sess = sessionLabel(e.session ?? null);
        list.push({
          type: "earnings",
          date: e.date.slice(0, 10),
          title: `${t} earnings`,
          subtitle: company,
          listTitle: t,
          listSubtitle: ["Earnings", company, sess].filter(Boolean).join(" · "),
          ticker: t,
          session: e.session ?? null,
        });
      }
    }
    if (showDividends) {
      for (const d of dividends?.all ?? []) {
        const t = d.ticker.toUpperCase();
        const isEx = d.kind === "ex_dividend";
        const amount =
          d.estimatedGrossInUserCcy != null && Number.isFinite(d.estimatedGrossInUserCcy) && d.estimatedGrossInUserCcy > 0
            ? `${d.estimatedGrossInUserCcy.toFixed(2).replace(".", ",")} €`
            : null;
        list.push({
          type: "dividend",
          date: d.date.slice(0, 10),
          title: isEx ? `${t} ex-dividend` : `${t} payout`,
          subtitle: d.companyName || t,
          listTitle: t,
          listSubtitle: ["Dividenda", isEx ? "Ex-dividend" : "Výplata dividendy", amount]
            .filter(Boolean)
            .join(" · "),
          ticker: t,
        });
      }
    }
    if (showMacro) {
      for (const m of macro?.all ?? []) {
        const label = m.shortLabel || m.code || m.title;
        list.push({
          type: "macro",
          date: m.date.slice(0, 10),
          title: label,
          subtitle: m.title,
          listTitle: label,
          listSubtitle: `Makro · ${m.title}`,
          shortLabel: m.shortLabel || m.code,
        });
      }
    }
    return list.sort((a, b) => a.date.localeCompare(b.date) || a.listTitle.localeCompare(b.listTitle));
  }, [earnings?.all, dividends?.all, macro?.all, showEarnings, showDividends, showMacro]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date)!.push(e);
    }
    return map;
  }, [events]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);
    return eachDayOfInterval({
      start: startOfWeek(monthStart, { weekStartsOn: 1 }),
      end: endOfWeek(monthEnd, { weekStartsOn: 1 }),
    });
  }, [month]);

  const upcomingInMonth = useMemo(() => {
    const today = startOfDay(new Date());
    const todayIso = format(today, "yyyy-MM-dd");
    const monthStartIso = format(startOfMonth(month), "yyyy-MM-dd");
    const monthEndIso = format(endOfMonth(month), "yyyy-MM-dd");
    const fromIso = isSameMonth(month, today) ? todayIso : monthStartIso;
    return events.filter((e) => e.date >= fromIso && e.date <= monthEndIso);
  }, [events, month]);

  const dayEvents = dayKey ? byDay.get(dayKey) ?? [] : [];
  const today = startOfDay(new Date());

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline="Trhový kalendár" title="Kalendár" />
      <PageBody>
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 text-[11px] leading-[14px] text-[var(--rd-text-secondary)]">
            Earnings, dividendy a makro dáta na jednom mieste.
          </p>
          <HelpButton
            compact
            title="Interaktívny kalendár udalostí"
            body="Earnings, dividendové udalosti a makro dáta na jednom mieste. Filtre zapínajú typy; klik na deň otvorí detail."
          />
        </div>

        <Card className="gap-2">
          <div className="flex flex-col gap-1">
            <p className="rd-type-h2">Filtre udalostí</p>
            <p className="text-[11px] leading-[14px] text-[var(--rd-text-tertiary)]">
              Vyberte, ktoré typy udalostí sa majú zobrazovať v kalendári.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              active={showEarnings}
              letter="E"
              letterTone="info"
              label="Earnings"
              onClick={() => setShowEarnings((v) => !v)}
            />
            <FilterChip
              active={showDividends}
              letter="D"
              letterTone="profit"
              label="Dividendy"
              onClick={() => setShowDividends((v) => !v)}
            />
            <FilterChip
              active={showMacro}
              letter="M"
              letterTone="warning"
              label="Makro"
              onClick={() => setShowMacro((v) => !v)}
            />
          </div>
        </Card>

        <Card className="gap-2">
          <div className="flex flex-col gap-1">
            <p className="rd-type-h2">Kalendár udalostí</p>
            <p className="text-[11px] leading-[14px] text-[var(--rd-text-tertiary)]">
              Klikni na deň pre detail udalostí.
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <RoundNav label="Predchádzajúci mesiac" onClick={() => setMonth((m) => subMonths(m, 1))}>
              <ChevronLeft className="size-4" />
            </RoundNav>
            <p className="min-w-0 flex-1 text-center text-[13px] font-semibold capitalize leading-[18px]">
              {format(month, "LLLL yyyy", { locale: sk })}
            </p>
            <RoundNav label="Nasledujúci mesiac" onClick={() => setMonth((m) => addMonths(m, 1))}>
              <ChevronRight className="size-4" />
            </RoundNav>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1 text-center text-[10px] font-medium leading-3 text-[var(--rd-text-tertiary)]">
                {d}
              </div>
            ))}
            {calendarDays.map((day) => {
              const key = format(startOfDay(day), "yyyy-MM-dd");
              const inMonth = isSameMonth(day, month);
              const list = byDay.get(key) ?? [];
              const marker = dayMarker(list);
              const selected = dayKey === key || (dayKey == null && isToday(day));
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!inMonth}
                  onClick={() => inMonth && setDayKey(key)}
                  className={cn(
                    "flex h-12 flex-col items-center justify-center gap-0.5 rounded-[var(--rd-radius-sm)]",
                    !inMonth && "text-[var(--rd-border-strong)]",
                    selected && inMonth && "border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-hover)]",
                  )}
                >
                  {inMonth ? (
                    <>
                      <span
                        className={cn(
                          "text-[11px] font-medium leading-[14px]",
                          marker ? "text-[var(--rd-text-primary)]" : "text-[var(--rd-text-secondary)]",
                        )}
                      >
                        {format(day, "d")}
                      </span>
                      {marker ? (
                        <span className={cn("max-w-full truncate px-0.5 text-[10px] font-medium leading-3", marker.color)}>
                          {marker.text}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-[11px] leading-[14px]">·</span>
                  )}
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="gap-2">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="rd-type-h2">Najbližšie udalosti</p>
              <p className="text-[11px] leading-[14px] text-[var(--rd-text-tertiary)]">
                {format(month, "LLLL yyyy", { locale: sk })} · od najbližšej
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-[var(--rd-bg-surface-hover)] px-2 py-[3px] text-[10px] font-medium leading-3 text-[var(--rd-text-secondary)]">
              {eventsCountLabel(upcomingInMonth.length)}
            </span>
          </div>

          {calendarLoading && upcomingInMonth.length === 0 ? (
            <p className="py-2 text-[11px] text-[var(--rd-text-tertiary)]">Načítavam udalosti…</p>
          ) : calendarError && upcomingInMonth.length === 0 ? (
            <p className="py-2 text-[11px] text-[var(--rd-loss)]">
              Udalosti sa nepodarilo načítať. Skús obnoviť stránku.
            </p>
          ) : upcomingInMonth.length === 0 ? (
            <p className="py-2 text-[11px] text-[var(--rd-text-tertiary)]">
              V tomto mesiaci nie sú udalosti pre aktívne filtre.
            </p>
          ) : (
            <div className="flex flex-col">
              {upcomingInMonth.map((e, i) => {
                const prev = i > 0 ? upcomingInMonth[i - 1] : null;
                const showDate = !prev || prev.date !== e.date;
                const letter = typeLetterMeta(e.type);
                return (
                  <button
                    key={`${e.type}-${e.date}-${e.listTitle}-${i}`}
                    type="button"
                    onClick={() => setDayKey(e.date)}
                    className={cn(
                      "flex w-full items-center gap-3 py-2 text-left",
                      i > 0 && "border-t border-[var(--rd-border-subtle)]",
                    )}
                  >
                    <div
                      className={cn(
                        "flex size-9 shrink-0 flex-col items-center justify-center rounded-[var(--rd-radius-sm)] bg-[var(--rd-bg-surface-raised)]",
                        !showDate && "opacity-0",
                      )}
                      aria-hidden={!showDate}
                    >
                      <p className="text-[13px] font-semibold leading-[18px] text-[var(--rd-text-primary)]">
                        {format(new Date(`${e.date}T12:00:00`), "d")}
                      </p>
                      <p className="text-[10px] font-medium leading-3 text-[var(--rd-text-tertiary)]">
                        {weekdayShortSk(e.date)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
                        letter.className,
                      )}
                    >
                      {letter.letter}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold leading-[18px] text-[var(--rd-text-primary)]">
                        {e.listTitle}
                      </p>
                      <p className="truncate text-[11px] leading-[14px] text-[var(--rd-text-secondary)]">
                        {e.listSubtitle}
                      </p>
                    </div>
                    <p className="shrink-0 text-[11px] font-medium leading-[14px] text-[var(--rd-text-tertiary)]">
                      {daysUntilLabel(e.date, today)}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </PageBody>

      <Dialog
        open={!!dayKey}
        title={dayKey ? format(new Date(`${dayKey}T12:00:00`), "EEEE d. MMMM yyyy", { locale: sk }) : ""}
        body={
          dayEvents.length > 0
            ? `Plánované udalosti: ${dayEvents.length}`
            : "V tento deň nie sú udalosti pre aktívne filtre."
        }
        onClose={() => setDayKey(null)}
      >
        <ul className="mt-3 space-y-2">
          {dayEvents.map((e, i) => (
            <li
              key={`${e.type}-${e.title}-${i}`}
              className="flex items-start gap-2 rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] px-3 py-2"
            >
              {e.ticker ? <Avatar ticker={e.ticker} companyName={e.subtitle} /> : null}
              <div className="min-w-0 flex-1">
                <div className="mb-1">{typeBadge(e.type)}</div>
                <p className="text-[13px] font-semibold leading-[18px]">{e.listTitle}</p>
                <p className="truncate text-[11px] text-[var(--rd-text-tertiary)]">{e.listSubtitle}</p>
              </div>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
