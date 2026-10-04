/**
 * Európske Cardmarket ceny cez TCGGO (RapidAPI „CardMarket API TCG“).
 * Cardmarket vlastné API momentálne nevydáva prístup, tento kľúč si vieš vytvoriť sám.
 * Free Basic je 100 požiadaviek denne, preto sa úspech aj miss cachujú 12 hodín.
 *
 * Raw a sealed: lowest_near_mint anglickej verzie (EUR).
 * Graded: prices.cardmarket.graded pre danú spoločnosť a stupeň. eBay (USD) sa nepoužíva.
 */

const HOST = "cardmarket-api-tcg.p.rapidapi.com";
const SUCCESS_TTL_MS = 12 * 60 * 60 * 1000;
const MISS_TTL_MS = 12 * 60 * 60 * 1000;
const ERROR_TTL_MS = 30 * 60 * 1000;

export type TcggoPriceKind =
  | { kind: "raw" }
  | { kind: "sealed" }
  | { kind: "graded"; company: string; grade: string };

export type TcggoPriceResult =
  | { status: "ok"; low: number | null }
  | { status: "unconfigured" }
  | { status: "unavailable" };

type Row = Record<string, unknown>;

type RowCache = {
  at: number;
  ttl: number;
  row: Row | null;
};

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
  }
  if (body.prices != null || body.cardmarket_id != null) return [body];
  return [];
}

function productIdOf(row: Row): string | null {
  const raw = row.cardmarket_id ?? row.cardmarketId ?? row.idProduct;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(Math.trunc(raw));
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) return raw.trim();
  return null;
}

function isEnglishRow(row: Row): boolean {
  const lang = String(row.lang ?? row.language ?? "").trim().toLowerCase();
  return lang === "" || lang === "en" || lang === "english";
}

export function cardmarketBlock(row: Row): Row | null {
  const prices = row.prices;
  if (!isRow(prices)) return null;
  const block = prices.cardmarket;
  if (!isRow(block)) return null;
  const currency = String(block.currency ?? "EUR").trim().toUpperCase();
  if (currency && currency !== "EUR") return null;
  return block;
}

/** Near Mint low z Cardmarket bloku. Nie je to denný cenník cez všetky jazyky. */
export function nearMintEur(row: Row): number | null {
  const block = cardmarketBlock(row);
  if (!block) return null;
  return positive(block.lowest_near_mint);
}

/**
 * Cena stupňa z prices.cardmarket.graded.
 * Prázdne pole aj chýbajúci stupeň vrátia null. Raw Near Mint sa sem nedostane.
 */
