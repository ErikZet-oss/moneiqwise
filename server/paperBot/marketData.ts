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

export type CandleTf = "1d" | "1h" | "15m";

export type OhlcSeries = {
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  lastPrice: number | null;
  interval: string;
};

export function normalizeCandleTf(raw: string | null | undefined): CandleTf {
  const v = String(raw || "1d").toLowerCase();
  if (v === "15m" || v === "15min") return "15m";
  if (v === "1h" || v === "60m" || v === "1hr") return "1h";
  return "1d";
}

export function candleTfQuery(tf: CandleTf): {
  interval: string;
  range: string;
  minBars: number;
} {
  if (tf === "15m") return { interval: "15m", range: "60d", minBars: 80 };
  if (tf === "1h") return { interval: "60m", range: "730d", minBars: 60 };
  return { interval: "1d", range: "2y", minBars: 60 };
}

function alignPositive(
  high: (number | null)[] | undefined,
  low: (number | null)[] | undefined,
  close: (number | null)[] | undefined,
  volume?: (number | null)[] | undefined,
): { highs: number[]; lows: number[]; closes: number[]; volumes: number[] } {
  const h = high ?? [];
  const l = low ?? [];
  const c = close ?? [];
  const vol = volume ?? [];
  const n = Math.min(h.length, l.length, c.length);
  const highs: number[] = [];
  const lows: number[] = [];
  const closes: number[] = [];
  const volumes: number[] = [];
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
      const vv = Number(vol[i]);
      volumes.push(Number.isFinite(vv) && vv >= 0 ? vv : 0);
    }
  }
  return { highs, lows, closes, volumes };
}

export async function fetchOhlc(
  ticker: string,
  opts?: { tf?: CandleTf | string; range?: string },
): Promise<OhlcSeries> {
  const tf = normalizeCandleTf(opts?.tf);
  const qParams = candleTfQuery(tf);
  const interval = qParams.interval;
  const range = opts?.range || qParams.range;
  const yahoo = toYahooTicker(ticker);
  try {
    const yf = getYahooFinance();
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}`;
    const data = (await yf._fetch(
      url,
      { interval, range, includePrePost: "false" },
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
              volume?: (number | null)[];
            }>;
          };
        }>;
      };
    };
    const result = data?.chart?.result?.[0];
    const q = result?.indicators?.quote?.[0];
    const { highs, lows, closes, volumes } = alignPositive(
      q?.high,
      q?.low,
      q?.close,
      q?.volume,
    );
    const metaPrice = Number(result?.meta?.regularMarketPrice);
    const lastPrice =
      Number.isFinite(metaPrice) && metaPrice > 0
        ? metaPrice
        : closes.length
          ? closes[closes.length - 1]!
          : null;
    return { closes, highs, lows, volumes, lastPrice, interval };
  } catch (err) {
    console.warn(`[paper-bot] chart failed for ${yahoo} (${interval}):`, err);
    return {
      closes: [],
      highs: [],
      lows: [],
      volumes: [],
      lastPrice: null,
      interval,
    };
  }
}

export async function fetchDailyOhlc(
  ticker: string,
  range = "1y",
): Promise<OhlcSeries> {
  return fetchOhlc(ticker, { tf: "1d", range });
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
