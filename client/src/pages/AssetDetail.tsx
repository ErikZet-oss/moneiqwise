import { useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { format, parse, parseISO } from "date-fns";
import { sk } from "date-fns/locale";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceDot,
} from "recharts";
import { ArrowLeft, ExternalLink, TrendingDown, TrendingUp, Clock, Shield, Calendar } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanyLogo } from "@/components/CompanyLogo";
import { BrokerLogo } from "@/components/BrokerLogo";
import { useCurrency } from "@/hooks/useCurrency";
import { useChartSettings } from "@/hooks/useChartSettings";
import type { BrokerCode, Transaction } from "@shared/schema";
import { formatShareQuantity } from "@/lib/utils";

type PositionRow = {
  portfolioId: string | null;
  portfolioName: string;
  brokerCode: string | null;
  shares: number;
  averageCost: number;
  totalInvested: number;
};

type DividendPayment = {
  id: string;
  date: string;
  portfolioId: string | null;
  portfolioName: string;
  gross: number;
  tax: number;
  net: number;
  currency: string;
};

type AssetDetailResponse = {
  ticker: string;
  companyName: string;
  positions: PositionRow[];
  portfolios: { id: string; name: string }[];
  totals: { shares: number; totalInvested: number; averageCost: number };
  dividends: {
    totalGross: number;
    totalTax: number;
    totalNet: number;
    paymentCount: number;
  };
  dividendPayments: DividendPayment[];
  marketTransactions: Transaction[];
  transactions: Transaction[];
  quote: {
    price: number;
    change: number;
    changePercent: number;
  } | null;
  prices: Record<string, number>;
  /** Najbližší očakávaný dátum výsledkov (Yahoo calendarEvents), YYYY-MM-DD. */
  nextEarnings: { date: string } | null;
};

type OpenFifoLotRow = {
  acquiredAt: string;
  remainingShares: number;
  pricePerShareLocal: number;
  purchaseCurrency: string;
  eurPerUnitAtPurchase: number;
  currentPriceAvailable: boolean;
  currentPnl: number;
  currentPnlEur: number;
  taxFree: boolean;
  daysToTaxFree: number | null;
  inTaxFreeCountdown: boolean;
  daysHeld: number;
};

type FifoLotWithMeta = OpenFifoLotRow & {
  portfolioName: string;
  portfolioId: string | null;
};

function alignMarkerToChart(
  txDate: Date,
  sortedAscDates: string[],
  prices: Record<string, number>
): { date: string; price: number } | null {
  const key = format(txDate, "yyyy-MM-dd");
  let best: string | null = null;
  for (const d of sortedAscDates) {
    if (d <= key) best = d;
  }
  if (!best) return null;
  const p = prices[best];
  return p != null ? { date: best, price: p } : null;
}

function txnCurrency(tx: Transaction): "EUR" | "USD" | "GBP" | "CZK" | "PLN" {
  const c = (tx.currency || "EUR").toUpperCase();
  if (c === "USD" || c === "GBP" || c === "CZK" || c === "PLN" || c === "EUR") return c;
  return "EUR";
}

function codeToCurrency(c: string): "EUR" | "USD" | "GBP" | "CZK" | "PLN" {
  const x = (c || "EUR").toUpperCase();
  if (x === "USD" || x === "GBP" || x === "CZK" || x === "PLN" || x === "EUR") return x;
  return "EUR";
}

