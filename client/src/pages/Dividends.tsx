import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Banknote, ChevronDown, ChevronRight } from "lucide-react";
import { addMonths, differenceInCalendarDays, format, startOfMonth } from "date-fns";
import { sk } from "date-fns/locale";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { CompanyLogo } from "@/components/CompanyLogo";
import type { Holding, Transaction } from "@shared/schema";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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

export default function Dividends() {
  const [, setLocation] = useLocation();
  const { formatCurrency } = useCurrency();
  const { getQueryParam } = usePortfolio();
  const portfolioParam = getQueryParam();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  const forecastBars = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 12 }).map((_, i) => startOfMonth(addMonths(now, i)));
    const monthKey = (d: Date) => format(d, "yyyy-MM");
    const map = new Map<string, { monthLabel: string; confirmed: number; estimated: number }>();
    for (const m of months) {
      map.set(monthKey(m), {
        monthLabel: format(m, "LLL", { locale: sk }),
        confirmed: 0,
        estimated: 0,
      });
    }

    for (const ev of upcomingDividends?.all ?? []) {
      if (ev.kind !== "payout") continue;
      const d = new Date(`${ev.date}T12:00:00`);
      const key = monthKey(startOfMonth(d));
      const row = map.get(key);
      if (!row) continue;
      const amount = ev.estimatedGrossInUserCcy ?? 0;
      if (ev.confirmed) row.confirmed += amount;
      else row.estimated += amount;
    }

    // fallback estimate from last 12M realized dividends projected one year ahead
    for (const t of transactions) {
      if (t.type !== "DIVIDEND") continue;
      const d = new Date(t.transactionDate as unknown as string);
      const projected = addMonths(d, 12);
      const key = monthKey(startOfMonth(projected));
      const row = map.get(key);
      if (!row) continue;
      const net = parseFloat(String(t.shares ?? "0")) * parseFloat(String(t.pricePerShare ?? "0")) - parseFloat(String(t.commission ?? "0"));
      if (Number.isFinite(net)) row.estimated += Math.max(0, net);
    }

    return Array.from(map.values());
  }, [transactions, upcomingDividends?.all]);

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

    rows.sort((a, b) => {
      const da = new Date(`${a.exDate || a.paymentDate || "2100-01-01"}T12:00:00`).getTime();
      const db = new Date(`${b.exDate || b.paymentDate || "2100-01-01"}T12:00:00`).getTime();
      return da - db;
    });
    return rows;
  }, [upcomingDividends?.all, holdingsByTicker]);

  const statusLabel = (s: FeedStatus) =>
    s === "UPCOMING" ? "Upcoming" : s === "PENDING" ? "Pending" : s === "REINVESTED" ? "Reinvested" : "Paid";

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
          <CardTitle>Forward Income Timeline (12M)</CardTitle>
          <CardDescription>Zelené = confirmed, svetlé = estimated</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={forecastBars}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="monthLabel" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="confirmed" stackId="a" fill="#16a34a" name="Confirmed" />
                <Bar dataKey="estimated" stackId="a" fill="#86efac" name="Estimated" />
              </BarChart>
            </ResponsiveContainer>
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
