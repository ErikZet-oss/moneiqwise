import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { sk } from "date-fns/locale";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Moon, Sun, CalendarPlus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { usePortfolio } from "@/hooks/usePortfolio";
import { HelpTip } from "@/components/HelpTip";
import { useMobileRedesign } from "@/hooks/useMobileUi";
import EventsCalendarMobile from "@/pages/redesign/EventsCalendarMobile";
import { CompanyLogo } from "@/components/CompanyLogo";
import { fetchUpcomingEnvelope } from "@/lib/upcomingEvents";

type EarningsSession = "BMO" | "AMC" | null;
type EventType = "earnings" | "dividend" | "macro";
type MacroCode = "CPI" | "CORE_CPI" | "FOMC" | "NFP" | "PCE";

type EarningsRes = {
  next: { ticker: string; companyName: string; date: string; session?: EarningsSession } | null;
  all: Array<{ ticker: string; companyName: string; date: string; session?: EarningsSession }>;
};

type MacroRes = {
  next: { code: string; shortLabel: string; date: string; title: string } | null;
  all: Array<{ code: string; shortLabel: string; date: string; title: string }>;
};

type DivRes = {
  next: unknown;
  all?: Array<{
    ticker: string;
    companyName: string;
    date: string;
    kind: "ex_dividend" | "payout";
    confirmed: boolean;
  }>;
};

type CalendarEvent = {
  type: EventType;
  date: string;
  title: string;
  subtitle: string;
  ticker?: string;
  session?: EarningsSession;
  impact: "normal" | "high";
  infoUrl: string;
};

function toIcsDateUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${day}T${hh}${mm}${ss}Z`;
}

function escapeIcsText(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function buildCalendarDates(ev: CalendarEvent): { start: Date; end: Date } {
  const base = new Date(`${ev.date}T12:00:00`);
  if (ev.type === "earnings" && ev.session === "BMO") {
    const start = new Date(`${ev.date}T11:00:00Z`);
    const end = new Date(start.getTime() + 45 * 60 * 1000);
    return { start, end };
  }
  if (ev.type === "earnings" && ev.session === "AMC") {
    const start = new Date(`${ev.date}T20:30:00Z`);
    const end = new Date(start.getTime() + 45 * 60 * 1000);
    return { start, end };
  }
  const start = new Date(`${ev.date}T12:00:00Z`);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    const fallbackStart = new Date(base);
    const fallbackEnd = new Date(base.getTime() + 60 * 60 * 1000);
    return { start: fallbackStart, end: fallbackEnd };
  }
  return { start, end };
}

function buildGoogleCalendarUrl(ev: CalendarEvent): string {
  const { start, end } = buildCalendarDates(ev);
  const params = new URLSearchParams({
    text: ev.title,
    details: `${ev.subtitle}\n\nSource: ${ev.infoUrl}`,
    dates: `${toIcsDateUtc(start)}/${toIcsDateUtc(end)}`,
  });
  return `https://calendar.google.com/calendar/u/0/r/eventedit?${params.toString()}`;
}

