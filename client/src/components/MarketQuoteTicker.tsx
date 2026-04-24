import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const TICKER_ROWS: { yahoo: string; label: string; decimals: number }[] = [
  { yahoo: "EURUSD=X", label: "EUR/USD", decimals: 4 },
  { yahoo: "BTC-USD", label: "BTC/USD", decimals: 0 },
  { yahoo: "^GSPC", label: "S&P 500", decimals: 2 },
  { yahoo: "^IXIC", label: "Nasdaq", decimals: 2 },
  { yahoo: "^VIX", label: "VIX", decimals: 2 },
  { yahoo: "^TNX", label: "TNX", decimals: 2 },
  { yahoo: "GC=F", label: "Gold", decimals: 2 },
  { yahoo: "CL=F", label: "Oil", decimals: 2 },
];

interface QuoteRow {
  price: number;
  changePercent: number;
}

async function fetchTickerQuotes(): Promise<Record<string, QuoteRow>> {
  const res = await fetch("/api/stocks/quotes/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ tickers: TICKER_ROWS.map((r) => r.yahoo), refresh: false }),
  });
  if (!res.ok) throw new Error("ticker quotes");
  const data = (await res.json()) as { quotes?: Record<string, QuoteRow> };
  return data.quotes ?? {};
}

function formatValue(price: number, decimals: number) {
  if (!Number.isFinite(price)) return "—";
  return price.toLocaleString("sk-SK", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatPct(pct: number) {
  if (!Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export function MarketQuoteTicker() {
  const { isMobile, state } = useSidebar();
  const padForSidebar = !isMobile && state === "expanded";
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/market-quote-ticker", TICKER_ROWS.map((r) => r.yahoo)],
    queryFn: fetchTickerQuotes,
    staleTime: 60 * 1000,
    refetchInterval: 120 * 1000,
  });

  useEffect(() => {
    if (isLoading) {
      setShouldAnimate(false);
      return;
    }

    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      const overflows = content.scrollWidth - viewport.clientWidth > 8;
      setShouldAnimate(overflows && !reducedMotion.matches);
    };

    update();

    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(content);
    reducedMotion.addEventListener("change", update);

    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener("change", update);
    };
  }, [isLoading, data]);

  const renderItems = (duplicate = false) =>
    isLoading
      ? TICKER_ROWS.map((row) => (
          <div
            key={`${row.yahoo}${duplicate ? "-dup-loading" : "-loading"}`}
            className="flex shrink-0 items-baseline gap-1.5 text-[10px] sm:text-xs"
          >
            <span className="font-medium text-foreground/80">{row.label}</span>
            <span className="tabular-nums opacity-50">…</span>
          </div>
        ))
      : TICKER_ROWS.map((row) => {
          const key = row.yahoo.toUpperCase();
          const q = data?.[key];
          const pct = q?.changePercent ?? NaN;
          const up = pct > 0;
          const down = pct < 0;
          const pctCls = up ? "text-emerald-600 dark:text-emerald-500" : down ? "text-red-600 dark:text-red-500" : "text-muted-foreground";
          return (
            <div
              key={`${row.yahoo}${duplicate ? "-dup" : ""}`}
              className="flex shrink-0 items-baseline gap-1.5 text-[10px] sm:text-xs"
            >
              <span className="font-medium text-foreground/85">{row.label}</span>
              <span className="tabular-nums text-foreground/90">
                {q ? formatValue(q.price, row.decimals) : "—"}
              </span>
              <span className={`tabular-nums ${pctCls}`}>{q ? formatPct(pct) : ""}</span>
            </div>
          );
        });

  return (
    <div
      className={cn(
        "shrink-0 border-b border-border/50 bg-muted/50 text-muted-foreground transition-[padding-left] duration-200 ease-linear",
        padForSidebar && "md:pl-[var(--sidebar-width)]"
      )}
      data-testid="market-quote-ticker"
    >
      <div
        ref={viewportRef}
        className={cn(
          shouldAnimate
            ? "overflow-hidden"
            : "overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        <div className={cn(shouldAnimate && "market-ticker-track")}>
          <div ref={contentRef} className="flex min-h-[28px] items-center gap-4 px-3 py-1 sm:gap-6 sm:px-4">
            {renderItems(false)}
          </div>
          {shouldAnimate && (
            <div className="flex min-h-[28px] items-center gap-4 px-3 py-1 sm:gap-6 sm:px-4" aria-hidden>
              {renderItems(true)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
