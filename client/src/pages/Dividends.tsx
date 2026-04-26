import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Banknote, ChevronLeft, ChevronRight } from "lucide-react";
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
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { CompanyLogo } from "@/components/CompanyLogo";
import type { Holding, Transaction } from "@shared/schema";
import {
  CASH_INTEREST_DISPLAY_NAME,
  CASH_INTEREST_TAX_DISPLAY_NAME,
  CASH_INTEREST_TICKER,
} from "@shared/tickerCurrency";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { HelpTip } from "@/components/HelpTip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

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

type YearMonthBarRow = {
  monthIndex: number;
  label: string;
  paid: number;
  confirmed: number;
  estimated: number;
  total: number;
};

type MonthChartBreakdownEntry = {
  ticker: string;
  companyName: string;
  amount: number;
  badge: "Potvrdené" | "Odhad";
};

type CalendarRow = {
  ticker: string;
  companyName: string;
  gross: number;
  tax: number;
  net: number;
  /** Skutočná výplata z histórie vs. odhad z kalendára Yahoo */
  source: "paid" | "forecast";
};

export default function Dividends() {
  const { formatCurrency } = useCurrency();
  const { getQueryParam } = usePortfolio();
  const portfolioParam = getQueryParam();
  /** Kalendárny rok pre hlavný stĺpcový graf (Jan–Dec). */
  const [chartYear, setChartYear] = useState(() => new Date().getFullYear());
  /** Vybraný mesiac v grafe 0–11 alebo null. */
  const [selectedBarMonth, setSelectedBarMonth] = useState<number | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [calendarDaySheetOpen, setCalendarDaySheetOpen] = useState(false);
  const [calendarSelectedDay, setCalendarSelectedDay] = useState<{
    day: Date;
    bucket: { totalNet: number; rows: CalendarRow[] } | null;
  } | null>(null);

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

  /** Ročná dividenda na akciu z Yahoo (summaryDetail), ak ju API vráti. */
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

  /**
   * Yahoo trailing yield (%) z toho istého zdroja — keď nie je dividendRate, stále vieme odhadnúť ročný cash flow.
   */
  const dividendYieldPctByTicker = useMemo(() => {
    const m = new Map<string, number>();
    for (const ev of upcomingDividends?.all ?? []) {
      const t = ev.ticker.toUpperCase();
      if (ev.dividendYieldCurrent != null && Number.isFinite(ev.dividendYieldCurrent) && ev.dividendYieldCurrent > 0) {
        m.set(t, Math.max(m.get(t) ?? 0, ev.dividendYieldCurrent));
      }
    }
    return m;
  }, [upcomingDividends?.all]);

  /**
   * Súčet čistých dividend za posledných 12 mesiacov podľa tickeru.
   * Použité keď Yahoo nevráti kalendár / annualDividend (časté u EU titulov alebo keď sú len minulé výplaty).
   */
  const trailing12mNetByTicker = useMemo(() => {
    const cutoff = subMonths(startOfDay(new Date()), 12);
    const m = new Map<string, number>();
    for (const t of transactions) {
      if (t.type !== "DIVIDEND") continue;
      const d = startOfDay(new Date(t.transactionDate as unknown as string));
      if (d < cutoff) continue;
      const ticker = (t.ticker || "N/A").toUpperCase();
      const gross =
        parseFloat(String(t.shares ?? "0")) * parseFloat(String(t.pricePerShare ?? "0"));
      const taxOrFee = parseFloat(String(t.commission ?? "0"));
      const net = gross - taxOrFee;
      if (!Number.isFinite(net)) continue;
      m.set(ticker, (m.get(ticker) ?? 0) + net);
    }
    return m;
  }, [transactions]);

  const yieldMetrics = useMemo(() => {
    let totalCurrentValue = 0;
    let totalInvested = 0;
    let annualIncome = 0;

    for (const [ticker, h] of Array.from(holdingsByTicker.entries())) {
      const q = quotes[ticker];
      const annPerShare = annualDivByTicker.get(ticker) ?? 0;
      const yieldPct = dividendYieldPctByTicker.get(ticker);
      const trailing12m = trailing12mNetByTicker.get(ticker) ?? 0;

      let annualCash = 0;
      if (annPerShare > 0) {
        annualCash = annPerShare * h.shares;
      } else if (yieldPct != null && yieldPct > 0 && q && Number.isFinite(q.price) && q.price > 0) {
        annualCash = (yieldPct / 100) * q.price * h.shares;
      } else if (trailing12m > 0) {
        annualCash = trailing12m;
      } else {
        continue;
      }

      const marketValue = q && Number.isFinite(q.price) && q.price > 0 ? q.price * h.shares : 0;
      const costBasis = h.avgCost * h.shares;

      totalInvested += Number.isFinite(costBasis) && costBasis > 0 ? costBasis : 0;
      annualIncome += annualCash;

      if (marketValue > 0) {
        totalCurrentValue += marketValue;
      } else if (annualCash > 0 && Number.isFinite(costBasis) && costBasis > 0) {
        /* Bez live ceny (zlyhanie quote) použijeme cost basis ako hrubý menovateľ pre „aktuálny“ yield. */
        totalCurrentValue += costBasis;
      }
    }

    return {
      dividendYieldCurrent: totalCurrentValue > 0 ? (annualIncome / totalCurrentValue) * 100 : 0,
      yieldOnCost: totalInvested > 0 ? (annualIncome / totalInvested) * 100 : 0,
      annualIncome,
    };
  }, [annualDivByTicker, dividendYieldPctByTicker, trailing12mNetByTicker, holdingsByTicker, quotes]);

  const { yearlyBars, yearlyBreakdownByMonth } = useMemo(() => {
    const y = chartYear;
    const todayStart = startOfDay(new Date());
    const rows: YearMonthBarRow[] = [];
    const rawBreakdown: MonthChartBreakdownEntry[][] = Array.from({ length: 12 }, () => []);

    const pushBreakdown = (mi: number, entry: MonthChartBreakdownEntry) => {
      if (mi < 0 || mi > 11) return;
      rawBreakdown[mi].push(entry);
    };

    for (let mi = 0; mi < 12; mi++) {
      const d = new Date(y, mi, 1);
      rows.push({
        monthIndex: mi,
        label: format(d, "LLL", { locale: sk }),
        paid: 0,
        confirmed: 0,
        estimated: 0,
        total: 0,
      });
    }

    /** ticker UPPER + "-" + mesiac 0–11 — už vyplatené v danom roku (skutočná transakcia). */
    const paidMonthTicker = new Set<string>();
    for (const t of transactions) {
      if (t.type !== "DIVIDEND") continue;
      const dt = new Date(t.transactionDate as unknown as string);
      if (dt.getFullYear() !== y) continue;
      const mi = dt.getMonth();
      const net =
        parseFloat(String(t.shares ?? "0")) * parseFloat(String(t.pricePerShare ?? "0")) -
        parseFloat(String(t.commission ?? "0"));
      if (!Number.isFinite(net)) continue;
      const n = Math.max(0, net);
      rows[mi].paid += n;
      paidMonthTicker.add(`${(t.ticker || "N/A").toUpperCase()}-${mi}`);
      const tkr = t.ticker || "N/A";
      const isXtbCashInt = tkr.toUpperCase() === CASH_INTEREST_TICKER;
      pushBreakdown(mi, {
        ticker: tkr,
        companyName: isXtbCashInt
          ? CASH_INTEREST_DISPLAY_NAME
          : (t.companyName || tkr || "N/A").trim(),
        amount: n,
        badge: "Potvrdené",
      });
    }

    /** Mesiac už pokrytý Yahoo udalosťou (aby sme nepričítali +12m odhad navyše). */
    const upcomingMonthTicker = new Set<string>();

    for (const ev of upcomingDividends?.all ?? []) {
      const amount = ev.estimatedGrossInUserCcy ?? 0;
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const dateIso =
        ev.kind === "payout"
          ? ev.paymentDate || ev.date
          : ev.paymentDate || ev.exDate || ev.date;
      if (!dateIso) continue;
      const pd = new Date(`${dateIso}T12:00:00`);
      if (pd.getFullYear() !== y) continue;
      const mi = pd.getMonth();
      const eventDay = startOfDay(pd);
      /**
       * Odhad len pre budúcnosť (vrátane dnes). V minulosti už buď máš výplatu v transakciách (paid),
       * alebo nechceme „Odhad“ za skutočne uplynulé obdobie.
       */
      if (!ev.confirmed && eventDay < todayStart) continue;

      upcomingMonthTicker.add(`${ev.ticker.toUpperCase()}-${mi}`);

      if (ev.confirmed) {
        rows[mi].confirmed += amount;
        pushBreakdown(mi, {
          ticker: ev.ticker,
          companyName: ev.companyName,
          amount,
          badge: "Potvrdené",
        });
      } else {
        rows[mi].estimated += amount;
        pushBreakdown(mi, {
          ticker: ev.ticker,
          companyName: ev.companyName,
          amount,
          badge: "Odhad",
        });
      }
    }

    /* Odhad z histórie: rovnaký mesiac o +12 mesiacov, ak v tom mesiaci už nie je výplata ani Yahoo. */
    for (const t of transactions) {
      if (t.type !== "DIVIDEND") continue;
      const d0 = new Date(t.transactionDate as unknown as string);
      const projected = addMonths(startOfDay(d0), 12);
      if (projected < todayStart) continue;
      if (projected.getFullYear() !== y) continue;
      const mi = projected.getMonth();
      const tickerU = (t.ticker || "N/A").toUpperCase();
      const mtKey = `${tickerU}-${mi}`;
      if (paidMonthTicker.has(mtKey) || upcomingMonthTicker.has(mtKey)) continue;
      const net =
        parseFloat(String(t.shares ?? "0")) * parseFloat(String(t.pricePerShare ?? "0")) -
        parseFloat(String(t.commission ?? "0"));
      if (!Number.isFinite(net)) continue;
      const n = Math.max(0, net);
      if (n <= 0) continue;
      rows[mi].estimated += n;
      upcomingMonthTicker.add(mtKey);
      const tkrP = t.ticker || "N/A";
      const isXtbCiP = tkrP.toUpperCase() === CASH_INTEREST_TICKER;
      pushBreakdown(mi, {
        ticker: tkrP,
        companyName: isXtbCiP
          ? CASH_INTEREST_DISPLAY_NAME
          : (t.companyName || tkrP || "N/A").trim(),
        amount: n,
        badge: "Odhad",
      });
    }

    rows.forEach((r) => {
      r.total = r.paid + r.confirmed + r.estimated;
    });

    const mergeBreakdown = (entries: MonthChartBreakdownEntry[]): MonthChartBreakdownEntry[] => {
      const m = new Map<string, MonthChartBreakdownEntry>();
      for (const e of entries) {
        const key = `${e.ticker.toUpperCase()}\0${e.badge}`;
        const prev = m.get(key);
        if (prev) prev.amount += e.amount;
        else m.set(key, { ...e, ticker: e.ticker, amount: e.amount });
      }
      return Array.from(m.values()).sort((a, b) => b.amount - a.amount);
    };

    return {
      yearlyBars: rows,
      yearlyBreakdownByMonth: rawBreakdown.map(mergeBreakdown),
    };
  }, [chartYear, transactions, upcomingDividends?.all]);

  const yearlyGrandTotal = useMemo(
    () => yearlyBars.reduce((sum, r) => sum + r.total, 0),
    [yearlyBars],
  );

  /** Spojenie všetkých mesiacov roka: rovnaký ticker + badge → jeden riadok so sčítanou sumou. */
  const yearlyBreakdownFullYear = useMemo(() => {
    const m = new Map<string, MonthChartBreakdownEntry>();
    for (const monthEntries of yearlyBreakdownByMonth) {
      for (const e of monthEntries) {
        const key = `${e.ticker.toUpperCase()}\0${e.badge}`;
        const prev = m.get(key);
        if (prev) prev.amount += e.amount;
        else m.set(key, { ...e, ticker: e.ticker, amount: e.amount });
      }
    }
    return Array.from(m.values()).sort((a, b) => b.amount - a.amount);
  }, [yearlyBreakdownByMonth]);

  const calendarByDay = useMemo(() => {
    const map = new Map<string, { totalNet: number; rows: CalendarRow[] }>();
    const upsert = (
      dayIso: string,
      ticker: string,
      companyName: string,
      gross: number,
      tax: number,
      net: number,
      source: CalendarRow["source"],
    ) => {
      const d = map.get(dayIso) ?? { totalNet: 0, rows: [] };
      let row = d.rows.find((r) => r.ticker === ticker && r.source === source);
      if (!row) {
        row = { ticker, companyName, gross: 0, tax: 0, net: 0, source };
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
      const companyName =
        ticker.toUpperCase() === CASH_INTEREST_TICKER
          ? t.type === "TAX"
            ? CASH_INTEREST_TAX_DISPLAY_NAME
            : CASH_INTEREST_DISPLAY_NAME
          : t.companyName || ticker;
      if (t.type === "DIVIDEND") {
        const shares = parseFloat(String(t.shares ?? "0"));
        const dps = parseFloat(String(t.pricePerShare ?? "0"));
        const tax = Math.abs(parseFloat(String(t.commission ?? "0")));
        const gross = Number.isFinite(shares) && Number.isFinite(dps) ? shares * dps : 0;
        const net = gross - tax;
        upsert(dayIso, ticker, companyName, gross, tax, net, "paid");
      } else if (t.type === "TAX") {
        const shares = parseFloat(String(t.shares ?? "0"));
        const pps = parseFloat(String(t.pricePerShare ?? "0"));
        const taxOnly = Math.abs(Number.isFinite(shares) && Number.isFinite(pps) ? shares * pps : 0);
        upsert(dayIso, ticker, companyName, 0, taxOnly, -taxOnly, "paid");
      }
    }

    const todayIso = format(startOfDay(new Date()), "yyyy-MM-dd");
    const forecastDayTicker = new Set<string>();

    for (const ev of upcomingDividends?.all ?? []) {
      const est = ev.estimatedGrossInUserCcy;
      if (est == null || !Number.isFinite(est) || est <= 0) continue;
      const dayIso =
        ev.kind === "payout"
          ? ev.paymentDate || ev.date
          : ev.paymentDate || ev.exDate || ev.date;
      if (!dayIso || dayIso < todayIso) continue;
      const k = `${ev.ticker.toUpperCase()}-${dayIso}`;
      forecastDayTicker.add(k);
      upsert(dayIso, ev.ticker, ev.companyName, est, 0, est, "forecast");
    }

    for (const t of transactions) {
      if (t.type !== "DIVIDEND") continue;
      const d0 = startOfDay(new Date(t.transactionDate as unknown as string));
      const projected = addMonths(d0, 12);
      const dayIso = format(projected, "yyyy-MM-dd");
      if (dayIso < todayIso) continue;
      const ticker = t.ticker || "N/A";
      const tickerU = ticker.toUpperCase();
      const k = `${tickerU}-${dayIso}`;
      if (forecastDayTicker.has(k)) continue;
      const bucket = map.get(dayIso);
      const hasPaidSameTicker = bucket?.rows.some(
        (r) => r.ticker.toUpperCase() === tickerU && r.source === "paid",
      );
      if (hasPaidSameTicker) continue;
      forecastDayTicker.add(k);
      const shares = parseFloat(String(t.shares ?? "0"));
      const dps = parseFloat(String(t.pricePerShare ?? "0"));
      const tax = Math.abs(parseFloat(String(t.commission ?? "0")));
      const gross = Number.isFinite(shares) && Number.isFinite(dps) ? shares * dps : 0;
      const net = gross - tax;
      if (!Number.isFinite(net) || net <= 0) continue;
      const fcName =
        ticker.toUpperCase() === CASH_INTEREST_TICKER
          ? CASH_INTEREST_DISPLAY_NAME
          : t.companyName || ticker;
      upsert(dayIso, ticker, fcName, gross, tax, net, "forecast");
    }

    Array.from(map.values()).forEach((v) => {
      v.rows.sort((a: CalendarRow, b: CalendarRow) => b.net - a.net);
    });
    return map;
  }, [transactions, upcomingDividends?.all]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(calendarMonth);
    const monthEnd = endOfMonth(calendarMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [calendarMonth]);

  const openCalendarDayDetail = (day: Date) => {
    const dayIso = format(startOfDay(day), "yyyy-MM-dd");
    setCalendarSelectedDay({ day, bucket: calendarByDay.get(dayIso) ?? null });
    setCalendarDaySheetOpen(true);
  };

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
    <div className="space-y-4 md:space-y-6 pb-6 md:pb-8 px-0 sm:px-0">
      <div>
        <h1
          className="text-xl sm:text-2xl font-bold flex items-center gap-2 flex-wrap"
          data-testid="text-page-title"
        >
          <Banknote className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
          Dividendy
          <HelpTip title="Stránka Dividendy">
            <p>
              Prehľad dividend podľa zvoleného portfólia: interaktívny kalendár, ročný graf, odhad príjmu a
              výnosové metriky. Čerpá sa z vašich transakcií a z verejných údajov o plánovaných výplatách.
            </p>
          </HelpTip>
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground mt-1">
          Kalendár, ročný prehľad a yield analytika
        </p>
      </div>

      <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
        <Card className="shadow-sm">
          <CardContent className="px-2 py-2 sm:px-6 sm:py-5">
            <p className="text-[9px] sm:text-xs text-muted-foreground leading-tight line-clamp-2 sm:line-clamp-none flex items-center gap-1">
              <span className="min-w-0">
                <span className="sm:hidden">12M príjem</span>
                <span className="hidden sm:inline">Forward 12M príjem</span>
              </span>
              <HelpTip title="Forward 12M príjem">
                <p>
                  Orientačný ročný čistý príjem z dividend na základe aktuálnych pozícií: údaje z Yahoo (sadzba
                  alebo výnos), prípadne posledných 12 mesiacov skutočných výplat, ak kalendár chýba.
                </p>
              </HelpTip>
            </p>
            <p className="text-[11px] sm:text-xl font-semibold tabular-nums leading-tight mt-0.5 sm:mt-1 break-all sm:break-normal">
              {formatCurrency(yieldMetrics.annualIncome)}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="px-2 py-2 sm:px-6 sm:py-5">
            <p className="text-[9px] sm:text-xs text-muted-foreground leading-tight line-clamp-2 sm:line-clamp-none flex items-center gap-1">
              <span className="min-w-0">
                <span className="sm:hidden">Yield</span>
                <span className="hidden sm:inline">Dividend Yield (aktuálny)</span>
              </span>
              <HelpTip title="Dividend yield (aktuálny)">
                <p>
                  Pomer očakávaného ročného dividendového príjmu k aktuálnej trhovej hodnote držaných akcií. Ak
                  nie je dostupná live cena, použije sa približne nákladová hodnota.
                </p>
              </HelpTip>
            </p>
            <p className="text-[11px] sm:text-xl font-semibold tabular-nums leading-tight mt-0.5 sm:mt-1">
              {yieldMetrics.dividendYieldCurrent.toFixed(2)}%
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="px-2 py-2 sm:px-6 sm:py-5">
            <p className="text-[9px] sm:text-xs text-muted-foreground leading-tight line-clamp-2 sm:line-clamp-none flex items-center gap-1">
              <span className="min-w-0">
                <span className="sm:hidden">YOC</span>
                <span className="hidden sm:inline">Yield on Cost (YOC)</span>
              </span>
              <HelpTip title="Yield on Cost (YOC)">
                <p>
                  Výnos voči pôvodným investovaným nákladom (priemerná cena × počet akcií), nie voči dnešnej
                  trhovej cene. Ukáže, aký „úrok“ z pôvodnej investície dividendy predstavujú.
                </p>
              </HelpTip>
            </p>
            <p className="text-[11px] sm:text-xl font-semibold tabular-nums leading-tight mt-0.5 sm:mt-1">
              {yieldMetrics.yieldOnCost.toFixed(2)}%
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="px-3 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base sm:text-lg flex items-center gap-1 flex-wrap">
                Dividendový kalendár (interaktívny)
                <HelpTip title="Dividendový kalendár">
                  <p>
                    Mesačný pohľad na dni so skutočnými výplatami z histórie a plánovanými udalosťami (vrátane
                    odhadov). Kliknutím na deň zobrazíte detail podľa titulu.
                  </p>
                </HelpTip>
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Klikni na deň — zobrazia sa logá, sumy a plánované výplaty (odhad).
              </CardDescription>
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
        <CardContent className="px-3 sm:px-6">
          <div className="rounded-lg border overflow-hidden touch-manipulation">
            <div className="grid grid-cols-7 gap-px bg-border">
              {["Po", "Ut", "St", "Št", "Pi", "So", "Ne"].map((d) => (
                <div
                  key={d}
                  className="bg-muted/50 px-0.5 py-1.5 sm:py-2 text-center text-[10px] sm:text-xs font-medium text-muted-foreground"
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px bg-border">
              {calendarDays.map((day) => {
                const dayIso = format(startOfDay(day), "yyyy-MM-dd");
                const bucket = calendarByDay.get(dayIso);
                const inMonth = isSameMonth(day, calendarMonth);
                const logoRows = bucket?.rows ?? [];
                const showLogos = logoRows.length > 0;
                return (
                  <button
                    key={dayIso}
                    type="button"
                    onClick={() => openCalendarDayDetail(day)}
                    className={`w-full min-h-[4rem] sm:min-h-[5rem] p-1 sm:p-1.5 flex flex-col items-stretch text-left bg-card active:bg-muted/60 transition-colors ${!inMonth ? "opacity-40" : ""} ${isToday(day) ? "ring-1 ring-inset ring-primary/50 z-[1]" : ""}`}
                  >
                    <span
                      className={`text-[11px] sm:text-xs font-medium leading-none ${inMonth ? "text-foreground" : "text-muted-foreground"}`}
                    >
                      {format(day, "d")}
                    </span>
                    {showLogos && (
                      <div className="flex items-center mt-0.5 min-h-[1.25rem]">
                        <div className="flex items-center pl-0.5">
                          {logoRows.slice(0, 3).map((r, idx) => (
                            <span
                              key={`${dayIso}-${r.ticker}-${r.source}-${idx}`}
                              className="-ml-1 first:ml-0 ring-2 ring-card rounded-full bg-card shrink-0"
                              style={{ zIndex: 3 - idx }}
                            >
                              <CompanyLogo ticker={r.ticker} companyName={r.companyName} size="xs" />
                            </span>
                          ))}
                        </div>
                        {logoRows.length > 3 && (
                          <span className="text-[9px] sm:text-[10px] text-muted-foreground font-medium ml-0.5 shrink-0">
                            +{logoRows.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                    {bucket && (
                      <span
                        className={`mt-auto text-[9px] sm:text-[11px] font-semibold truncate leading-tight ${bucket.totalNet >= 0 ? "text-blue-600 dark:text-blue-400" : "text-red-600"}`}
                      >
                        {bucket.totalNet >= 0 ? "+" : ""}
                        {formatCurrency(bucket.totalNet)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-3 sm:px-6 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-base sm:text-lg leading-snug flex items-center gap-1 flex-wrap">
                Dividendy podľa mesiacov
                <HelpTip title="Graf podľa mesiacov">
                  <p>
                    Stĺce za kalendárny rok: modrá — už vyplatené z transakcií, zelená — potvrdené budúce výplaty,
                    svetlozelená — odhad. Kliknutím na mesiac rozbalíte zoznam podľa spoločností.
                  </p>
                </HelpTip>
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Kalendárny rok (január–december), sumy v EUR. Klikni na stĺpec pre detail.
              </CardDescription>
            </div>
            <div className="flex items-center justify-center sm:justify-end gap-1 sm:gap-2 shrink-0">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 sm:h-9 sm:w-9"
                aria-label="Predchádzajúci rok"
                onClick={() => {
                  setChartYear((yy) => yy - 1);
                  setSelectedBarMonth(null);
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[4.5rem] sm:min-w-[5.5rem] text-center text-sm sm:text-base font-semibold tabular-nums">
                {chartYear}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 sm:h-9 sm:w-9"
                aria-label="Nasledujúci rok"
                onClick={() => {
                  setChartYear((yy) => yy + 1);
                  setSelectedBarMonth(null);
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs sm:text-sm h-8 px-2 sm:px-3"
                onClick={() => {
                  const y = new Date().getFullYear();
                  setChartYear(y);
                  setSelectedBarMonth(null);
                }}
              >
                Dnes
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-2 sm:px-6">
          {(() => {
            const today = new Date();
            const isCurrentMonthBar = (monthIndex: number) =>
              chartYear === today.getFullYear() && monthIndex === today.getMonth();
            const handleBarClick = (_: unknown, index: number) => {
              if (typeof index === "number" && index >= 0 && index < 12) {
                setSelectedBarMonth((prev) => (prev === index ? null : index));
              }
            };
            const axisEur = (v: number) => {
              if (!Number.isFinite(v)) return "";
              if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
              return `${Math.round(v)}`;
            };
            return (
              <>
                <div className="h-[200px] sm:h-[280px] w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={yearlyBars}
                      margin={{ top: 8, right: 4, left: 0, bottom: 4 }}
                      barCategoryGap="12%"
                      barGap={2}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 9 }}
                        interval={0}
                        tickMargin={6}
                        className="text-muted-foreground"
                      />
                      <YAxis
                        tick={{ fontSize: 9 }}
                        width={32}
                        tickFormatter={axisEur}
                        className="text-muted-foreground"
                        allowDecimals={false}
                      />
                      <RTooltip
                        formatter={(value: number | string, name: string) => [
                          formatCurrency(Number(value)),
                          name === "paid"
                            ? "Vyplatené"
                            : name === "confirmed"
                              ? "Potvrdené (čaká)"
                              : "Odhad",
                        ]}
                        labelFormatter={(_, payload) => {
                          const p = payload?.[0]?.payload as YearMonthBarRow | undefined;
                          if (!p) return "";
                          const cap = format(new Date(chartYear, p.monthIndex, 1), "LLLL", { locale: sk });
                          return cap.charAt(0).toUpperCase() + cap.slice(1);
                        }}
                      />
                      <Bar
                        dataKey="paid"
                        stackId="stack"
                        name="paid"
                        maxBarSize={48}
                        onClick={handleBarClick}
                        style={{ cursor: "pointer" }}
                      >
                        {yearlyBars.map((_, i) => (
                          <Cell
                            key={`p-${i}`}
                            fill={isCurrentMonthBar(i) ? "#1d4ed8" : "#2563eb"}
                            style={
                              isCurrentMonthBar(i)
                                ? { filter: "drop-shadow(0 0 6px rgba(37, 99, 235, 0.55))" }
                                : undefined
                            }
                          />
                        ))}
                      </Bar>
                      <Bar
                        dataKey="confirmed"
                        stackId="stack"
                        name="confirmed"
                        maxBarSize={48}
                        onClick={handleBarClick}
                        style={{ cursor: "pointer" }}
                      >
                        {yearlyBars.map((_, i) => (
                          <Cell
                            key={`c-${i}`}
                            fill={isCurrentMonthBar(i) ? "#15803d" : "#16a34a"}
                            style={
                              isCurrentMonthBar(i)
                                ? { filter: "drop-shadow(0 0 6px rgba(22, 163, 74, 0.5))" }
                                : undefined
                            }
                          />
                        ))}
                      </Bar>
                      <Bar
                        dataKey="estimated"
                        stackId="stack"
                        name="estimated"
                        maxBarSize={48}
                        radius={[6, 6, 0, 0]}
                        onClick={handleBarClick}
                        style={{ cursor: "pointer" }}
                      >
                        {yearlyBars.map((_, i) => (
                          <Cell
                            key={`e-${i}`}
                            fill={isCurrentMonthBar(i) ? "#4ade80" : "#86efac"}
                            style={
                              isCurrentMonthBar(i)
                                ? { filter: "drop-shadow(0 0 6px rgba(74, 222, 128, 0.55))" }
                                : undefined
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-1 text-[10px] sm:text-xs text-muted-foreground text-center sm:text-left flex items-center justify-center sm:justify-start gap-1 flex-wrap">
                  <span>Os Y: súčet v EUR (škála sa prispôsobí výške stĺpcov).</span>
                  <HelpTip title="Os Y v grafe">
                    <p>Hodnoty sú v meny používateľa (EUR). Osa sa škáluje podľa maxima v danom roku.</p>
                  </HelpTip>
                </p>

                <div
                  className="mt-4 rounded-xl border bg-muted/20 p-3 sm:p-4 animate-in fade-in slide-in-from-top-2 duration-200"
                  data-testid="dividend-month-detail"
                >
                  {selectedBarMonth == null ? (
                    <>
                      <h3 className="text-sm sm:text-base font-semibold flex items-center gap-1 flex-wrap">
                        Rok {chartYear}: Celkovo{" "}
                        <span className="tabular-nums">{formatCurrency(yearlyGrandTotal)}</span>
                        <HelpTip title="Súhrn za rok">
                          <p>
                            Spojenie všetkých mesiacov roka: rovnaký ticker a typ (potvrdené vs. odhad) sa v zozname
                            zlučuje do jedného riadku so sčítanou sumou.
                          </p>
                        </HelpTip>
                      </h3>
                      <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">
                        Súhrn za celý vybraný rok. Klikni na stĺpec v grafe pre detail konkrétneho mesiaca.
                      </p>
                      <ul className="mt-3 max-h-[min(50vh,22rem)] overflow-y-auto space-y-2 pr-1">
                        {yearlyBreakdownFullYear.length === 0 ? (
                          <li className="text-sm text-muted-foreground py-2">V tomto roku nie sú v dátach žiadne dividendy.</li>
                        ) : (
                          yearlyBreakdownFullYear.map((row, liIdx) => (
                            <li
                              key={`yr-${row.ticker}-${row.badge}-${liIdx}`}
                              className="flex items-center gap-2 sm:gap-3 rounded-lg border bg-card px-2 py-2 sm:px-3"
                            >
                              <CompanyLogo ticker={row.ticker} companyName={row.companyName} size="sm" className="shrink-0" />
                              <div className="min-w-0 flex-1">
                                <span className="font-medium text-sm">{row.ticker}</span>
                                <span className="text-xs text-muted-foreground truncate block">{row.companyName}</span>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-sm font-semibold tabular-nums">{formatCurrency(row.amount)}</div>
                                <Badge
                                  variant={row.badge === "Potvrdené" ? "default" : "secondary"}
                                  className="text-[10px] mt-0.5"
                                >
                                  {row.badge}
                                </Badge>
                              </div>
                            </li>
                          ))
                        )}
                      </ul>
                    </>
                  ) : (
                    <>
                      <h3 className="text-sm sm:text-base font-semibold capitalize flex items-center gap-1 flex-wrap">
                        {format(new Date(chartYear, selectedBarMonth, 1), "LLLL yyyy", { locale: sk })}: Celkovo{" "}
                        <span className="tabular-nums">{formatCurrency(yearlyBars[selectedBarMonth]?.total ?? 0)}</span>
                        <HelpTip title="Detail mesiaca">
                          <p>Zoznam dividend v danom mesiaci podľa zdroja v grafe (vyplatené, potvrdené, odhad).</p>
                        </HelpTip>
                      </h3>
                      <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">
                        {yearlyBreakdownByMonth[selectedBarMonth]?.length
                          ? "Detail mesiaca. Klikni znova na rovnaký stĺpec pre návrat na celý rok."
                          : "V tomto mesiaci nie sú žiadne dividendy v dátach."}
                      </p>
                      <ul className="mt-3 max-h-[min(50vh,22rem)] overflow-y-auto space-y-2 pr-1">
                        {yearlyBreakdownByMonth[selectedBarMonth]?.map((row, liIdx) => (
                          <li
                            key={`mo-${row.ticker}-${row.badge}-${liIdx}`}
                            className="flex items-center gap-2 sm:gap-3 rounded-lg border bg-card px-2 py-2 sm:px-3"
                          >
                            <CompanyLogo ticker={row.ticker} companyName={row.companyName} size="sm" className="shrink-0" />
                            <div className="min-w-0 flex-1">
                              <span className="font-medium text-sm">{row.ticker}</span>
                              <span className="text-xs text-muted-foreground truncate block">{row.companyName}</span>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-sm font-semibold tabular-nums">{formatCurrency(row.amount)}</div>
                              <Badge
                                variant={row.badge === "Potvrdené" ? "default" : "secondary"}
                                className="text-[10px] mt-0.5"
                              >
                                {row.badge}
                              </Badge>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </>
            );
          })()}
        </CardContent>
      </Card>

      {dividends && dividends.byTicker.length > 0 && (
        <Card>
          <CardHeader className="px-3 sm:px-6">
            <CardTitle className="text-base sm:text-lg flex items-center gap-1 flex-wrap">
              Dividendy podľa spoločností
              <HelpTip title="Tabuľka podľa spoločností">
                <p>
                  Súhrn všetkých dividendových výplat v histórii: počet výplat, hrubá suma, zrazená daň a čistá
                  čiastka podľa tickeru. Respektuje aktuálny výber portfólia.
                </p>
              </HelpTip>
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">Historický prehľad vyplatených dividend</CardDescription>
          </CardHeader>
          <CardContent className="px-3 sm:px-6">
            <div className="md:hidden space-y-2">
              {dividends.byTicker.map((item) => (
                <div key={item.ticker} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <CompanyLogo ticker={item.ticker} companyName={item.companyName} size="sm" />
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{item.ticker}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2">{item.companyName}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <span className="text-muted-foreground">Výplat</span>
                    <span className="text-right tabular-nums">{item.transactions}</span>
                    <span className="text-muted-foreground">Hrubé</span>
                    <span className="text-right tabular-nums">{formatCurrency(item.totalGross)}</span>
                    <span className="text-muted-foreground">Daň</span>
                    <span className="text-right tabular-nums">{formatCurrency(item.totalTax)}</span>
                    <span className="text-muted-foreground">Čisté</span>
                    <span className="text-right font-medium tabular-nums">{formatCurrency(item.totalNet)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden md:block overflow-x-auto rounded-md border">
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
            </div>
          </CardContent>
        </Card>
      )}

      <Sheet open={calendarDaySheetOpen} onOpenChange={setCalendarDaySheetOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto px-4 pb-6">
          <SheetHeader className="text-left space-y-1 pr-6">
            <SheetTitle className="text-base sm:text-lg flex items-center gap-1 flex-wrap">
              {calendarSelectedDay
                ? format(calendarSelectedDay.day, "EEEE d. MMMM yyyy", { locale: sk })
                : ""}
              {calendarSelectedDay && (
                <HelpTip title="Detail dňa v kalendári">
                  <p>
                    Zoznam udalostí v daný deň: skutočné výplaty z účtu alebo odhad plánovanej dividendy. Pri odhadoch
                    môže chýbať rozdelenie na daň do skutočnej výplaty.
                  </p>
                </HelpTip>
              )}
            </SheetTitle>
            <SheetDescription className="text-xs sm:text-sm text-left">
              {calendarSelectedDay?.bucket && calendarSelectedDay.bucket.rows.length > 0
                ? `Celkom netto v tento deň: ${formatCurrency(calendarSelectedDay.bucket.totalNet)}`
                : "V tento deň nemáš v kalendári žiadne výplaty ani plánované dividendy."}
            </SheetDescription>
          </SheetHeader>
          {calendarSelectedDay?.bucket && calendarSelectedDay.bucket.rows.length > 0 && (
            <div className="mt-4 space-y-3">
              {calendarSelectedDay.bucket.rows.map((r, idx) => (
                <div
                  key={`${r.ticker}-${r.source}-${idx}`}
                  className="rounded-lg border p-3 space-y-2 bg-card"
                >
                  <div className="flex items-start gap-2">
                    <CompanyLogo ticker={r.ticker} companyName={r.companyName} size="sm" className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm">{r.ticker}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          {r.source === "forecast" ? "Odhad výplaty" : "Skutočná výplata"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{r.companyName}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs sm:text-sm">
                    <div>
                      <span className="text-muted-foreground">Brutto</span>
                      <div className="font-medium tabular-nums">{formatCurrency(r.gross)}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Daň</span>
                      <div className="font-medium tabular-nums text-red-600">
                        {r.tax > 0 ? `-${formatCurrency(r.tax)}` : "—"}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Netto</span>
                      <div
                        className={`font-medium tabular-nums ${r.net >= 0 ? "text-blue-600 dark:text-blue-400" : "text-red-600"}`}
                      >
                        {r.net >= 0 ? "+" : ""}
                        {formatCurrency(r.net)}
                      </div>
                    </div>
                  </div>
                  {r.source === "forecast" && r.tax <= 0 && (
                    <p className="text-[11px] text-muted-foreground border-t pt-2">
                      Odhad bez rozdelenia na daň — po výplate upravíme podľa skutočnej transakcie.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
