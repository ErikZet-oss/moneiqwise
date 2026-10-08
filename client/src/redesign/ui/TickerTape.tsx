import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  TICKER_ROWS,
  fetchTickerQuotes,
  formatTickerPct,
  formatTickerValue,
} from "@/components/MarketQuoteTicker";

export function TickerTape() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/market-quote-ticker", TICKER_ROWS.map((row) => row.yahoo)],
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
      setShouldAnimate(!reducedMotion.matches);
    };
    update();
    reducedMotion.addEventListener("change", update);
    return () => reducedMotion.removeEventListener("change", update);
  }, [isLoading, data]);

  const renderItems = (duplicate = false) =>
    TICKER_ROWS.map((row) => {
      const quote = data?.[row.yahoo.toUpperCase()];
      const pct = quote?.changePercent ?? NaN;
      const pctClass =
        pct > 0 ? "text-[var(--rd-profit)]" : pct < 0 ? "text-[var(--rd-loss)]" : "text-[var(--rd-text-tertiary)]";
      return (
        <div
          key={`${row.yahoo}${duplicate ? "-dup" : ""}`}
          className="flex shrink-0 items-center gap-2 font-mono text-[10px] leading-3"
        >
          <span className="text-[var(--rd-text-tertiary)]">{row.label}</span>
          <span className="text-[var(--rd-text-primary)]">
            {isLoading ? "…" : quote ? formatTickerValue(quote.price, row.decimals) : "—"}
          </span>
          {!isLoading && quote ? <span className={pctClass}>{formatTickerPct(pct)}</span> : null}
        </div>
      );
    });

  return (
    <div className="shrink-0 bg-[var(--rd-bg-surface)]" data-testid="redesign-ticker-tape">
      <div ref={viewportRef} className={cn(shouldAnimate ? "overflow-hidden" : "overflow-x-auto")}>
        <div className={cn(shouldAnimate && "market-ticker-track")}>
          <div ref={contentRef} className="flex min-h-7 items-center gap-5 px-4 py-2">
            {renderItems(false)}
          </div>
          {shouldAnimate ? (
            <div className="flex min-h-7 items-center gap-5 px-4 py-2" aria-hidden>
              {renderItems(true)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
