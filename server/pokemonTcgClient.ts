import { sql } from "drizzle-orm";
import type { PokemonCardHit } from "@shared/pokemonTcg";
import { pokemonCatalogRef, pokemonGradeFromTicker } from "@shared/pokemonTcg";
import { holdings, transactions } from "@shared/schema";
import { db } from "./db";
import {
  fetchRapidCardmarketPrice,
  gradedEur,
  isEnglishRow,
  nearMintEur,
  searchTcgEpisodes,
  searchTcgRows,
  type RapidPriceKind,
  type TcgCatalogQuery,
} from "./rapidPokemonPrices";

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function httpsUrl(value: unknown): string | null {
  const v = text(value);
  return v.startsWith("https://") ? v : null;
}

export function rowToHit(row: Row, grade?: { company: string; grade: string } | null): PokemonCardHit | null {
  if (!isEnglishRow(row)) return null;
  const name = text(row.name) || text(row.name_numbered);
  const cardmarketId = text(row.cardmarket_id);
  const tcggoId = text(row.id);
  const hasCardmarket = /^\d{1,12}$/.test(cardmarketId);
  const hasTcggo = /^\d{1,12}$/.test(tcggoId);
  if (!name || (!hasCardmarket && !hasTcggo)) return null;
  const episode = row.episode && typeof row.episode === "object" ? (row.episode as Row) : null;
  const externalId = text(row.tcgid) || tcggoId || cardmarketId;
  const kind = text(row.type) === "singles" || row.card_number != null || row.tcgid != null ? "raw" : "sealed";
  const priceKind = kind === "sealed" && row.card_number == null && row.tcgid == null ? "sealed" : "raw";
  const euLow = nearMintEur(row, priceKind);
  const gradePrice = grade ? gradedEur(row, grade.company, grade.grade) : null;
  return {
    externalId: externalId.toLowerCase(),
    name,
    setName: text(episode?.name),
    number: text(row.card_number) || text(row.card_code_number),
    imageUrl: httpsUrl(row.image),
    euLowEur: grade ? gradePrice : euLow,
    lowLanguage: (grade ? gradePrice : euLow) != null ? "en" : null,
    cardmarketUrl: httpsUrl((row.links as Row | undefined)?.cardmarket) ?? httpsUrl(row.tcggo_url),
    cardmarketId: hasCardmarket ? cardmarketId : null,
    tcggoId: hasTcggo ? tcggoId : null,
    episodeId: text(episode?.id) || null,
    gradePriceEur: gradePrice,
  };
}

export type PokemonEpisodeHit = {
  id: string;
  name: string;
  code: string;
};

export async function searchPokemonCatalog(query: TcgCatalogQuery & { gradeCompany?: string; gradeValue?: string }): Promise<PokemonCardHit[]> {
  const grade =
    query.gradeCompany && query.gradeValue ? { company: query.gradeCompany, grade: query.gradeValue } : null;
  const rows = await searchTcgRows(query);
  const hits = rows.map((row) => rowToHit(row, query.kind === "cards" ? grade : null)).filter((hit): hit is PokemonCardHit => hit != null);
  return rankCatalogHits(hits, query.search ?? "");
}

function rankCatalogHits(hits: PokemonCardHit[], search: string): PokemonCardHit[] {
  const tokens = search.toLowerCase().split(/\s+/).filter((token) => token.length > 1);
  if (tokens.length === 0) return hits;
  const score = (hit: PokemonCardHit) => {
    const name = `${hit.name} ${hit.setName}`.toLowerCase();
    return tokens.reduce((total, token) => total + (name.includes(token) ? 1 : 0), 0);
  };
  return [...hits].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name, "sk"));
}

export async function searchPokemonEpisodes(search: string): Promise<PokemonEpisodeHit[]> {
  const rows = await searchTcgEpisodes(search);
  const hits: PokemonEpisodeHit[] = [];
  for (const row of rows) {
    const id = text(row.id);
    const name = text(row.name);
    if (!/^\d+$/.test(id) || !name) continue;
    hits.push({ id, name, code: text(row.code) });
  }
  return hits;
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
  priceLanguage: "en";
  rapidChecked: boolean;
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
    priceLanguage: "en",
    rapidChecked: true,
  };
}

