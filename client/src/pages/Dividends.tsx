import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Banknote, Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  addMonths,
  subMonths,
  startOfDay,
} from "date-fns";
import { sk } from "date-fns/locale";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { CompanyLogo } from "@/components/CompanyLogo";
import type { Transaction } from "@shared/schema";

interface DividendSummary {
  totalGross: number;
  totalTax: number;
  totalNet: number;
  grossYTD: number;
  netYTD: number;
  grossThisMonth: number;
  netThisMonth: number;
  grossToday: number;
  netToday: number;
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

type ExpectedDividendItem = {
  ticker: string;
  companyName: string;
  kind: "ex_dividend" | "payout";
  estimatedGrossInUserCcy: number | null;
};

type DayBucket = {
  net: number;
  items: { ticker: string; companyName: string; net: number; kind: "DIVIDEND" | "TAX" }[];
  expected?: ExpectedDividendItem[];
};

function transactionNetImpact(t: Transaction): number | null {
  if (t.type === "DIVIDEND") {
    const shares = parseFloat(t.shares);
    const dividendPerShare = parseFloat(t.pricePerShare);
    const withhold = parseFloat(t.commission || "0");
    const gross = shares * dividendPerShare;
    return gross - withhold;
  }
  if (t.type === "TAX") {
    const shares = parseFloat(t.shares);
    const pricePerShare = parseFloat(t.pricePerShare);
    return shares * pricePerShare;
  }
  return null;
}

function dayKeyFromTransaction(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return format(startOfDay(date), "yyyy-MM-dd");
}

const WEEKDAYS_SK = ["Po", "Ut", "St", "Št", "Pi", "So", "Ne"];

export default function Dividends() {
  const [, setLocation] = useLocation();
  const { formatCurrency } = useCurrency();
  const { getQueryParam } = usePortfolio();
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));

  const portfolioParam = getQueryParam();

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

  const { data: upcomingDividends } = useQuery<{
    next: unknown;
    all?: Array<{
      ticker: string;
      companyName: string;
      date: string;
      kind: "ex_dividend" | "payout";
      estimatedGrossInUserCcy: number | null;
    }>;
  }>({
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

  const isLoading = dividendsLoading || transactionsLoading;

  const payoutsByDay = useMemo(() => {
    const map = new Map<string, DayBucket>();
    for (const t of transactions) {
      const net = transactionNetImpact(t);
      if (net === null) continue;
      const key = dayKeyFromTransaction(t.transactionDate as unknown as string);
      let b = map.get(key);
      if (!b) {
        b = { net: 0, items: [] };
        map.set(key, b);
      }
      b.net += net;
      b.items.push({
        ticker: t.ticker,
        companyName: t.companyName,
        net,
        kind: t.type === "TAX" ? "TAX" : "DIVIDEND",
      });
    }
    return map;
  }, [transactions]);

  const calendarByDay = useMemo(() => {
    const map = new Map<string, DayBucket>();
    for (const [k, v] of Array.from(payoutsByDay.entries())) {
      map.set(k, { net: v.net, items: [...v.items] });
    }
    for (const ev of upcomingDividends?.all ?? []) {
      const key = ev.date;
      let b = map.get(key);
      if (!b) {
        b = { net: 0, items: [], expected: [] };
        map.set(key, b);
      }
      if (!b.expected) b.expected = [];
      b.expected.push({
        ticker: ev.ticker,
        companyName: ev.companyName,
        kind: ev.kind,
        estimatedGrossInUserCcy: ev.estimatedGrossInUserCcy,
      });
    }
    return map;
  }, [payoutsByDay, upcomingDividends?.all]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(viewMonth);
    const monthEnd = endOfMonth(viewMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [viewMonth]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-96" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[340px] w-full rounded-lg" />
          </CardContent>
        </Card>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const hasDividends = dividends && dividends.transactionCount > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Banknote className="h-6 w-6 text-primary" />
          Dividendy
        </h1>
        <p className="text-muted-foreground">Prehľad príjmov z dividend</p>
      </div>

      <Card data-testid="dividend-calendar">
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarIcon className="h-5 w-5 text-primary" />
                Kalendár výplat
              </CardTitle>
              <CardDescription>
                Skutočné výplaty z histórie (čistá suma za deň). Odhady z Yahoo (ex-dividend / výplata) sú oranžovo — orientačné,
                nie záväzné; závisí od toho, či broker hlási dátum v kalendári.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Predchádzajúci mesiac"
                onClick={() => setViewMonth((m) => subMonths(m, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[11rem] text-center font-medium capitalize">
                {format(viewMonth, "LLLL yyyy", { locale: sk })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Ďalší mesiac"
                onClick={() => setViewMonth((m) => addMonths(m, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <div className="grid grid-cols-7 gap-px bg-border">
              {WEEKDAYS_SK.map((d) => (
                <div key={d} className="bg-muted/50 px-1 py-2 text-center text-xs font-medium text-muted-foreground">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px bg-border">
              {calendarDays.map((day) => {
                  const key = format(startOfDay(day), "yyyy-MM-dd");
                  const bucket = calendarByDay.get(key);
                  const inMonth = isSameMonth(day, viewMonth);
                  const today = isToday(day);
                  const hasActual = bucket && bucket.items.length > 0;
                  const hasExpected = bucket && bucket.expected && bucket.expected.length > 0;
                  const showTooltip = hasActual || hasExpected;

                  const cellInner = (
                    <div
                      className={`min-h-[4.25rem] p-1.5 flex flex-col bg-card ${
                        today ? "ring-1 ring-inset ring-primary/40" : ""
                      } ${!inMonth ? "opacity-40" : ""}`}
                    >
                      <span
                        className={`text-xs font-medium tabular-nums ${inMonth ? "text-foreground" : "text-muted-foreground"}`}
                      >
                        {format(day, "d")}
                      </span>
                      {hasActual && (
                        <span
                          className={`mt-auto text-[11px] font-semibold leading-tight truncate ${
                            bucket!.net >= 0 ? "text-blue-600 dark:text-blue-400" : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {bucket!.net >= 0 ? "+" : ""}
                          {formatCurrency(bucket!.net)}
                        </span>
                      )}
                      {hasExpected && (
                        <span
                          className={`${hasActual ? "mt-0.5" : "mt-auto"} text-[10px] font-medium leading-tight text-amber-700 dark:text-amber-500 truncate`}
                        >
                          {bucket!.expected!.length === 1 &&
                          bucket!.expected![0].estimatedGrossInUserCcy != null &&
                          bucket!.expected![0].estimatedGrossInUserCcy! > 0
                            ? `~ ${formatCurrency(bucket!.expected![0].estimatedGrossInUserCcy!)}`
                            : `~ ${bucket!.expected!.length} očak.`}
                        </span>
                      )}
                    </div>
                  );

                  if (showTooltip) {
                    return (
                      <Tooltip key={key}>
                        <TooltipTrigger asChild>
                          <button type="button" className="text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                            {cellInner}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[300px] p-3">
                          <p className="font-medium mb-2">{format(day, "d. MMMM yyyy", { locale: sk })}</p>
                          {hasActual && (
                            <>
                              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Skutočné</p>
                              <ul className="space-y-1.5 text-sm mb-2">
                                {bucket!.items.map((it, idx) => (
                                  <li key={`${it.ticker}-${idx}`} className="flex justify-between gap-4">
                                    <span className="text-muted-foreground truncate">
                                      {it.kind === "TAX" ? "Daň" : it.ticker}
                                      {it.kind === "DIVIDEND" ? ` · ${it.companyName}` : ""}
                                    </span>
                                    <span
                                      className={`tabular-nums shrink-0 ${it.net >= 0 ? "text-blue-600" : "text-red-600"}`}
                                    >
                                      {it.net >= 0 ? "+" : ""}
                                      {formatCurrency(it.net)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                              <p className="mb-2 pt-2 border-t text-sm font-medium">
                                Spolu: {bucket!.net >= 0 ? "+" : ""}
                                {formatCurrency(bucket!.net)}
                              </p>
                            </>
                          )}
                          {hasExpected && (
                            <>
                              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Odhad (Yahoo)</p>
                              <ul className="space-y-2 text-sm">
                                {bucket!.expected!.map((ex, idx) => (
                                  <li key={`${ex.ticker}-${ex.kind}-${idx}`}>
                                    <button
                                      type="button"
                                      className="flex w-full items-center gap-2 text-left rounded-sm hover:bg-muted/60 -mx-1 px-1 py-0.5"
                                      onClick={() => setLocation(`/asset/${encodeURIComponent(ex.ticker)}`)}
                                    >
                                      <CompanyLogo ticker={ex.ticker} companyName={ex.companyName} size="xs" />
                                      <span className="flex-1 min-w-0">
                                        <span className="font-medium">{ex.ticker}</span>
                                        <span className="text-muted-foreground text-xs block truncate">
                                          {ex.kind === "ex_dividend" ? "Ex-dividend" : "Výplata"} · {ex.companyName}
                                        </span>
                                      </span>
                                      {ex.estimatedGrossInUserCcy != null && ex.estimatedGrossInUserCcy > 0 && (
                                        <span className="tabular-nums text-amber-700 dark:text-amber-500 shrink-0">
                                          ~{formatCurrency(ex.estimatedGrossInUserCcy)}
                                        </span>
                                      )}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    );
                  }

                  return (
                    <div key={key} className="w-full">
                      {cellInner}
                    </div>
                  );
                })}
            </div>
          </div>
          {!hasDividends &&
            (!upcomingDividends?.all || upcomingDividends.all.length === 0) && (
            <p className="mt-4 text-sm text-muted-foreground text-center">
              Po pridaní dividend alebo daňových položiek sa v kalendári zobrazí skutočná výplata. Odhady vyžadujú aspoň jednu
              držanú akciu s dátumom v kalendári Yahoo.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dividendy podľa spoločností</CardTitle>
          <CardDescription>
            Prehľad dividend od jednotlivých spoločností
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasDividends && dividends.byTicker.length > 0 ? (
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
                  <TableRow key={item.ticker} data-testid={`row-dividend-${item.ticker}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <CompanyLogo ticker={item.ticker} companyName={item.companyName} size="sm" />
                        <span className="font-medium">{item.ticker}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px] truncate">{item.companyName}</TableCell>
                    <TableCell className="text-right">{item.transactions}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.totalGross)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatCurrency(item.totalTax)}</TableCell>
                    <TableCell className="text-right font-medium text-blue-500">
                      +{formatCurrency(item.totalNet)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Banknote className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg">Zatiaľ nemáte zaznamenané žiadne dividendy</p>
              <p className="text-sm mt-2">
                Po zadaní dividend v sekcii História tu uvidíte prehľad vašich príjmov.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {hasDividends && dividends && (
        <Card>
          <CardHeader>
            <CardTitle>Súhrn</CardTitle>
            <CardDescription>Celkový prehľad dividendových príjmov</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Celkové hrubé dividendy</p>
                <p className="text-xl font-semibold">{formatCurrency(dividends.totalGross)}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Zrazená daň</p>
                <p className="text-xl font-semibold text-red-500">-{formatCurrency(dividends.totalTax)}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Čisté dividendy</p>
                <p className="text-xl font-semibold text-blue-500">+{formatCurrency(dividends.totalNet)}</p>
              </div>
            </div>
            <div className="mt-6 pt-6 border-t">
              <p className="text-sm text-muted-foreground">
                Celkový počet dividendových výplat:{" "}
                <span className="font-medium text-foreground">{dividends.transactionCount}</span>
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
