/** Yahoo Fundamentals fallback keď Finviz z Renderu zlyhá / vráti prázdne metriky. */

import YahooFinance from "yahoo-finance2";
import { toYahooTicker } from "../yahooTicker";

export type YahooMetricSnapshot = {
  ticker: string;
  companyName: string | null;
  metrics: Record<string, string>;
  source: "yahoo";
};

let yahooFinance: InstanceType<typeof YahooFinance> | null = null;

function getYahooFinance(): InstanceType<typeof YahooFinance> {
  if (!yahooFinance) {
    yahooFinance = new YahooFinance({
      suppressNotices: ["yahooSurvey"],
    });
  }
  return yahooFinance;
}

function fmt(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object" && v !== null && "fmt" in v) {
    const f = (v as { fmt?: string }).fmt;
    return typeof f === "string" && f.trim() ? f.trim() : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function set(metrics: Record<string, string>, key: string, value: unknown) {
  const s = fmt(value);
  if (s) metrics[key] = s;
}

function formatPercent(value: unknown): string | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export async function fetchYahooMetricSnapshot(ticker: string): Promise<YahooMetricSnapshot> {
  const yahooTicker = toYahooTicker(ticker);
  const yf = getYahooFinance();

  const result = await yf.quoteSummary(yahooTicker, {
    modules: ["price", "summaryDetail", "defaultKeyStatistics", "financialData"],
  });

  const price = (result.price ?? {}) as Record<string, unknown>;
  const summary = (result.summaryDetail ?? {}) as Record<string, unknown>;
  const stats = (result.defaultKeyStatistics ?? {}) as Record<string, unknown>;
  const fin = (result.financialData ?? {}) as Record<string, unknown>;

  const metrics: Record<string, string> = {};
  set(metrics, "Price", price.regularMarketPrice ?? summary.regularMarketPrice);
  const changePct = formatPercent(price.regularMarketChangePercent ?? summary.regularMarketChangePercent);
  if (changePct) metrics["Change"] = changePct;
  set(metrics, "P/E", summary.trailingPE ?? stats.trailingPE);
  set(metrics, "Forward P/E", summary.forwardPE ?? stats.forwardPE);
  set(metrics, "PEG", stats.pegRatio);
  set(metrics, "EPS (ttm)", stats.trailingEps);
  set(metrics, "Market Cap", price.marketCap ?? summary.marketCap);
  set(metrics, "Dividend %", summary.dividendYield ?? stats.yield);
  set(metrics, "Payout", summary.payoutRatio);
  set(metrics, "Debt/Eq", fin.debtToEquity);
  set(metrics, "ROE", fin.returnOnEquity);
  set(metrics, "ROA", fin.returnOnAssets);
  set(metrics, "Gross Margin", fin.grossMargins);
  set(metrics, "Oper. Margin", fin.operatingMargins);
  set(metrics, "Profit Margin", fin.profitMargins);
  set(metrics, "Target Price", fin.targetMeanPrice);
  set(metrics, "52W High", summary.fiftyTwoWeekHigh);
  set(metrics, "52W Low", summary.fiftyTwoWeekLow);
  set(metrics, "Recom", fin.recommendationMean);
  set(metrics, "Avg Volume", summary.averageVolume);
  set(metrics, "Short Float", stats.shortPercentOfFloat);
  set(metrics, "Insider Own", stats.heldPercentInsiders);
  set(metrics, "Inst Own", stats.heldPercentInstitutions);
  set(metrics, "Sales past 5Y", stats.revenueGrowth);
  set(metrics, "EPS next Y", stats.earningsGrowth);

  const companyName =
    (typeof price.longName === "string" && price.longName) ||
    (typeof price.shortName === "string" && price.shortName) ||
    null;

  if (Object.keys(metrics).length === 0) {
    throw new Error(`Yahoo metrics empty for ${yahooTicker}`);
  }

  return {
    ticker: ticker.toUpperCase(),
    companyName,
    metrics,
    source: "yahoo",
  };
}
