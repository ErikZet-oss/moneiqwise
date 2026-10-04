const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; url: string | null }>();

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

/** Obrázok sealed produktu podľa anglického názvu. Rovnaký názov na TCGplayeri. */
export async function findSealedProductImage(productName: string): Promise<string | null> {
  const key = normalize(productName.split(" · ")[0] ?? "");
  if (key.length < 2) return null;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.url;
  try {
    const url = `https://mp-search-api.tcgplayer.com/v1/search/request?q=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        algorithm: "sales_synonym_v2",
        from: 0,
        size: 8,
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
    const match = products.find((product) => normalize(product.productName ?? "") === key && product.productId);
    const found = match?.productId ? imageUrl(match.productId) : null;
    cache.set(key, { at: Date.now(), url: found });
    return found;
  } catch (error) {
    console.warn("Sealed product image lookup failed:", error);
    cache.set(key, { at: Date.now(), url: null });
    return null;
  }
}
