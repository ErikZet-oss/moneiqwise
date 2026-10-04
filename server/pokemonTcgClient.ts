import type { PokemonCardHit } from "@shared/pokemonTcg";
import { pokemonCardmarketProductId, pokemonEuLowCardId } from "@shared/pokemonTcg";
import { fetchSealedEuLow } from "./cardmarketSealed";
import { fetchEnglishCardmarketLow, fetchEnglishCardmarketLows, resolveCardmarketLow } from "./cardmarketEnglishLow";

const TCGDEX = "https://api.tcgdex.net/v2/en/cards";

type TcgdexListItem = {
  id?: string;
  name?: string;
  image?: string;
};

type TcgdexCard = {
  id?: string;
  name?: string;
  localId?: string;
  image?: string;
  set?: { name?: string };
  pricing?: {
    cardmarket?: {
      low?: number | null;
      idProduct?: number | null;
    };
  };
};

function imageUrl(base: string | undefined): string | null {
  const v = (base ?? "").trim();
  if (!v.startsWith("https://")) return null;
  return v.endsWith(".webp") || v.endsWith(".png") ? v : `${v}/low.webp`;
}

function asHit(card: TcgdexCard): PokemonCardHit | null {
  const externalId = (card.id ?? "").trim().toLowerCase();
  const name = (card.name ?? "").trim();
  if (!externalId || !name) return null;
  const productId = card.pricing?.cardmarket?.idProduct;
  const guideLow = card.pricing?.cardmarket?.low;
  const guide = typeof guideLow === "number" && Number.isFinite(guideLow) && guideLow > 0 ? guideLow : null;
  return {
    externalId,
    name,
    setName: (card.set?.name ?? "").trim(),
    number: (card.localId ?? "").trim(),
    imageUrl: imageUrl(card.image),
    euLowEur: guide,
    lowLanguage: guide != null ? "any" : null,
    cardmarketUrl:
      typeof productId === "number"
        ? `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${productId}&language=1`
        : null,
    cardmarketId: typeof productId === "number" ? String(productId) : null,
  };
}

async function fetchCard(id: string): Promise<PokemonCardHit | null> {
  const res = await fetch(`${TCGDEX}/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) return null;
  const card = (await res.json()) as TcgdexCard;
  return asHit(card);
}

/** Vyhľadanie kariet. Cena je Cardmarket low v EUR (európsky low). */
export async function searchPokemonCards(query: string): Promise<PokemonCardHit[]> {
  const safe = query.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, " ").replace(/\s+/g, " ").trim();
  if (safe.length < 2) return [];
  const res = await fetch(`${TCGDEX}?name=${encodeURIComponent(safe)}`, {
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    throw new Error(`TCGdex ${res.status}`);
  }
  const list = (await res.json()) as TcgdexListItem[];
  if (!Array.isArray(list) || list.length === 0) return [];
  const tokens = safe.toLowerCase().split(" ").filter(Boolean);
  const ranked = list
    .filter((item) => {
      const name = (item.name ?? "").toLowerCase();
      return tokens.every((token) => name.includes(token));
    })
    .sort((a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image)))
    .slice(0, 8);
  const details = (await Promise.all(ranked.map((item) => fetchCard(item.id ?? "")))).filter(
    (hit): hit is PokemonCardHit => hit != null,
  );
  const lows = await fetchEnglishCardmarketLows(details.map((hit) => hit.cardmarketId));
  return details.map((hit) => ({
    ...hit,
    ...resolveCardmarketLow(hit.cardmarketId ? lows.get(hit.cardmarketId) : undefined, hit.euLowEur),
  }));
}

export type PokemonEuLowQuote = {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  quoteDate: null;
  marketState: "CLOSED";
  isMarketOpen: false;
  preMarketPrice: null;
  preMarketChange: null;
  preMarketChangePercent: null;
  high52: number;
  low52: number;
  annualDividendPerShare: 0;
  priceLanguage: "en" | "any";
};

function quoteFromLow(ticker: string, low: number, priceLanguage: "en" | "any"): PokemonEuLowQuote {
  return {
    ticker: ticker.toUpperCase(),
    price: low,
    change: 0,
    changePercent: 0,
    quoteDate: null,
    marketState: "CLOSED",
    isMarketOpen: false,
    preMarketPrice: null,
    preMarketChange: null,
    preMarketChangePercent: null,
    high52: low,
    low52: low,
    annualDividendPerShare: 0,
    priceLanguage,
  };
}

/** Aktuálny Cardmarket low len z anglických ponúk, pre raw kartu alebo sealed. */
export async function fetchPokemonEuLowQuote(ticker: string): Promise<PokemonEuLowQuote | null> {
  const sealedId = pokemonCardmarketProductId(ticker);
  if (sealedId) {
    const low = await fetchSealedEuLow(sealedId);
    return low == null ? null : quoteFromLow(ticker, low.price, low.priceLanguage);
  }
  const cardId = pokemonEuLowCardId(ticker);
  if (!cardId) return null;
  const res = await fetch(`${TCGDEX}/${encodeURIComponent(cardId)}`, { signal: AbortSignal.timeout(12000) });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`TCGdex ${res.status}`);
  }
  const card = (await res.json()) as TcgdexCard;
  const guideRaw = card.pricing?.cardmarket?.low;
  const guide = typeof guideRaw === "number" && Number.isFinite(guideRaw) && guideRaw > 0 ? guideRaw : null;
  const productId = card.pricing?.cardmarket?.idProduct;
  if (typeof productId !== "number") return guide == null ? null : quoteFromLow(ticker, guide, "any");
  const english = await fetchEnglishCardmarketLow(String(productId));
  const resolved = resolveCardmarketLow(english, guide);
  return resolved.euLowEur == null || resolved.lowLanguage == null
    ? null
    : quoteFromLow(ticker, resolved.euLowEur, resolved.lowLanguage);
}
