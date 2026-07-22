/** Yahoo Fundamentals fallback keď Finviz z Renderu zlyhá / vráti prázdne metriky. */

export type YahooMetricSnapshot = {
  ticker: string;
  companyName: string | null;
  metrics: Record<string, string>;
  source: "yahoo";
};

function toYahooTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\./g, "-");
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

export async function fetchYahooMetricSnapshot(ticker: string): Promise<YahooMetricSnapshot> {
  const yahooTicker = toYahooTicker(ticker);
  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooTicker)}` +
    `?modules=price,summaryDetail,defaultKeyStatistics,financialData`;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Yahoo HTTP ${response.status}`);
  }

  const data = await response.json();
  const result = data?.quoteSummary?.result?.[0];
  if (!result) {
    throw new Error("Yahoo empty quoteSummary");
  }

  const price = result.price ?? {};
  const summary = result.summaryDetail ?? {};
  const stats = result.defaultKeyStatistics ?? {};
  const fin = result.financialData ?? {};

  const metrics: Record<string, string> = {};
  set(metrics, "Price", price.regularMarketPrice ?? summary.regularMarketPrice);
  set(metrics, "Change", price.regularMarketChangePercent);
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
    throw new Error("Yahoo metrics empty");
  }

  return {
    ticker: ticker.toUpperCase(),
    companyName,
    metrics,
    source: "yahoo",
  };
}
