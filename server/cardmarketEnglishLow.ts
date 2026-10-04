/**
 * Cardmarket low len z anglických ponúk (idLanguage = 1).
 * Denný price guide je minimum cez všetky jazyky, to sem nepatrí.
 */

const ARTICLES_URL = "https://apiv2.cardmarket.com/ws/v2.0/output.json/articles";
const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 15 * 60 * 1000;
const ENGLISH_LANGUAGE_ID = 1;

export type EnglishLowResult = { status: "ok"; low: number | null } | { status: "unavailable" };

type CacheEntry = {
  at: number;
  result: EnglishLowResult;
};

const cache = new Map<string, CacheEntry>();
let unavailableLoggedAt = 0;

type Article = {
  price?: number | string;
  isSigned?: boolean;
  isAltered?: boolean;
  language?: { idLanguage?: number | string };
};

function articleList(body: unknown): Article[] {
  if (!body || typeof body !== "object") return [];
  const raw = (body as { article?: unknown }).article;
  if (Array.isArray(raw)) return raw.filter((row): row is Article => !!row && typeof row === "object");
  if (raw && typeof raw === "object") return [raw as Article];
  return [];
}

function englishPrice(article: Article): number | null {
  if (article.isSigned === true || article.isAltered === true) return null;
  const languageId = article.language?.idLanguage;
  if (languageId != null && Number(languageId) !== ENGLISH_LANGUAGE_ID) return null;
  const price = typeof article.price === "number" ? article.price : Number(article.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return price;
}

async function requestEnglishLow(productId: string): Promise<number | null> {
  const url = `${ARTICLES_URL}/${productId}?idLanguage=${ENGLISH_LANGUAGE_ID}&start=0&maxResults=100`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Cardmarket articles ${res.status}`);
  }
  const prices = articleList(await res.json())
    .map(englishPrice)
    .filter((price): price is number => price != null);
  if (prices.length === 0) return null;
  return Math.min(...prices);
}

/** Najlacnejšia anglická ponuka v EUR. `unavailable` znamená, že sa zoznam ponúk nenačítal. */
export async function fetchEnglishCardmarketLow(productId: string): Promise<EnglishLowResult> {
  const id = productId.trim();
  if (!/^\d{1,12}$/.test(id)) return { status: "ok", low: null };
  const cached = cache.get(id);
  if (cached) {
    const ttl = cached.result.status === "ok" ? SUCCESS_TTL_MS : FAILURE_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.result;
  }
  try {
    const result: EnglishLowResult = { status: "ok", low: await requestEnglishLow(id) };
    cache.set(id, { at: Date.now(), result });
    return result;
  } catch (error) {
    if (Date.now() - unavailableLoggedAt > FAILURE_TTL_MS) {
      unavailableLoggedAt = Date.now();
      console.warn("Cardmarket English listings unavailable:", error);
    }
    const result: EnglishLowResult = { status: "unavailable" };
    cache.set(id, { at: Date.now(), result });
    return result;
  }
}

export function resolveCardmarketLow(
  english: EnglishLowResult | undefined,
  guideLow: number | null,
): { euLowEur: number | null; lowLanguage: "en" | "any" | null } {
  if (english?.status === "ok") {
    return { euLowEur: english.low, lowLanguage: english.low != null ? "en" : null };
  }
  if (guideLow != null && guideLow > 0) return { euLowEur: guideLow, lowLanguage: "any" };
  return { euLowEur: null, lowLanguage: null };
}

export async function fetchEnglishCardmarketLows(
  productIds: Array<string | null | undefined>,
): Promise<Map<string, EnglishLowResult>> {
  const ids = [...new Set(productIds.map((id) => (id ?? "").trim()).filter((id) => /^\d{1,12}$/.test(id)))];
  const out = new Map<string, EnglishLowResult>();
  const queue = [...ids];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) return;
      out.set(id, await fetchEnglishCardmarketLow(id));
    }
  });
  await Promise.all(workers);
  return out;
}
