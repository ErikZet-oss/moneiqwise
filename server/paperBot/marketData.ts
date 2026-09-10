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

export async function fetchDailyCloses(
  ticker: string,
  range = "1y",
): Promise<{ closes: number[]; lastPrice: number | null }> {
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
          indicators?: { quote?: Array<{ close?: (number | null)[] }> };
        }>;
      };
    };
    const result = data?.chart?.result?.[0];
    const raw = result?.indicators?.quote?.[0]?.close ?? [];
    const closes = raw
      .map((c) => Number(c))
      .filter((n) => Number.isFinite(n) && n > 0);
    const metaPrice = Number(result?.meta?.regularMarketPrice);
    const lastPrice =
      Number.isFinite(metaPrice) && metaPrice > 0
        ? metaPrice
        : closes.length
          ? closes[closes.length - 1]!
          : null;
    return { closes, lastPrice };
  } catch (err) {
    console.warn(`[paper-bot] chart failed for ${yahoo}:`, err);
    return { closes: [], lastPrice: null };
  }
}
