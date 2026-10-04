/**
 * Cardmarket low v EUR pre raw karty cez PokéWallet.
 * https://pokewallet.io/api-docs
 *
 * `cardmarket.prices[].low` je denný Cardmarket low (nie len anglické ponuky).
 * Sealed má v tomto API Cardmarket vždy null, graded ceny tam nie sú.
 */

const API_ROOT = "https://api.pokewallet.io";
const SUCCESS_TTL_MS = 12 * 60 * 60 * 1000;
const MISS_TTL_MS = 12 * 60 * 60 * 1000;
const ERROR_TTL_MS = 30 * 60 * 1000;

const EXTRA_NAME_TOKENS = ["ex", "v", "vmax", "vstar", "gx", "break", "ex"];

export type PokewalletLowResult =
  | { status: "ok"; low: number | null }
  | { status: "unconfigured" }
  | { status: "unavailable" };

export type PokewalletCardQuery = {
  name: string;
  setName?: string | null;
  number?: string | null;
  guideLow?: number | null;
};

type PriceRow = { low?: unknown; variant_type?: unknown };
type SearchHit = {
  card_info?: {
    name?: unknown;
    clean_name?: unknown;
    set_name?: unknown;
    card_number?: unknown;
    product_type?: unknown;
  };
  cardmarket?: { prices?: unknown } | null;
};

type CacheEntry = { at: number; ttl: number; low: number | null; failed: boolean };

const cache = new Map<string, CacheEntry>();
let missingKeyLogged = false;
let authLogged = false;

function apiKey(): string {
  return process.env.POKEWALLET_API_KEY?.trim() ?? "";
}

function positive(value: unknown): number | null {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(num) && num > 0 ? num : null;
}

export function normalizeCardText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return normalizeCardText(value).split(" ").filter(Boolean);
}

function cardNumberKey(value: string | null | undefined): string | null {
  const head = (value ?? "").trim().split("/")[0] ?? "";
  const digits = head.replace(/\D/g, "").replace(/^0+/, "");
  return digits || null;
}

/** Názov sa zhoduje aj vo variante ex / V / VMAX, aby sa nenašla iná karta. */
export function cardNamesMatch(wanted: string, got: string): boolean {
  const wantedTokens = tokens(wanted);
  const gotTokens = tokens(got);
  if (wantedTokens.length === 0 || gotTokens.length === 0) return false;
  if (!wantedTokens.every((token) => gotTokens.includes(token))) return false;
  for (const extra of EXTRA_NAME_TOKENS) {
    if (gotTokens.includes(extra) !== wantedTokens.includes(extra)) return false;
  }
  return true;
}

export function scorePokewalletHit(hit: SearchHit, query: PokewalletCardQuery): number {
  const info = hit.card_info;
  if (!info || String(info.product_type ?? "card") === "sealed") return -1;
  const gotName = String(info.clean_name ?? info.name ?? "");
  if (!cardNamesMatch(query.name, gotName)) return -1;
  let score = 6;
  const wantedSet = normalizeCardText(query.setName ?? "");
  const gotSet = normalizeCardText(String(info.set_name ?? ""));
  if (/\bjapan|\bjapanese|\bjp\b/.test(gotSet)) return -1;
  if (wantedSet && gotSet && (gotSet === wantedSet || gotSet.includes(wantedSet) || wantedSet.includes(gotSet))) {
    score += 5;
  }
  const wantedNumber = cardNumberKey(query.number);
  const gotNumber = cardNumberKey(String(info.card_number ?? ""));
  if (wantedNumber && gotNumber && wantedNumber === gotNumber) score += 8;
  else if (wantedNumber && gotNumber) score -= 4;
  if (cardmarketLows(hit).length === 0) score -= 3;
  return score;
}

function cardmarketLows(hit: SearchHit): number[] {
  const prices = hit.cardmarket?.prices;
  if (!Array.isArray(prices)) return [];
  return prices
    .map((row) => positive((row as PriceRow).low))
    .filter((low): low is number => low != null);
}

/** Pri viacerých variantoch (normal/holo) berie low najbližšie k dennému cenníku tej istej karty. */
export function pickCardmarketLow(hit: SearchHit, guideLow?: number | null): number | null {
  const lows = cardmarketLows(hit);
  if (lows.length === 0) return null;
  if (lows.length === 1 || guideLow == null || !Number.isFinite(guideLow)) return lows[0] ?? null;
  return lows.reduce((best, low) => (Math.abs(low - guideLow) < Math.abs(best - guideLow) ? low : best));
}

function cacheKey(query: PokewalletCardQuery): string {
  return [normalizeCardText(query.name), normalizeCardText(query.setName ?? ""), cardNumberKey(query.number) ?? ""].join("|");
}

async function searchCards(query: string): Promise<{ status: number; hits: SearchHit[] } | "auth" | "error"> {
  try {
    const res = await fetch(`${API_ROOT}/search?q=${encodeURIComponent(query)}&limit=20`, {
      headers: { Accept: "application/json", "X-API-Key": apiKey() },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401 || res.status === 403) return "auth";
    if (res.status === 429 || res.status >= 500) return "error";
    if (!res.ok) return "error";
    const body = (await res.json()) as { results?: unknown };
    const hits = Array.isArray(body.results) ? (body.results.filter((row) => row && typeof row === "object") as SearchHit[]) : [];
    return { status: res.status, hits };
  } catch (error) {
    console.warn("PokéWallet request failed:", error instanceof Error ? error.message : error);
    return "error";
  }
}

/** Cardmarket low v EUR pre raw kartu. `low: null` znamená, že sa karta nenašla. */
export async function fetchPokewalletCardmarketLow(query: PokewalletCardQuery): Promise<PokewalletLowResult> {
  const name = query.name.trim();
  if (name.length < 2) return { status: "unavailable" };
  if (!apiKey()) {
    if (!missingKeyLogged) {
      missingKeyLogged = true;
      console.warn("POKEWALLET_API_KEY chýba. Raw karty berú denný Cardmarket cenník z TCGdex.");
    }
    return { status: "unconfigured" };
  }

  const key = cacheKey(query);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < cached.ttl) {
    return cached.failed ? { status: "unavailable" } : { status: "ok", low: cached.low };
  }

  const searchText = [name, query.setName?.trim(), query.number?.trim()].filter(Boolean).join(" ");
  const result = await searchCards(searchText);
  if (result === "auth") {
    if (!authLogged) {
      authLogged = true;
      console.warn("PokéWallet odmietlo kľúč. Skontroluj POKEWALLET_API_KEY.");
    }
    cache.set(key, { at: Date.now(), ttl: ERROR_TTL_MS, low: null, failed: true });
    return { status: "unavailable" };
  }
  if (result === "error") {
    cache.set(key, { at: Date.now(), ttl: ERROR_TTL_MS, low: null, failed: true });
    return { status: "unavailable" };
  }

  const ranked = result.hits
    .map((hit) => ({ hit, score: scorePokewalletHit(hit, query) }))
    .filter((row) => row.score >= 8)
    .sort((a, b) => b.score - a.score);
  const low = ranked[0] ? pickCardmarketLow(ranked[0].hit, query.guideLow) : null;
  cache.set(key, { at: Date.now(), ttl: low == null ? MISS_TTL_MS : SUCCESS_TTL_MS, low, failed: false });
  return { status: "ok", low };
}
