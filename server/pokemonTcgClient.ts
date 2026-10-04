import type { PokemonCardHit } from "@shared/pokemonTcg";
import { pokemonCardmarketProductId, pokemonEuLowCardId } from "@shared/pokemonTcg";
import { fetchSealedEuLow } from "./cardmarketSealed";

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
  const low = card.pricing?.cardmarket?.low;
  const productId = card.pricing?.cardmarket?.idProduct;
  return {
    externalId,
    name,
    setName: (card.set?.name ?? "").trim(),
    number: (card.localId ?? "").trim(),
    imageUrl: imageUrl(card.image),
    euLowEur: typeof low === "number" && Number.isFinite(low) && low > 0 ? low : null,
    cardmarketUrl:
      typeof productId === "number"
        ? `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${productId}`
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
  const details = await Promise.all(ranked.map((item) => fetchCard(item.id ?? "")));
  return details.filter((hit): hit is PokemonCardHit => hit != null);
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
};

function quoteFromLow(ticker: string, low: number): PokemonEuLowQuote {
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
  };
}

/** Aktuálny európsky low (Cardmarket) pre raw kartu alebo sealed z katalógu. */
export async function fetchPokemonEuLowQuote(ticker: string): Promise<PokemonEuLowQuote | null> {
  const sealedId = pokemonCardmarketProductId(ticker);
  if (sealedId) {
    const low = await fetchSealedEuLow(sealedId);
    return low == null ? null : quoteFromLow(ticker, low);
  }
  const cardId = pokemonEuLowCardId(ticker);
  if (!cardId) return null;
  const res = await fetch(`${TCGDEX}/${encodeURIComponent(cardId)}`, { signal: AbortSignal.timeout(12000) });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`TCGdex ${res.status}`);
  }
  const card = (await res.json()) as TcgdexCard;
  const low = card.pricing?.cardmarket?.low;
  if (typeof low !== "number" || !Number.isFinite(low) || !(low > 0)) return null;
  return quoteFromLow(ticker, low);
}
