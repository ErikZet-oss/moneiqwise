/**
 * Cardmarket ceny v EUR cez CardMarket API TCG (TCGGO) na RapidAPI.
 * https://rapidapi.com/tcggopro/api/cardmarket-api-tcg
 * https://www.tcggo.com/api-docs/v1/
 *
 * Host cardmarket-api-tcg.p.rapidapi.com, hra v ceste `/pokemon/...`.
 * Kľúč ide v hlavičke aj v query rapidapi-key.
 * Jedna položka = jeden dopyt podľa Cardmarket id. Expanzie sa neprechádzajú.
 * Karty: prices.cardmarket.lowest_near_mint (anglický Near Mint).
 * Sealed: prices.cardmarket.lowest na riadku lang=en.
 * Graded: prices.cardmarket.graded. Jazykové suffixy a eBay USD sa neberú.
 */

const HOST = "cardmarket-api-tcg.p.rapidapi.com";
const SUCCESS_TTL_MS = 12 * 60 * 60 * 1000;
const MISS_TTL_MS = 15 * 60 * 1000;
const ERROR_TTL_MS = 5 * 60 * 1000;
const SEARCH_TTL_MS = 10 * 60 * 1000;

export type RapidPriceKind =
  | { kind: "raw" }
  | { kind: "sealed" }
  | { kind: "graded"; company: string; grade: string };

export type RapidPriceResult =
  | { status: "ok"; low: number | null }
  | { status: "unconfigured" }
  | { status: "unavailable" };

export type TcgSort = "relevance" | "price_highest" | "price_lowest";

export type TcgCatalogQuery = {
  kind: "cards" | "products";
  search?: string;
  episodeId?: string;
  cardNumber?: string;
  sort?: string;
};

type Row = Record<string, unknown>;
type RowCache = { at: number; ttl: number; row: Row | null };
type ListCache = { at: number; ttl: number; rows: Row[] };

const rowCache = new Map<string, RowCache>();
const listCache = new Map<string, ListCache>();
let missingKeyLogged = false;
let authLogged = false;

function rapidApiKey(): string {
  return process.env.RAPIDAPI_KEY?.trim() ?? "";
}

function isRow(value: unknown): value is Row {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function positive(value: unknown): number | null {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(num) && num > 0 ? num : null;
}

export function rowsFrom(body: unknown): Row[] {
  if (Array.isArray(body)) return body.filter(isRow);
  if (!isRow(body)) return [];
  for (const key of ["data", "results", "cards", "products", "product", "items", "episodes"]) {
    const value = body[key];
    if (Array.isArray(value)) return value.filter(isRow);
    if (isRow(value)) {
      const nested = rowsFrom(value);
      if (nested.length > 0) return nested;
    }
  }
  if (body.prices != null || body.cardmarket_id != null || body.cardmarket != null || body.name != null) return [body];
  return [];
}

function idString(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return String(Math.trunc(raw));
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) return raw.trim();
  return null;
}

function productIdOf(row: Row): string | null {
  const nested = isRow(row.cardmarket) ? row.cardmarket : null;
  return (
    idString(row.cardmarket_id) ??
    idString(row.cardmarketId) ??
    idString(row.idProduct) ??
    idString(nested?.id) ??
    idString(nested?.idProduct) ??
    idString(nested?.cardmarket_id)
  );
}

export function isEnglishRow(row: Row): boolean {
  const lang = String(row.lang ?? row.language ?? "").trim().toLowerCase();
  return lang === "" || lang === "en" || lang === "english";
}

export function cardmarketBlock(row: Row): Row | null {
  const prices = isRow(row.prices) ? row.prices : null;
  const block =
    prices && isRow(prices.cardmarket) ? prices.cardmarket : isRow(row.cardmarket) ? row.cardmarket : null;
  if (!block) return null;
  const currency = String(block.currency ?? "EUR").trim().toUpperCase();
  if (currency !== "EUR") return null;
  const graded = block.graded;
  const hasQuote =
    positive(block.lowest_near_mint) != null ||
    positive(block.lowest) != null ||
    positive(block["7d_average"]) != null ||
    positive(block["30d_average"]) != null ||
    (isRow(graded) && Object.keys(graded).length > 0);
  if (!hasQuote) return null;
  return block;
}

/** Anglický Near Mint karty, alebo `lowest` sealed produktu s lang=en. Nula nie je cena. */
export function nearMintEur(row: Row, kind: "raw" | "sealed" = "raw"): number | null {
  const block = cardmarketBlock(row);
  if (!block) return null;
  if (kind === "sealed") {
    return positive(block.lowest) ?? positive(block.lowest_near_mint) ?? positive(block["7d_average"]) ?? positive(block["30d_average"]);
  }
  return positive(block.lowest_near_mint) ?? positive(block.lowest);
}

