import YahooFinance from "yahoo-finance2";
import { subMonths, subYears, format } from "date-fns";
import { toYahooTicker } from "./yahooTicker";
import { fetchYahooMetricSnapshot } from "./finviz/yahooFallback";

export type WatchlistStockSection = "news" | "chart" | "statistics" | "options" | "holders";

export type WatchlistStockNewsArticle = {
  title: string;
  link: string;
  publisher: string;
  publishedAt: number;
  summary?: string;
  thumbnail?: string | null;
};

export type WatchlistStockChartPoint = {
  date: string;
  close: number;
};

export type WatchlistStockOptionRow = {
  contractSymbol: string;
  strike: number;
  lastPrice: number | null;
  change: number | null;
  percentChange: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  inTheMoney: boolean | null;
};

export type WatchlistStockHolderRow = {
  name: string;
  pctHeld: number | null;
  value: number | null;
  reportDate: string | null;
  pctChange: number | null;
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

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(v: unknown): number | null {
  const n = num(v);
  if (n == null) return null;
  return Math.abs(n) <= 1 ? n * 100 : n;
}

function dateStr(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return format(d, "yyyy-MM-dd");
}

export async function fetchWatchlistStockNews(ticker: string): Promise<WatchlistStockNewsArticle[]> {
  const yahooTicker = toYahooTicker(ticker);
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(yahooTicker)}&quotesCount=0&newsCount=10&enableFuzzyQuery=false&quotesQueryId=tss_match_phrase_query&multiQuoteQueryId=multi_quote_single_token_query&newsQueryId=news_cie_vespa&enableCb=false&enableNavLinks=false`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!response.ok) return [];

  const data = (await response.json()) as {
    news?: Array<{
      title?: string;
      link?: string;
      publisher?: string;
      providerPublishTime?: number;
      summary?: string;
      thumbnail?: { resolutions?: Array<{ url?: string }> };
    }>;
  };

  if (!Array.isArray(data.news)) return [];

  return data.news.map((article) => ({
    title: article.title || "",
    link: article.link || "",
    publisher: article.publisher || "Yahoo Finance",
    publishedAt: article.providerPublishTime || Math.floor(Date.now() / 1000),
    summary: article.summary || "",
    thumbnail: article.thumbnail?.resolutions?.[0]?.url || null,
  }));
}

export async function fetchWatchlistStockChart(
  ticker: string,
  range: "6m" | "1y" | "5y" = "6m",
): Promise<{ range: string; series: WatchlistStockChartPoint[] }> {
  const yahooTicker = toYahooTicker(ticker);
  const yf = getYahooFinance();
  const now = new Date();
  const period1 =
    range === "5y"
      ? subYears(now, 5)
      : range === "1y"
        ? subYears(now, 1)
        : subMonths(now, 6);

  const chart = await yf.chart(yahooTicker, {
    period1: format(period1, "yyyy-MM-dd"),
    interval: "1d",
  });

  const series: WatchlistStockChartPoint[] = (chart.quotes ?? [])
    .map((q) => {
      const close = num(q.close ?? q.adjclose);
      const date = dateStr(q.date);
      if (close == null || !date) return null;
      return { date, close };
    })
    .filter((p): p is WatchlistStockChartPoint => p != null);

  return { range, series };
}

export async function fetchWatchlistStockStatistics(ticker: string) {
  const snapshot = await fetchYahooMetricSnapshot(ticker);
  return {
    companyName: snapshot.companyName,
    metrics: snapshot.metrics,
    source: snapshot.source,
  };
}

function mapOptionRow(row: Record<string, unknown>): WatchlistStockOptionRow {
  return {
    contractSymbol: String(row.contractSymbol ?? ""),
    strike: num(row.strike) ?? 0,
    lastPrice: num(row.lastPrice),
    change: num(row.change),
    percentChange: num(row.percentChange),
    bid: num(row.bid),
    ask: num(row.ask),
    volume: num(row.volume),
    openInterest: num(row.openInterest),
    impliedVolatility: num(row.impliedVolatility),
    inTheMoney: typeof row.inTheMoney === "boolean" ? row.inTheMoney : null,
  };
}

function pickNearMoneyOptions(
  rows: WatchlistStockOptionRow[],
  spot: number | null,
  limit = 12,
): WatchlistStockOptionRow[] {
  if (rows.length === 0) return [];
  const sorted = [...rows].sort((a, b) => {
    if (spot != null) {
      return Math.abs(a.strike - spot) - Math.abs(b.strike - spot);
    }
    return a.strike - b.strike;
  });
  return sorted.slice(0, limit).sort((a, b) => a.strike - b.strike);
}

export async function fetchWatchlistStockOptions(
  ticker: string,
  expirationIndex = 0,
): Promise<{
  expirations: string[];
  selectedExpiration: string | null;
  spotPrice: number | null;
  calls: WatchlistStockOptionRow[];
  puts: WatchlistStockOptionRow[];
}> {
  const yahooTicker = toYahooTicker(ticker);
  const yf = getYahooFinance();
  const result = await yf.options(yahooTicker);

  const expirations = (result.expirationDates ?? [])
    .map((d) => dateStr(d))
    .filter((d): d is string => !!d);

  const idx = Math.min(Math.max(0, expirationIndex), Math.max(0, expirations.length - 1));
  const selectedExpiration = expirations[idx] ?? null;

  const optionSet =
    result.options?.find((o) => dateStr(o.expirationDate) === selectedExpiration) ??
    result.options?.[0];

  const spotPrice = num(result.quote?.regularMarketPrice);
  const calls = pickNearMoneyOptions(
    (optionSet?.calls ?? []).map((r) => mapOptionRow(r as Record<string, unknown>)),
    spotPrice,
  );
  const puts = pickNearMoneyOptions(
    (optionSet?.puts ?? []).map((r) => mapOptionRow(r as Record<string, unknown>)),
    spotPrice,
  );

  return {
    expirations,
    selectedExpiration: selectedExpiration ?? dateStr(optionSet?.expirationDate),
    spotPrice,
    calls,
    puts,
  };
}

export async function fetchWatchlistStockHolders(ticker: string) {
  const yahooTicker = toYahooTicker(ticker);
  const yf = getYahooFinance();
  const result = await yf.quoteSummary(yahooTicker, {
    modules: ["majorHoldersBreakdown", "institutionOwnership", "fundOwnership", "insiderHolders"],
  });

  const breakdown = result.majorHoldersBreakdown as Record<string, unknown> | undefined;

  const mapOwnership = (rows: Array<Record<string, unknown>> | undefined): WatchlistStockHolderRow[] =>
    (rows ?? []).slice(0, 12).map((row) => ({
      name: String(row.organization ?? row.name ?? "—"),
      pctHeld: pct(row.pctHeld),
      value: num(row.value),
      reportDate: dateStr(row.reportDate),
      pctChange: pct(row.pctChange),
    }));

  const mapInsiders = (
    module: { holders?: Array<Record<string, unknown>> } | undefined,
  ): WatchlistStockHolderRow[] =>
    (module?.holders ?? []).slice(0, 12).map((row) => ({
      name: String(row.name ?? "—"),
      pctHeld: null,
      value: num(row.positionDirect),
      reportDate: dateStr(row.latestTransDate),
      pctChange: null,
    }));

  return {
    breakdown: {
      insidersPercentHeld: pct(breakdown?.insidersPercentHeld),
      institutionsPercentHeld: pct(breakdown?.institutionsPercentHeld),
      institutionsFloatPercentHeld: pct(breakdown?.institutionsFloatPercentHeld),
      institutionsCount: num(breakdown?.institutionsCount),
    },
    institutions: mapOwnership(
      (result.institutionOwnership as { ownershipList?: Array<Record<string, unknown>> } | undefined)
        ?.ownershipList,
    ),
    funds: mapOwnership(
      (result.fundOwnership as { ownershipList?: Array<Record<string, unknown>> } | undefined)
        ?.ownershipList,
    ),
    insiders: mapInsiders(result.insiderHolders as { holders?: Array<Record<string, unknown>> } | undefined),
  };
}

export async function fetchWatchlistStockSection(
  ticker: string,
  section: WatchlistStockSection,
  options?: { chartRange?: "6m" | "1y" | "5y"; expirationIndex?: number },
) {
  switch (section) {
    case "news":
      return { section, news: await fetchWatchlistStockNews(ticker) };
    case "chart":
      return {
        section,
        chart: await fetchWatchlistStockChart(ticker, options?.chartRange ?? "6m"),
      };
    case "statistics":
      return { section, statistics: await fetchWatchlistStockStatistics(ticker) };
    case "options":
      return {
        section,
        options: await fetchWatchlistStockOptions(ticker, options?.expirationIndex ?? 0),
      };
    case "holders":
      return { section, holders: await fetchWatchlistStockHolders(ticker) };
    default:
      throw new Error("Invalid section");
  }
}