async function storedCatalog(ticker: string): Promise<{ kind: "card" | "product"; id: string; source: "cardmarket"; name: string | null } | null> {
  const upper = ticker.trim().toUpperCase();
  const holding = await db
    .select({
      id: holdings.tcgCardmarketId,
      category: holdings.tcgCategory,
      name: holdings.tcgProductName,
      company: holdings.companyName,
    })
    .from(holdings)
    .where(sql`upper(${holdings.ticker}) = ${upper}`)
    .limit(1);
  const fromHolding = catalogFromStored(holding[0]?.id, holding[0]?.category, holding[0]?.name || holding[0]?.company);
  if (fromHolding) return fromHolding;
  const tx = await db
    .select({
      id: transactions.tcgCardmarketId,
      category: transactions.tcgCategory,
      name: transactions.tcgProductName,
      company: transactions.companyName,
    })
    .from(transactions)
    .where(sql`upper(${transactions.ticker}) = ${upper}`)
    .limit(1);
  return catalogFromStored(tx[0]?.id, tx[0]?.category, tx[0]?.name || tx[0]?.company);
}

function catalogFromStored(
  id: string | null | undefined,
  category: string | null | undefined,
  name: string | null | undefined,
): { kind: "card" | "product"; id: string; source: "cardmarket"; name: string | null } | null {
  const clean = (id ?? "").trim();
  if (!/^\d{1,12}$/.test(clean)) return null;
  const productName = (name ?? "").split("·")[0]?.trim() || null;
  return { id: clean, kind: category === "SEALED_PRODUCT" ? "product" : "card", source: "cardmarket", name: productName };
}

async function priceByProductName(name: string, request: RapidPriceKind): Promise<number | null> {
  const wanted = name.trim().toLowerCase();
  if (wanted.length < 2) return null;
  const kind = request.kind === "sealed" ? "products" : "cards";
  const rows = await searchTcgRows({ kind, search: name });
  const named = rows.filter((row) => {
    const label = text(row.name).toLowerCase();
    return label === wanted || label.includes(wanted) || wanted.includes(label);
  });
  const exact = rows.find((row) => text(row.name).toLowerCase() === wanted);
  const pool = exact ? [exact] : named;
  for (const row of pool) {
    const price = request.kind === "graded" ? gradedEur(row, request.company, request.grade) : nearMintEur(row, request.kind === "sealed" ? "sealed" : "raw");
    if (price != null) return price;
  }
  return null;
}

/**
 * Anglická Cardmarket cena v EUR z TCGGO.
 * Raw je Near Mint, sealed je lowest anglického produktu, graded je cena stupňa.
 * Keď API cenu nevráti, kotácia ostane prázdna a prehľad drží nákupnú cenu.
 */
export async function fetchPokemonEuLowQuote(ticker: string): Promise<PokemonEuLowQuote | null> {
  const grade = pokemonGradeFromTicker(ticker);
  const fromTicker = pokemonCatalogRef(ticker);
  const stored = fromTicker ? null : await storedCatalog(ticker);
  const ref = fromTicker ?? stored;
  if (!ref) return null;
  if (grade && ref.kind !== "card") return null;
  const request: RapidPriceKind = grade
    ? { kind: "graded", company: grade.company, grade: grade.grade }
    : ref.kind === "product"
      ? { kind: "sealed" }
      : { kind: "raw" };
  const live = await fetchRapidCardmarketPrice(ref.id, request, ref.source);
  if (live.status === "ok" && live.low != null) return quoteFromLow(ticker, live.low);
  if (ref.source === "cardmarket" && request.kind === "sealed") {
    const name = stored?.name ?? (await storedProductName(ticker));
    if (name) {
      const named = await priceByProductName(name, request);
      if (named != null) return quoteFromLow(ticker, named);
    }
  }
  return null;
}

async function storedProductName(ticker: string): Promise<string | null> {
  const upper = ticker.trim().toUpperCase();
  const holding = await db
    .select({ name: holdings.tcgProductName, company: holdings.companyName })
    .from(holdings)
    .where(sql`upper(${holdings.ticker}) = ${upper}`)
    .limit(1);
  const raw = holding[0]?.name || holding[0]?.company;
  return raw ? raw.split("·")[0]?.trim() || null : null;
}