/** Cena stupňa len z Cardmarket bloku v EUR. Prázdne graded aj chýbajúci stupeň vrátia null. */
export function gradedEur(row: Row, company: string, grade: string): number | null {
  const graded = cardmarketBlock(row)?.graded;
  if (!isRow(graded)) return null;
  const companyKey = company.trim().toLowerCase();
  const bucket = graded[companyKey] ?? graded[companyKey.toUpperCase()];
  if (!isRow(bucket)) return null;
  const gradeKey = grade.trim();
  const keys = [
    `${companyKey}${gradeKey}`,
    gradeKey,
    `${companyKey}${gradeKey.replace(".", "_")}`,
    `${companyKey}${gradeKey.replace(".", "")}`,
    gradeKey.replace(".", "_"),
    gradeKey.replace(".", ""),
  ];
  for (const key of keys) {
    const direct = bucket[key] ?? bucket[key.toUpperCase()] ?? bucket[key.toLowerCase()];
    const flat = positive(direct);
    if (flat != null) return flat;
    if (isRow(direct)) {
      const nested = positive(direct.median_price ?? direct.price ?? direct.lowest ?? direct.low);
      if (nested != null) return nested;
    }
  }
  return null;
}

function priceFromRow(row: Row, request: RapidPriceKind): number | null {
  if (request.kind === "graded") return gradedEur(row, request.company, request.grade);
  return nearMintEur(row, request.kind === "sealed" ? "sealed" : "raw");
}

async function rapidGet(path: string): Promise<{ status: number; body: unknown } | "auth" | "error"> {
  const key = rapidApiKey();
  const url = new URL(`https://${HOST}${path}`);
  url.searchParams.set("rapidapi-key", key);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "x-rapidapi-key": key,
        "x-rapidapi-host": HOST,
      },
      signal: AbortSignal.timeout(12000),
    });
    if (res.status === 401 || res.status === 403) return "auth";
    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = null;
      }
    }
    return { status: res.status, body };
  } catch (error) {
    console.warn("TCGGO API request failed:", error instanceof Error ? error.message : error);
    return "error";
  }
}

export function pickIdMatch(rows: Row[], productId: string, allowUnlabeled: boolean): Row | null {
  const idMatches = rows.filter((row) => productIdOf(row) === productId);
  const pool = idMatches.length > 0 ? idMatches : allowUnlabeled && rows.length > 0 && rows.length <= 8 ? rows : [];
  const english = pool.filter(isEnglishRow);
  return english.find((row) => cardmarketBlock(row) != null) ?? null;
}

function internalId(row: Row): string | null {
  const raw = row.id;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(Math.trunc(raw));
  if (typeof raw === "string" && /^[\w.-]{1,80}$/.test(raw.trim())) return raw.trim();
  return null;
}

function candidateRow(rows: Row[], productId: string, allowUnlabeled: boolean): Row | null {
  return (
    pickIdMatch(rows, productId, allowUnlabeled) ??
    (() => {
      const idMatches = rows.filter((row) => productIdOf(row) === productId && isEnglishRow(row));
      const pool = idMatches.length > 0 ? idMatches : allowUnlabeled ? rows.filter(isEnglishRow).slice(0, 8) : [];
      return pool[0] ?? null;
    })()
  );
}

async function readRows(
  path: string,
): Promise<{ rows: Row[]; failed: "auth" | "error" | null; notFound: boolean; status: number }> {
  const result = await rapidGet(path);
  if (result === "auth") return { rows: [], failed: "auth", notFound: false, status: 401 };
  if (result === "error") return { rows: [], failed: "error", notFound: false, status: 0 };
  if (result.status === 429 || result.status >= 500) {
    return { rows: [], failed: "error", notFound: false, status: result.status };
  }
  if (result.status === 404) return { rows: [], failed: null, notFound: true, status: 404 };
  if (result.status !== 200) return { rows: [], failed: "error", notFound: false, status: result.status };
  const rows = rowsFrom(result.body);
  return { rows, failed: null, notFound: rows.length === 0, status: 200 };
}

function noteAuth(failed: "auth" | "error" | null) {
  if (failed === "auth" && !authLogged) {
    authLogged = true;
    console.warn("TCGGO API odmietlo kľúč. Skontroluj RAPIDAPI_KEY a predplatné CardMarket API TCG.");
  }
}

async function hydratePrices(row: Row, catalog: "cards" | "products"): Promise<Row> {
  if (cardmarketBlock(row)) return row;
  const id = internalId(row);
  if (!id) return row;
  const detail = await readRows(`/pokemon/${catalog}/${encodeURIComponent(id)}`);
  noteAuth(detail.failed);
  return detail.rows.find((item) => isEnglishRow(item) && cardmarketBlock(item) != null) ?? row;
}

