import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { format, parse } from "date-fns";
import { sk } from "date-fns/locale";
import { LayoutList, Loader2, Plus, Rows2, Search, Star, X } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  getUsMarketSessionState,
  shouldShowExtendedQuote,
  shouldUseExtendedQuotes,
} from "@/lib/usMarketSession";
import { cn } from "@/lib/utils";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  Dialog,
  EmptyState,
  Input,
  TopBar,
  WatchlistCard,
  trendFromNumber,
} from "@/redesign/ui";
import type { Currency } from "@shared/schema";
import type { QuoteCurrency } from "@shared/tickerCurrency";
import { PageBody } from "./mobileChrome";

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

type WatchlistViewMode = "classic" | "simple";

const WATCHLIST_DISPLAY_CURRENCY_KEY = "moneiqwise.watchlist.displayCurrency";
const WATCHLIST_VIEW_MODE_KEY = "moneiqwise.watchlist.viewMode";

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function readWatchlistDisplayCurrency(fallback: Currency): Currency {
  if (typeof window === "undefined") return fallback;
  const stored = window.localStorage.getItem(WATCHLIST_DISPLAY_CURRENCY_KEY);
  if (stored === "EUR" || stored === "USD") return stored;
  return fallback;
}

function writeWatchlistDisplayCurrency(value: Currency) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WATCHLIST_DISPLAY_CURRENCY_KEY, value);
}

function readWatchlistViewMode(): WatchlistViewMode {
  if (typeof window === "undefined") return "classic";
  const stored = window.localStorage.getItem(WATCHLIST_VIEW_MODE_KEY);
  if (stored === "classic" || stored === "simple") return stored;
  return "classic";
}

function writeWatchlistViewMode(value: WatchlistViewMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WATCHLIST_VIEW_MODE_KEY, value);
}

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatEarningsDate(iso: string): string {
  try {
    return format(parse(iso, "yyyy-MM-dd", new Date()), "d.M.yyyy", { locale: sk });
  } catch {
    return iso;
  }
}

function rangePosition(price: number, low52: number, high52: number): number {
  if (!Number.isFinite(low52) || !Number.isFinite(high52) || high52 <= low52 || price <= 0) return 0;
  return Math.min(100, Math.max(0, ((price - low52) / (high52 - low52)) * 100));
}

