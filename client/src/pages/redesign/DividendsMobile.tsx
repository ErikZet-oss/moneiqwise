import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addMonths,
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
import type { Holding, Transaction } from "@shared/schema";
import {
  CASH_INTEREST_DISPLAY_NAME,
  CASH_INTEREST_TAX_DISPLAY_NAME,
  CASH_INTEREST_TICKER,
} from "@shared/tickerCurrency";
import { useCurrency } from "@/hooks/useCurrency";
import { useChartSettings } from "@/hooks/useChartSettings";
import { usePortfolio } from "@/hooks/usePortfolio";
import { Avatar, Badge, Button, Card, Dialog, TopBar } from "@/redesign/ui";
import { cn } from "@/lib/utils";
import { HelpButton, PageBody, PortfolioSwitcher, signedMoney } from "./mobileChrome";

type UpcomingDividendItem = {
  ticker: string;
  companyName: string;
  date: string;
  kind: "ex_dividend" | "payout";
  estimatedGrossInUserCcy: number | null;
  exDate: string | null;
  paymentDate: string | null;
  dividendYieldCurrent: number | null;
  annualDividendPerShare: number | null;
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
  source: "paid" | "forecast";
};

type StockQuote = { ticker: string; price: number };

const WEEKDAYS = ["Po", "Ut", "St", "Št", "Pi", "So", "Ne"];
const MONTH_SHORT = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

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

