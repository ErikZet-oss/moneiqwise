import type { AiScannerStrategy, AiScannerStrategyId } from "./strategies";
import type { FinvizScreenerRow } from "./scraper";

/**
 * Likvidný US universe pre Yahoo fallback, keď Finviz na cloude (Render) zlyhá.
 * Stačí na TOP 3 výber cez Claude.
 */
const SCREEN_UNIVERSE: string[] = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "AVGO", "AMD", "INTC", "CRM",
  "ORCL", "ADBE", "CSCO", "IBM", "QCOM", "TXN", "AMAT", "MU", "NOW", "SNOW",
  "JPM", "BAC", "WFC", "GS", "MS", "C", "BLK", "SCHW", "AXP", "V",
  "MA", "PYPL", "SOFI", "COIN", "SQ", "BRK-B", "JNJ", "UNH", "PFE", "MRK",
  "ABBV", "LLY", "TMO", "ABT", "BMY", "AMGN", "GILD", "CVS", "CI", "MDT",
  "XOM", "CVX", "COP", "SLB", "EOG", "OXY", "WMT", "COST", "TGT", "HD",
  "LOW", "NKE", "SBUX", "MCD", "KO", "PEP", "PG", "UL", "CL", "MDLZ",
  "DIS", "NFLX", "CMCSA", "T", "VZ", "TMUS", "BA", "CAT", "GE", "HON",
  "UPS", "FDX", "DE", "LMT", "RTX", "NOC", "TSLA", "F", "GM", "UBER",
  "ABNB", "SHOP", "MELI", "SE", "BABA", "NIO", "PLTR", "CRWD", "PANW", "ZS",
  "O", "AMT", "PLD", "SPG", "CCI", "EQIX", "VICI", "WELL", "DLR", "PSA",
  "NEE", "DUK", "SO", "D", "AEP", "SRE", "EXC", "XEL", "PCG", "ED",
  "MO", "PM", "BTI", "TROW", "BEN", "MAIN", "ARCC", "JEPI", "SCHD", "VYM",
];

