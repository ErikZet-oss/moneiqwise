/**
 * Cardmarket low len z anglických ponúk (language=1, pole From).
 * Denný price guide je minimum cez všetky jazyky a použije sa len keď sa anglická stránka nenačíta.
 */

import { fetchEnglishFromProductPage } from "./cardmarketProductPage";

const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 15 * 60 * 1000;

export type EnglishLowResult = { status: "ok"; low: number | null } | { status: "unavailable" };

type CacheEntry = {
  at: number;
  result: EnglishLowResult;
};

const cache = new Map<string, CacheEntry>();
let unavailableLoggedAt = 0;

async function requestEnglishLow(productId: string): Promise<number | null> {
  return fetchEnglishFromProductPage(productId);
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
  const ids = Array.from(new Set(productIds.map((id) => (id ?? "").trim()).filter((id) => /^\d{1,12}$/.test(id))));
  const out = new Map<string, EnglishLowResult>();
  const queue = [...ids];
  const workers = Array.from({ length: Math.min(1, queue.length) }, async () => {
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) return;
      out.set(id, await fetchEnglishCardmarketLow(id));
    }
  });
  await Promise.all(workers);
  return out;
}
