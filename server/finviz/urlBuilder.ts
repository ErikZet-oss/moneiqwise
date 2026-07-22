import type { AiScannerStrategy } from "./strategies";
import { strategyRuntimeFilters } from "./strategies";

/** Overview table (v=111) — ticker, company, sector, industry, country, market cap, P/E, price, change, volume */
export const FINVIZ_VIEW_OVERVIEW = "111";

export function buildScreenerUrl(strategy: AiScannerStrategy, opts?: { view?: string }): string {
  const view = opts?.view ?? FINVIZ_VIEW_OVERVIEW;
  const f = strategyRuntimeFilters(strategy).join(",");
  const params = new URLSearchParams({
    v: view,
    f,
    ft: "4",
  });
  return `https://finviz.com/screener.ashx?${params.toString()}`;
}

export function buildQuoteUrl(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  return `https://finviz.com/quote.ashx?t=${encodeURIComponent(t)}`;
}