export function gradedEur(row: Row, company: string, grade: string): number | null {
  const block = cardmarketBlock(row);
  const graded = block?.graded;
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

function priceFromRow(row: Row, request: TcggoPriceKind): number | null {
  if (request.kind === "graded") return gradedEur(row, request.company, request.grade);
  return nearMintEur(row);
}

async function tcggoGet(path: string): Promise<{ status: number; body: unknown } | "auth" | "error"> {
  const key = rapidApiKey();
  try {
    const res = await fetch(`https://${HOST}${path}`, {
      headers: {
        Accept: "application/json",
        "x-rapidapi-key": key,
        "x-rapidapi-host": HOST,
      },
      signal: AbortSignal.timeout(15000),
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
    console.warn("TCGGO request failed:", error instanceof Error ? error.message : error);
    return "error";
  }
}

function lookupPaths(productId: string, catalog: "cards" | "products", productName?: string | null): string[] {
  const byId = `/pokemon/${catalog}/search?cardmarket_id=${productId}`;
  const name = (productName ?? "").replace(/\s+/g, " ").trim();
  if (catalog === "cards" && name.length >= 2) {
    return [byId, `/pokemon/cards/search?search=${encodeURIComponent(name)}&sort=relevance`];
  }
  return [byId];
}

async function readMatch(
  path: string,
  productId: string,
): Promise<{ match: Row | null; failed: "auth" | "error" | null; notFound: boolean }> {
  const result = await tcggoGet(path);
  if (result === "auth") return { match: null, failed: "auth", notFound: false };
  if (result === "error" || result.status === 429 || result.status >= 500) {
    return { match: null, failed: "error", notFound: false };
  }
  if (result.status === 404) return { match: null, failed: null, notFound: true };
  if (result.status !== 200) return { match: null, failed: "error", notFound: false };
  const match = rowsFrom(result.body).find((row) => productIdOf(row) === productId && isEnglishRow(row)) ?? null;
  return { match, failed: null, notFound: false };
}

async function loadEnglishRow(productId: string, catalog: "cards" | "products", productName?: string | null): Promise<Row | null> {
  const cacheKey = `${catalog}:${productId}`;
  const cached = rowCache.get(cacheKey);
  if (cached && Date.now() - cached.at < cached.ttl) return cached.row;

  let lastError = false;
  for (const path of lookupPaths(productId, catalog, productName)) {
    const read = await readMatch(path, productId);
    if (read.failed === "auth" && !authLogged) {
      authLogged = true;
      console.warn("TCGGO odmietlo kľúč. Skontroluj RAPIDAPI_KEY a predplatné CardMarket API TCG na RapidAPI.");
    }
    if (read.match) {
      rowCache.set(cacheKey, { at: Date.now(), ttl: SUCCESS_TTL_MS, row: read.match });
      return read.match;
    }
    if (read.failed) {
      lastError = true;
      break;
    }
    if (read.notFound && path.includes("/search?") && !path.includes("search=")) {
      const alt = await readMatch(path.replace("/search?", "?"), productId);
      if (alt.failed === "auth" && !authLogged) {
        authLogged = true;
        console.warn("TCGGO odmietlo kľúč. Skontroluj RAPIDAPI_KEY a predplatné CardMarket API TCG na RapidAPI.");
      }
      if (alt.match) {
        rowCache.set(cacheKey, { at: Date.now(), ttl: SUCCESS_TTL_MS, row: alt.match });
        return alt.match;
      }
      if (alt.failed) {
        lastError = true;
        break;
      }
    }
  }

  rowCache.set(cacheKey, {
    at: Date.now(),
    ttl: lastError ? ERROR_TTL_MS : MISS_TTL_MS,
    row: null,
  });
  return null;
}

/** Anglická Cardmarket cena v EUR. `low: null` znamená, že produkt je známy, ale táto cena v ňom nie je. */
export async function fetchTcggoEnglishPrice(
  productId: string,
  request: TcggoPriceKind,
  productName?: string | null,
): Promise<TcggoPriceResult> {
  const id = productId.trim();
  if (!/^\d{1,12}$/.test(id)) return { status: "unavailable" };
  if (!rapidApiKey()) {
    if (!missingKeyLogged) {
      missingKeyLogged = true;
      console.warn(
        "RAPIDAPI_KEY chýba. Raw a sealed berú denný Cardmarket cenník, graded ostáva na nákupnej cene. Kľúč je zadarmo na RapidAPI (CardMarket API TCG).",
      );
    }
    return { status: "unconfigured" };
  }

  const catalog = request.kind === "sealed" ? "products" : "cards";
  const cacheKey = `${catalog}:${id}`;
  const cached = rowCache.get(cacheKey);
  if (cached && Date.now() - cached.at < cached.ttl) {
    if (!cached.row) {
      return cached.ttl === ERROR_TTL_MS ? { status: "unavailable" } : { status: "ok", low: null };
    }
    return { status: "ok", low: priceFromRow(cached.row, request) };
  }

  const row = await loadEnglishRow(id, catalog, productName);
  const after = rowCache.get(cacheKey);
  if (!row) {
    return after && after.ttl === ERROR_TTL_MS ? { status: "unavailable" } : { status: "ok", low: null };
  }
  return { status: "ok", low: priceFromRow(row, request) };
}
