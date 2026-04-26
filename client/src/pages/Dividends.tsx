import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Banknote, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, differenceInCalendarDays, endOfMonth, endOfWeek, format, isSameMonth, isToday, startOfDay, startOfMonth, startOfWeek, subMonths, eachDayOfInterval } from "date-fns";
import { sk } from "date-fns/locale";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { CompanyLogo } from "@/components/CompanyLogo";
import type { Holding, Transaction } from "@shared/schema";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface DividendSummary {
  totalGross: number;
  totalTax: number;
  totalNet: number;
  byTicker: {
    ticker: string;
    companyName: string;
    totalGross: number;
    totalTax: number;
    totalNet: number;
    transactions: number;
  }[];
  transactionCount: number;
}

interface StockQuote {
  ticker: string;
  price: number;
}

type UpcomingDividendItem = {
  ticker: string;
  companyName: string;
  date: string;
  kind: "ex_dividend" | "payout";
  estimatedGrossInUserCcy: number | null;
  exDate: string | null;
  paymentDate: string | null;
  declarationDate: string | null;
  recordDate: string | null;
  payoutRatio: number | null;
  dividendYieldCurrent: number | null;
  annualDividendPerShare: number | null;
  dividendGrowth5yPct: number | null;
  dividendStreakYears: number | null;
  confirmed: boolean;
};

type FeedStatus = "UPCOMING" | "PENDING" | "PAID" | "REINVESTED";
type CalendarMode = "ROLLING" | "HISTORY";
type CalendarRow = {
  ticker: string;
  companyName: string;
  gross: number;
  tax: number;
  net: number;
};

