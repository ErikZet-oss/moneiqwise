import type { PokemonCardHit } from "@shared/pokemonTcg";
import { findSealedProductImage } from "./sealedProductImage";

const NONSINGLES_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json";
const PRICE_GUIDE_URL = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json";
const CATALOG_TTL_MS = 12 * 60 * 60 * 1000;

type CatalogProduct = {
  idProduct: number;
  name: string;
  category: string;
};

type Catalog = {
  products: CatalogProduct[];
  guideLows: Map<number, number>;
};

type PriceGuideFile = {
  priceGuides?: Array<{
    idProduct?: number;
    low?: number | null;
  }>;
};

type NonsinglesFile = {
  products?: Array<{
    idProduct?: number;
    name?: string;
    categoryName?: string;
  }>;
};

let catalogPromise: Promise<Catalog> | null = null;
let catalogLoadedAt = 0;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/pokémon/g, "pokemon")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function categoryLabel(name: string): string {
  return name.replace(/^Pokémon\s+/i, "").replace(/^PCG\s+/i, "").trim();
}

const FOREIGN_PRINTS: Array<{ pattern: RegExp; tokens: string[] }> = [
  { pattern: /\bjp\b|\bjapanese\b/, tokens: ["jp", "japanese"] },
  { pattern: /\bchinese\b|\bchs\b|\bcht\b/, tokens: ["chinese", "chs", "cht"] },
  { pattern: /\bkorean\b/, tokens: ["korean"] },
  { pattern: /\bindonesian\b/, tokens: ["indonesian"] },
  { pattern: /\bthai\b/, tokens: ["thai"] },
  { pattern: /\bgerman\b|\bdeutsch\b/, tokens: ["german", "deutsch"] },
  { pattern: /\bfrench\b/, tokens: ["french"] },
  { pattern: /\bitalian\b/, tokens: ["italian"] },
  { pattern: /\bspanish\b/, tokens: ["spanish"] },
];

function foreignPrintPenalty(name: string, tokens: string[]): number {
  let penalty = 0;
  for (const print of FOREIGN_PRINTS) {
    if (print.pattern.test(name) && !print.tokens.some((token) => tokens.includes(token))) penalty += 80;
  }
  return penalty;
}

async function loadCatalog(): Promise<Catalog> {
  const [productsRes, guideRes] = await Promise.all([
    fetch(NONSINGLES_URL, { signal: AbortSignal.timeout(60_000) }),
    fetch(PRICE_GUIDE_URL, { signal: AbortSignal.timeout(60_000) }),
  ]);
  if (!productsRes.ok) throw new Error(`Cardmarket products ${productsRes.status}`);
  if (!guideRes.ok) throw new Error(`Cardmarket price guide ${guideRes.status}`);
  const productsFile = (await productsRes.json()) as NonsinglesFile;
  const guideFile = (await guideRes.json()) as PriceGuideFile;
  const products: CatalogProduct[] = [];
  const ids = new Set<number>();
  for (const row of productsFile.products ?? []) {
    const idProduct = row.idProduct;
    const name = (row.name ?? "").trim();
    if (typeof idProduct !== "number" || !name) continue;
    products.push({
      idProduct,
      name,
      category: categoryLabel((row.categoryName ?? "").trim()),
    });
    ids.add(idProduct);
  }
  const guideLows = new Map<number, number>();
  for (const row of guideFile.priceGuides ?? []) {
    if (typeof row.idProduct !== "number" || !ids.has(row.idProduct)) continue;
    if (typeof row.low === "number" && Number.isFinite(row.low) && row.low > 0) {
      guideLows.set(row.idProduct, row.low);
    }
  }
  return { products, guideLows };
}

function getCatalog(): Promise<Catalog> {
  if (!catalogPromise || Date.now() - catalogLoadedAt > CATALOG_TTL_MS) {
    catalogLoadedAt = Date.now();
    catalogPromise = loadCatalog().catch((error) => {
      catalogPromise = null;
      catalogLoadedAt = 0;
      throw error;
    });
  }
  return catalogPromise;
}

/** Denný Cardmarket low v EUR. Cenník je najlacnejšia ponuka cez všetky jazyky. */
export async function fetchSealedEuLow(
  productId: string,
): Promise<{ price: number; priceLanguage: "en" | "any" } | null> {
  const id = Number(productId);
  if (!Number.isInteger(id)) return null;
  const guide = (await getCatalog()).guideLows.get(id);
  return guide == null ? null : { price: guide, priceLanguage: "any" };
}

/** Vyhľadanie sealed produktov v dennom Cardmarket katalógu. */
export async function searchSealedProducts(query: string): Promise<PokemonCardHit[]> {
  const tokens = normalize(query).split(" ").filter((token) => token.length > 0);
  if (tokens.length === 0 || tokens.join("").length < 2) return [];
  const catalog = await getCatalog();
  const phrase = tokens.join(" ");
  const wantsCase = tokens.includes("case");
  const wantsEmpty = tokens.includes("empty");
  const wantsCoin = tokens.includes("coin");
  const ranked = catalog.products
    .map((product) => {
      const name = normalize(product.name);
      if (!tokens.every((token) => name.includes(token))) return null;
      if (foreignPrintPenalty(name, tokens) > 0) return null;
      let score = 0;
      if (name === phrase) score += 100;
      else if (name.startsWith(phrase)) score += 40;
      else if (name.includes(phrase)) score += 20;
      if (!wantsCase && name.includes(" case")) score -= 25;
      if (!wantsEmpty && name.includes(" empty")) score -= 25;
      if (!wantsCoin && product.category.toLowerCase() === "coins") score -= 40;
      score -= name.length / 200;
      return { product, score };
    })
    .filter((row): row is { product: CatalogProduct; score: number } => row != null)
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
    .slice(0, 12);

  const images = await Promise.all(ranked.map(({ product }) => findSealedProductImage(product.name)));
  return ranked.map(({ product }, index) => {
    const id = String(product.idProduct);
    const guide = catalog.guideLows.get(product.idProduct) ?? null;
    return {
      externalId: `cm${id}`,
      name: product.name,
      setName: product.category,
      number: "",
      imageUrl: images[index],
      euLowEur: guide,
      lowLanguage: guide != null ? "any" : null,
      cardmarketUrl: `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${id}&language=1`,
      cardmarketId: id,
    };
  });
}
