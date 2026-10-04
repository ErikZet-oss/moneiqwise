import type { PokemonCardHit } from "@shared/pokemonTcg";
import { pokemonCardmarketProductId, pokemonGradeFromTicker, pokemonTcgdexCardId } from "@shared/pokemonTcg";
import { fetchSealedEuLow, sealedProductName } from "./cardmarketSealed";
import { fetchRapidCardmarketPrice } from "./rapidPokemonPrices";

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
  if (/\.(webp|png|jpe?g)$/i.test(v)) return v;
  return `${v}/high.png`;
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
  return (await Promise.all(ranked.map((item) => fetchCard(item.id ?? "")))).filter(
    (hit): hit is PokemonCardHit => hit != null,
  );
}

const imageCache = new Map<string, string | null>();
const imageByNameCache = new Map<string, string | null>();

/** Obrázok karty z TCGdex. Funguje aj pre graded, lebo sken je ten istý. */
export async function fetchTcgdexImage(cardId: string): Promise<string | null> {
  const id = cardId.trim().toLowerCase();
  if (!id) return null;
  if (imageCache.has(id)) return imageCache.get(id) ?? null;
  try {
    const res = await fetch(`${TCGDEX}/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      imageCache.set(id, null);
      return null;
    }
    const card = (await res.json()) as TcgdexCard;
    const url = imageUrl(card.image);
    imageCache.set(id, url);
    return url;
  } catch {
    return null;
  }
}

/** Fotka raw karty podľa názvu, keď ticker nemá TCGdex id. */
export async function fetchTcgdexImageByName(productName: string, setName?: string | null): Promise<string | null> {
  const name = productName.split("·")[0]?.trim() ?? "";
  if (name.length < 2) return null;
  const set = (setName ?? "").trim().toLowerCase();
  const key = `${name.toLowerCase()}|${set}`;
  if (imageByNameCache.has(key)) return imageByNameCache.get(key) ?? null;
  try {
    const res = await fetch(`${TCGDEX}?name=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const list = (await res.json()) as TcgdexListItem[];
    if (!Array.isArray(list)) return null;
    const wanted = name.toLowerCase();
    const matches = list.filter((item) => (item.name ?? "").trim().toLowerCase() === wanted && item.id);
    const pool = (matches.length > 0 ? matches : list.filter((item) => item.id)).slice(0, 4);
    if (set) {
      for (const item of pool) {
        const cardRes = await fetch(`${TCGDEX}/${encodeURIComponent(item.id ?? "")}`, { signal: AbortSignal.timeout(8000) });
        if (!cardRes.ok) continue;
        const card = (await cardRes.json()) as TcgdexCard;
        const cardSet = (card.set?.name ?? "").trim().toLowerCase();
        if (cardSet && (cardSet === set || cardSet.includes(set) || set.includes(cardSet))) {
          const url = imageUrl(card.image);
          if (url) {
            imageByNameCache.set(key, url);
            return url;
          }
        }
      }
    }
    const url = imageUrl(pool[0]?.image);
    imageByNameCache.set(key, url);
    return url;
  } catch {
    return null;
  }
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
  /** True, keď sa RapidAPI už pýtalo. Inak sa po doplnení RAPIDAPI_KEY cena dotiahne znova. */
  rapidChecked: boolean;
};

function quoteFromLow(
  ticker: string,
  low: number,
  priceLanguage: "en" | "any",
  rapidChecked: boolean,
): PokemonEuLowQuote {
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
    rapidChecked,
  };
}

function guideLow(card: TcgdexCard): number | null {
  const guideRaw = card.pricing?.cardmarket?.low;
  return typeof guideRaw === "number" && Number.isFinite(guideRaw) && guideRaw > 0 ? guideRaw : null;
}

async function loadTcgdexCard(cardId: string): Promise<TcgdexCard | null> {
  const res = await fetch(`${TCGDEX}/${encodeURIComponent(cardId)}`, { signal: AbortSignal.timeout(12000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TCGdex ${res.status}`);
  return (await res.json()) as TcgdexCard;
}

/**
 * Cardmarket cena v EUR cez Pokémon TCG API.
 * Raw a sealed sú anglický Near Mint. Graded je cena daného stupňa, nie raw low.
 * Denný cenník je len záloha pre raw a sealed.
 */
export async function fetchPokemonEuLowQuote(ticker: string): Promise<PokemonEuLowQuote | null> {
  const sealedId = pokemonCardmarketProductId(ticker);
  if (sealedId) {
    const name = await sealedProductName(sealedId).catch(() => null);
    const live = await fetchRapidCardmarketPrice(sealedId, { kind: "sealed" }, name);
    if (live.status === "ok" && live.low != null) return quoteFromLow(ticker, live.low, "en", true);
    const guide = await fetchSealedEuLow(sealedId);
    return guide == null ? null : quoteFromLow(ticker, guide.price, "any", live.status === "ok");
  }
  const cardId = pokemonTcgdexCardId(ticker);
  if (!cardId) return null;
  const card = await loadTcgdexCard(cardId);
  if (!card) return null;
  const productId = card.pricing?.cardmarket?.idProduct;
  const grade = pokemonGradeFromTicker(ticker);
  if (grade) {
    if (typeof productId !== "number") return null;
    const live = await fetchRapidCardmarketPrice(
      String(productId),
      { kind: "graded", company: grade.company, grade: grade.grade },
      card.name,
    );
    return live.status === "ok" && live.low != null ? quoteFromLow(ticker, live.low, "en", true) : null;
  }
  const guide = guideLow(card);
  if (typeof productId === "number") {
    const live = await fetchRapidCardmarketPrice(String(productId), { kind: "raw" }, card.name);
    if (live.status === "ok" && live.low != null) return quoteFromLow(ticker, live.low, "en", true);
    return guide == null ? null : quoteFromLow(ticker, guide, "any", live.status === "ok");
  }
  return guide == null ? null : quoteFromLow(ticker, guide, "any", false);
}
