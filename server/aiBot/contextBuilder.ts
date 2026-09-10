import { storage } from "../storage";
import { toYahooTicker } from "../yahooTicker";
import { fetchYahooV7Quote } from "../yahooQuoteClient";
import { collectAiBotNewsContext, type AiBotNewsItem } from "./newsContext";

export type AiBotHoldingContext = {
  ticker: string;
  companyName: string;
  shares: number;
  averageCost: number;
  price: number | null;
  changePercent: number | null;
  marketValue: number | null;
  weightPct: number | null;
  unrealizedPnlPct: number | null;
  pe: number | null;
};

export type AiBotMoverContext = {
  ticker: string;
  companyName: string;
  price: number | null;
  changePercent: number | null;
  pe: number | null;
  sector: string | null;
};

export type AiBotRunContext = {
  portfolioId: string;
  portfolioLabel: string;
  slotLabel: string;
  holdings: AiBotHoldingContext[];
  totalMarketValue: number;
  movers: AiBotMoverContext[];
  watchlistTickers: string[];
  news: AiBotNewsItem[];
  sourcesUsed: string[];
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function fetchPredefinedScreener(
  scrId: string,
  count = 25,
): Promise<
  Array<{
    symbol?: string;
    shortName?: string;
    longName?: string;
    regularMarketPrice?: number;
    regularMarketChangePercent?: number;
    trailingPE?: number;
    sector?: string;
  }>
> {
  const url =
    `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved` +
    `?formatted=false&lang=en-US&region=US&scrIds=${encodeURIComponent(scrId)}&count=${count}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Yahoo screener ${scrId}: HTTP ${res.status}`);
  const data = (await res.json()) as any;
  const quotes =
    data?.finance?.result?.[0]?.quotes ??
    data?.finance?.result?.[0]?.records ??
    [];
  return Array.isArray(quotes) ? quotes : [];
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function quoteForTicker(ticker: string): Promise<{
  price: number | null;
  changePercent: number | null;
  pe: number | null;
  name: string | null;
}> {
  try {
    const yahoo = toYahooTicker(ticker);
    const row = await fetchYahooV7Quote(yahoo);
    if (!row) return { price: null, changePercent: null, pe: null, name: null };
    return {
      price: num(row.regularMarketPrice),
      changePercent: num(row.regularMarketChangePercent),
      pe: num(row.trailingPE) ?? num(row.forwardPE),
      name:
        (typeof row.shortName === "string" && row.shortName) ||
        (typeof row.longName === "string" && row.longName) ||
        null,
    };
  } catch {
    return { price: null, changePercent: null, pe: null, name: null };
  }
}

export async function buildAiBotContext(
  userId: string,
  portfolioId: string,
  slotLabel: string,
): Promise<AiBotRunContext> {
  const sourcesUsed = ["yahoo_finance", "moneiqwise_holdings"];
  const pf =
    portfolioId && portfolioId !== "all"
      ? await storage.getPortfolioById(portfolioId, userId)
      : null;
  const portfolioLabel =
    portfolioId === "all" || !portfolioId
      ? "Všetky portfóliá"
      : pf?.name || portfolioId;

  const holdingsRaw = await storage.getHoldingsByUser(
    userId,
    portfolioId === "all" ? null : portfolioId,
  );
  const watchlist = await storage.getWatchlistByUser(userId);
  const watchlistTickers = watchlist.map((w) => w.ticker.toUpperCase());
  const heldSet = new Set(holdingsRaw.map((h) => h.ticker.toUpperCase()));

  const holdings: AiBotHoldingContext[] = [];
  for (const h of holdingsRaw) {
    const shares = parseFloat(h.shares);
    const averageCost = parseFloat(h.averageCost);
    if (!Number.isFinite(shares) || shares <= 0) continue;
    const q = await quoteForTicker(h.ticker);
    const price = q.price;
    const marketValue =
      price != null && Number.isFinite(price) ? shares * price : null;
    const unrealizedPnlPct =
      price != null && Number.isFinite(averageCost) && averageCost > 0
        ? ((price - averageCost) / averageCost) * 100
        : null;
    holdings.push({
      ticker: h.ticker.toUpperCase(),
      companyName: h.companyName || q.name || h.ticker,
      shares,
      averageCost: Number.isFinite(averageCost) ? averageCost : 0,
      price,
      changePercent: q.changePercent,
      marketValue,
      weightPct: null,
      unrealizedPnlPct,
      pe: q.pe,
    });
  }

  const totalMarketValue = holdings.reduce(
    (s, h) => s + (h.marketValue ?? 0),
    0,
  );
  for (const h of holdings) {
    h.weightPct =
      totalMarketValue > 0 && h.marketValue != null
        ? (h.marketValue / totalMarketValue) * 100
        : null;
  }
  holdings.sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0));

  const movers: AiBotMoverContext[] = [];
  const moverSeen = new Set<string>();
  for (const scrId of ["day_gainers", "most_actives", "growth_technology_stocks"]) {
    try {
      const quotes = await fetchPredefinedScreener(scrId, 20);
      sourcesUsed.push(`yahoo_screener:${scrId}`);
      for (const q of quotes) {
        const t = String(q.symbol || "").toUpperCase();
        if (!t || heldSet.has(t) || watchlistTickers.includes(t) || moverSeen.has(t)) {
          continue;
        }
        if (String((q as any).quoteType || "").toUpperCase() === "CRYPTOCURRENCY") continue;
        moverSeen.add(t);
        movers.push({
          ticker: t,
          companyName: q.shortName || q.longName || t,
          price: num(q.regularMarketPrice),
          changePercent: num(q.regularMarketChangePercent),
          pe: num(q.trailingPE),
          sector: q.sector || null,
        });
        if (movers.length >= 12) break;
      }
    } catch (err) {
      console.warn(`[ai-bot] screener ${scrId} failed:`, err);
    }
    if (movers.length >= 12) break;
  }

  const { news, sourcesUsed: newsSources } = await collectAiBotNewsContext({
    holdingTickers: holdings.map((h) => h.ticker),
  });
  sourcesUsed.push(...newsSources);

  return {
    portfolioId: portfolioId || "all",
    portfolioLabel,
    slotLabel,
    holdings,
    totalMarketValue,
    movers: movers.slice(0, 10),
    watchlistTickers,
    news,
    sourcesUsed: Array.from(new Set(sourcesUsed)),
  };
}
