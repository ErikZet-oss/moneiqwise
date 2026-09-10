import YahooFinance from "yahoo-finance2";
import { toYahooTicker } from "../yahooTicker";

let yahooFinance: InstanceType<typeof YahooFinance> | null = null;

function getYahooFinance(): InstanceType<typeof YahooFinance> {
  if (!yahooFinance) {
    yahooFinance = new YahooFinance({
      suppressNotices: ["yahooSurvey"],
    });
  }
  return yahooFinance;
}

export type OhlcSeries = {
  closes: number[];
  highs: number[];
  lows: number[];
  lastPrice: number | null;
};

function alignPositive(
  high: (number | null)[] | undefined,
  low: (number | null)[] | undefined,
  close: (number | null)[] | undefined,
): { highs: number[]; lows: number[]; closes: number[] } {
  const h = high ?? [];
  const l = low ?? [];
  const c = close ?? [];
  const n = Math.min(h.length, l.length, c.length);
  const highs: number[] = [];
  const lows: number[] = [];
  const closes: number[] = [];
  for (let i = 0; i < n; i++) {
    const hv = Number(h[i]);
    const lv = Number(l[i]);
    const cv = Number(c[i]);
    if (
      Number.isFinite(hv) &&
      hv > 0 &&
      Number.isFinite(lv) &&
      lv > 0 &&
      Number.isFinite(cv) &&
      cv > 0
    ) {
      highs.push(hv);
      lows.push(lv);
      closes.push(cv);
    }
  }
  return { highs, lows, closes };
}

export async function fetchDailyOhlc(
  ticker: string,
  range = "1y",
): Promise<OhlcSeries> {
  const yahoo = toYahooTicker(ticker);
  try {
    const yf = getYahooFinance();
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}`;
    const data = (await yf._fetch(
      url,
      { interval: "1d", range, includePrePost: "false" },
      {},
      "json",
      true,
    )) as {
      chart?: {
        result?: Array<{
          meta?: { regularMarketPrice?: number };
          indicators?: {
            quote?: Array<{
              high?: (number | null)[];
              low?: (number | null)[];
              close?: (number | null)[];
            }>;
          };
        }>;
      };
    };
    const result = data?.chart?.result?.[0];
    const q = result?.indicators?.quote?.[0];
    const { highs, lows, closes } = alignPositive(q?.high, q?.low, q?.close);
    const metaPrice = Number(result?.meta?.regularMarketPrice);
    const lastPrice =
      Number.isFinite(metaPrice) && metaPrice > 0
        ? metaPrice
        : closes.length
          ? closes[closes.length - 1]!
          : null;
    return { closes, highs, lows, lastPrice };
  } catch (err) {
    console.warn(`[paper-bot] chart failed for ${yahoo}:`, err);
    return { closes: [], highs: [], lows: [], lastPrice: null };
  }
}

/** Back-compat helper. */
export async function fetchDailyCloses(
  ticker: string,
  range = "1y",
): Promise<{ closes: number[]; lastPrice: number | null }> {
  const ohlc = await fetchDailyOhlc(ticker, range);
  return { closes: ohlc.closes, lastPrice: ohlc.lastPrice };
}

/** Fresher mark during RTH — last 1m bar if available. */
export async function fetchLiveMark(ticker: string): Promise<number | null> {
  const yahoo = toYahooTicker(ticker);
  try {
    const yf = getYahooFinance();
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}`;
    const data = (await yf._fetch(
      url,
      { interval: "1m", range: "1d", includePrePost: "true" },
      {},
      "json",
      true,
    )) as {
      chart?: {
        result?: Array<{
          meta?: { regularMarketPrice?: number };
          indicators?: { quote?: Array<{ close?: (number | null)[] }> };
        }>;
      };
    };
    const result = data?.chart?.result?.[0];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    for (let i = closes.length - 1; i >= 0; i--) {
      const n = Number(closes[i]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const meta = Number(result?.meta?.regularMarketPrice);
    return Number.isFinite(meta) && meta > 0 ? meta : null;
  } catch {
    return null;
  }
}
