/** Yahoo symbol pre strieborný spot (USD / trójska unca). */
const SILVER_YAHOO_SYMBOL = "SI=F";

type YahooChartMeta = {
  regularMarketPrice?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  regularMarketTime?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
};

async function fetchYahooChart(
  symbol: string,
  range: string,
  interval: string,
): Promise<{ meta: YahooChartMeta; closes: number[]; timestamps: number[] } | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  if (!response.ok) return null;

  const data = (await response.json()) as {
    chart?: { result?: Array<{ meta?: YahooChartMeta; timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> };
  };
  const result = data.chart?.result?.[0];
  if (!result?.meta) return null;

  const timestamps = result.timestamp ?? [];
  const rawCloses = result.indicators?.quote?.[0]?.close ?? [];
  const closes: number[] = [];
  for (let i = 0; i < rawCloses.length; i++) {
    const c = Number(rawCloses[i]);
    if (Number.isFinite(c) && c > 0) closes.push(c);
  }

  return { meta: result.meta, closes, timestamps };
}

export async function fetchSilverSpotQuote(): Promise<{
  price: number;
  change: number;
  changePercent: number;
  high52: number;
  low52: number;
}> {
  const chart = await fetchYahooChart(SILVER_YAHOO_SYMBOL, "1d", "1d");
  if (!chart) throw new Error("Silver spot unavailable");

  const price = Number(chart.meta.regularMarketPrice);
  const previousClose =
    Number(chart.meta.previousClose) ||
    Number(chart.meta.chartPreviousClose) ||
    price;
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Silver spot price invalid");
  }

  const change = Number.isFinite(previousClose) ? price - previousClose : 0;
  const changePercent =
    Number.isFinite(previousClose) && previousClose > 0 ? (change / previousClose) * 100 : 0;

  return {
    price,
    change,
    changePercent,
    high52: Number(chart.meta.fiftyTwoWeekHigh) || 0,
    low52: Number(chart.meta.fiftyTwoWeekLow) || 0,
  };
}

export async function fetchSilverHistoricalPrices(): Promise<Record<string, number>> {
  const now = Math.floor(Date.now() / 1000);
  const fiveYearsAgo = now - 5 * 365 * 24 * 60 * 60;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(SILVER_YAHOO_SYMBOL)}?period1=${fiveYearsAgo}&period2=${now}&interval=1d`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  if (!response.ok) return {};

  const data = (await response.json()) as {
    chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> };
  };
  const result = data.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const prices: Record<string, number> = {};

  for (let i = 0; i < timestamps.length; i++) {
    const c = Number(closes[i]);
    if (!Number.isFinite(c) || c <= 0) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().split("T")[0];
    prices[date] = c;
  }

  return prices;
}

export { SILVER_YAHOO_SYMBOL };
