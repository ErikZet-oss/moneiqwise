import { toYahooTicker } from "../yahooTicker";

export type AiBotNewsItem = {
  query: string;
  ticker: string | null;
  title: string;
  link: string;
  publisher: string;
  publishedAt: number;
  summary: string;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const MACRO_QUERIES = [
  "stock market today",
  "Federal Reserve inflation interest rates",
  "Trump tariffs trade war",
  "geopolitics Middle East Ukraine oil",
  "ECB Europe economy",
  "AI semiconductor chip stocks",
];

async function fetchYahooNewsForQuery(
  query: string,
  newsCount = 6,
): Promise<Omit<AiBotNewsItem, "query" | "ticker">[]> {
  const url =
    `https://query2.finance.yahoo.com/v1/finance/search` +
    `?q=${encodeURIComponent(query)}` +
    `&quotesCount=0&newsCount=${newsCount}` +
    `&enableFuzzyQuery=false` +
    `&quotesQueryId=tss_match_phrase_query` +
    `&multiQuoteQueryId=multi_quote_single_token_query` +
    `&newsQueryId=news_cie_vespa` +
    `&enableCb=false&enableNavLinks=false`;

  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    news?: Array<{
      title?: string;
      link?: string;
      publisher?: string;
      providerPublishTime?: number;
      summary?: string;
    }>;
  };
  if (!Array.isArray(data.news)) return [];
  return data.news
    .map((a) => ({
      title: String(a.title || "").trim(),
      link: String(a.link || "").trim(),
      publisher: String(a.publisher || "Yahoo Finance").trim(),
      publishedAt: Number(a.providerPublishTime) || Math.floor(Date.now() / 1000),
      summary: String(a.summary || "").trim().slice(0, 280),
    }))
    .filter((a) => a.title.length > 0);
}

export async function collectAiBotNewsContext(input: {
  holdingTickers: string[];
}): Promise<{ news: AiBotNewsItem[]; sourcesUsed: string[] }> {
  const sourcesUsed = ["yahoo_news"];
  const news: AiBotNewsItem[] = [];
  const seen = new Set<string>();

  const pushUnique = (item: AiBotNewsItem) => {
    const key = item.title.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    news.push(item);
  };

  // Top holdingy (max 8) — články k konkrétnym tickerom
  const tickers = input.holdingTickers.slice(0, 8);
  await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const yahoo = toYahooTicker(ticker);
        const rows = await fetchYahooNewsForQuery(yahoo, 4);
        for (const row of rows) {
          pushUnique({
            query: ticker,
            ticker,
            ...row,
          });
        }
      } catch (err) {
        console.warn(`[ai-bot] news for ${ticker} failed:`, err);
      }
    }),
  );

  // Makro / geopolitika / Fed / Trump…
  await Promise.all(
    MACRO_QUERIES.map(async (q) => {
      try {
        const rows = await fetchYahooNewsForQuery(q, 5);
        for (const row of rows.slice(0, 3)) {
          pushUnique({
            query: q,
            ticker: null,
            ...row,
          });
        }
      } catch (err) {
        console.warn(`[ai-bot] macro news "${q}" failed:`, err);
      }
    }),
  );

  // Preferuj novšie, max ~28 položiek do promptu
  news.sort((a, b) => b.publishedAt - a.publishedAt);
  return { news: news.slice(0, 28), sourcesUsed };
}
