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
  if (!name || !/^\d{1,12}$/.test(cardmarketId)) return null;
  const episode = row.episode && typeof row.episode === "object" ? (row.episode as Row) : null;
  const externalId = text(row.tcgid) || text(row.id) || cardmarketId;
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
    cardmarketId,
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
  return rows.map((row) => rowToHit(row, query.kind === "cards" ? grade : null)).filter((hit): hit is PokemonCardHit => hit != null);
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

async function storedCatalog(ticker: string): Promise<{ kind: "card" | "product"; id: string } | null> {
  const upper = ticker.trim().toUpperCase();
  const holding = await db
    .select({ id: holdings.tcgCardmarketId, category: holdings.tcgCategory })
    .from(holdings)
    .where(sql`upper(${holdings.ticker}) = ${upper}`)
    .limit(1);
  const fromHolding = catalogFromStored(holding[0]?.id, holding[0]?.category);
  if (fromHolding) return fromHolding;
  const tx = await db
    .select({ id: transactions.tcgCardmarketId, category: transactions.tcgCategory })
    .from(transactions)
    .where(sql`upper(${transactions.ticker}) = ${upper}`)
    .limit(1);
  return catalogFromStored(tx[0]?.id, tx[0]?.category);
}

function catalogFromStored(
  id: string | null | undefined,
  category: string | null | undefined,
): { kind: "card" | "product"; id: string } | null {
  const clean = (id ?? "").trim();
  if (!/^\d{1,12}$/.test(clean)) return null;
  return { id: clean, kind: category === "SEALED_PRODUCT" ? "product" : "card" };
}

/**
 * Anglická Cardmarket cena v EUR z TCGGO.
 * Raw je Near Mint, sealed je lowest anglického produktu, graded je cena stupňa.
 * Keď API cenu nevráti, kotácia ostane prázdna a prehľad drží nákupnú cenu.
 */
export async function fetchPokemonEuLowQuote(ticker: string): Promise<PokemonEuLowQuote | null> {
  const grade = pokemonGradeFromTicker(ticker);
  const ref = pokemonCatalogRef(ticker) ?? (await storedCatalog(ticker));
  if (!ref) return null;
  if (grade && ref.kind !== "card") return null;
  const live = await fetchRapidCardmarketPrice(
    ref.id,
    grade ? { kind: "graded", company: grade.company, grade: grade.grade } : ref.kind === "product" ? { kind: "sealed" } : { kind: "raw" },
  );
  if (live.status === "ok" && live.low != null) return quoteFromLow(ticker, live.low);
  return null;
}
