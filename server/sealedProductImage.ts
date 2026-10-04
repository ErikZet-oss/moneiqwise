const SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; url: string | null }>();

const NOISE = new Set(["pokemon", "international", "version", "retail", "the", "and", "of", "set", "a", "ex"]);
const TYPE_WORDS = new Set([
  "tin",
  "mini",
  "display",
  "case",
  "box",
  "etb",
  "elite",
  "trainer",
  "booster",
  "bundle",
  "collection",
  "chest",
  "coin",
]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/pokémon/g, "pokemon")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function imageUrl(productId: number): string {
  return `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_200w.jpg`;
}

function tokens(value: string): string[] {
  return normalize(value)
    .replace(/\btins\b/g, "tin")
    .split(" ")
    .filter((token) => token.length > 0 && !NOISE.has(token));
}

/** Vyššie skóre = bližší názov. `null`, keď produkt nie je ten istý typ. */
export function sealedImageMatchScore(query: string, productName: string): number | null {
  const queryTokens = tokens(query);
  const productTokens = tokens(productName);
  if (queryTokens.length === 0 || productTokens.length === 0) return null;
  const productSet = new Set(productTokens);
  const identity = queryTokens.filter((token) => !TYPE_WORDS.has(token) && token !== "30th" && token !== "celebration");
  const types = queryTokens.filter((token) => TYPE_WORDS.has(token));
  if (types.some((token) => !productSet.has(token))) return null;
  const hits = identity.filter((token) => productSet.has(token));
  if (identity.length > 0 && hits.length === 0) return null;
  let score = hits.length * 20;
  if (hits.length === identity.length) score += 40;
  const plain = normalize(productName);
  if (productSet.has("case") && !queryTokens.includes("case")) score -= 40;
  if (plain.includes("set of") && !normalize(query).includes("set of")) score -= 40;
  if (productSet.has("code") && productSet.has("card")) score -= 50;
  if (productSet.has("display") && !queryTokens.includes("display")) score -= 30;
  if (productSet.has("empty") && !queryTokens.includes("empty")) score -= 30;
  if (plain.includes("retail") && !normalize(query).includes("retail")) score -= 12;
  if (plain.includes("international")) score += 6;
  score -= Math.max(0, productTokens.length - queryTokens.length);
  return score;
}

/** Obrázok sealed produktu podľa anglického názvu. Rovnaký názov na TCGplayeri. */
export async function findSealedProductImage(productName: string): Promise<string | null> {
  const key = normalize(productName.split(" · ")[0] ?? "");
  if (key.length < 2) return null;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < (cached.url ? SUCCESS_TTL_MS : MISS_TTL_MS)) return cached.url;
  try {
    const url = `https://mp-search-api.tcgplayer.com/v1/search/request?q=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        algorithm: "sales_synonym_v2",
        from: 0,
        size: 12,
        filters: { term: { productLineName: ["pokemon"] } },
        listingSearch: { context: { cart: {} }, filters: { term: { sellerStatus: "Live" } } },
        context: { cart: {}, shippingCountry: "US" },
        settings: { useFuzzySearch: true },
        sort: {},
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`TCGplayer ${res.status}`);
    const json = (await res.json()) as {
      results?: Array<{ results?: Array<{ productName?: string; productId?: number }> }>;
    };
    const products = json.results?.[0]?.results ?? [];
    const ranked = products
      .map((product) => ({
        product,
        score: product.productId ? sealedImageMatchScore(key, product.productName ?? "") : null,
      }))
      .filter((row): row is { product: { productName?: string; productId?: number }; score: number } => row.score != null)
      .sort((a, b) => b.score - a.score);
    const found = ranked[0]?.product.productId ? imageUrl(ranked[0].product.productId) : null;
    cache.set(key, { at: Date.now(), url: found });
    return found;
  } catch (error) {
    console.warn("Sealed product image lookup failed:", error);
    cache.set(key, { at: Date.now(), url: null });
    return null;
  }
}