function MetricTile({
  label,
  value,
  sub,
  tone = "neutral",
  helpTitle,
  helpBody,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "up";
  helpTitle: string;
  helpBody: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-[var(--rd-radius-md)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-2 [background-image:var(--rd-bg-surface-gradient)]">
      <div className="flex items-center gap-1">
        <p className="min-w-0 flex-1 truncate rd-type-overline text-[var(--rd-text-tertiary)]">{label}</p>
        <HelpButton compact title={helpTitle} body={helpBody} />
      </div>
      <p
        className={cn(
          "truncate text-[15px] font-semibold leading-5 tracking-[-0.15px]",
          tone === "up" ? "text-[var(--rd-profit)]" : "text-[var(--rd-text-primary)]",
        )}
      >
        {value}
      </p>
      <p className="text-[10px] font-medium leading-3 text-[var(--rd-text-secondary)]">{sub}</p>
    </div>
  );
}

function formatCompactAmount(n: number): string {
  const abs = Math.abs(n);
  const formatted =
    abs >= 100 ? abs.toFixed(0) : abs >= 10 ? abs.toFixed(1) : abs.toFixed(2);
  return `${n >= 0 ? "+" : "−"}${formatted.replace(".", ",")}`;
}

export default function DividendsMobile() {
  const { formatCurrency: formatRaw } = useCurrency();
  const { hideAmounts } = useChartSettings();
  const { getQueryParam, isAllPortfolios, selectedPortfolio } = usePortfolio();
  const formatCurrency = (n: number) => {
    if (hideAmounts) return "••••••";
    if (!Number.isFinite(n)) return "—";
    return formatRaw(n);
  };
  const portfolioParam = getQueryParam();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [chartYear, setChartYear] = useState(() => new Date().getFullYear());
  const [selectedBarMonth, setSelectedBarMonth] = useState<number | null>(null);

  const { data: transactions = [] } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/transactions?portfolio=${encodeURIComponent(portfolioParam)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("transactions");
      return res.json();
    },
  });

  const { data: holdings = [] } = useQuery<Holding[]>({
    queryKey: ["/api/holdings", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/holdings?portfolio=${encodeURIComponent(portfolioParam)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("holdings");
      return res.json();
    },
  });

  const { data: upcomingDividends } = useQuery<{ all?: UpcomingDividendItem[] }>({
    queryKey: ["/api/dividends/upcoming", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/dividends/upcoming?portfolio=${encodeURIComponent(portfolioParam)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("upcoming");
      return res.json();
    },
    staleTime: 45 * 60 * 1000,
  });

  const quoteTickers = useMemo(
    () => Array.from(new Set(holdings.map((h) => h.ticker).filter(Boolean))).sort(),
    [holdings],
  );

  const { data: quotes = {} } = useQuery<Record<string, StockQuote>>({
    queryKey: ["/api/stocks/quotes/batch", quoteTickers.join(","), "dividends-mobile"],
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

  const trailing12mNetByTicker = useMemo(() => {
    const cutoff = subMonths(startOfDay(new Date()), 12);
    const m = new Map<string, number>();
    for (const t of transactions) {
      if (t.type !== "DIVIDEND") continue;
      const d = startOfDay(new Date(t.transactionDate as unknown as string));
      if (d < cutoff) continue;
      const ticker = (t.ticker || "N/A").toUpperCase();
      const gross = parseFloat(String(t.shares ?? "0")) * parseFloat(String(t.pricePerShare ?? "0"));
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
      if (annPerShare > 0) annualCash = annPerShare * h.shares;
      else if (yieldPct != null && yieldPct > 0 && q && Number.isFinite(q.price) && q.price > 0) {
        annualCash = (yieldPct / 100) * q.price * h.shares;
      } else if (trailing12m > 0) annualCash = trailing12m;
      else continue;

      const marketValue = q && Number.isFinite(q.price) && q.price > 0 ? q.price * h.shares : 0;
      const costBasis = h.avgCost * h.shares;
      totalInvested += Number.isFinite(costBasis) && costBasis > 0 ? costBasis : 0;
      annualIncome += annualCash;
      if (marketValue > 0) totalCurrentValue += marketValue;
      else if (annualCash > 0 && Number.isFinite(costBasis) && costBasis > 0) totalCurrentValue += costBasis;
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
      rows.push({
        monthIndex: mi,
        label: format(new Date(y, mi, 1), "LLL", { locale: sk }),
        paid: 0,
        confirmed: 0,
        estimated: 0,
        total: 0,
      });
    }

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
      pushBreakdown(mi, {
        ticker: tkr,
        companyName:
          tkr.toUpperCase() === CASH_INTEREST_TICKER
            ? CASH_INTEREST_DISPLAY_NAME
            : (t.companyName || tkr).trim(),
        amount: n,
        badge: "Potvrdené",
      });
    }

    const upcomingMonthTicker = new Set<string>();
    for (const ev of upcomingDividends?.all ?? []) {
      const amount = ev.estimatedGrossInUserCcy ?? 0;
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const dateIso =
        ev.kind === "payout" ? ev.paymentDate || ev.date : ev.paymentDate || ev.exDate || ev.date;
      if (!dateIso) continue;
      const pd = new Date(`${dateIso}T12:00:00`);
      if (pd.getFullYear() !== y) continue;
      const mi = pd.getMonth();
      if (!ev.confirmed && startOfDay(pd) < todayStart) continue;
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

    for (const t of transactions) {
      if (t.type !== "DIVIDEND") continue;
      const d0 = new Date(t.transactionDate as unknown as string);
      const projected = addMonths(startOfDay(d0), 12);
      if (projected < todayStart || projected.getFullYear() !== y) continue;
      const mi = projected.getMonth();
      const tickerU = (t.ticker || "N/A").toUpperCase();
      const mtKey = `${tickerU}-${mi}`;
      if (paidMonthTicker.has(mtKey) || upcomingMonthTicker.has(mtKey)) continue;
      const net =
        parseFloat(String(t.shares ?? "0")) * parseFloat(String(t.pricePerShare ?? "0")) -
        parseFloat(String(t.commission ?? "0"));
      if (!Number.isFinite(net) || net <= 0) continue;
      rows[mi].estimated += net;
      upcomingMonthTicker.add(mtKey);
      const tkrP = t.ticker || "N/A";
      pushBreakdown(mi, {
        ticker: tkrP,
        companyName:
          tkrP.toUpperCase() === CASH_INTEREST_TICKER
            ? CASH_INTEREST_DISPLAY_NAME
            : (t.companyName || tkrP).trim(),
        amount: net,
        badge: "Odhad",
      });
    }

    rows.forEach((r) => {
      r.total = r.paid + r.confirmed + r.estimated;
    });

    const mergeBreakdown = (entries: MonthChartBreakdownEntry[]) => {
      const m = new Map<string, MonthChartBreakdownEntry>();
      for (const e of entries) {
        const key = `${e.ticker.toUpperCase()}\0${e.badge}`;
        const prev = m.get(key);
        if (prev) prev.amount += e.amount;
        else m.set(key, { ...e });
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

  const yearlyBreakdownFullYear = useMemo(() => {
    const m = new Map<string, MonthChartBreakdownEntry>();
    for (const monthEntries of yearlyBreakdownByMonth) {
      for (const e of monthEntries) {
        const key = `${e.ticker.toUpperCase()}\0${e.badge}`;
        const prev = m.get(key);
        if (prev) prev.amount += e.amount;
        else m.set(key, { ...e });
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
        upsert(dayIso, ticker, companyName, gross, tax, gross - tax, "paid");
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
        ev.kind === "payout" ? ev.paymentDate || ev.date : ev.paymentDate || ev.exDate || ev.date;
      if (!dayIso || dayIso < todayIso) continue;
      forecastDayTicker.add(`${ev.ticker.toUpperCase()}-${dayIso}`);
      upsert(dayIso, ev.ticker, ev.companyName, est, 0, est, "forecast");
    }

    for (const t of transactions) {
      if (t.type !== "DIVIDEND") continue;
      const projected = addMonths(startOfDay(new Date(t.transactionDate as unknown as string)), 12);
      const dayIso = format(projected, "yyyy-MM-dd");
      if (dayIso < todayIso) continue;
      const ticker = t.ticker || "N/A";
      const tickerU = ticker.toUpperCase();
      const k = `${tickerU}-${dayIso}`;
      if (forecastDayTicker.has(k)) continue;
      const bucket = map.get(dayIso);
      if (bucket?.rows.some((r) => r.ticker.toUpperCase() === tickerU && r.source === "paid")) continue;
      forecastDayTicker.add(k);
      const shares = parseFloat(String(t.shares ?? "0"));
      const dps = parseFloat(String(t.pricePerShare ?? "0"));
      const tax = Math.abs(parseFloat(String(t.commission ?? "0")));
      const gross = Number.isFinite(shares) && Number.isFinite(dps) ? shares * dps : 0;
      const net = gross - tax;
      if (!Number.isFinite(net) || net <= 0) continue;
      upsert(
        dayIso,
        ticker,
        tickerU === CASH_INTEREST_TICKER ? CASH_INTEREST_DISPLAY_NAME : t.companyName || ticker,
        gross,
        tax,
        net,
        "forecast",
      );
    }

    return map;
  }, [transactions, upcomingDividends?.all]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(calendarMonth);
    const monthEnd = endOfMonth(calendarMonth);
    return eachDayOfInterval({
      start: startOfWeek(monthStart, { weekStartsOn: 1 }),
      end: endOfWeek(monthEnd, { weekStartsOn: 1 }),
    });
  }, [calendarMonth]);

  const maxBar = Math.max(1, ...yearlyBars.map((b) => b.total));
  const selected = dayKey ? calendarByDay.get(dayKey) : null;
  const summaryRows =
    selectedBarMonth != null ? yearlyBreakdownByMonth[selectedBarMonth] ?? [] : yearlyBreakdownFullYear;
  const summaryTotal =
    selectedBarMonth != null ? yearlyBars[selectedBarMonth]?.total ?? 0 : yearlyGrandTotal;
  const summaryLabel =
    selectedBarMonth != null
      ? `${format(new Date(chartYear, selectedBarMonth, 1), "LLLL", { locale: sk })} ${chartYear}`
      : `Rok ${chartYear}: Celkovo`;

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar
        overline={isAllPortfolios ? "Všetky portfóliá" : selectedPortfolio?.name || "Portfólio"}
        title="Dividendy"
        onOverlineClick={() => setPickerOpen(true)}
      />
      <PortfolioSwitcher open={pickerOpen} onClose={() => setPickerOpen(false)} />

      <PageBody>
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 text-[11px] leading-[14px] text-[var(--rd-text-secondary)]">
            Kalendár, ročný prehľad a yield analytika
          </p>
          <HelpButton
            compact
            title="Stránka Dividendy"
            body="Prehľad dividend podľa zvoleného portfólia: interaktívny kalendár, ročný graf, odhad príjmu a výnosové metriky."
          />
        </div>

        <div className="flex gap-1.5">
          <MetricTile
            label="12M príjem"
            value={formatCurrency(yieldMetrics.annualIncome)}
            sub="forward"
            tone="up"
            helpTitle="Forward 12M príjem"
            helpBody="Orientačný ročný čistý príjem z dividend na základe aktuálnych pozícií: Yahoo sadzba/výnos, alebo posledných 12 mesiacov skutočných výplat."
          />
          <MetricTile
            label="Yield"
            value={`${yieldMetrics.dividendYieldCurrent.toFixed(2)}%`}
            sub="aktuálny"
            helpTitle="Dividend yield (aktuálny)"
            helpBody="Pomer očakávaného ročného dividendového príjmu k aktuálnej trhovej hodnote držaných akcií."
          />
          <MetricTile
            label="YOC"
            value={`${yieldMetrics.yieldOnCost.toFixed(2)}%`}
            sub="na náklady"
            helpTitle="Yield on Cost (YOC)"
            helpBody="Výnos voči pôvodným investovaným nákladom, nie voči dnešnej trhovej cene."
          />
        </div>

        <Card className="gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <p className="min-w-0 flex-1 rd-type-h2">Dividendový kalendár</p>
              <HelpButton
                compact
                title="Dividendový kalendár"
                body="Mesačný pohľad na dni so skutočnými výplatami a plánovanými udalosťami (vrátane odhadov). Kliknutím na deň zobrazíte detail."
              />
            </div>
            <p className="text-[11px] leading-[14px] text-[var(--rd-text-tertiary)]">
              Klikni na deň — zobrazia sa sumy a plánované výplaty (odhad).
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <RoundNav label="Predchádzajúci mesiac" onClick={() => setCalendarMonth((m) => subMonths(m, 1))}>
              <ChevronLeft className="size-4" />
            </RoundNav>
            <p className="min-w-0 flex-1 text-center text-[13px] font-semibold capitalize leading-[18px]">
              {format(calendarMonth, "LLLL yyyy", { locale: sk })}
            </p>
            <RoundNav label="Nasledujúci mesiac" onClick={() => setCalendarMonth((m) => addMonths(m, 1))}>
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
              const inMonth = isSameMonth(day, calendarMonth);
              const entry = calendarByDay.get(key);
              const net = entry?.totalNet ?? 0;
              const selectedDay = dayKey === key || (dayKey == null && isToday(day));
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!inMonth}
                  onClick={() => inMonth && setDayKey(key)}
                  className={cn(
                    "flex h-12 flex-col items-center justify-center gap-0.5 rounded-[var(--rd-radius-sm)]",
                    selectedDay && inMonth && "border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-hover)]",
                  )}
                >
                  {inMonth ? (
                    <>
                      <span
                        className={cn(
                          "text-[11px] font-medium leading-[14px]",
                          net !== 0 ? "text-[var(--rd-text-primary)]" : "text-[var(--rd-text-secondary)]",
                        )}
                      >
                        {format(day, "d")}
                      </span>
                      {net !== 0 ? (
                        <span
                          className={cn(
                            "text-[10px] font-medium leading-3",
                            net > 0 ? "text-[var(--rd-profit)]" : "text-[var(--rd-text-tertiary)]",
                          )}
                        >
                          {hideAmounts ? "••" : formatCompactAmount(net)}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-[11px] text-[var(--rd-border-strong)]">·</span>
                  )}
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <p className="min-w-0 flex-1 rd-type-h2">Dividendy podľa mesiacov</p>
              <HelpButton
                compact
                title="Graf podľa mesiacov"
                body="Kalendárny rok Jan–Dec. Modré = vyplatené/potvrdené, zelené = odhad. Klikni na stĺpec pre detail mesiaca."
              />
            </div>
            <p className="text-[11px] leading-[14px] text-[var(--rd-text-tertiary)]">
              Kalendárny rok, sumy v EUR. Klikni na stĺpec pre detail.
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <RoundNav label="Predchádzajúci rok" onClick={() => setChartYear((y) => y - 1)}>
              <ChevronLeft className="size-4" />
            </RoundNav>
            <p className="min-w-0 flex-1 text-center text-[13px] font-semibold leading-[18px]">{chartYear}</p>
            <Button
              variant="Secondary"
              className="h-8 shrink-0 px-3 text-[12px]"
              onClick={() => {
                setChartYear(new Date().getFullYear());
                setSelectedBarMonth(null);
              }}
            >
              Dnes
            </Button>
            <RoundNav label="Nasledujúci rok" onClick={() => setChartYear((y) => y + 1)}>
              <ChevronRight className="size-4" />
            </RoundNav>
          </div>

          <div className="flex h-[120px] items-end gap-1">
            {yearlyBars.map((bar) => {
              const h = Math.max(bar.total > 0 ? 4 : 0, Math.round((bar.total / maxBar) * 96));
              const paidH = bar.total > 0 ? Math.round((bar.paid / bar.total) * h) : 0;
              const confH = bar.total > 0 ? Math.round((bar.confirmed / bar.total) * h) : 0;
              const estH = Math.max(0, h - paidH - confH);
              const active = selectedBarMonth === bar.monthIndex;
              const mostlyEstimate = bar.estimated > 0 && bar.paid + bar.confirmed < bar.estimated;
              return (
                <button
                  key={bar.monthIndex}
                  type="button"
                  onClick={() =>
                    setSelectedBarMonth((prev) => (prev === bar.monthIndex ? null : bar.monthIndex))
                  }
                  className="flex min-w-0 flex-1 flex-col items-center gap-1"
                >
                  <div
                    className={cn(
                      "flex w-full flex-col justify-end overflow-hidden rounded-t-[3px]",
                      active && "outline outline-1 outline-[var(--rd-text-primary)]",
                    )}
                    style={{ height: 96 }}
                  >
                    <div className="mt-auto flex w-full flex-col justify-end" style={{ height: h || 2 }}>
                      {estH > 0 ? (
                        <div
                          className={cn(
                            "w-full",
                            mostlyEstimate ? "bg-[var(--rd-profit-dim)]" : "bg-[var(--rd-profit)]/40",
                          )}
                          style={{ height: estH }}
                        />
                      ) : null}
                      {confH > 0 ? (
                        <div className="w-full bg-[var(--rd-profit)]" style={{ height: confH }} />
                      ) : null}
                      {paidH > 0 ? (
                        <div className="w-full bg-[var(--rd-info)]" style={{ height: paidH }} />
                      ) : null}
                      {h === 0 ? <div className="w-full bg-[var(--rd-border-subtle)]" style={{ height: 2 }} /> : null}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-medium leading-3",
                      active ? "text-[var(--rd-text-primary)]" : "text-[var(--rd-text-tertiary)]",
                    )}
                  >
                    {MONTH_SHORT[bar.monthIndex]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--rd-text-secondary)]">
              <span className="size-2 rounded-full bg-[var(--rd-info)]" /> Vyplatené
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--rd-text-secondary)]">
              <span className="size-2 rounded-full bg-[var(--rd-profit)]" /> Potvrdené
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--rd-text-secondary)]">
              <span className="size-2 rounded-full bg-[var(--rd-profit-dim)]" /> Odhad
            </span>
            <span className="ml-auto">
              <HelpButton
                compact
                title="Os Y v grafe"
                body="Výška stĺpca = suma v EUR za mesiac (vyplatené + potvrdené + odhad)."
              />
            </span>
          </div>
        </Card>

        <Card className="gap-1.5">
          <div className="flex items-start gap-1.5">
            <div className="min-w-0 flex-1">
              <p className="rd-type-overline uppercase text-[var(--rd-text-tertiary)]">{summaryLabel}</p>
              <p className="rd-type-display-lg text-[var(--rd-text-primary)]">{formatCurrency(summaryTotal)}</p>
            </div>
            <HelpButton
              compact
              title="Súhrn za rok"
              body="Súčet dividend za zvolený rok alebo mesiac, vrátane potvrdených a odhadovaných výplat."
            />
          </div>
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 flex-1 text-[13px] font-semibold leading-[18px]">Podľa spoločností</p>
            <HelpButton
              compact
              title="Tabuľka podľa spoločností"
              body="Rozpis podľa tickerov za vybraný rok alebo mesiac. Badge rozlišuje potvrdené výplaty a odhady."
            />
          </div>
          {summaryRows.length === 0 ? (
            <p className="py-2 text-[11px] text-[var(--rd-text-tertiary)]">Žiadne dividendy v tomto období.</p>
          ) : (
            summaryRows.slice(0, 12).map((row, index) => (
              <div key={`${row.ticker}-${row.badge}-${index}`}>
                {index > 0 ? <div className="h-px w-full bg-[var(--rd-border-subtle)]" /> : null}
                <div className="flex items-center gap-2 py-2">
                  <Avatar ticker={row.ticker} companyName={row.companyName} />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[13px] font-semibold leading-[18px]">{row.ticker}</p>
                    <p className="truncate text-[11px] text-[var(--rd-text-tertiary)]">{row.companyName}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <p className="font-mono text-[13px] font-semibold leading-[18px]">
                      {formatCurrency(row.amount)}
                    </p>
                    <Badge
                      label={row.badge}
                      tone={row.badge === "Potvrdené" ? "Profit" : "Neutral"}
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </Card>
      </PageBody>

      <Dialog
        open={!!dayKey}
        title={dayKey ? format(new Date(`${dayKey}T12:00:00`), "EEEE d. MMMM yyyy", { locale: sk }) : ""}
        body={
          selected
            ? `Celkom netto v tento deň: ${formatCurrency(selected.totalNet)}`
            : "V tento deň nie sú dividendové udalosti."
        }
        onClose={() => setDayKey(null)}
      >
        <div className="mt-3 space-y-3">
          {(selected?.rows ?? []).map((item, idx) => (
            <div key={`${item.ticker}-${item.source}-${idx}`} className="flex items-center gap-3">
              <Avatar ticker={item.ticker} companyName={item.companyName} />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-medium">{item.ticker}</p>
                <p className="truncate text-xs text-[var(--rd-text-tertiary)]">{item.companyName}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <p
                  className={cn(
                    "font-mono text-sm",
                    item.net >= 0 ? "text-[var(--rd-profit)]" : "text-[var(--rd-loss)]",
                  )}
                >
                  {signedMoney(formatCurrency, item.net)}
                </p>
                <Badge
                  label={item.source === "paid" ? "Vyplatené" : "Odhad"}
                  tone={item.source === "paid" ? "Profit" : "Neutral"}
                />
              </div>
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
