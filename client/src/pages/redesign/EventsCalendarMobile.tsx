import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import { sk } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePortfolio } from "@/hooks/usePortfolio";
import { Card, Checkbox, Dialog, TopBar } from "@/redesign/ui";
import { PageBody } from "./mobileChrome";

type CalEvent = { date: string; label: string; kind: "earnings" | "dividend" | "macro"; ticker?: string };

export default function EventsCalendarMobile() {
  const { getQueryParam } = usePortfolio();
  const portfolioParam = getQueryParam();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [showEarnings, setShowEarnings] = useState(true);
  const [showDividends, setShowDividends] = useState(true);
  const [showMacro, setShowMacro] = useState(true);
  const [dayKey, setDayKey] = useState<string | null>(null);

  const { data: earnings = [] } = useQuery<Array<{ ticker: string; date: string; companyName?: string }>>({
    queryKey: ["/api/holdings/next-earnings", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/holdings/next-earnings?portfolio=${encodeURIComponent(portfolioParam)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("earnings");
      return res.json();
    },
  });

  const { data: dividends = [] } = useQuery<Array<{ ticker: string; date: string; companyName?: string }>>({
    queryKey: ["/api/dividends/upcoming", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/dividends/upcoming?portfolio=${encodeURIComponent(portfolioParam)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("dividends");
      return res.json();
    },
  });

  const { data: macro = [] } = useQuery<Array<{ date: string; title: string }>>({
    queryKey: ["/api/macro-events/upcoming"],
    queryFn: async () => {
      const res = await fetch("/api/macro-events/upcoming", { credentials: "include" });
      if (!res.ok) throw new Error("macro");
      return res.json();
    },
  });

  const events = useMemo(() => {
    const list: CalEvent[] = [];
    if (showEarnings) {
      for (const e of earnings) {
        list.push({ date: e.date.slice(0, 10), label: e.companyName || e.ticker, kind: "earnings", ticker: e.ticker });
      }
    }
    if (showDividends) {
      for (const d of dividends) {
        list.push({ date: d.date.slice(0, 10), label: d.companyName || d.ticker, kind: "dividend", ticker: d.ticker });
      }
    }
    if (showMacro) {
      for (const m of macro) {
        list.push({ date: m.date.slice(0, 10), label: m.title, kind: "macro" });
      }
    }
    return list;
  }, [earnings, dividends, macro, showEarnings, showDividends, showMacro]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date)!.push(e);
    }
    return map;
  }, [events]);

  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  const startPad = (getDay(startOfMonth(month)) + 6) % 7;
  const dayEvents = dayKey ? byDay.get(dayKey) ?? [] : [];

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline="Trhový kalendár" title="Kalendár" />
      <PageBody>
        <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
          Earnings, dividendy a makro dáta na jednom mieste.
        </p>
        <Card>
          <h3 className="text-[15px] font-semibold">Filtre udalostí</h3>
          <Checkbox id="rd-cal-earn" checked={showEarnings} onCheckedChange={setShowEarnings} label="Earnings" />
          <Checkbox id="rd-cal-div" checked={showDividends} onCheckedChange={setShowDividends} label="Dividendy" />
          <Checkbox id="rd-cal-macro" checked={showMacro} onCheckedChange={setShowMacro} label="Makro" />
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold capitalize">{format(month, "LLLL yyyy", { locale: sk })}</h3>
            <div className="flex">
              <button type="button" aria-label="Predošlý" className="size-9 inline-flex items-center justify-center" onClick={() => setMonth((m) => subMonths(m, 1))}>
                <ChevronLeft className="size-4" />
              </button>
              <button type="button" aria-label="Ďalší" className="size-9 inline-flex items-center justify-center" onClick={() => setMonth((m) => addMonths(m, 1))}>
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-[var(--rd-text-tertiary)]">
            {["Po", "Ut", "St", "Št", "Pi", "So", "Ne"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: startPad }).map((_, i) => (
              <div key={`p-${i}`} />
            ))}
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const list = byDay.get(key) ?? [];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => list.length && setDayKey(key)}
                  className="flex min-h-11 flex-col items-center justify-center rounded-[var(--rd-radius-xs)] text-xs"
                >
                  <span className="font-mono">{format(day, "d")}</span>
                  {list[0] ? (
                    <span className="max-w-full truncate px-0.5 text-[9px] text-[var(--rd-info)]">
                      {list[0].ticker || list[0].label.slice(0, 6)}
                      {list.length > 1 ? ` · ${list.length}` : ""}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </Card>
      </PageBody>

      <Dialog
        open={!!dayKey}
        title={dayKey ? format(new Date(dayKey), "EEEE d. MMMM yyyy", { locale: sk }) : ""}
        body={dayEvents.length ? `Plánované udalosti: ${dayEvents.length}` : undefined}
        onClose={() => setDayKey(null)}
      >
        <ul className="mt-3 space-y-2">
          {dayEvents.map((e, i) => (
            <li key={`${e.kind}-${e.label}-${i}`} className="rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] px-3 py-2 text-sm">
              <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--rd-text-tertiary)]">{e.kind}</p>
              <p className="font-medium">{e.ticker ? `${e.ticker} — ${e.label}` : e.label}</p>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
