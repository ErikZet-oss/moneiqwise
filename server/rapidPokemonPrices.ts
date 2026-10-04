/**
 * Cardmarket ceny v EUR cez Pokémon TCG API (RapidAPI).
 * https://www.pokemon-api.com/docs/
 *
 * Raw a sealed: lowest_near_mint anglickej verzie.
 * Graded: prices.cardmarket.graded. eBay v USD sa nepoužíva a raw cena sa na slab neberie.
 * Free plán má 100 požiadaviek denne, preto sa výsledok cachuje 12 hodín.
 */

const HOST = "pokemon-tcg-api.p.rapidapi.com";
const SUCCESS_TTL_MS = 12 * 60 * 60 * 1000;
const MISS_TTL_MS = 12 * 60 * 60 * 1000;
const ERROR_TTL_MS = 30 * 60 * 1000;

export type RapidPriceKind =
  | { kind: "raw" }
  | { kind: "sealed" }
  | { kind: "graded"; company: string; grade: string };

export type RapidPriceResult =
  | { status: "ok"; low: number | null }
  | { status: "unconfigured" }
  | { status: "unavailable" };

type Row = Record<string, unknown>;
type RowCache = { at: number; ttl: number; row: Row | null };

const rowCache = new Map<string, RowCache>();
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

function rowsFrom(body: unknown): Row[] {
  if (Array.isArray(body)) return body.filter(isRow);
  if (!isRow(body)) return [];
  for (const key of ["data", "results", "cards", "products", "items"]) {
    const value = body[key];
    if (Array.isArray(value)) return value.filter(isRow);
    if (isRow(value)) {
      const nested = rowsFrom(value);
      if (nested.length > 0) return nested;
    }
  }
  if (body.prices != null || body.cardmarket_id != null || body.cardmarket != null) return [body];
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

function isEnglishRow(row: Row): boolean {
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
  return block;
}

export function nearMintEur(row: Row): number | null {
  return positive(cardmarketBlock(row)?.lowest_near_mint);
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
  return nearMintEur(row);
}

async function rapidGet(path: string): Promise<{ status: number; body: unknown } | "auth" | "error"> {
  try {
    const res = await fetch(`https://${HOST}${path}`, {
      headers: {
        Accept: "application/json",
        "x-rapidapi-key": rapidApiKey(),
        "x-rapidapi-host": HOST,
      },
      signal: AbortSignal.timeout(8000),
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
    console.warn("Pokémon TCG API request failed:", error instanceof Error ? error.message : error);
    return "error";
  }
}

/**
 * Presný filter podľa Cardmarket id.
 * Pri priamom id dopyte API id v tele často neopakuje, tak sa berie anglický záznam z malej odpovede.
 * Vyhľadávanie podľa mena berie len zhodu id, inak by sa ocenila iná karta.
 */
export function pickIdMatch(rows: Row[], productId: string, allowUnlabeled: boolean): Row | null {
  const idMatches = rows.filter((row) => productIdOf(row) === productId);
  const pool = idMatches.length > 0 ? idMatches : allowUnlabeled && rows.length > 0 && rows.length <= 8 ? rows : [];
  const english = pool.filter(isEnglishRow);
  const list = english.length > 0 ? english : pool;
  return list.find((row) => cardmarketBlock(row) != null) ?? null;
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
      const idMatches = rows.filter((row) => productIdOf(row) === productId);
      const pool = idMatches.length > 0 ? idMatches : allowUnlabeled && rows.length > 0 && rows.length <= 8 ? rows : [];
      const english = pool.filter(isEnglishRow);
      return (english.length > 0 ? english : pool)[0] ?? null;
    })()
  );
}

async function readRows(
  path: string,
): Promise<{ rows: Row[]; failed: "auth" | "error" | null; notFound: boolean; status: number }> {
  const result = await rapidGet(path);
  if (result === "auth") return { rows: [], failed: "auth", notFound: false, status: 401 };
  if (result === "error" || result.status === 429 || result.status >= 500) {
    return { rows: [], failed: "error", notFound: false, status: result === "error" ? 0 : result.status };
  }
  if (result.status === 404) return { rows: [], failed: null, notFound: true, status: 404 };
  if (result.status !== 200) return { rows: [], failed: "error", notFound: false, status: result.status };
  const rows = rowsFrom(result.body);
  return { rows, failed: null, notFound: rows.length === 0, status: 200 };
}

/** Zoznam často nemá ceny. Detail `/cards/:id` ich má. */
async function hydratePrices(row: Row, catalog: "cards" | "products"): Promise<Row> {
  if (cardmarketBlock(row)) return row;
  const id = internalId(row);
  if (!id) return row;
  const detail = await readRows(`/${catalog}/${encodeURIComponent(id)}`);
  return detail.rows.find((item) => cardmarketBlock(item) != null) ?? detail.rows[0] ?? row;
}

async function loadEnglishRow(productId: string, catalog: "cards" | "products", productName?: string | null): Promise<Row | null> {
  const cacheKey = `${catalog}:${productId}`;
  const cached = rowCache.get(cacheKey);
  if (cached && Date.now() - cached.at < cached.ttl) return cached.row;

  const name = (productName ?? "").replace(/\s+/g, " ").trim();
  const paths = [`/${catalog}?cardmarket_id=${productId}`];
  if (name.length >= 2) {
    const query = encodeURIComponent(name);
    if (catalog === "products") paths.push(`/products/search?search=${query}`);
    paths.push(`/${catalog}?search=${query}`);
  }

  let lastError = false;
  let lastStatus = 0;
  let lastPath = "";
  for (const path of paths) {
    const read = await readRows(path);
    lastStatus = read.status;
    lastPath = path;
    if (read.failed === "auth" && !authLogged) {
      authLogged = true;
      console.warn("Pokémon TCG API odmietlo kľúč. Skontroluj RAPIDAPI_KEY a predplatné Pokémon TCG API.");
    }
    if (read.failed === "auth" || read.status === 429 || read.status >= 500 || read.status === 0) {
      lastError = true;
      break;
    }
    if (read.failed) continue;
    const row = candidateRow(read.rows, productId, path.includes("cardmarket_id="));
    if (!row) continue;
    const full = await hydratePrices(row, path.startsWith("/cards") ? "cards" : catalog);
    if (cardmarketBlock(full)) {
      rowCache.set(cacheKey, { at: Date.now(), ttl: SUCCESS_TTL_MS, row: full });
      return full;
    }
  }

  console.warn(`Pokemon API ${catalog} ${productId}: bez ceny, posledný status ${lastStatus || "chyba"} ${lastPath}`);
  rowCache.set(cacheKey, { at: Date.now(), ttl: lastError ? ERROR_TTL_MS : MISS_TTL_MS, row: null });
  return null;
}

/** Anglická Cardmarket cena v EUR. `low: null` znamená, že táto cena v produkte nie je. */
export async function fetchRapidCardmarketPrice(
  productId: string,
  request: RapidPriceKind,
  productName?: string | null,
): Promise<RapidPriceResult> {
  const id = productId.trim();
  if (!/^\d{1,12}$/.test(id)) return { status: "unavailable" };
  if (!rapidApiKey()) {
    if (!missingKeyLogged) {
      missingKeyLogged = true;
      console.warn(
        "RAPIDAPI_KEY chýba. Raw a sealed berú denný Cardmarket cenník, graded ostáva na nákupnej cene.",
      );
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

  const row = await loadEnglishRow(id, catalog, productName);
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