export default function Dividends() {
  const [, setLocation] = useLocation();
  const { formatCurrency } = useCurrency();
  const { getQueryParam } = usePortfolio();
  const portfolioParam = getQueryParam();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("ROLLING");
  const [windowOffset, setWindowOffset] = useState(0);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));

  const { data: dividends, isLoading: dividendsLoading } = useQuery<DividendSummary>({
    queryKey: ["/api/dividends", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/dividends?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch dividends");
      return res.json();
    },
  });

  const { data: transactions = [], isLoading: transactionsLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/transactions?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch transactions");
      return res.json();
    },
  });

  const { data: holdings = [] } = useQuery<Holding[]>({
    queryKey: ["/api/holdings", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/holdings?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch holdings");
      return res.json();
    },
  });

  const { data: upcomingDividends } = useQuery<{ next: unknown; all?: UpcomingDividendItem[] }>({
    queryKey: ["/api/dividends/upcoming", portfolioParam],
    queryFn: async () => {
      const res = await fetch(
        `/api/dividends/upcoming?portfolio=${encodeURIComponent(portfolioParam)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("upcoming dividends");
      return res.json();
    },
    staleTime: 45 * 60 * 1000,
  });

  const quoteTickers = useMemo(
    () => Array.from(new Set(holdings.map((h) => h.ticker).filter(Boolean))).sort(),
    [holdings],
  );

  const { data: quotes = {} } = useQuery<Record<string, StockQuote>>({
    queryKey: ["/api/stocks/quotes/batch", quoteTickers.join(","), "dividends"],
    enabled: quoteTickers.length > 0,
    queryFn: async () => {
      const res = await fetch("/api/stocks/quotes/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tickers: quoteTickers, refresh: false }),
      });
      if (!res.ok) throw new Error("quotes");
      const data = await res.json();
      return (data?.quotes ?? {}) as Record<string, StockQuote>;
    },
    staleTime: 60 * 1000,
  });

  const isLoading = dividendsLoading || transactionsLoading;

  const holdingsByTicker = useMemo(() => {
    const m = new Map<string, { shares: number; avgCost: number; invested: number; companyName: string }>();
    for (const h of holdings) {
      const t = h.ticker.toUpperCase();
      const shares = parseFloat(String(h.shares ?? "0"));
      const invested = parseFloat(String(h.totalInvested ?? "0"));
      if (!Number.isFinite(shares) || shares <= 0) continue;
      const prev = m.get(t);
      const mergedShares = (prev?.shares ?? 0) + shares;
      const mergedInvested = (prev?.invested ?? 0) + (Number.isFinite(invested) ? invested : 0);
      m.set(t, {
        shares: mergedShares,
        invested: mergedInvested,
        avgCost: mergedShares > 0 ? mergedInvested / mergedShares : 0,
        companyName: prev?.companyName || h.companyName || t,
      });
    }
    return m;
  }, [holdings]);

  const annualDivByTicker = useMemo(() => {
    const m = new Map<string, number>();
    for (const ev of upcomingDividends?.all ?? []) {
      const t = ev.ticker.toUpperCase();
      if (ev.annualDividendPerShare != null && Number.isFinite(ev.annualDividendPerShare)) {
        m.set(t, Math.max(m.get(t) ?? 0, ev.annualDividendPerShare));
      }
    }
    return m;
  }, [upcomingDividends?.all]);

  const yieldMetrics = useMemo(() => {
    let totalCurrentValue = 0;
    let totalInvested = 0;
    let annualIncome = 0;
    for (const [ticker, h] of Array.from(holdingsByTicker.entries())) {
      const annual = annualDivByTicker.get(ticker) ?? 0;
      if (!(annual > 0)) continue;
      const q = quotes[ticker];
      if (!q || !Number.isFinite(q.price)) continue;
      const currentValue = q.price * h.shares;
      totalCurrentValue += currentValue;
      totalInvested += h.avgCost * h.shares;
      annualIncome += annual * h.shares;
    }
    return {
      dividendYieldCurrent: totalCurrentValue > 0 ? (annualIncome / totalCurrentValue) * 100 : 0,
      yieldOnCost: totalInvested > 0 ? (annualIncome / totalInvested) * 100 : 0,
      annualIncome,
    };
  }, [annualDivByTicker, holdingsByTicker, quotes]);

  const windowStart = useMemo(() => {
    const nowMonth = startOfMonth(new Date());
    if (calendarMode === "ROLLING") return addMonths(nowMonth, windowOffset);
    return subMonths(nowMonth, 11 + windowOffset * 12);
  }, [calendarMode, windowOffset]);

  const windowMonths = useMemo(
    () => Array.from({ length: 12 }).map((_, i) => addMonths(windowStart, i)),
    [windowStart],
  );

  const forecastBars = useMemo(() => {
    const monthKey = (d: Date) => format(d, "yyyy-MM");
    const map = new Map<string, { monthLabel: string; paid: number; confirmed: number; estimated: number; events: number }>();
    for (const m of windowMonths) {
      map.set(monthKey(m), {
        monthLabel: format(m, "LLL yy", { locale: sk }),
        paid: 0,
        confirmed: 0,
        estimated: 0,
        events: 0,
      });
    }

    for (const t of transactions) {
      if (t.type !== "DIVIDEND") continue;
      const d = new Date(t.transactionDate as unknown as string);
      const key = monthKey(startOfMonth(d));
      const row = map.get(key);
      if (!row) continue;
      const net =
        parseFloat(String(t.shares ?? "0")) * parseFloat(String(t.pricePerShare ?? "0")) -
        parseFloat(String(t.commission ?? "0"));
      if (!Number.isFinite(net)) continue;
      row.paid += Math.max(0, net);
      row.events += 1;
    }

    if (calendarMode === "ROLLING") {
      for (const ev of upcomingDividends?.all ?? []) {
        if (ev.kind !== "payout") continue;
        const d = new Date(`${ev.date}T12:00:00`);
        const key = monthKey(startOfMonth(d));
        const row = map.get(key);
        if (!row) continue;
        const amount = ev.estimatedGrossInUserCcy ?? 0;
        if (ev.confirmed) row.confirmed += amount;
        else row.estimated += amount;
        row.events += 1;
      }

      // fallback estimate from historical payouts projected +12m
      for (const t of transactions) {
        if (t.type !== "DIVIDEND") continue;
        const d = new Date(t.transactionDate as unknown as string);
        const projected = addMonths(d, 12);
        const key = monthKey(startOfMonth(projected));
        const row = map.get(key);
        if (!row) continue;
        const net =
          parseFloat(String(t.shares ?? "0")) * parseFloat(String(t.pricePerShare ?? "0")) -
          parseFloat(String(t.commission ?? "0"));
        if (Number.isFinite(net)) row.estimated += Math.max(0, net);
      }
    }

    return Array.from(map.values());
  }, [transactions, upcomingDividends?.all, windowMonths, calendarMode]);

  const feedRows = useMemo(() => {
    const now = new Date();
    const rows: Array<{
      id: string;
      ticker: string;
      companyName: string;
      exDate: string | null;
      paymentDate: string | null;
      declarationDate: string | null;
      recordDate: string | null;
      amount: number;
      status: FeedStatus;
      payoutRatio: number | null;
      dividendGrowth5yPct: number | null;
      dividendStreakYears: number | null;
      dividendYieldCurrent: number | null;
      yoc: number | null;
    }> = [];

    for (const t of transactions) {
      if (t.type !== "DIVIDEND") continue;
      const d = new Date(t.transactionDate as unknown as string);
      const iso = format(d, "yyyy-MM-dd");
      const amount =
        parseFloat(String(t.shares ?? "0")) * parseFloat(String(t.pricePerShare ?? "0")) -
        parseFloat(String(t.commission ?? "0"));
      rows.push({
        id: `paid-${t.id}`,
        ticker: t.ticker,
        companyName: t.companyName,
        exDate: null,
        paymentDate: iso,
        declarationDate: null,
        recordDate: null,
        amount: Number.isFinite(amount) ? amount : 0,
        status: "PAID",
        payoutRatio: null,
        dividendGrowth5yPct: null,
        dividendStreakYears: null,
        dividendYieldCurrent: null,
        yoc: null,
      });
    }

    for (const ev of upcomingDividends?.all ?? []) {
      const t = ev.ticker.toUpperCase();
      const hold = holdingsByTicker.get(t);
      const exDate = ev.exDate ? new Date(`${ev.exDate}T12:00:00`) : null;
      const payDate = ev.paymentDate ? new Date(`${ev.paymentDate}T12:00:00`) : null;
      let status: FeedStatus = "UPCOMING";
      if (payDate && payDate < now) status = "PAID";
      else if (exDate && exDate < now) status = "PENDING";
      const yoc =
        ev.annualDividendPerShare != null && hold && hold.avgCost > 0
          ? (ev.annualDividendPerShare / hold.avgCost) * 100
          : null;
      rows.push({
        id: `${ev.ticker}-${ev.kind}-${ev.date}`,
        ticker: ev.ticker,
        companyName: ev.companyName,
        exDate: ev.exDate,
        paymentDate: ev.paymentDate,
        declarationDate: ev.declarationDate,
        recordDate: ev.recordDate,
        amount: ev.estimatedGrossInUserCcy ?? 0,
        status,
        payoutRatio: ev.payoutRatio,
        dividendGrowth5yPct: ev.dividendGrowth5yPct,
        dividendStreakYears: ev.dividendStreakYears,
        dividendYieldCurrent: ev.dividendYieldCurrent,
        yoc,
      });
    }

    const start = windowMonths[0];
    const end = addMonths(start, 12);
    const insideWindow = (iso: string | null) => {
      if (!iso) return false;
      const d = new Date(`${iso}T12:00:00`);
      return d >= start && d < end;
    };

    rows.sort((a, b) => {
      const da = new Date(`${a.exDate || a.paymentDate || "2100-01-01"}T12:00:00`).getTime();
      const db = new Date(`${b.exDate || b.paymentDate || "2100-01-01"}T12:00:00`).getTime();
      return da - db;
    });
    return rows.filter((r) => insideWindow(r.paymentDate || r.exDate));
  }, [upcomingDividends?.all, holdingsByTicker, transactions, windowMonths]);

  const statusLabel = (s: FeedStatus) =>
    s === "UPCOMING" ? "Upcoming" : s === "PENDING" ? "Pending" : s === "REINVESTED" ? "Reinvested" : "Paid";

  const calendarByDay = useMemo(() => {
    const map = new Map<string, { totalNet: number; rows: CalendarRow[] }>();
    const upsert = (dayIso: string, ticker: string, companyName: string, gross: number, tax: number, net: number) => {
      const d = map.get(dayIso) ?? { totalNet: 0, rows: [] };
      let row = d.rows.find((r) => r.ticker === ticker);
      if (!row) {
        row = { ticker, companyName, gross: 0, tax: 0, net: 0 };
        d.rows.push(row);
      }
      row.gross += gross;
      row.tax += tax;
      row.net += net;
      d.totalNet += net;
      map.set(dayIso, d);
    };

    for (const t of transactions) {
      const dayIso = format(startOfDay(new Date(t.transactionDate as unknown as string)), "yyyy-MM-dd");
      const ticker = t.ticker || "N/A";
      const companyName = t.companyName || ticker;
      if (t.type === "DIVIDEND") {
        const shares = parseFloat(String(t.shares ?? "0"));
        const dps = parseFloat(String(t.pricePerShare ?? "0"));
        const tax = Math.abs(parseFloat(String(t.commission ?? "0")));
        const gross = Number.isFinite(shares) && Number.isFinite(dps) ? shares * dps : 0;
        const net = gross - tax;
        upsert(dayIso, ticker, companyName, gross, tax, net);
      } else if (t.type === "TAX") {
        const shares = parseFloat(String(t.shares ?? "0"));
        const pps = parseFloat(String(t.pricePerShare ?? "0"));
        const taxOnly = Math.abs(Number.isFinite(shares) && Number.isFinite(pps) ? shares * pps : 0);
        upsert(dayIso, ticker, companyName, 0, taxOnly, -taxOnly);
      }
    }
    Array.from(map.values()).forEach((v) => {
      v.rows.sort((a: CalendarRow, b: CalendarRow) => b.net - a.net);
    });
    return map;
  }, [transactions]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(calendarMonth);
    const monthEnd = endOfMonth(calendarMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [calendarMonth]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Banknote className="h-6 w-6 text-primary" />
          Dividendy
        </h1>
        <p className="text-muted-foreground">Dividend timeline, výplatný feed a yield analytika</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Forward 12M príjem</p><p className="text-xl font-semibold">{formatCurrency(yieldMetrics.annualIncome)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Dividend Yield (aktuálny)</p><p className="text-xl font-semibold">{yieldMetrics.dividendYieldCurrent.toFixed(2)}%</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-xs text-muted-foreground">Yield on Cost (YOC)</p><p className="text-xl font-semibold">{yieldMetrics.yieldOnCost.toFixed(2)}%</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Dividendový kalendár (interaktívny)</CardTitle>
              <CardDescription>Klikni na deň a uvidíš presne: logo firmy, brutto, daň, netto.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setCalendarMonth((m) => subMonths(m, 1))} aria-label="Predchádzajúci mesiac">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[11rem] text-center text-sm font-medium capitalize">
                {format(calendarMonth, "LLLL yyyy", { locale: sk })}
              </span>
              <Button variant="outline" size="icon" onClick={() => setCalendarMonth((m) => addMonths(m, 1))} aria-label="Nasledujúci mesiac">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <div className="grid grid-cols-7 gap-px bg-border">
              {["Po", "Ut", "St", "Št", "Pi", "So", "Ne"].map((d) => (
                <div key={d} className="bg-muted/50 px-1 py-2 text-center text-xs font-medium text-muted-foreground">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px bg-border">
              {calendarDays.map((day) => {
                const dayIso = format(startOfDay(day), "yyyy-MM-dd");
                const bucket = calendarByDay.get(dayIso);
                const inMonth = isSameMonth(day, calendarMonth);
                const cell = (
                  <div
                    className={`min-h-[4.8rem] p-1.5 flex flex-col bg-card ${!inMonth ? "opacity-40" : ""} ${isToday(day) ? "ring-1 ring-inset ring-primary/40" : ""}`}
                  >
                    <span className={`text-xs font-medium ${inMonth ? "text-foreground" : "text-muted-foreground"}`}>
                      {format(day, "d")}
                    </span>
                    {bucket && (
                      <span className={`mt-auto text-[11px] font-semibold truncate ${bucket.totalNet >= 0 ? "text-blue-600" : "text-red-600"}`}>
                        {bucket.totalNet >= 0 ? "+" : ""}{formatCurrency(bucket.totalNet)}
                      </span>
                    )}
                  </div>
                );
                if (!bucket) return <div key={dayIso}>{cell}</div>;
                return (
                  <UiTooltip key={dayIso}>
                    <TooltipTrigger asChild>
                      <button type="button" className="w-full text-left">{cell}</button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[340px] p-3">
                      <p className="font-medium mb-2">{format(day, "d. MMMM yyyy", { locale: sk })}</p>
                      <div className="space-y-2">
                        {bucket.rows.map((r) => (
                          <div key={`${dayIso}-${r.ticker}`} className="rounded-md border px-2 py-1.5">
                            <div className="flex items-center gap-2">
                              <CompanyLogo ticker={r.ticker} companyName={r.companyName} size="xs" />
                              <span className="text-sm font-medium">{r.ticker}</span>
                              <span className="text-xs text-muted-foreground truncate">{r.companyName}</span>
                            </div>
                            <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
                              <span>Brutto: <span className="font-medium">{formatCurrency(r.gross)}</span></span>
                              <span>Daň: <span className="font-medium text-red-600">-{formatCurrency(r.tax)}</span></span>
                              <span>Netto: <span className={`font-medium ${r.net >= 0 ? "text-blue-600" : "text-red-600"}`}>{r.net >= 0 ? "+" : ""}{formatCurrency(r.net)}</span></span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </TooltipContent>
                  </UiTooltip>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>
                {calendarMode === "ROLLING" ? "Dividendový kalendár (Rolling 12M)" : "Dividendový kalendár (História 12M)"}
              </CardTitle>
              <CardDescription>
                {calendarMode === "ROLLING"
                  ? "Nasledujúcich 12 mesiacov od zvoleného mesiaca."
                  : "12-mesačné okno z minulosti, posúvateľné po rokoch."}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant={calendarMode === "ROLLING" ? "default" : "outline"} size="sm" onClick={() => { setCalendarMode("ROLLING"); setWindowOffset(0); }}>
                Rolling 12M
              </Button>
              <Button variant={calendarMode === "HISTORY" ? "default" : "outline"} size="sm" onClick={() => { setCalendarMode("HISTORY"); setWindowOffset(0); }}>
                História
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button variant="outline" size="icon" onClick={() => setWindowOffset((v) => v + 1)} aria-label="Do minulosti">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setWindowOffset((v) => Math.max(0, v - 1))}
              aria-label="Do budúcnosti"
              disabled={windowOffset === 0}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              {format(windowMonths[0], "LLLL yyyy", { locale: sk })} - {format(windowMonths[11], "LLLL yyyy", { locale: sk })}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={forecastBars}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="monthLabel" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="paid" stackId="a" fill="#2563eb" name="Paid" />
                <Bar dataKey="confirmed" stackId="a" fill="#16a34a" name="Confirmed" />
                <Bar dataKey="estimated" stackId="a" fill="#86efac" name="Estimated" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[720px] grid grid-cols-12 gap-2 text-xs">
              {forecastBars.map((m) => (
                <div key={m.monthLabel} className="rounded-md border p-2">
                  <div className="font-medium">{m.monthLabel}</div>
                  <div className="text-blue-600">Paid: {formatCurrency(m.paid)}</div>
                  <div className="text-green-600">Confirmed: {formatCurrency(m.confirmed)}</div>
                  <div className="text-emerald-500">Estimated: {formatCurrency(m.estimated)}</div>
                  <div className="text-muted-foreground">Events: {m.events}</div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dividend Feed</CardTitle>
          <CardDescription>Ex-date countdown, status a čistá očakávaná suma</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {feedRows.length === 0 && <p className="text-sm text-muted-foreground">Zatiaľ nie sú dostupné dividendové udalosti.</p>}
          {feedRows.map((r) => {
            const isOpen = expanded.has(r.id);
            const exDelta = r.exDate ? differenceInCalendarDays(new Date(`${r.exDate}T12:00:00`), new Date()) : null;
            return (
              <div key={r.id} className="rounded-lg border p-3">
                <button
                  type="button"
                  className="w-full flex items-center gap-3 text-left"
                  onClick={() => {
                    const n = new Set(expanded);
                    if (n.has(r.id)) n.delete(r.id);
                    else n.add(r.id);
                    setExpanded(n);
                  }}
                >
                  <CompanyLogo ticker={r.ticker} companyName={r.companyName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{r.ticker}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.companyName}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-amber-600">
                      {exDelta == null ? "Ex-date neznámy" : exDelta >= 0 ? `Ex-date za ${exDelta} dní` : `Ex-date pred ${Math.abs(exDelta)} d`}
                    </div>
                    <div className="font-medium">{formatCurrency(r.amount)}</div>
                  </div>
                  <Badge variant="outline">{statusLabel(r.status)}</Badge>
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {isOpen && (
                  <div className="mt-3 pt-3 border-t grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                    <div><span className="text-muted-foreground">Declaration:</span> {r.declarationDate ?? "N/A"}</div>
                    <div><span className="text-muted-foreground">Ex-Date:</span> {r.exDate ?? "N/A"}</div>
                    <div><span className="text-muted-foreground">Record Date:</span> {r.recordDate ?? "N/A"}</div>
                    <div><span className="text-muted-foreground">Payment:</span> {r.paymentDate ?? "N/A"}</div>
                    <div><span className="text-muted-foreground">Yield:</span> {r.dividendYieldCurrent != null ? `${r.dividendYieldCurrent.toFixed(2)}%` : "N/A"}</div>
                    <div><span className="text-muted-foreground">YOC:</span> {r.yoc != null ? `${r.yoc.toFixed(2)}%` : "N/A"}</div>
                    <div><span className="text-muted-foreground">Payout Ratio:</span> {r.payoutRatio != null ? `${r.payoutRatio.toFixed(1)}%` : "N/A"}</div>
                    <div><span className="text-muted-foreground">Dividend Growth (5Y):</span> {r.dividendGrowth5yPct != null ? `${r.dividendGrowth5yPct.toFixed(1)}%` : "N/A"}</div>
                    <div><span className="text-muted-foreground">Dividend Streak:</span> {r.dividendStreakYears != null ? `${r.dividendStreakYears} rokov` : "N/A"}</div>
                    <div>
                      <Button
                        variant="ghost"
                        className="px-0 h-auto text-xs underline"
                        onClick={() => setLocation(`/asset/${encodeURIComponent(r.ticker)}`)}
                      >
                        Otvoriť detail aktíva
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {dividends && dividends.byTicker.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Dividendy podľa spoločností</CardTitle>
            <CardDescription>Historický prehľad vyplatených dividend</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Spoločnosť</TableHead>
                  <TableHead className="text-right">Výplat</TableHead>
                  <TableHead className="text-right">Hrubé</TableHead>
                  <TableHead className="text-right">Daň</TableHead>
                  <TableHead className="text-right">Čisté</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dividends.byTicker.map((item) => (
                  <TableRow key={item.ticker}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <CompanyLogo ticker={item.ticker} companyName={item.companyName} size="sm" />
                        <span className="font-medium">{item.ticker}</span>
                      </div>
                    </TableCell>
                    <TableCell>{item.companyName}</TableCell>
                    <TableCell className="text-right">{item.transactions}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.totalGross)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.totalTax)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(item.totalNet)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