function yahooFinanceUrl(ticker: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`;
}

function SortableWatchCard({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("relative", isDragging && "z-30 opacity-90")}
    >
      {disabled ? null : (
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label="Presunúť položku"
          className="absolute left-1 top-2 z-10 h-11 w-10 touch-none"
          {...attributes}
          {...listeners}
        />
      )}
      {children}
    </div>
  );
}

export default function WatchlistMobile() {
  const { currency, exchangeRate, getTickerCurrency } = useCurrency();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const usSessionState = useMemo(() => getUsMarketSessionState(), []);
  const [displayCurrency, setDisplayCurrency] = useState<Currency>(() =>
    readWatchlistDisplayCurrency(currency === "USD" ? "USD" : "EUR"),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(WATCHLIST_DISPLAY_CURRENCY_KEY)) return;
    if (currency === "EUR" || currency === "USD") setDisplayCurrency(currency);
  }, [currency]);

  const setWatchlistDisplayCurrency = useCallback((next: Currency) => {
    setDisplayCurrency(next);
    writeWatchlistDisplayCurrency(next);
  }, []);

  const [viewMode, setViewMode] = useState<WatchlistViewMode>(() => readWatchlistViewMode());
  const setWatchlistViewMode = useCallback((next: WatchlistViewMode) => {
    setViewMode(next);
    writeWatchlistViewMode(next);
  }, []);

  const convertToWatchlistCurrency = useCallback(
    (price: number, source: QuoteCurrency) => {
      const rate = exchangeRate;
      let eurPrice = price;
      if (source === "USD") eurPrice = price * rate.usdToEur;
      else if (source === "GBP") eurPrice = price * rate.gbpToEur;
      else if (source === "CZK") eurPrice = price * rate.czkToEur;
      else if (source === "PLN") eurPrice = price * rate.plnToEur;
      else if (source === "HKD") eurPrice = price * rate.hkdToEur;
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
  const [localItems, setLocalItems] = useState<WatchlistItem[]>([]);
  const scrollLockMainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!selectedTag) setLocalItems(items);
  }, [items, selectedTag]);

  const canReorder = !selectedTag && localItems.length > 1;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 1000, tolerance: 12 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const unlockPageScroll = useCallback(() => {
    const main = scrollLockMainRef.current;
    if (!main) return;
    main.style.overflow = "";
    main.style.touchAction = "";
    scrollLockMainRef.current = null;
  }, []);

  const handleDragStart = useCallback(() => {
    const main = document.querySelector("main");
    if (!main) return;
    scrollLockMainRef.current = main;
    main.style.overflow = "hidden";
    main.style.touchAction = "none";
  }, []);

  const handleDragCancel = useCallback(
    (_event: DragCancelEvent) => {
      unlockPageScroll();
    },
    [unlockPageScroll],
  );

  const filteredItems = useMemo(() => {
    if (selectedTag) {
      return items.filter((item) => item.tags.some((tag) => tag.toLowerCase() === selectedTag.toLowerCase()));
    }
    return localItems;
  }, [items, localItems, selectedTag]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      for (const tag of item.tags) set.add(tag);
    }
    return Array.from(set).sort();
  }, [items]);

  const tickers = useMemo(() => items.map((item) => item.ticker), [items]);

  const { data: quotesData, isLoading: quotesLoading } = useQuery<{ quotes: Record<string, StockQuote> }>({
    queryKey: ["/api/quotes", "watchlist", tickers.join(",")],
    enabled: tickers.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch("/api/stocks/quotes/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          tickers,
          refresh: shouldUseExtendedQuotes(getUsMarketSessionState()),
        }),
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
    mutationFn: async (payload: { ticker: string; companyName: string }) => apiRequest("POST", "/api/watchlist", payload),
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
    mutationFn: async (ticker: string) => apiRequest("DELETE", `/api/watchlist/${encodeURIComponent(ticker)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      setEditItem(null);
      toast({ title: "Odstránené z watchlistu" });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: string[]) => apiRequest("POST", "/api/watchlist/reorder", { orderedIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({ title: "Nepodarilo sa zmeniť poradie", variant: "destructive" });
    },
  });

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      unlockPageScroll();
      const { active, over } = event;
      if (!over || active.id === over.id || selectedTag) return;
      setLocalItems((prev) => {
        const oldIndex = prev.findIndex((item) => item.id === active.id);
        const newIndex = prev.findIndex((item) => item.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return prev;
        const next = arrayMove(prev, oldIndex, newIndex);
        reorderMutation.mutate(next.map((item) => item.id));
        return next;
      });
    },
    [reorderMutation, selectedTag, unlockPageScroll],
  );

  useEffect(() => () => unlockPageScroll(), [unlockPageScroll]);

  const openEdit = (item: WatchlistItem) => {
    setEditItem(item);
    setEditTarget(item.targetPrice != null ? String(item.targetPrice) : "");
    setEditNotes(item.notes ?? "");
    setEditTags(item.tags.map((tag) => `#${tag}`).join(" "));
  };

  const saveEdit = () => {
    if (!editItem) return;
    let targetPrice: number | null | undefined;
    if (editTarget.trim() === "") {
      targetPrice = null;
    } else {
      const parsed = Number(editTarget.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        toast({ title: "Neplatná cieľová cena", variant: "destructive" });
        return;
      }
      targetPrice = parsed;
    }
    updateMutation.mutate({
      ticker: editItem.ticker,
      body: { targetPrice, notes: editNotes.trim(), tags: editTags.trim() },
    });
  };

  const showSearchResults = debouncedSearch.length >= 1 && search.trim().length >= 1;
  const visibleResults = (searchResults ?? []).filter((result) => result.ticker !== "CASH").slice(0, 8);
  const cardView = viewMode === "simple" ? "Compact" : "Detailed";

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline="Sledované akcie" title="Watchlist" />
      <PageBody className="gap-2 pb-8">
        <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
          Sledované akcie s metrikami, cieľovou cenou a poznámkami
        </p>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1" aria-label="Mena zobrazenia cien">
            <Chip active={displayCurrency === "USD"} onClick={() => setWatchlistDisplayCurrency("USD")}>
              USD
            </Chip>
            <Chip active={displayCurrency === "EUR"} onClick={() => setWatchlistDisplayCurrency("EUR")}>
              EUR
            </Chip>
          </div>
          <div
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-1 [background-image:var(--rd-bg-surface-gradient)]"
            aria-label="Režim zobrazenia watchlistu"
          >
            <button
              type="button"
              aria-label="Detailné zobrazenie"
              aria-pressed={viewMode === "classic"}
              onClick={() => setWatchlistViewMode("classic")}
              className={cn(
                "inline-flex h-7 w-9 items-center justify-center rounded-full",
                viewMode === "classic"
                  ? "bg-[var(--rd-bg-surface-hover)] text-[var(--rd-text-primary)]"
                  : "text-[var(--rd-text-tertiary)]",
              )}
            >
              <LayoutList className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Kompaktné zobrazenie"
              aria-pressed={viewMode === "simple"}
              onClick={() => setWatchlistViewMode("simple")}
              className={cn(
                "inline-flex h-7 w-9 items-center justify-center rounded-full",
                viewMode === "simple"
                  ? "bg-[var(--rd-bg-surface-hover)] text-[var(--rd-text-primary)]"
                  : "text-[var(--rd-text-tertiary)]",
              )}
            >
              <Rows2 className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 z-10 size-[18px] -translate-y-1/2 text-[var(--rd-text-tertiary)]"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Hľadať ticker alebo názov firmy…"
            mono={false}
            className="pl-9 pr-9"
            aria-label="Hľadať ticker alebo názov firmy"
          />
          {search ? (
            <button
              type="button"
              aria-label="Vymazať hľadanie"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center text-[var(--rd-text-tertiary)]"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        {showSearchResults ? (
          <Card className="gap-0 overflow-hidden p-0">
            {searchLoading ? (
              <p className="flex items-center gap-2 px-3 py-3 text-xs text-[var(--rd-text-secondary)]">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Hľadám…
              </p>
            ) : visibleResults.length === 0 ? (
              <p className="px-3 py-3 text-xs text-[var(--rd-text-secondary)]">Žiadne výsledky</p>
            ) : (
              visibleResults.map((result) => {
                const alreadyAdded = items.some((item) => item.ticker.toUpperCase() === result.ticker.toUpperCase());
                return (
                  <button
                    key={result.ticker}
                    type="button"
                    disabled={alreadyAdded || addMutation.isPending}
                    onClick={() => addMutation.mutate({ ticker: result.ticker, companyName: result.name })}
                    className="flex w-full items-center gap-3 border-b border-[var(--rd-border-subtle)] px-3 py-3 text-left last:border-0 disabled:opacity-50"
                  >
                    <Avatar ticker={result.ticker} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-sm font-medium leading-5">{result.ticker}</span>
                      <span className="block truncate text-xs leading-4 text-[var(--rd-text-tertiary)]">{result.name}</span>
                    </span>
                    {alreadyAdded ? (
                      <Badge label="Pridané" />
                    ) : (
                      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--rd-profit-dim)] text-[var(--rd-profit)]">
                        <Plus className="size-4" aria-hidden />
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </Card>
        ) : null}

        {allTags.length > 0 ? (
          <div className="flex gap-1 overflow-x-auto">
            <Chip active={selectedTag == null} onClick={() => setSelectedTag(null)}>
              Všetky
            </Chip>
            {allTags.map((tag) => (
              <Chip
                key={tag}
                active={selectedTag === tag}
                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              >
                #{tag}
              </Chip>
            ))}
          </div>
        ) : null}

        {listLoading ? (
          <p className="text-xs text-[var(--rd-text-secondary)]">Načítavam watchlist…</p>
        ) : filteredItems.length === 0 ? (
          <EmptyState
            title="Watchlist je prázdny"
            body={
              items.length === 0
                ? "Vyhľadaj akciu vyššie a pridaj ju."
                : "Žiadna položka nezodpovedá vybranému tagu."
            }
            icon={<Star className="size-5" aria-hidden />}
          />
        ) : (
          <>
            {canReorder ? (
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                Podržte ikonu vľavo (~1 s) a presuňte kartu hore/dole pre zmenu poradia.
              </p>
            ) : null}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragCancel={handleDragCancel}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={filteredItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                <div className={cn("flex flex-col gap-2", showSearchResults && "opacity-40")}>
                  {filteredItems.map((item) => {
                    const quote = quotes[item.ticker];
                    const showOffHours = shouldShowExtendedQuote(
                      usSessionState,
                      quote?.marketState,
                      quote?.preMarketChangePercent,
                    );
                    const changeValue =
                      usSessionState === "LIVE"
                        ? quote?.change ?? 0
                        : showOffHours
                          ? quote?.preMarketChange ?? 0
                          : quote?.change ?? 0;
                    const changePercent =
                      usSessionState === "LIVE"
                        ? quote?.changePercent
                        : showOffHours
                          ? quote?.preMarketChangePercent ?? 0
                          : quote?.changePercent;
                    const divYield =
                      quote?.price && quote.annualDividendPerShare
                        ? (quote.annualDividendPerShare / quote.price) * 100
                        : null;
                    const earningsDate = earningsByTicker[item.ticker]?.date;
                    const priceLabel =
                      quotesLoading && !quote
                        ? "…"
                        : quote
                          ? formatWatchlistCurrency(quote.price, item.ticker)
                          : "—";

                    return (
                      <SortableWatchCard key={item.id} id={item.id} disabled={!canReorder}>
                        <WatchlistCard
                          view={cardView}
                          ticker={item.ticker}
                          name={item.companyName || item.ticker}
                          price={priceLabel}
                          delta={
                            quote && changePercent != null && Number.isFinite(changePercent)
                              ? formatPercent(changePercent)
                              : "—"
                          }
                          trend={quote ? trendFromNumber(changeValue) : "Flat"}
                          showMoon={showOffHours}
                          low={quote ? formatWatchlistCurrency(quote.low52, item.ticker) : "—"}
                          high={quote ? formatWatchlistCurrency(quote.high52, item.ticker) : "—"}
                          position={quote ? rangePosition(quote.price, quote.low52, quote.high52) : 0}
                          pe={quote?.trailingPE ? quote.trailingPE.toFixed(1) : "—"}
                          dividend={divYield != null ? `${divYield.toFixed(2)}%` : "—"}
                          earnings={earningsDate ? formatEarningsDate(earningsDate) : "—"}
                          onOpen={() => window.open(yahooFinanceUrl(item.ticker), "_blank", "noopener,noreferrer")}
                          onSelect={() => openEdit(item)}
                        />
                      </SortableWatchCard>
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          </>
        )}
      </PageBody>

      <Dialog
        open={!!editItem}
        title={editItem ? editItem.ticker : "Upraviť"}
        body="Cieľová cena, poznámky a tagy"
        onClose={() => setEditItem(null)}
      >
        {editItem ? (
          <div className="mt-3 flex max-h-[65vh] flex-col gap-3 overflow-y-auto">
            <Input
              label="Cieľová nákupná cena"
              inputMode="decimal"
              placeholder="napr. 12"
              value={editTarget}
              onChange={(event) => setEditTarget(event.target.value)}
            />
            <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">
              V mene kotácie ({getTickerCurrency(editItem.ticker)}).
            </p>
            <Input
              label="Poznámky"
              mono={false}
              placeholder="Počkám si na Q3 výsledky…"
              value={editNotes}
              onChange={(event) => setEditNotes(event.target.value)}
            />
            <Input
              label="Tagy / kategórie"
              mono={false}
              placeholder="#jadro #fintech #dividendy"
              value={editTags}
              onChange={(event) => setEditTags(event.target.value)}
            />
            <Button className="w-full" onClick={saveEdit} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Ukladám…" : "Uložiť"}
            </Button>
            <Button
              variant="Secondary"
              className="w-full"
              onClick={() => removeMutation.mutate(editItem.ticker)}
              disabled={removeMutation.isPending}
            >
              Odstrániť z watchlistu
            </Button>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
