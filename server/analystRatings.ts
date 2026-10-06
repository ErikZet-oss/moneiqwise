/**
 * Analyst ratings / price targets pre detail aktíva (Yahoo quoteSummary).
 */
import YahooFinance from "yahoo-finance2";
import { toYahooTicker } from "./yahooTicker";

export type AnalystRecommendationBucket = {
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
};

export type AnalystHistoryItem = {
  date: string | null;
  firm: string;
  action: string | null;
  fromGrade: string | null;
  toGrade: string | null;
  priceTarget: number | null;
  priorPriceTarget: number | null;
  priceTargetAction: string | null;
};

export type AnalystRatingsPayload = {
  ticker: string;
  currency: string | null;
  currentPrice: number | null;
  targetMean: number | null;
  targetMedian: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  /** % od aktuálnej ceny k mean targetu (kladné = upside). */
  upsidePercent: number | null;
  recommendationKey: string | null;
  recommendationMean: number | null;
  numberOfAnalystOpinions: number | null;
  recommendationTrend: AnalystRecommendationBucket | null;
  history: AnalystHistoryItem[];
  source: "yahoo" | null;
};

type CacheEntry = { t: number; v: AnalystRatingsPayload };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

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
  if (v == null) return null;
  if (typeof v === "object" && v !== null && "raw" in v) {
    return num((v as { raw: unknown }).raw);
  }
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function isoDateFromUnknown(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date && Number.isFinite(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  }
  if (typeof v === "object" && v !== null && "raw" in v) {
    return isoDateFromUnknown((v as { raw: unknown }).raw);
  }
  return null;
}

function emptyPayload(ticker: string): AnalystRatingsPayload {
  return {
    ticker,
    currency: null,
    currentPrice: null,
    targetMean: null,
    targetMedian: null,
    targetHigh: null,
    targetLow: null,
    upsidePercent: null,
    recommendationKey: null,
    recommendationMean: null,
    numberOfAnalystOpinions: null,
    recommendationTrend: null,
    history: [],
    source: null,
  };
}

function pickTrendBucket(trend: unknown): AnalystRecommendationBucket | null {
  if (!trend || typeof trend !== "object") return null;
  const arr = (trend as { trend?: unknown[] }).trend;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  // Prefer "0m" (current month), else first row
  const row =
    arr.find((r) => r && typeof r === "object" && (r as { period?: string }).period === "0m") ??
    arr[0];
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  return {
    strongBuy: num(o.strongBuy) ?? 0,
    buy: num(o.buy) ?? 0,
    hold: num(o.hold) ?? 0,
    sell: num(o.sell) ?? 0,
    strongSell: num(o.strongSell) ?? 0,
  };
}

export async function fetchAnalystRatingsForAsset(ticker: string): Promise<AnalystRatingsPayload> {
  const key = ticker.trim().toUpperCase();
  if (!key || key === "CASH") return emptyPayload(ticker);

  const cached = cache.get(key);
  if (cached && Date.now() - cached.t < CACHE_TTL_MS) return cached.v;

  const yahooTicker = toYahooTicker(key);
  try {
    const result = await getYahooFinance().quoteSummary(yahooTicker, {
      modules: ["financialData", "recommendationTrend", "upgradeDowngradeHistory", "price"],
    });

    const fin = (result.financialData ?? {}) as Record<string, unknown>;
    const priceMod = (result.price ?? {}) as Record<string, unknown>;
    const currentPrice =
      num(fin.currentPrice) ??
      num(priceMod.regularMarketPrice) ??
      num((priceMod.regularMarketPrice as { raw?: unknown } | undefined)?.raw);

    const targetMean = num(fin.targetMeanPrice);
    const targetMedian = num(fin.targetMedianPrice);
    const targetHigh = num(fin.targetHighPrice);
    const targetLow = num(fin.targetLowPrice);

    let upsidePercent: number | null = null;
    if (currentPrice != null && currentPrice > 0 && targetMean != null) {
      upsidePercent = ((targetMean - currentPrice) / currentPrice) * 100;
    }

    const historyRaw = (result.upgradeDowngradeHistory as { history?: unknown[] } | undefined)
      ?.history;
    const history: AnalystHistoryItem[] = [];
    if (Array.isArray(historyRaw)) {
      for (const item of historyRaw.slice(0, 40)) {
        if (!item || typeof item !== "object") continue;
        const h = item as Record<string, unknown>;
        history.push({
          date: isoDateFromUnknown(h.epochGradeDate),
          firm: str(h.firm) ?? "Neznámy analytik",
          action: str(h.action),
          fromGrade: str(h.fromGrade),
          toGrade: str(h.toGrade),
          priceTarget: num(h.currentPriceTarget),
          priorPriceTarget: num(h.priorPriceTarget),
          priceTargetAction: str(h.priceTargetAction),
        });
      }
    }

    const currency =
      str(fin.financialCurrency) ??
      str(priceMod.currency) ??
      null;

    const payload: AnalystRatingsPayload = {
      ticker: key,
      currency,
      currentPrice,
      targetMean,
      targetMedian,
      targetHigh,
      targetLow,
      upsidePercent,
      recommendationKey: str(fin.recommendationKey),
      recommendationMean: num(fin.recommendationMean),
      numberOfAnalystOpinions: num(fin.numberOfAnalystOpinions),
      recommendationTrend: pickTrendBucket(result.recommendationTrend),
      history,
      source: "yahoo",
    };

    cache.set(key, { t: Date.now(), v: payload });
    return payload;
  } catch (err) {
    console.warn(`[analystRatings] Yahoo failed for ${key}:`, err);
    const empty = emptyPayload(key);
    cache.set(key, { t: Date.now(), v: empty });
    return empty;
  }
}
