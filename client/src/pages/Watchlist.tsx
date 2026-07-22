import { useEffect, useMemo, useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  ExternalLink,
  Loader2,
  Moon,
  Plus,
  Search,
  Tag,
  Trash2,
  Target,
} from "lucide-react";
import { format, parse } from "date-fns";
import { sk } from "date-fns/locale";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CompanyLogo } from "@/components/CompanyLogo";
import { useCurrency } from "@/hooks/useCurrency";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  getUsMarketSessionState,
  shouldShowExtendedQuote,
} from "@/lib/usMarketSession";
import { cn } from "@/lib/utils";
import type { Currency } from "@shared/schema";

const premarketMoonClass = "text-amber-600 dark:text-amber-400";

type WatchlistItem = {
  id: string;
  ticker: string;
  companyName: string | null;
  targetPrice: number | null;
  notes: string | null;
  tags: string[];
  sortOrder: number;
};

type StockQuote = {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  high52: number;
  low52: number;
  annualDividendPerShare: number;
  trailingPE: number | null;
  marketState?: string | null;
  preMarketPrice?: number | null;
  preMarketChange?: number | null;
  preMarketChangePercent?: number | null;
};

type SearchResult = {
  ticker: string;
  name: string;
  exchange?: string;
};

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function yahooFinanceUrl(ticker: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`;
}

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function getChangeColor(value: number): string {
  if (value > 0) return "text-green-500";
  if (value < 0) return "text-red-500";
  return "text-muted-foreground";
}

/** Koľko % musí cena klesnúť z aktuálnej hodnoty, aby dosiahla cieľovú nákupnú cenu. */
function targetDropPercent(currentPrice: number, targetPrice: number): number | null {
  if (
    !Number.isFinite(currentPrice) ||
    !Number.isFinite(targetPrice) ||
    currentPrice <= 0 ||
    targetPrice <= 0
  ) {
    return null;
  }
  if (currentPrice <= targetPrice) return 0;
  return ((currentPrice - targetPrice) / currentPrice) * 100;
}

function getDisplayDailyChange(
  quote: StockQuote | undefined,
  usSessionState: ReturnType<typeof getUsMarketSessionState>,
): number {
  if (!quote) return 0;
  if (usSessionState === "LIVE") return quote.change;
  if (
    shouldShowExtendedQuote(
      usSessionState,
      quote.marketState,
      quote.preMarketChangePercent,
    )
  ) {
    return quote.preMarketChange ?? 0;
  }
  return quote.change;
}

function formatEarningsDate(iso: string): string {
  try {
    return format(parse(iso, "yyyy-MM-dd", new Date()), "d.M.yyyy", { locale: sk });
  } catch {
    return iso;
  }
}

function Range52Bar({
  price,
  low52,
  high52,
  formatLabel,
}: {
  price: number;
  low52: number;
  high52: number;
  formatLabel: (v: number) => string;
}) {
  if (!Number.isFinite(low52) || !Number.isFinite(high52) || high52 <= low52 || price <= 0) {
    return <p className="text-[9px] text-muted-foreground">52w rozpätie nedostupné</p>;
  }

  const pct = Math.min(100, Math.max(0, ((price - low52) / (high52 - low52)) * 100));

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1">
        <span className="text-[8px] font-medium uppercase tracking-wide text-muted-foreground shrink-0">
          52w
        </span>
        <div className="flex flex-1 items-center justify-between text-[8px] text-muted-foreground tabular-nums min-w-0">
          <span>{formatLabel(low52)}</span>
          <span className="text-foreground/80 px-0.5">{pct.toFixed(0)}%</span>
          <span>{formatLabel(high52)}</span>
        </div>
      </div>
      <div className="relative h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary/25"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border border-background bg-primary shadow-sm"
          style={{ left: `calc(${pct}% - 4px)` }}
        />
      </div>
    </div>
  );
}

export default function Watchlist() {
  const { currency, exchangeRate, getTickerCurrency } = useCurrency();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const usSessionState = useMemo(() => getUsMarketSessionState(), []);
  const [displayCurrency, setDisplayCurrency] = useState<Currency>(() =>
    currency === "USD" ? "USD" : "EUR",
  );

  useEffect(() => {
    if (currency === "EUR" || currency === "USD") {
      setDisplayCurrency(currency);
    }
  }, [currency]);

  const convertToWatchlistCurrency = useCallback(
    (price: number, source: "EUR" | "USD" | "GBP" | "CZK" | "PLN") => {
      const rate = exchangeRate;
      let eurPrice = price;
      if (source === "USD") eurPrice = price * rate.usdToEur;
      else if (source === "GBP") eurPrice = price * rate.gbpToEur;
      else if (source === "CZK") eurPrice = price * rate.czkToEur;
      else if (source === "PLN") eurPrice = price * rate.plnToEur;
      if (displayCurrency === "USD") return eurPrice * rate.eurToUsd;
      return eurPrice;
    },
    [displayCurrency, exchangeRate],
  );

  const formatWatchlistCurrency = useCallback(
    (price: number, ticker: string) => {
      const converted = convertToWatchlistCurrency(price, getTickerCurrency(ticker));
      return new Intl.NumberFormat("sk-SK", {
        style: "currency",
        currency: displayCurrency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(converted);
    },
    [convertToWatchlistCurrency, displayCurrency, getTickerCurrency],
  );

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search.trim(), 300);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<WatchlistItem | null>(null);
  const [editTarget, setEditTarget] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editTags, setEditTags] = useState("");

  const { data: watchlistData, isLoading: listLoading } = useQuery<{ items: WatchlistItem[] }>({
    queryKey: ["/api/watchlist"],
    queryFn: async () => {
      const res = await fetch("/api/watchlist", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load watchlist");
      return res.json();
    },
  });

  const items = watchlistData?.items ?? [];

  const filteredItems = useMemo(() => {
    if (!selectedTag) return items;
    return items.filter((item) => item.tags.some((t) => t.toLowerCase() === selectedTag.toLowerCase()));
  }, [items, selectedTag]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      for (const tag of item.tags) set.add(tag);
    }
    return Array.from(set).sort();
  }, [items]);

  const tickers = useMemo(() => items.map((i) => i.ticker), [items]);

  const { data: quotesData, isLoading: quotesLoading } = useQuery<{ quotes: Record<string, StockQuote> }>({
    queryKey: ["/api/quotes", "watchlist", tickers.join(",")],
    enabled: tickers.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch("/api/stocks/quotes/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tickers, refresh: false }),
      });
      if (!res.ok) throw new Error("Failed to fetch quotes");
      const data = await res.json();
      return { quotes: data.quotes as Record<string, StockQuote> };
    },
  });

  const quotes = quotesData?.quotes ?? {};

  const { data: earningsData } = useQuery<{ earnings: Record<string, { date: string } | null> }>({
    queryKey: ["/api/earnings", "watchlist", tickers.join(",")],
    enabled: tickers.length > 0,
    staleTime: 45 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch("/api/stocks/earnings/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tickers }),
      });
      if (!res.ok) throw new Error("Failed to fetch earnings");
      const data = await res.json();
      return { earnings: data.earnings as Record<string, { date: string } | null> };
    },
  });

  const earningsByTicker = earningsData?.earnings ?? {};

  const { data: searchResults, isFetching: searchLoading } = useQuery<SearchResult[]>({
    queryKey: ["/api/stocks/search", debouncedSearch],
    queryFn: async () => {
      const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(debouncedSearch)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: debouncedSearch.length >= 1,
  });

  const addMutation = useMutation({
    mutationFn: async (payload: { ticker: string; companyName: string }) => {
      return apiRequest("POST", "/api/watchlist", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      setSearch("");
      toast({ title: "Pridané do watchlistu" });
    },
    onError: (err: Error) => {
      toast({
        title: "Nepodarilo sa pridať",
        description: err.message.includes("409") ? "Ticker už je vo watchliste." : undefined,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      ticker,
      body,
    }: {
      ticker: string;
      body: { targetPrice?: number | null; notes?: string; tags?: string };
    }) => apiRequest("PATCH", `/api/watchlist/${encodeURIComponent(ticker)}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      setEditItem(null);
      toast({ title: "Watchlist aktualizovaný" });
    },
    onError: () => {
      toast({ title: "Uloženie zlyhalo", variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (ticker: string) =>
      apiRequest("DELETE", `/api/watchlist/${encodeURIComponent(ticker)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      setEditItem(null);
      toast({ title: "Odstránené z watchlistu" });
    },
  });

  const openEdit = (item: WatchlistItem) => {
    setEditItem(item);
    setEditTarget(item.targetPrice != null ? String(item.targetPrice) : "");
    setEditNotes(item.notes ?? "");
    setEditTags(item.tags.map((t) => `#${t}`).join(" "));
  };

  const saveEdit = () => {
    if (!editItem) return;
    let targetPrice: number | null | undefined = undefined;
    if (editTarget.trim() === "") {
      targetPrice = null;
    } else {
      const n = Number(editTarget.replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) {
        toast({ title: "Neplatná cieľová cena", variant: "destructive" });
        return;
      }
      targetPrice = n;
    }
    updateMutation.mutate({
      ticker: editItem.ticker,
      body: {
        targetPrice,
        notes: editNotes.trim(),
        tags: editTags.trim(),
      },
    });
  };

  const formatQuoteLabel = (ticker: string, nativePrice: number) =>
    formatWatchlistCurrency(nativePrice, ticker);

  const showSearchResults = debouncedSearch.length >= 1 && search.trim().length >= 1;

  return (
    <div className="flex flex-col gap-3 md:gap-6 pb-6 md:pb-8">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold flex items-center gap-2 flex-wrap">
            <Eye className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
            Watchlist
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Sledované akcie s metrikami, cieľovou cenou a poznámkami
          </p>
        </div>
        <div
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-[10px] text-muted-foreground"
          aria-label="Mena zobrazenia cien"
        >
          <span className={cn("font-medium tabular-nums", displayCurrency === "USD" && "text-foreground")}>
            USD
          </span>
          <Switch
            checked={displayCurrency === "EUR"}
            onCheckedChange={(checked) => setDisplayCurrency(checked ? "EUR" : "USD")}
            className="scale-[0.72] origin-center"
            aria-label={displayCurrency === "EUR" ? "Prepnúť na USD" : "Prepnúť na EUR"}
          />
          <span className={cn("font-medium tabular-nums", displayCurrency === "EUR" && "text-foreground")}>
            EUR
          </span>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Hľadať ticker alebo názov firmy…"
          className="h-9 pl-8 text-xs"
        />
        {showSearchResults && (
          <Card className="absolute z-20 mt-1 w-full shadow-lg">
            <CardContent className="p-0 max-h-56 overflow-y-auto">
              {searchLoading ? (
                <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Hľadám…
                </div>
              ) : !searchResults?.length ? (
                <p className="p-3 text-xs text-muted-foreground">Žiadne výsledky</p>
              ) : (
                searchResults
                  .filter((r) => r.ticker !== "CASH")
                  .slice(0, 8)
                  .map((result) => {
                    const alreadyAdded = items.some(
                      (i) => i.ticker.toUpperCase() === result.ticker.toUpperCase(),
                    );
                    return (
                      <button
                        key={result.ticker}
                        type="button"
                        disabled={alreadyAdded || addMutation.isPending}
                        onClick={() =>
                          addMutation.mutate({
                            ticker: result.ticker,
                            companyName: result.name,
                          })
                        }
                        className="flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left last:border-0 hover:bg-muted/60 disabled:opacity-50"
                      >
                        <CompanyLogo ticker={result.ticker} companyName={result.name} size="xs" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold">{result.ticker}</div>
                          <div className="truncate text-[10px] text-muted-foreground">{result.name}</div>
                        </div>
                        {alreadyAdded ? (
                          <Badge variant="secondary" className="text-[9px] shrink-0">
                            Pridané
                          </Badge>
                        ) : (
                          <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
                        )}
                      </button>
                    );
                  })
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {allTags.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-0.5 px-0.5">
          <button
            type="button"
            onClick={() => setSelectedTag(null)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium border transition-colors ${
              selectedTag == null
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/50 text-muted-foreground border-border"
            }`}
          >
            Všetky
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium border transition-colors ${
                selectedTag === tag
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/50 text-muted-foreground border-border"
              }`}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {listLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">
              {items.length === 0
                ? "Watchlist je prázdny. Vyhľadaj akciu vyššie a pridaj ju."
                : "Žiadna položka nezodpovedá vybranému tagu."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-1.5">
          {filteredItems.map((item) => {
            const quote = quotes[item.ticker];
            const divYield =
              quote?.price && quote.annualDividendPerShare
                ? (quote.annualDividendPerShare / quote.price) * 100
                : null;
            const nearTarget =
              item.targetPrice != null &&
              quote?.price != null &&
              quote.price > 0 &&
              quote.price <= item.targetPrice * 1.02;
            const dropToTargetPct =
              item.targetPrice != null && quote?.price
                ? targetDropPercent(quote.price, item.targetPrice)
                : null;

            const showOffHoursDailyChange = shouldShowExtendedQuote(
              usSessionState,
              quote?.marketState,
              quote?.preMarketChangePercent,
            );
            const displayDailyChange = getDisplayDailyChange(quote, usSessionState);

            return (
              <Card
                key={item.id}
                className="relative overflow-hidden cursor-pointer active:bg-muted/30 transition-colors"
                onClick={() => openEdit(item)}
              >
                {displayDailyChange !== 0 && (
                  <div
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute inset-0 bg-gradient-to-l from-35% to-transparent",
                      displayDailyChange > 0
                        ? "from-green-500/10 dark:from-green-500/15"
                        : "from-red-500/10 dark:from-red-500/15",
                    )}
                  />
                )}
                <CardContent className="relative p-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <a
                      href={yahooFinanceUrl(item.ticker)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex min-w-0 flex-1 items-center gap-1.5 group"
                      title="Otvoriť na Yahoo Finance"
                    >
                      <CompanyLogo
                        ticker={item.ticker}
                        companyName={item.companyName ?? item.ticker}
                        size="xs"
                      />
                      <div className="min-w-0 leading-tight">
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-semibold group-hover:text-primary">
                            {item.ticker}
                          </span>
                          <ExternalLink className="h-2.5 w-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        </div>
                        <p className="truncate text-[9px] text-muted-foreground">
                          {item.companyName || item.ticker}
                        </p>
                      </div>
                    </a>

                    <div className="shrink-0 flex items-center gap-1 leading-none">
                      {quotesLoading && !quote ? (
                        <Skeleton className="h-3.5 w-16" />
                      ) : quote ? (
                        <>
                          {usSessionState === "LIVE" && Number.isFinite(quote.changePercent) ? (
                            <span
                              className={`text-[10px] font-medium tabular-nums ${getChangeColor(quote.change)}`}
                            >
                              {formatPercent(quote.changePercent)}
                            </span>
                          ) : showOffHoursDailyChange ? (
                            <span
                              className={`text-[10px] font-medium tabular-nums inline-flex items-center gap-0.5 ${getChangeColor(quote.preMarketChange ?? 0)}`}
                            >
                              <Moon className={`h-2 w-2 shrink-0 ${premarketMoonClass}`} aria-hidden />
                              {formatPercent(quote.preMarketChangePercent ?? 0)}
                            </span>
                          ) : Number.isFinite(quote.changePercent) ? (
                            <span
                              className={`text-[10px] font-medium tabular-nums ${getChangeColor(quote.change)}`}
                            >
                              {formatPercent(quote.changePercent)}
                            </span>
                          ) : null}
                          <span className="text-xs font-semibold tabular-nums">
                            {formatWatchlistCurrency(quote.price, item.ticker)}
                          </span>
                        </>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>

                  {quote && (
                    <Range52Bar
                      price={quote.price}
                      low52={quote.low52}
                      high52={quote.high52}
                      formatLabel={(v) => formatQuoteLabel(item.ticker, v)}
                    />
                  )}

                  <div className="flex items-end justify-between gap-2 text-[8px] text-muted-foreground leading-tight">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0 flex-1">
                      <span>
                        P/E{" "}
                        <span className="text-foreground font-medium tabular-nums">
                          {quote?.trailingPE ? quote.trailingPE.toFixed(1) : "—"}
                        </span>
                      </span>
                      <span>
                        Div.{" "}
                        <span className="text-foreground font-medium tabular-nums">
                          {divYield != null ? `${divYield.toFixed(2)}%` : "—"}
                        </span>
                      </span>
                      {item.targetPrice != null && (
                        <span className="inline-flex items-center gap-0.5 flex-wrap">
                          <Target className="h-3 w-3" />
                          <span className="text-foreground font-medium tabular-nums">
                            {formatQuoteLabel(item.ticker, item.targetPrice)}
                          </span>
                          {dropToTargetPct != null && dropToTargetPct > 0 && (
                            <span className="text-red-500 font-medium tabular-nums">
                              −{dropToTargetPct.toFixed(1)}%
                            </span>
                          )}
                          {dropToTargetPct === 0 && (
                            <span className="text-green-500 font-medium">Na cieli</span>
                          )}
                          {nearTarget && dropToTargetPct != null && dropToTargetPct > 0 && (
                            <Badge className="ml-0.5 h-4 px-1 text-[8px] bg-green-600 hover:bg-green-600">
                              Blízko cieľa
                            </Badge>
                          )}
                        </span>
                      )}
                    </div>
                    {earningsByTicker[item.ticker]?.date ? (
                      <span className="shrink-0 text-right whitespace-nowrap">
                        Earnings{" "}
                        <span className="text-foreground font-medium tabular-nums">
                          {formatEarningsDate(earningsByTicker[item.ticker]!.date)}
                        </span>
                      </span>
                    ) : null}
                  </div>

                  {item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {item.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className="text-[9px] px-1.5 py-0 h-4 font-normal"
                        >
                          <Tag className="h-2.5 w-2.5 mr-0.5" />#{tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {item.notes?.trim() && (
                    <p className="text-[9px] text-muted-foreground line-clamp-1 leading-tight">
                      {item.notes}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Sheet open={!!editItem} onOpenChange={(open) => !open && setEditItem(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-xl">
          {editItem && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-base">
                  <CompanyLogo
                    ticker={editItem.ticker}
                    companyName={editItem.companyName ?? editItem.ticker}
                    size="sm"
                  />
                  {editItem.ticker}
                </SheetTitle>
                <SheetDescription className="text-xs">
                  {editItem.companyName || "Uprav cieľovú cenu, poznámky a tagy"}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-4 py-4">
                <div className="space-y-1.5">
                  <Label htmlFor="target-price" className="text-xs">
                    Cieľová nákupná cena
                  </Label>
                  <Input
                    id="target-price"
                    inputMode="decimal"
                    placeholder="napr. 12"
                    value={editTarget}
                    onChange={(e) => setEditTarget(e.target.value)}
                    className="h-9 text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    V mene kotácie ({getTickerCurrency(editItem.ticker)}). Upozornenie pri blízkosti cieľa.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="notes" className="text-xs">
                    Poznámky
                  </Label>
                  <Textarea
                    id="notes"
                    placeholder="Počkám si na Q3 výsledky…"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="min-h-[80px] text-xs resize-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="tags" className="text-xs">
                    Tagy / kategórie
                  </Label>
                  <Input
                    id="tags"
                    placeholder="#jadro #fintech #dividendy"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
              </div>

              <SheetFooter className="flex-col gap-2 sm:flex-col">
                <Button
                  className="w-full h-9 text-xs"
                  onClick={saveEdit}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? "Ukladám…" : "Uložiť"}
                </Button>
                <Button
                  variant="destructive"
                  className="w-full h-9 text-xs"
                  onClick={() => removeMutation.mutate(editItem.ticker)}
                  disabled={removeMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Odstrániť z watchlistu
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