type YahooBundle = {
  ticker: string;
  companyName: string;
  sector: string | null;
  price: number | null;
  changePercent: number | null;
  pe: number | null;
  marketCap: number | null;
  marketCapLabel: string | null;
  dividendYield: number | null;
  payout: number | null;
  earningsGrowth: number | null;
  revenueGrowth: number | null;
  monthPerfApprox: number | null;
};

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "object" && v !== null && "raw" in v) {
    const n = Number((v as { raw?: unknown }).raw);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatCap(n: number | null): string | null {
  if (n == null || n <= 0) return null;
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return String(Math.round(n));
}

async function fetchYahooBundle(ticker: string): Promise<YahooBundle | null> {
  const yahooTicker = ticker.replace(/\./g, "-");
  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooTicker)}` +
    `?modules=price,summaryDetail,defaultKeyStatistics,financialData,summaryProfile`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const r = data?.quoteSummary?.result?.[0];
    if (!r) return null;

    const priceMod = r.price ?? {};
    const summary = r.summaryDetail ?? {};
    const stats = r.defaultKeyStatistics ?? {};
    const fin = r.financialData ?? {};
    const profile = r.summaryProfile ?? {};

    const price = num(priceMod.regularMarketPrice) ?? num(summary.regularMarketPrice);
    const changePercent = num(priceMod.regularMarketChangePercent);
    // Yahoo often returns change percent as fraction (0.01 = 1%) or already %
    const changePct =
      changePercent != null ? (Math.abs(changePercent) < 1 ? changePercent * 100 : changePercent) : null;

    const pe = num(summary.trailingPE) ?? num(stats.trailingPE);
    const marketCap = num(priceMod.marketCap) ?? num(summary.marketCap);
    let dividendYield = num(summary.dividendYield) ?? num(summary.yield) ?? num(stats.yield);
    if (dividendYield != null && dividendYield > 0 && dividendYield < 1) {
      dividendYield = dividendYield * 100;
    }
    let payout = num(summary.payoutRatio);
    if (payout != null && payout > 0 && payout <= 1.5) {
      payout = payout * 100;
    }
    let earningsGrowth = num(fin.earningsGrowth) ?? num(stats.earningsGrowth);
    if (earningsGrowth != null && Math.abs(earningsGrowth) < 5) {
      earningsGrowth = earningsGrowth * 100;
    }
    let revenueGrowth = num(fin.revenueGrowth) ?? num(stats.revenueGrowth);
    if (revenueGrowth != null && Math.abs(revenueGrowth) < 5) {
      revenueGrowth = revenueGrowth * 100;
    }

    // Approx. 1-month move via 50d / price when available
    const fiftyDay = num(summary.fiftyDayAverage) ?? num(stats.fiftyDayAverage);
    let monthPerfApprox: number | null = null;
    if (price != null && fiftyDay != null && fiftyDay > 0) {
      monthPerfApprox = ((price - fiftyDay) / fiftyDay) * 100;
    }

    const companyName =
      (typeof priceMod.longName === "string" && priceMod.longName) ||
      (typeof priceMod.shortName === "string" && priceMod.shortName) ||
      ticker;

    return {
      ticker,
      companyName,
      sector: typeof profile.sector === "string" ? profile.sector : null,
      price,
      changePercent: changePct,
      pe,
      marketCap,
      marketCapLabel: formatCap(marketCap),
      dividendYield,
      payout,
      earningsGrowth,
      revenueGrowth,
      monthPerfApprox,
    };
  } catch {
    return null;
  }
}

function passesStrategy(bundle: YahooBundle, strategyId: AiScannerStrategyId): boolean {
  const midCapMin = 2e9; // ~$2B mid+
  if (bundle.marketCap != null && bundle.marketCap < midCapMin) return false;
  if (bundle.price == null || bundle.price <= 0) return false;

  switch (strategyId) {
    case "dip_buyer": {
      const perf = bundle.monthPerfApprox ?? bundle.changePercent;
      if (perf == null) return false;
      // v poklese vs 50d priemer alebo denný mínus
      return perf <= -5 || (bundle.changePercent != null && bundle.changePercent <= -2);
    }
    case "garp": {
      if (bundle.pe == null || bundle.pe <= 0 || bundle.pe > 25) return false;
      const eg = bundle.earningsGrowth;
      const rg = bundle.revenueGrowth;
      // aspoň jeden rastový signál
      const growthOk =
        (eg != null && eg >= 10) || (rg != null && rg >= 8) || (eg == null && rg == null && bundle.pe <= 18);
      return growthOk;
    }
    case "dividend": {
      if (bundle.dividendYield == null || bundle.dividendYield < 2.5) return false;
      if (bundle.payout != null && bundle.payout > 85) return false;
      if (bundle.pe != null && bundle.pe > 35) return false;
      return true;
    }
    default:
      return false;
  }
}

function scoreRow(bundle: YahooBundle, strategyId: AiScannerStrategyId): number {
  switch (strategyId) {
    case "dip_buyer":
      return -((bundle.monthPerfApprox ?? bundle.changePercent) ?? 0);
    case "garp": {
      const growth = Math.max(bundle.earningsGrowth ?? 0, bundle.revenueGrowth ?? 0);
      const pe = bundle.pe ?? 25;
      return growth / Math.max(pe, 1);
    }
    case "dividend":
      return (bundle.dividendYield ?? 0) - (bundle.payout != null && bundle.payout > 60 ? 1 : 0);
    default:
      return 0;
  }
}

function toScreenerRow(bundle: YahooBundle): FinvizScreenerRow {
  return {
    ticker: bundle.ticker,
    companyName: bundle.companyName,
    sector: bundle.sector,
    industry: null,
    marketCap: bundle.marketCapLabel,
    pe: bundle.pe,
    price: bundle.price,
    changePercent: bundle.changePercent,
    volume: null,
  };
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const part = await Promise.all(chunk.map(fn));
    out.push(...part);
  }
  return out;
}

/**
 * Yahoo-based strategy screen (fallback keď Finviz scrapovanie zlyhá na Renderi).
 */
export async function fetchYahooStrategyScreen(strategy: AiScannerStrategy): Promise<{
  url: string;
  rows: FinvizScreenerRow[];
  source: "yahoo";
}> {
  const bundles = await mapPool(SCREEN_UNIVERSE, 6, fetchYahooBundle);
  const ok = bundles.filter((b): b is YahooBundle => b != null && passesStrategy(b, strategy.id));
  ok.sort((a, b) => scoreRow(b, strategy.id) - scoreRow(a, strategy.id));
  const rows = ok.slice(0, 40).map(toScreenerRow);

  return {
    url: `yahoo-fallback://${strategy.id}`,
    rows,
    source: "yahoo",
  };
}
