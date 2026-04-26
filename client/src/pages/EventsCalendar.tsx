import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addMonths, endOfMonth, endOfWeek, eachDayOfInterval, format, isSameMonth, isToday, startOfDay, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { sk } from "date-fns/locale";
import { CalendarClock, ChevronLeft, ChevronRight, Moon, Sun } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { usePortfolio } from "@/hooks/usePortfolio";
import { HelpTip } from "@/components/HelpTip";
import { CompanyLogo } from "@/components/CompanyLogo";

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
};

export default function EventsCalendar() {
  const { getQueryParam, selectedPortfolio, isAllPortfolios } = usePortfolio();
  const portfolioParam = getQueryParam();

  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [showEarnings, setShowEarnings] = useState(true);
  const [showDividends, setShowDividends] = useState(true);
  const [showMacro, setShowMacro] = useState(true);
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<{ day: Date; events: CalendarEvent[] } | null>(null);

  const { data: earnings, isLoading: earningsLoading } = useQuery<EarningsRes>({
    queryKey: ["/api/holdings/next-earnings", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/holdings/next-earnings?portfolio=${encodeURIComponent(portfolioParam)}`, { credentials: "include" });
      if (!res.ok) throw new Error("earnings");
      return res.json();
    },
    staleTime: 45 * 60 * 1000,
  });

  const { data: dividends, isLoading: dividendsLoading } = useQuery<DivRes>({
    queryKey: ["/api/dividends/upcoming", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/dividends/upcoming?portfolio=${encodeURIComponent(portfolioParam)}`, { credentials: "include" });
      if (!res.ok) throw new Error("dividends");
      return res.json();
    },
    staleTime: 45 * 60 * 1000,
  });

  const { data: macro, isLoading: macroLoading } = useQuery<MacroRes>({
    queryKey: ["/api/macro-events/upcoming"],
    queryFn: async () => {
      const res = await fetch("/api/macro-events/upcoming", { credentials: "include" });
      if (!res.ok) throw new Error("macro");
      return res.json();
    },
    staleTime: 12 * 60 * 60 * 1000,
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
      });
    }

    for (const d of dividends?.all ?? []) {
      const t = d.ticker.toUpperCase();
      out.push({
        type: "dividend",
        date: d.date,
        title: d.kind === "ex_dividend" ? `${t} ex-dividend` : `${t} payout`,
        subtitle: d.kind === "ex_dividend" ? "Posledn· öanca k˙più pred ex-date" : "Payment date",
        ticker: t,
        impact: "normal",
      });
    }

    for (const m of macro?.all ?? []) {
      out.push({
        type: "macro",
        date: m.date,
        title: `${m.shortLabel}`,
        subtitle: m.title,
        impact: "high",
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
        const w = (t: EventType) => (t === "macro" ? 0 : t === "earnings" ? 1 : 2);
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

  const openDay = (day: Date) => {
    const iso = format(startOfDay(day), "yyyy-MM-dd");
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
    if (type === "dividend") return <Badge className="bg-green-600 hover:bg-green-600">Dividendy</Badge>;
    return <Badge className="bg-orange-600 hover:bg-orange-600">Makro</Badge>;
  };

  return (
    <div className="space-y-4 md:space-y-6 pb-6 md:pb-8">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2 flex-wrap">
          <CalendarClock className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
          Trhov˝ kalend·r
          <HelpTip title="InteraktÌvny kalend·r udalostÌ">
            <p>Earnings, dividendovÈ udalosti a makro d·ta na jednom mieste. Kliknite na deÚ pre detail.</p>
          </HelpTip>
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground mt-1">
          {isAllPortfolios ? "Vöetky portfÛli·" : `PortfÛlio: ${selectedPortfolio?.name ?? "VybranÈ"}`}
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base sm:text-lg">Filtre udalostÌ</CardTitle>
          <CardDescription>Vyberte, ktorÈ typy udalostÌ sa maj˙ zobrazovaù v kalend·ri.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant={showEarnings ? "default" : "outline"} size="sm" onClick={() => setShowEarnings((v) => !v)}>
              <span className="mr-1">??</span> Earnings
            </Button>
            <Button variant={showDividends ? "default" : "outline"} size="sm" onClick={() => setShowDividends((v) => !v)}>
              <span className="mr-1">??</span> Dividendy
            </Button>
            <Button variant={showMacro ? "default" : "outline"} size="sm" onClick={() => setShowMacro((v) => !v)}>
              <span className="mr-1">??</span> Makro
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-3 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base sm:text-lg">Kalend·r udalostÌ</CardTitle>
              <CardDescription>Klikni na deÚ pre detail udalostÌ.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setCalendarMonth((m) => subMonths(m, 1))} aria-label="Predch·dzaj˙ci mesiac">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[11rem] text-center text-sm font-medium capitalize">
                {format(calendarMonth, "LLLL yyyy", { locale: sk })}
              </span>
              <Button variant="outline" size="icon" onClick={() => setCalendarMonth((m) => addMonths(m, 1))} aria-label="Nasleduj˙ci mesiac">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-3 sm:px-6">
          {loading ? (
            <Skeleton className="h-[420px] w-full" />
          ) : (
            <div className="rounded-lg border overflow-hidden touch-manipulation">
              <div className="grid grid-cols-7 gap-px bg-border">
                {["Po", "Ut", "St", "ät", "Pi", "So", "Ne"].map((d) => (
                  <div key={d} className="bg-muted/50 px-0.5 py-1.5 sm:py-2 text-center text-[10px] sm:text-xs font-medium text-muted-foreground">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px bg-border">
                {calendarDays.map((day) => {
                  const dayIso = format(startOfDay(day), "yyyy-MM-dd");
                  const items = eventsByDay.get(dayIso) ?? [];
                  const inMonth = isSameMonth(day, calendarMonth);
                  return (
                    <button
                      key={dayIso}
                      type="button"
                      onClick={() => openDay(day)}
                      className={`w-full min-h-[4.25rem] sm:min-h-[5rem] p-1 sm:p-1.5 flex flex-col items-stretch text-left bg-card active:bg-muted/60 transition-colors ${!inMonth ? "opacity-40" : ""} ${isToday(day) ? "ring-1 ring-inset ring-primary/50 z-[1]" : ""}`}
                    >
                      <span className={`text-[11px] sm:text-xs font-medium leading-none ${inMonth ? "text-foreground" : "text-muted-foreground"}`}>
                        {format(day, "d")}
                      </span>
                      <div className="mt-1 flex items-center gap-1 flex-wrap min-h-[1rem]">
                        {items.slice(0, 3).map((ev, idx) =>
                          ev.ticker ? (
                            <span
                              key={`${dayIso}-${ev.type}-${ev.title}-${idx}`}
                              className="-ml-1 first:ml-0 ring-2 ring-card rounded-full bg-card shrink-0"
                            >
                              <CompanyLogo ticker={ev.ticker} companyName={ev.subtitle} size="xs" />
                            </span>
                          ) : (
                            <span key={`${dayIso}-${ev.type}-${ev.title}-${idx}`} title={ev.title}>
                              {macroBadge(ev.title)}
                            </span>
                          ),
                        )}
                      </div>
                      {items.length > 0 && (
                        <span className="mt-auto text-[9px] sm:text-[11px] font-semibold text-muted-foreground">
                          {items.length} udal.
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={daySheetOpen} onOpenChange={setDaySheetOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto px-4 pb-6">
          <SheetHeader className="text-left space-y-1 pr-6">
            <SheetTitle className="text-base sm:text-lg">
              {selectedDay ? format(selectedDay.day, "EEEE d. MMMM yyyy", { locale: sk }) : ""}
            </SheetTitle>
            <SheetDescription className="text-xs sm:text-sm text-left">
              {selectedDay && selectedDay.events.length > 0
                ? `Napl·novanÈ udalosti: ${selectedDay.events.length}`
                : "V tento deÚ nie s˙ udalosti podæa aktu·lnych filtrov."}
            </SheetDescription>
          </SheetHeader>
          {selectedDay && selectedDay.events.length > 0 && (
            <div className="mt-4 space-y-3">
              {selectedDay.events.map((ev, idx) => (
                <div key={`${ev.type}-${ev.title}-${idx}`} className="rounded-lg border p-3 space-y-2 bg-card">
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5">
                      {ev.ticker ? (
                        <CompanyLogo ticker={ev.ticker} companyName={ev.subtitle} size="sm" />
                      ) : (
                        macroBadge(ev.title)
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm">{ev.title}</span>
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
                      <p className="text-xs text-muted-foreground mt-1">{ev.subtitle}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
