import type { AiScannerStrategy, AiScannerStrategyId } from "./strategies";
import type { FinvizScreenerRow } from "./scraper";

/**
 * Finviz is often blocked from cloud hosts. Use Yahoo predefined screeners instead —
 * one HTTP call returns ~25 ranked tickers with PE, price, change, etc.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

type YahooScreenerQuote = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  quoteType?: string;
  sector?: string;
  industry?: string;
  marketCap?: number;
  trailingPE?: number;
  forwardPE?: number;
  peTTM?: number;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  fiftyTwoWeekChangePercent?: number;
  trailingAnnualDividendYield?: number;
  dividendYield?: number;
  averageDailyVolume3Month?: number;
  averageVolume?: number;
  regularMarketVolume?: number;
};

const SCREENER_IDS: Record<AiScannerStrategyId, string[]> = {
  dip_buyer: ["day_losers"],
  garp: ["undervalued_growth_stocks", "growth_technology_stocks"],
  dividend: ["undervalued_large_caps", "portfolio_anchors"],
};

async function fetchPredefinedScreener(scrId: string, count = 40): Promise<YahooScreenerQuote[]> {
  const url =
    `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved` +
    `?formatted=false&lang=en-US&region=US&scrIds=${encodeURIComponent(scrId)}&count=${count}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json,text/plain,*/*",
    },
    signal: AbortSignal.timeout(25_000),
  });

  if (!res.ok) {
    throw new Error(`Yahoo screener ${scrId}: HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    finance?: { result?: Array<{ quotes?: YahooScreenerQuote[] }> };
  };
  return data?.finance?.result?.[0]?.quotes ?? [];
}

function formatMarketCap(n: number | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return String(Math.round(n));
}

function dividendYieldPct(q: YahooScreenerQuote): number | null {
  const raw = q.trailingAnnualDividendYield ?? q.dividendYield;
  if (raw == null || !Number.isFinite(raw)) return null;
  // Yahoo sometimes returns 0.025 (ratio) and sometimes 2.5 (already %)
  if (raw > 0 && raw < 1) return raw * 100;
  return raw;
}

function isLikelyEquity(q: YahooScreenerQuote): boolean {
  const t = (q.quoteType || "").toUpperCase();
  if (t === "ETF" || t === "MUTUALFUND" || t === "INDEX") return false;
  const sym = (q.symbol || "").toUpperCase();
  if (!sym || sym.includes("=") || sym.includes("^")) return false;
  if (t && t !== "EQUITY" && t !== "STOCK") return false;
  return true;
}

function toScreenerRow(q: YahooScreenerQuote): FinvizScreenerRow {
  const pe = q.trailingPE ?? q.peTTM ?? q.forwardPE ?? null;
  const vol = q.regularMarketVolume ?? q.averageDailyVolume3Month ?? q.averageVolume;
  return {
    ticker: (q.symbol || "").toUpperCase(),
    companyName: q.longName || q.shortName || q.symbol || "",
    sector: q.sector || null,
    industry: q.industry || null,
    marketCap: formatMarketCap(q.marketCap),
    pe: pe != null && Number.isFinite(pe) ? pe : null,
    price: q.regularMarketPrice != null && Number.isFinite(q.regularMarketPrice) ? q.regularMarketPrice : null,
    changePercent:
      q.regularMarketChangePercent != null && Number.isFinite(q.regularMarketChangePercent)
        ? q.regularMarketChangePercent
        : null,
    volume: vol != null && Number.isFinite(vol) ? String(Math.round(vol)) : null,
  };
}

function filterForStrategy(strategyId: AiScannerStrategyId, quotes: YahooScreenerQuote[]): YahooScreenerQuote[] {
  const equities = quotes.filter(isLikelyEquity);

  if (strategyId === "dip_buyer") {
    return equities
      .filter((q) => (q.marketCap ?? 0) >= 2e9 || q.marketCap == null)
      .filter((q) => (q.regularMarketChangePercent ?? 0) < -0.5)
      .sort((a, b) => (a.regularMarketChangePercent ?? 0) - (b.regularMarketChangePercent ?? 0));
  }

  if (strategyId === "garp") {
    return equities
      .filter((q) => {
        const pe = q.trailingPE ?? q.peTTM ?? q.forwardPE;
        if (pe != null && Number.isFinite(pe) && (pe <= 0 || pe > 45)) return false;
        return true;
      })
      .sort((a, b) => {
        const peA = a.forwardPE ?? a.trailingPE ?? 99;
        const peB = b.forwardPE ?? b.trailingPE ?? 99;
        return peA - peB;
      });
  }

  // dividend — Large/Mega (~$10B+) + yield ~2.5%+
  return equities
    .filter((q) => (q.marketCap ?? 0) >= 1e10 || q.marketCap == null)
    .filter((q) => {
      const y = dividendYieldPct(q);
      return y != null && y >= 2.5;
    })
    .sort((a, b) => (dividendYieldPct(b) ?? 0) - (dividendYieldPct(a) ?? 0));
}

/**
 * Screen candidates via Yahoo predefined screener APIs (Finviz fallback).
 */
export async function fetchYahooStrategyScreen(
  strategy: AiScannerStrategy,
): Promise<{ url: string; rows: FinvizScreenerRow[] }> {
  const screenerIds = SCREENER_IDS[strategy.id] ?? ["day_losers"];
  const seen = new Set<string>();
  const merged: YahooScreenerQuote[] = [];
  const usedIds: string[] = [];

  for (const scrId of screenerIds) {
    try {
      const quotes = await fetchPredefinedScreener(scrId, 40);
      usedIds.push(scrId);
      for (const q of quotes) {
        const sym = (q.symbol || "").toUpperCase();
        if (!sym || seen.has(sym)) continue;
        seen.add(sym);
        merged.push(q);
      }
    } catch (err) {
      console.warn(`[yahoo-strategy] screener ${scrId} failed:`, err);
    }
  }

  if (merged.length === 0) {
    throw new Error("Yahoo predefined screener nevrátil žiadne tickery");
  }

  let filtered = filterForStrategy(strategy.id, merged);

  // Soft fallback: if filters were too strict, still return equities from screener
  if (filtered.length === 0) {
    filtered = merged.filter(isLikelyEquity);
  }
  if (filtered.length === 0) {
    filtered = merged;
  }

  const rows = filtered
    .slice(0, 40)
    .map(toScreenerRow)
    .filter((r) => r.ticker.length > 0);

  const url =
    `https://finance.yahoo.com/screener/predefined/${encodeURIComponent(usedIds[0] ?? screenerIds[0])}`;

  return { url, rows };
}