function buildIcsHref(ev: CalendarEvent): string {
  const { start, end } = buildCalendarDates(ev);
  const uid = `${encodeURIComponent(ev.title)}-${ev.date}@moneiqwise`;
  const now = toIcsDateUtc(new Date());
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Moneiqwise//Events Calendar//SK",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${toIcsDateUtc(start)}`,
    `DTEND:${toIcsDateUtc(end)}`,
    `SUMMARY:${escapeIcsText(ev.title)}`,
    `DESCRIPTION:${escapeIcsText(`${ev.subtitle}\n\nSource: ${ev.infoUrl}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

function EventsCalendarClassic() {
  const { getQueryParam, selectedPortfolio, isAllPortfolios } = usePortfolio();
  const portfolioParam = getQueryParam();

  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [showEarnings, setShowEarnings] = useState(true);
  const [showDividends, setShowDividends] = useState(true);
  const [showMacro, setShowMacro] = useState(true);
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<{ day: Date; events: CalendarEvent[] } | null>(null);

  const { data: earnings, isLoading: earningsLoading } = useQuery({
    queryKey: ["/api/holdings/next-earnings", portfolioParam],
    queryFn: () =>
      fetchUpcomingEnvelope<EarningsRes["all"][number]>(
        `/api/holdings/next-earnings?portfolio=${encodeURIComponent(portfolioParam)}`,
      ),
    staleTime: 45 * 60 * 1000,
    refetchOnMount: "always",
  });

  const { data: dividends, isLoading: dividendsLoading } = useQuery({
    queryKey: ["/api/dividends/upcoming", portfolioParam],
    queryFn: () =>
      fetchUpcomingEnvelope<NonNullable<DivRes["all"]>[number]>(
        `/api/dividends/upcoming?portfolio=${encodeURIComponent(portfolioParam)}`,
      ),
    staleTime: 45 * 60 * 1000,
    refetchOnMount: "always",
  });

  const { data: macro, isLoading: macroLoading } = useQuery({
    queryKey: ["/api/macro-events/upcoming"],
    queryFn: () =>
      fetchUpcomingEnvelope<MacroRes["all"][number]>("/api/macro-events/upcoming"),
    staleTime: 30 * 60 * 1000,
    refetchOnMount: "always",
  });

  const allEvents = useMemo(() => {
    const out: CalendarEvent[] = [];

    for (const e of earnings?.all ?? []) {
      const t = e.ticker.toUpperCase();
      out.push({
        type: "earnings",
        date: e.date,
        title: `${t} earnings`,
        subtitle: e.companyName || t,
        ticker: t,
        session: e.session ?? null,
        impact: "normal",
        infoUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(t)}`,
      });
    }

    for (const d of dividends?.all ?? []) {
      const t = d.ticker.toUpperCase();
      out.push({
        type: "dividend",
        date: d.date,
        title: d.kind === "ex_dividend" ? `${t} ex-dividend` : `${t} payout`,
        subtitle: d.kind === "ex_dividend" ? "Last chance before ex-date" : "Payment date",
        ticker: t,
        impact: "normal",
        infoUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(t)}`,
      });
    }

    for (const m of macro?.all ?? []) {
      out.push({
        type: "macro",
        date: m.date,
        title: `${m.shortLabel}`,
        subtitle: m.title,
        impact: "high",
        infoUrl: "https://finance.yahoo.com/calendar/economic",
      });
    }

    return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  }, [earnings?.all, dividends?.all, macro?.all]);

  const filteredEvents = useMemo(() => {
    return allEvents.filter((e) => {
      if (!showEarnings && e.type === "earnings") return false;
      if (!showDividends && e.type === "dividend") return false;
      if (!showMacro && e.type === "macro") return false;
      return true;
    });
  }, [allEvents, showEarnings, showDividends, showMacro]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of filteredEvents) {
      const arr = map.get(ev.date) ?? [];
      arr.push(ev);
      map.set(ev.date, arr);
    }
    map.forEach((arr) => {
      arr.sort((a: CalendarEvent, b: CalendarEvent) => {
        const w = (t: EventType) => (t === "macro" ? 0 : t === "dividend" ? 1 : 2);
        return w(a.type) - w(b.type);
      });
    });
    return map;
  }, [filteredEvents]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(calendarMonth);
    const monthEnd = endOfMonth(calendarMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [calendarMonth]);

  const [panelDay, setPanelDay] = useState(() => startOfDay(new Date()));
  const panelDayIso = format(panelDay, "yyyy-MM-dd");
  const panelEvents = eventsByDay.get(panelDayIso) ?? [];
  const upcomingEvents = useMemo(() => {
    const todayIso = format(startOfDay(new Date()), "yyyy-MM-dd");
    return filteredEvents.filter((e) => e.date >= todayIso && e.date !== panelDayIso).slice(0, 5);
  }, [filteredEvents, panelDayIso]);

  const openDay = (day: Date) => {
    const iso = format(startOfDay(day), "yyyy-MM-dd");
    setPanelDay(startOfDay(day));
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches) return;
    setSelectedDay({ day, events: eventsByDay.get(iso) ?? [] });
    setDaySheetOpen(true);
  };

  const loading = earningsLoading || dividendsLoading || macroLoading;

  const macroBadge = (title: string) => {
    const upper = title.toUpperCase();
    const code: MacroCode | null = upper.includes("CORE_CPI")
      ? "CORE_CPI"
      : upper === "CPI" || upper === "FOMC" || upper === "NFP" || upper === "PCE"
        ? (upper as MacroCode)
        : null;
    if (code === "FOMC") return <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500/20 px-1 text-[10px] font-semibold text-red-600">FED</span>;
    if (code === "CPI" || code === "CORE_CPI") return <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500/20 px-1 text-[10px] font-semibold text-orange-600">CPI</span>;
    if (code === "NFP") return <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/20 px-1 text-[10px] font-semibold text-amber-700">NFP</span>;
    if (code === "PCE") return <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500/20 px-1 text-[10px] font-semibold text-rose-600">PCE</span>;
    return <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500/20 px-1 text-[10px] font-semibold text-orange-600">M</span>;
  };

  const typeBadge = (type: EventType) => {
    if (type === "earnings") return <Badge className="bg-blue-600 hover:bg-blue-600">Earnings</Badge>;
    if (type === "dividend") return <Badge className="bg-green-600 hover:bg-green-600">Dividends</Badge>;
    return <Badge className="bg-orange-600 hover:bg-orange-600">Macro</Badge>;
  };

  const eventChipClass = (type: EventType) =>
    type === "earnings"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:border-[var(--rd-accent-earnings-border)] dark:bg-[var(--rd-accent-earnings-surface)] dark:!text-[var(--rd-accent-earnings)]"
      : type === "dividend"
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:border-[var(--rd-accent-position-border)] dark:bg-[var(--rd-accent-position-surface)] dark:!text-[var(--rd-accent-position)]"
        : "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:border-[var(--rd-accent-event-border)] dark:bg-[var(--rd-accent-event-surface)] dark:!text-[var(--rd-accent-event)]";

  const renderEventCards = (events: CalendarEvent[]) => (
    <div className="space-y-2.5">
      {events.map((ev, idx) => (
        <div
          key={`${ev.type}-${ev.title}-${idx}`}
          className="space-y-2 rounded-[10px] border border-border bg-card p-3 dark:bg-[var(--rd-bg-surface)]"
        >
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 shrink-0">
              {ev.ticker ? (
                <CompanyLogo ticker={ev.ticker} companyName={ev.subtitle} size="sm" />
              ) : (
                macroBadge(ev.title)
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-semibold leading-[18px]">{ev.title}</span>
                {typeBadge(ev.type)}
                {ev.impact === "high" && <Badge variant="destructive">High Impact</Badge>}
                {ev.session === "BMO" && (
                  <Badge variant="outline" className="gap-1">
                    <Sun className="h-3 w-3 text-amber-500" /> BMO
                  </Badge>
                )}
                {ev.session === "AMC" && (
                  <Badge variant="outline" className="gap-1">
                    <Moon className="h-3 w-3 text-indigo-500" /> AMC
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-[12px] leading-4 text-muted-foreground">{ev.subtitle}</p>
              <a
                href={ev.infoUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
              >
                Viac info
                <ExternalLink className="h-3 w-3" />
              </a>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-[12px] font-medium">
                  <a href={buildGoogleCalendarUrl(ev)} target="_blank" rel="noreferrer">
                    <CalendarPlus className="h-3.5 w-3.5" />
                    Pridať do Google kalendára
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-[12px] font-medium">
                  <a href={buildIcsHref(ev)} download={`moneiqwise-${ev.type}-${ev.date}.ics`}>
                    <CalendarPlus className="h-3.5 w-3.5" />
                    .ics
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const filterChips: Array<{ type: EventType; letter: string; label: string; active: boolean; toggle: () => void }> = [
    { type: "earnings", letter: "E", label: "Earnings", active: showEarnings, toggle: () => setShowEarnings((v) => !v) },
    { type: "dividend", letter: "D", label: "Dividends", active: showDividends, toggle: () => setShowDividends((v) => !v) },
    { type: "macro", letter: "M", label: "Macro", active: showMacro, toggle: () => setShowMacro((v) => !v) },
  ];

  return (
    <div className="flex flex-col gap-3 pb-6 md:pb-8">
      <div>
        <p className="text-[10px] font-semibold uppercase leading-3 tracking-[0.8px] text-tertiary">
          {isAllPortfolios ? "Všetky portfóliá" : `Portfólio: ${selectedPortfolio?.name ?? "Vybrané"}`}
        </p>
        <h1 className="mt-1 text-lg font-semibold flex items-center gap-2 flex-wrap">
          Trhový kalendár
          <HelpTip title="Interaktívny kalendár udalostí">
            <p>Earnings, dividend events a macro data na jednom mieste. Kliknite na deň pre detail.</p>
          </HelpTip>
        </h1>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <CardTitle className="text-sm font-medium">Filtre udalostí</CardTitle>
            <CardDescription>Vyberte, ktoré typy udalostí sa majú zobrazovať v kalendári.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {filterChips.map((chip) => (
              <Button
                key={chip.type}
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={chip.active}
                onClick={chip.toggle}
                className={`h-8 gap-2 pl-1.5 pr-2.5 text-[12px] font-medium ${chip.active ? "" : "opacity-60"}`}
              >
                <span className={`inline-flex size-5 items-center justify-center rounded-md border text-[10px] font-semibold ${eventChipClass(chip.type)}`}>
                  {chip.letter}
                </span>
                {chip.label}
                {chip.active ? <Check className="h-3.5 w-3.5 text-muted-foreground" /> : null}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
      <Card>
        <CardHeader className="p-4 pb-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-sm font-medium">Kalendár udalostí</CardTitle>
              <CardDescription>Klikni na deň pre detail udalostí.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setCalendarMonth((m) => subMonths(m, 1))} aria-label="Predchadzajuci mesiac">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[7.5rem] text-center text-[13px] font-semibold capitalize">
                {format(calendarMonth, "LLLL yyyy", { locale: sk })}
              </span>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setCalendarMonth((m) => addMonths(m, 1))} aria-label="Nasledujuci mesiac">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-3">
          {loading ? (
            <Skeleton className="h-[420px] w-full" />
          ) : (
            <div className="touch-manipulation">
              <div className="grid grid-cols-7 gap-1.5">
                {["Po", "Ut", "St", "Št", "Pi", "So", "Ne"].map((d, idx) => (
                  <div key={`${d}-${idx}`} className="px-1 pb-1.5 text-left text-[10px] font-semibold uppercase leading-3 tracking-[0.8px] text-tertiary">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {calendarDays.map((day) => {
                  const dayIso = format(startOfDay(day), "yyyy-MM-dd");
                  const items = eventsByDay.get(dayIso) ?? [];
                  const inMonth = isSameMonth(day, calendarMonth);
                  return (
                    <button
                      key={dayIso}
                      type="button"
                      onClick={() => openDay(day)}
                      className={`w-full min-h-[4.25rem] sm:min-h-[4.75rem] p-1 sm:p-1.5 flex flex-col items-stretch text-left rounded-lg border bg-card dark:bg-[var(--rd-bg-surface)] hover:bg-muted/60 active:bg-muted/60 transition-colors ${!inMonth ? "opacity-40" : ""} ${isToday(day) ? "border-amber-400 dark:border-[var(--rd-warning)]" : "border-border"} ${dayIso === panelDayIso ? "xl:ring-1 xl:ring-primary" : ""}`}
                    >
                      <span className={`px-0.5 text-[11px] font-medium leading-[14px] ${inMonth ? "text-foreground" : "text-muted-foreground"}`}>
                        {format(day, "d")}
                      </span>
                      <div className="mt-1 flex min-w-0 flex-col gap-1">
                        {items.slice(0, 2).map((ev, idx) => (
                          <span
                            key={`${dayIso}-${ev.type}-${ev.title}-${idx}`}
                            title={ev.title}
                            className={`truncate rounded-[4px] border px-1.5 py-px text-[10px] font-medium leading-[14px] ${eventChipClass(ev.type)}`}
                          >
                            {ev.ticker ?? ev.title}
                          </span>
                        ))}
                        {items.length > 2 && (
                          <span className="px-1 text-[10px] font-medium leading-3 text-muted-foreground">
                            +{items.length - 2}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="hidden xl:block" data-testid="events-day-panel">
        <CardHeader className="space-y-1 p-4 pb-2">
          <CardTitle className="text-sm font-medium first-letter:uppercase">
            {format(panelDay, "EEEE d. MMMM yyyy", { locale: sk })}
          </CardTitle>
          <CardDescription>
            {panelEvents.length > 0
              ? `Plánované udalosti: ${panelEvents.length}`
              : "V tento deň nie sú pre aktívne filtre žiadne udalosti."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-2">
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            panelEvents.length > 0 && renderEventCards(panelEvents)
          )}
          {!loading && upcomingEvents.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase leading-3 tracking-[0.8px] text-tertiary">Najbližšie</p>
              <div className="flex flex-col">
                {upcomingEvents.map((ev, idx) => (
                  <button
                    key={`${ev.date}-${ev.type}-${ev.title}-${idx}`}
                    type="button"
                    onClick={() => openDay(new Date(`${ev.date}T00:00:00`))}
                    className="flex items-center gap-2.5 rounded-md px-1.5 py-2 text-left hover:bg-muted/60"
                  >
                    <span className="w-12 shrink-0 text-[11px] font-medium leading-[14px] text-tertiary tabular-nums">
                      {format(new Date(`${ev.date}T00:00:00`), "d. M.", { locale: sk })}
                    </span>
                    <span className={`shrink-0 rounded-[4px] border px-1.5 py-px text-[10px] font-medium leading-[14px] ${eventChipClass(ev.type)}`}>
                      {ev.type === "earnings" ? "E" : ev.type === "dividend" ? "D" : "M"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-4 text-foreground">{ev.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      </div>

      <Sheet open={daySheetOpen} onOpenChange={setDaySheetOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto px-4 pb-6">
          <SheetHeader className="text-left space-y-1 pr-6">
            <SheetTitle className="text-base sm:text-lg first-letter:uppercase">
              {selectedDay ? format(selectedDay.day, "EEEE d. MMMM yyyy", { locale: sk }) : ""}
            </SheetTitle>
            <SheetDescription className="text-xs sm:text-sm text-left">
              {selectedDay && selectedDay.events.length > 0
                ? `Plánované udalosti: ${selectedDay.events.length}`
                : "V tento deň nie sú pre aktívne filtre žiadne udalosti."}
            </SheetDescription>
          </SheetHeader>
          {selectedDay && selectedDay.events.length > 0 && (
            <div className="mt-4">{renderEventCards(selectedDay.events)}</div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default function EventsCalendar() {
  const redesign = useMobileRedesign();
  return redesign ? <EventsCalendarMobile /> : <EventsCalendarClassic />;
}