export default function AssetDetail() {
  const params = useParams();
  const rawTicker = (params as { ticker?: string }).ticker ?? "";
  const ticker = rawTicker ? decodeURIComponent(rawTicker) : "";
  const [, setLocation] = useLocation();
  const { currency, convertPrice, getTickerCurrency, formatCurrency, formatWithConversion } = useCurrency();
  const { hideAmounts } = useChartSettings();

  const mask = (s: string) => (hideAmounts ? "••••••" : s);

  const { data, isLoading, error } = useQuery<AssetDetailResponse>({
    queryKey: ["/api/assets", ticker],
    queryFn: async () => {
      const res = await fetch(`/api/assets/${encodeURIComponent(ticker)}`, { credentials: "include" });
      if (res.status === 404) {
        throw new Error("NOT_FOUND");
      }
      if (!res.ok) throw new Error("Failed to fetch asset detail");
      return res.json();
    },
    enabled: !!ticker,
  });

  const lotQueries = useQueries({
    queries: (data?.positions ?? []).map((pos) => {
      const pathSeg = pos.portfolioId == null ? "unassigned" : pos.portfolioId;
      return {
        queryKey: ["/api/portfolios", pathSeg, "asset-lots", ticker] as const,
        queryFn: async () => {
          const u = encodeURIComponent(ticker);
          const res = await fetch(
            `/api/portfolios/${pathSeg === "unassigned" ? "unassigned" : encodeURIComponent(pathSeg)}/asset-lots?ticker=${u}`,
            { credentials: "include" },
          );
          if (!res.ok) throw new Error("asset-lots");
          return res.json() as Promise<{
            currency: string;
            lots: OpenFifoLotRow[];
          }>;
        },
        enabled: !!ticker && !!data && data.ticker !== "CASH" && (data?.positions?.length ?? 0) > 0,
        staleTime: 60 * 1000,
      };
    }),
  });

  const fifoLotRows: FifoLotWithMeta[] = useMemo(() => {
    if (!data?.positions) return [];
    const out: FifoLotWithMeta[] = [];
    data.positions.forEach((pos, i) => {
      const q = lotQueries[i];
      if (!q?.data?.lots?.length) return;
      for (const lot of q.data.lots) {
        out.push({ ...lot, portfolioName: pos.portfolioName, portfolioId: pos.portfolioId });
      }
    });
    return out;
  }, [data?.positions, lotQueries]);

  const anyLotsLoading = lotQueries.some((q) => q.isLoading);
  const lotsError = lotQueries.find((q) => q.isError);

  const chartData = useMemo(() => {
    if (!data?.prices) return [];
    const keys = Object.keys(data.prices).sort();
    return keys.map((d) => ({ date: d, price: data.prices[d] }));
  }, [data?.prices]);

  const sortedAscDates = useMemo(() => chartData.map((d) => d.date), [chartData]);

  const tradeMarkers = useMemo(() => {
    if (!data?.marketTransactions || !data.prices) return [];
    const out: Array<{
      date: string;
      price: number;
      kind: "BUY" | "SELL";
      key: string;
    }> = [];
    for (const tx of data.marketTransactions) {
      if (tx.type !== "BUY" && tx.type !== "SELL") continue;
      const d = parseISO(typeof tx.transactionDate === "string" ? tx.transactionDate : String(tx.transactionDate));
      const aligned = alignMarkerToChart(d, sortedAscDates, data.prices);
      if (!aligned) continue;
      out.push({
        ...aligned,
        kind: tx.type as "BUY" | "SELL",
        key: `${tx.id}-${tx.type}`,
      });
    }
    return out;
  }, [data?.marketTransactions, data?.prices, sortedAscDates]);

  const sortedTxDesc = useMemo(() => {
    if (!data?.transactions) return [];
    return [...data.transactions].sort(
      (a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime()
    );
  }, [data?.transactions]);

  const portfolioNameById = useMemo(() => {
    const m = new Map<string, string>();
    data?.portfolios?.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [data?.portfolios]);

  const formatTxnValue = (tx: Transaction): string => {
    const cur = txnCurrency(tx);
    if (tx.type === "DIVIDEND") {
      const gross = parseFloat(tx.shares) * parseFloat(tx.pricePerShare);
      return mask(formatCurrency(convertPrice(gross, cur)));
    }
    if (tx.type === "TAX") {
      const v = parseFloat(tx.shares) * parseFloat(tx.pricePerShare);
      return mask(formatCurrency(convertPrice(v, cur)));
    }
    const gross = parseFloat(tx.shares) * parseFloat(tx.pricePerShare);
    return mask(formatCurrency(convertPrice(gross, cur)));
  };

  const typeLabel = (t: string) => {
    switch (t) {
      case "BUY":
        return "Nákup";
      case "SELL":
        return "Predaj";
      case "DIVIDEND":
        return "Dividenda";
      case "TAX":
        return "Daň";
      default:
        return t;
    }
  };

  if (!ticker) {
    return (
      <div className="max-w-4xl mx-auto">
        <p className="text-muted-foreground">Neplatný ticker.</p>
        <Button variant="outline" className="mt-4" onClick={() => setLocation("/")}>
          Späť na prehľad
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error instanceof Error && error.message === "NOT_FOUND") {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <p className="text-muted-foreground">Pre tento ticker nemáte v aplikácii žiadne dáta.</p>
        <Button variant="outline" onClick={() => setLocation("/")}>
          Späť na prehľad
        </Button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <p className="text-destructive">Nepodarilo sa načítať detail aktíva.</p>
        <Button variant="outline" onClick={() => setLocation("/")}>
          Späť na prehľad
        </Button>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const quote = data.quote;
  const tc = getTickerCurrency(data.ticker);
  const changePositive = quote != null && quote.change >= 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-2 min-w-0">
          <Button variant="ghost" size="sm" className="gap-2 -ml-2 w-fit" onClick={() => setLocation("/")}>
            <ArrowLeft className="h-4 w-4" />
            Späť na prehľad
          </Button>
          <div className="flex items-start gap-3">
            <CompanyLogo ticker={data.ticker} companyName={data.companyName} size="lg" className="shrink-0" />
            <div className="min-w-0">
              <h1 className="text-2xl font-bold truncate" data-testid="asset-detail-title">
                {data.companyName}
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
                <span className="font-mono">{data.ticker}</span>
                <a
                  href={`https://finance.yahoo.com/quote/${encodeURIComponent(data.ticker)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Yahoo Finance
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 w-full sm:w-auto sm:items-end sm:max-w-full">
          {data.nextEarnings && data.ticker !== "CASH" && (
            <Card className="shrink-0 w-full sm:w-auto sm:min-w-[200px] border-amber-500/25 bg-amber-500/[0.06] dark:bg-amber-500/10">
              <CardContent className="p-3 sm:p-4">
                <div className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  Najbližšie earnings
                </div>
                <div className="text-base sm:text-lg font-semibold mt-1 tabular-nums">
                  {format(parse(data.nextEarnings.date, "yyyy-MM-dd", new Date()), "d. MMMM yyyy", {
                    locale: sk,
                  })}
                </div>
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 leading-snug">
                  Očakávaný dátum (Yahoo alebo Finnhub), môže sa zmeniť.
                </p>
              </CardContent>
            </Card>
          )}
          {data.ticker !== "CASH" && data.nextEarnings == null && (
            <Card className="shrink-0 w-full sm:w-auto sm:min-w-[200px] border-dashed border-muted-foreground/25">
              <CardContent className="p-3 sm:p-4">
                <div className="text-[10px] sm:text-xs text-muted-foreground flex items-start gap-2 leading-snug">
                  <Calendar className="h-3.5 w-3.5 shrink-0 mt-0.5 opacity-70" />
                  <span>
                    Najbližšie earnings sa nepodarilo načítať. Yahoo často blokuje API; so{" "}
                    <span className="font-mono">FINNHUB_API_KEY</span> na serveri sa použije záložný kalendár
                    Finnhub.
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
          {quote && data.ticker !== "CASH" && (
            <Card className="shrink-0 w-full sm:w-auto sm:min-w-[200px]">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Aktuálna cena</div>
                <div className="text-2xl font-bold">{mask(formatWithConversion(quote.price, data.ticker))}</div>
                <div
                  className={`text-sm flex items-center gap-1 ${changePositive ? "text-green-500" : "text-red-500"}`}
                >
                  {changePositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {mask(formatCurrency(convertPrice(quote.change, tc)))}{" "}
                  <span className="text-xs">
                    ({changePositive ? "+" : ""}
                    {(quote.changePercent ?? 0).toFixed(2)}%)
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Menovka kotácie: {tc} · zobrazenie: {currency}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Súhrn pozície</CardTitle>
          <CardDescription>Celkom naprieč viditeľnými portfóliami</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Počet kusov</div>
            <div className="text-lg font-semibold">{formatShareQuantity(data.totals.shares)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Priemerná nákupná cena (vážená)</div>
            <div className="text-lg font-semibold">
              {mask(formatCurrency(convertPrice(data.totals.averageCost, tc)))}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Celkom investované</div>
            <div className="text-lg font-semibold">
              {mask(formatCurrency(convertPrice(data.totals.totalInvested, tc)))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Podľa portfólia</CardTitle>
          <CardDescription>Držané množstvo a priemerná nákupná cena v každom portfóliu</CardDescription>
        </CardHeader>
        <CardContent>
          {data.positions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Momentálne nemáte otvorenú pozíciu (všetko predané).</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Portfólio</TableHead>
                  <TableHead className="text-right">Kusy</TableHead>
                  <TableHead className="text-right">Priem. nákup</TableHead>
                  <TableHead className="text-right">Investované</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.positions.map((p) => (
                  <TableRow key={p.portfolioId ?? "none"}>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-0">
                        <BrokerLogo brokerCode={p.brokerCode as BrokerCode | null} size="xs" />
                        <span className="truncate">{p.portfolioName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatShareQuantity(p.shares)}</TableCell>
                    <TableCell className="text-right">
                      {mask(formatCurrency(convertPrice(p.averageCost, tc)))}
                    </TableCell>
                    <TableCell className="text-right">
                      {mask(formatCurrency(convertPrice(p.totalInvested, tc)))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data.ticker !== "CASH" && data.positions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Otvorené pozície (FIFO loty)</CardTitle>
            <CardDescription>
              Nákupné dávky v poradí FIFO; PnL je nerealizovaný podľa aktuálnej kotácie a kurzov. Oslobodenie: orient. 365 dní
              držby.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {anyLotsLoading && fifoLotRows.length === 0 ? (
              <Skeleton className="h-32 w-full" />
            ) : lotsError ? (
              <p className="text-sm text-destructive">Loty sa nepodarilo načítať.</p>
            ) : fifoLotRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Žiadne otvorené nákupné dávky (všetko môže byť predané, alebo chýba cena z trhu).
              </p>
            ) : (
              <div className="space-y-2">
                <div className="md:hidden space-y-2">
                  {fifoLotRows.map((row, idx) => {
                    const pnlClass =
                      !row.currentPriceAvailable
                        ? "text-muted-foreground"
                        : row.currentPnl > 0
                          ? "text-emerald-600"
                          : row.currentPnl < 0
                            ? "text-red-500"
                            : "";
                    return (
                      <div
                        key={`${row.portfolioId ?? "n"}-${row.acquiredAt}-${idx}-${row.remainingShares}-mobile`}
                        className="rounded-lg border p-2.5"
                      >
                        <div className="grid grid-cols-3 gap-2 text-[11px]">
                          <div className="min-w-0 col-span-1">
                            <div className="text-[10px] text-muted-foreground">Portfólio</div>
                            <div className="font-medium truncate">{row.portfolioName}</div>
                            <div className="text-[10px] text-muted-foreground mt-1">Nákup</div>
                            <div>
                              {format(parseISO(row.acquiredAt + "T12:00:00Z"), "d. M. yyyy", {
                                locale: sk,
                              })}
                            </div>
                          </div>

                          <div className="col-span-1 text-right">
                            <div className="text-[10px] text-muted-foreground">Kusy</div>
                            <div className="font-mono">{formatShareQuantity(row.remainingShares)}</div>
                            <div className="text-[10px] text-muted-foreground mt-1">Nákup / ks</div>
                            <div>
                              {mask(
                                formatCurrency(
                                  convertPrice(row.pricePerShareLocal, codeToCurrency(row.purchaseCurrency)),
                                ),
                              )}
                            </div>
                          </div>

                          <div className="col-span-1 text-right">
                            <div className="text-[10px] text-muted-foreground">Aktuálny PnL</div>
                            <div className={`font-medium ${pnlClass}`}>
                              {!row.currentPriceAvailable ? "—" : mask(formatCurrency(row.currentPnl))}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-1">Kurz EUR</div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {row.eurPerUnitAtPurchase.toFixed(5)}
                            </div>
                          </div>
                        </div>

                        <div className="pt-1.5 mt-1.5 border-t border-border/60">
                          {row.taxFree ? (
                            <div className="inline-flex items-center gap-1 flex-wrap">
                              <Badge
                                className="bg-emerald-600/90 text-white hover:bg-emerald-600 border-0"
                                title="Orientačný časový test (1 rok) — detail u daňového poradcu"
                              >
                                <Shield className="h-3 w-3 mr-0.5 inline" />
                                Tax free
                              </Badge>
                            </div>
                          ) : row.inTaxFreeCountdown && row.daysToTaxFree != null ? (
                            <div
                              className="inline-flex items-center gap-1 text-amber-600"
                              title={`Cca ${row.daysToTaxFree} d. do 365 dní držby`}
                            >
                              <Clock className="h-4 w-4 shrink-0 motion-safe:animate-pulse" aria-hidden />
                              <span className="text-xs">o {row.daysToTaxFree} d.</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground" title="Držba v dňoch (orient.)">
                              ⏳ {Math.floor(row.daysHeld)} d.
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="hidden md:block overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Portfólio</TableHead>
                        <TableHead>Dátum nákupu</TableHead>
                        <TableHead className="text-right">Kusy</TableHead>
                        <TableHead className="text-right">Nákup / ks</TableHead>
                        <TableHead className="text-right">Kurz nákupu (EUR/1)</TableHead>
                        <TableHead className="text-right">Aktuálny PnL</TableHead>
                        <TableHead>Stav</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fifoLotRows.map((row, idx) => {
                        const pnlClass =
                          !row.currentPriceAvailable
                            ? "text-muted-foreground"
                            : row.currentPnl > 0
                              ? "text-emerald-600"
                              : row.currentPnl < 0
                                ? "text-red-500"
                                : "";
                        return (
                          <TableRow
                            key={`${row.portfolioId ?? "n"}-${row.acquiredAt}-${idx}-${row.remainingShares}`}
                          >
                            <TableCell className="max-w-[140px] truncate">{row.portfolioName}</TableCell>
                            <TableCell>
                              {format(
                                parseISO(row.acquiredAt + "T12:00:00Z"),
                                "d. M. yyyy",
                                { locale: sk },
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {formatShareQuantity(row.remainingShares)}
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {mask(
                                formatCurrency(
                                  convertPrice(
                                    row.pricePerShareLocal,
                                    codeToCurrency(row.purchaseCurrency),
                                  ),
                                ),
                              )}
                            </TableCell>
                            <TableCell className="text-right text-xs font-mono text-muted-foreground">
                              {row.eurPerUnitAtPurchase.toFixed(5)}
                            </TableCell>
                            <TableCell className={`text-right text-sm font-medium ${pnlClass}`}>
                              {!row.currentPriceAvailable
                                ? "—"
                                : mask(formatCurrency(row.currentPnl))}
                            </TableCell>
                            <TableCell>
                              {row.taxFree ? (
                                <div className="inline-flex items-center gap-1 flex-wrap">
                                  <Badge
                                    className="bg-emerald-600/90 text-white hover:bg-emerald-600 border-0"
                                    title="Orientačný časový test (1 rok) — detail u daňového poradcu"
                                  >
                                    <Shield className="h-3 w-3 mr-0.5 inline" />
                                    Tax free
                                  </Badge>
                                </div>
                              ) : row.inTaxFreeCountdown && row.daysToTaxFree != null ? (
                                <div
                                  className="inline-flex items-center gap-1 text-amber-600"
                                  title={`Cca ${row.daysToTaxFree} d. do 365 dní držby`}
                                >
                                  <Clock
                                    className="h-4 w-4 shrink-0 motion-safe:animate-pulse"
                                    aria-hidden
                                  />
                                  <span className="text-xs">
                                    o {row.daysToTaxFree} d.
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground" title="Držba v dňoch (orient.)">
                                  ⏳ {Math.floor(row.daysHeld)} d.
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data.dividends.paymentCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Dividendy</CardTitle>
            <CardDescription>Čo ste od tohto aktíva dostali (viditeľné portfóliá)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Hrubá suma ({currency})</div>
                <div className="font-semibold">{mask(formatCurrency(data.dividends.totalGross))}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Zrážky / daň ({currency})</div>
                <div className="font-semibold">{mask(formatCurrency(data.dividends.totalTax))}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Čistá suma ({currency})</div>
                <div className="font-semibold text-green-600 dark:text-green-400">
                  {mask(formatCurrency(data.dividends.totalNet))}
                </div>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dátum</TableHead>
                  <TableHead>Portfólio</TableHead>
                  <TableHead className="text-right">Hrubá</TableHead>
                  <TableHead className="text-right">Čistá</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.dividendPayments.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {format(parseISO(typeof row.date === "string" ? row.date : String(row.date)), "d. MMM yyyy", {
                        locale: sk,
                      })}
                    </TableCell>
                    <TableCell className="truncate max-w-[180px]">{row.portfolioName}</TableCell>
                    <TableCell className="text-right">
                      {mask(formatCurrency(convertPrice(row.gross, codeToCurrency(row.currency))))}
                    </TableCell>
                    <TableCell className="text-right">
                      {mask(formatCurrency(convertPrice(row.net, codeToCurrency(row.currency))))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Vývoj ceny a obchody</CardTitle>
          <CardDescription>
            Čiara je uzatváracia cena (historické dáta). Zelené body: nákup, červené: predaj (deň obchodu).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Historické ceny nie sú k dispozícii (alebo ide o hotovosť).
            </p>
          ) : (
            <div className="h-[320px] w-full" data-testid="asset-price-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    minTickGap={28}
                    tickFormatter={(v) => {
                      try {
                        return format(parseISO(v as string), "MMM yy", { locale: sk });
                      } catch {
                        return String(v);
                      }
                    }}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 10 }}
                    width={56}
                    tickFormatter={(v) => Number(v).toFixed(0)}
                  />
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0].payload as { date: string; price: number };
                      return (
                        <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
                          <div className="font-medium">{row.date}</div>
                          <div>{mask(formatWithConversion(row.price, data.ticker))}</div>
                        </div>
                      );
                    }}
                  />
                  <Line type="monotone" dataKey="price" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                  {tradeMarkers.map((m) => (
                    <ReferenceDot
                      key={m.key}
                      x={m.date}
                      y={m.price}
                      r={5}
                      fill={m.kind === "BUY" ? "#22c55e" : "#ef4444"}
                      stroke="#fff"
                      strokeWidth={1}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>História transakcií</CardTitle>
          <CardDescription>Všetky záznamy pre tento ticker</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dátum</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Portfólio</TableHead>
                <TableHead className="text-right">Ks</TableHead>
                <TableHead className="text-right">Cena / ks</TableHead>
                <TableHead className="text-right">Suma</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTxDesc.map((tx) => {
                const pName = tx.portfolioId ? portfolioNameById.get(tx.portfolioId) ?? "—" : "—";
                return (
                  <TableRow key={tx.id}>
                    <TableCell className="whitespace-nowrap">
                      {format(
                        parseISO(typeof tx.transactionDate === "string" ? tx.transactionDate : String(tx.transactionDate)),
                        "d.M.yyyy",
                        { locale: sk }
                      )}
                    </TableCell>
                    <TableCell>{typeLabel(tx.type)}</TableCell>
                    <TableCell className="max-w-[140px] truncate">{pName}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {tx.type === "DIVIDEND" || tx.type === "TAX"
                        ? "—"
                        : formatShareQuantity(parseFloat(tx.shares))}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {tx.type === "TAX"
                        ? "—"
                        : mask(formatCurrency(convertPrice(parseFloat(tx.pricePerShare), txnCurrency(tx))))}
                    </TableCell>
                    <TableCell className="text-right">{formatTxnValue(tx)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