async function loadEnglishRow(productId: string, catalog: "cards" | "products"): Promise<Row | null> {
  const cacheKey = `${catalog}:${productId}`;
  const cached = rowCache.get(cacheKey);
  if (cached && Date.now() - cached.at < cached.ttl) return cached.row;

  const paths = [
    `/pokemon/${catalog}?cardmarket_id=${encodeURIComponent(productId)}`,
    `/pokemon/${catalog}/search?cardmarket_id=${encodeURIComponent(productId)}`,
  ];
  let lastStatus = 0;
  let lastPath = paths[0] ?? "";
  for (const path of paths) {
    const read = await readRows(path);
    lastStatus = read.status;
    lastPath = path;
    noteAuth(read.failed);
    if (read.failed === "auth" || read.failed === "error") {
      rowCache.set(cacheKey, { at: Date.now(), ttl: ERROR_TTL_MS, row: null });
      console.warn(`Pokemon API ${catalog} ${productId}: bez ceny, posledný status ${read.status || "chyba"} ${path}`);
      return null;
    }
    const row = candidateRow(read.rows, productId, true);
    const full = row ? await hydratePrices(row, catalog) : null;
    if (full && cardmarketBlock(full) && isEnglishRow(full)) {
      rowCache.set(cacheKey, { at: Date.now(), ttl: SUCCESS_TTL_MS, row: full });
      return full;
    }
  }
  console.warn(`Pokemon API ${catalog} ${productId}: bez ceny, posledný status ${lastStatus} ${lastPath}`);
  rowCache.set(cacheKey, { at: Date.now(), ttl: MISS_TTL_MS, row: null });
  return null;
}

export function normalizeSort(sort: string | undefined): TcgSort {
  if (sort === "price_highest" || sort === "price_lowest" || sort === "relevance") return sort;
  return "relevance";
}

/** Vyhľadanie kariet, sealed produktov alebo sád. Jedna HTTP požiadavka. */
export async function searchTcgRows(query: TcgCatalogQuery): Promise<Row[]> {
  if (!rapidApiKey()) return [];
  const search = (query.search ?? "").trim();
  const episodeId = (query.episodeId ?? "").trim();
  const cardNumber = (query.cardNumber ?? "").trim();
  const sort = normalizeSort(query.sort);
  const hasEpisode = /^\d{1,12}$/.test(episodeId);
  if (search.length < 2 && !hasEpisode && cardNumber.length < 1) return [];

  let path: string;
  if (hasEpisode && search.length < 2 && !cardNumber) {
    path = `/pokemon/episodes/${episodeId}/${query.kind}?sort=${sort}`;
  } else {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (hasEpisode) params.set("episode_id", episodeId);
    if (query.kind === "cards" && cardNumber) params.set("card_number", cardNumber);
    params.set("sort", sort);
    path = `/pokemon/${query.kind}/search?${params.toString()}`;
  }

  const cacheKey = path;
  const cached = listCache.get(cacheKey);
  if (cached && Date.now() - cached.at < cached.ttl) return cached.rows;

  const read = await readRows(path);
  noteAuth(read.failed);
  if (read.failed) {
    console.warn(`Pokemon API search ${query.kind}: status ${read.status || "chyba"}`);
    return [];
  }
  const rows = read.rows.filter(isEnglishRow).slice(0, 20);
  listCache.set(cacheKey, { at: Date.now(), ttl: SEARCH_TTL_MS, rows });
  return rows;
}

export async function searchTcgEpisodes(search: string): Promise<Row[]> {
  const q = search.trim();
  if (q.length < 2 || !rapidApiKey()) return [];
  const path = `/pokemon/episodes/search?search=${encodeURIComponent(q)}`;
  const cached = listCache.get(path);
  if (cached && Date.now() - cached.at < cached.ttl) return cached.rows;
  const read = await readRows(path);
  noteAuth(read.failed);
  if (read.failed) return [];
  const rows = read.rows.filter(isEnglishRow).slice(0, 20);
  listCache.set(path, { at: Date.now(), ttl: SEARCH_TTL_MS, rows });
  return rows;
}

/** Anglická Cardmarket cena v EUR. `low: null` znamená, že táto cena v produkte nie je. */
export async function fetchRapidCardmarketPrice(
  productId: string,
  request: RapidPriceKind,
): Promise<RapidPriceResult> {
  const id = productId.trim();
  if (!/^\d{1,12}$/.test(id)) return { status: "unavailable" };
  if (!rapidApiKey()) {
    if (!missingKeyLogged) {
      missingKeyLogged = true;
      console.warn("RAPIDAPI_KEY chýba. Pokémon položky ostávajú na nákupnej cene.");
    }
    return { status: "unconfigured" };
  }

  const catalog = request.kind === "sealed" ? "products" : "cards";
  const cacheKey = `${catalog}:${id}`;
  const cached = rowCache.get(cacheKey);
  if (cached && Date.now() - cached.at < cached.ttl) {
    if (!cached.row) return cached.ttl === ERROR_TTL_MS ? { status: "unavailable" } : { status: "ok", low: null };
    return { status: "ok", low: priceFromRow(cached.row, request) };
  }

  const row = await loadEnglishRow(id, catalog);
  const after = rowCache.get(cacheKey);
  const result: RapidPriceResult = !row
    ? after && after.ttl === ERROR_TTL_MS
      ? { status: "unavailable" }
      : { status: "ok", low: null }
    : { status: "ok", low: priceFromRow(row, request) };
  const price = result.status === "ok" ? result.low : null;
  console.log(`Pokemon API ${request.kind} ${id}: ${result.status} ${price ?? "-"}`);
  return result;
}
