/**
 * Pokémon TCG portfólio.
 * Karty a sealed produkty sú bežné holdingy (ticker + množstvo + FIFO),
 * ale žijú len v portfóliu s brokerom `pokemon`. Evidujú sa len nákupy a predaje,
 * bez vkladov, výberov a hotovostného účtu. Akciový systém sa ich netýka.
 *
 * Trhová cena raw karty je Cardmarket low v EUR cez PokéWallet.
 * Sealed berie denný Cardmarket cenník. Graded sa tam neoceňuje a ostáva na nákupe.
 * Obrázok karty (aj graded) ide z TCGdex.
 */

export const POKEMON_PORTFOLIO_BROKER = "pokemon" as const;

/** Syntetický riadok v prehľade aktív — nie je to ticker v databáze. Karty aj sealed sú vnútri. */
export const POKEMON_GROUP_TICKER = "PTCG:ALL" as const;

export const POKEMON_TICKER_PREFIX = "PTCG:" as const;

export const POKEMON_TCG_CATEGORIES = ["RAW_CARD", "GRADED_CARD", "SEALED_PRODUCT"] as const;
export type PokemonTcgCategory = (typeof POKEMON_TCG_CATEGORIES)[number];

export const POKEMON_GRADE_COMPANIES = ["PSA", "BGS", "CGC", "ACE", "SGC", "TAG"] as const;
export type PokemonGradeCompany = (typeof POKEMON_GRADE_COMPANIES)[number];

export const POKEMON_GRADE_VALUES = [
  "10",
  "9.5",
  "9",
  "8.5",
  "8",
  "7.5",
  "7",
  "6",
  "5",
  "4",
  "3",
  "2",
  "1",
] as const;

export type PokemonHoldingMeta = {
  tcgCategory: string | null;
  tcgProductName: string | null;
  tcgSetName: string | null;
  tcgGradeCompany: string | null;
  tcgGradeValue: string | null;
  tcgImageUrl: string | null;
  tcgCardmarketId: string | null;
  tcgExternalId: string | null;
};

export type PokemonCardHit = {
  externalId: string;
  name: string;
  setName: string;
  number: string;
  imageUrl: string | null;
  euLowEur: number | null;
  /** `en` = anglický Near Mint. `any` = denný cenník cez všetky jazyky. */
  lowLanguage: "en" | "any" | null;
  cardmarketUrl: string | null;
  cardmarketId: string | null;
};

export function isPokemonPortfolio(brokerCode: string | null | undefined): boolean {
  return brokerCode === POKEMON_PORTFOLIO_BROKER;
}

export function isPokemonTicker(ticker: string | null | undefined): boolean {
  return (ticker ?? "").trim().toUpperCase().startsWith(POKEMON_TICKER_PREFIX);
}

/** Holding patrí do skupiny Pokémon TCG v prehľade všetkých portfólií. */
export function isPokemonHolding(holding: {
  ticker?: string | null;
  tcgCategory?: string | null;
}): boolean {
  return isPokemonTicker(holding.ticker) || isPokemonTcgCategory(holding.tcgCategory);
}

export function isPokemonGroupTicker(ticker: string | null | undefined): boolean {
  return (ticker ?? "").trim().toUpperCase() === POKEMON_GROUP_TICKER;
}

const GRADE_TAIL = /:(PSA|BGS|CGC|ACE|SGC|TAG)\d{1,2}(\.5)?$/;

export function isGradedPokemonTicker(ticker: string | null | undefined): boolean {
  return GRADE_TAIL.test((ticker ?? "").trim().toUpperCase());
}

/** `PTCG:sv03.5-006:PSA10` → `{ company: "PSA", grade: "10" }`. */
export function pokemonGradeFromTicker(ticker: string | null | undefined): { company: string; grade: string } | null {
  const match = /:(PSA|BGS|CGC|ACE|SGC|TAG)(\d{1,2}(?:\.5)?)$/.exec((ticker ?? "").trim().toUpperCase());
  if (!match?.[1] || !match[2]) return null;
  return { company: match[1], grade: match[2] };
}

/**
 * Id karty v Pokémon TCG API pre európsky low.
 * Graded a ručné (bez pomlčky v id) nemajú raw Cardmarket low ako trhovú cenu.
 * Sealed z katalógu ide cez `pokemonCardmarketProductId`, nie sem.
 */
export function pokemonEuLowCardId(ticker: string | null | undefined): string | null {
  const u = (ticker ?? "").trim().toUpperCase();
  if (isGradedPokemonTicker(u)) return null;
  return pokemonTcgdexCardId(ticker);
}

/** TCGdex id karty, aj keď je ticker graded (`PTCG:sv03.5-006:PSA10`). */
export function pokemonTcgdexCardId(ticker: string | null | undefined): string | null {
  const u = (ticker ?? "").trim().toUpperCase();
  if (!u.startsWith(POKEMON_TICKER_PREFIX) || u === POKEMON_GROUP_TICKER) return null;
  if (pokemonCardmarketProductId(u)) return null;
  const rest = u.slice(POKEMON_TICKER_PREFIX.length).replace(GRADE_TAIL, "");
  if (!rest.includes("-")) return null;
  return rest.toLowerCase();
}

export function isSealedPokemonHolding(holding: {
  ticker?: string | null;
  tcgCategory?: string | null;
}): boolean {
  return holding.tcgCategory === "SEALED_PRODUCT" || pokemonCardmarketProductId(holding.ticker) != null;
}

/** Cardmarket idProduct zo sealed tickera `PTCG:CM895551`. */
export function pokemonCardmarketProductId(ticker: string | null | undefined): string | null {
  const match = /^PTCG:CM(\d{1,12})$/.exec((ticker ?? "").trim().toUpperCase());
  return match?.[1] ?? null;
}

export function isPokemonTcgCategory(value: string | null | undefined): value is PokemonTcgCategory {
  return (POKEMON_TCG_CATEGORIES as readonly string[]).includes(value ?? "");
}

export function isPokemonGradeCompany(value: string | null | undefined): value is PokemonGradeCompany {
  return (POKEMON_GRADE_COMPANIES as readonly string[]).includes((value ?? "").toUpperCase());
}

function shortHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(8, "0").slice(0, 8);
}

export function pokemonCategoryLabel(category: string | null | undefined): string {
  switch (category) {
    case "RAW_CARD":
      return "Raw";
    case "GRADED_CARD":
      return "Graded";
    case "SEALED_PRODUCT":
      return "Sealed";
    default:
      return "Pokémon";
  }
}

export function pokemonDisplayName(input: {
  productName: string;
  setName?: string | null;
  category: PokemonTcgCategory;
  gradeCompany?: string | null;
  gradeValue?: string | null;
}): string {
  const parts = [input.productName.trim()];
  const setName = input.setName?.trim();
  if (setName) parts.push(setName);
  if (input.category === "GRADED_CARD" && input.gradeCompany && input.gradeValue) {
    parts.push(`${input.gradeCompany} ${input.gradeValue}`);
  }
  return parts.join(" · ");
}

export function buildPokemonTicker(input: {
  category: PokemonTcgCategory;
  externalId?: string | null;
  gradeCompany?: string | null;
  gradeValue?: string | null;
  productName: string;
  setName?: string | null;
}): string {
  const graded = input.category === "GRADED_CARD";
  const grade =
    graded && input.gradeCompany && input.gradeValue
      ? `:${input.gradeCompany}${input.gradeValue}`.replace(/\s+/g, "").toUpperCase()
      : "";
  const ext = (input.externalId ?? "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  let body = ext;
  if (!body) {
    body =
      "M" +
      shortHash(
        [input.category, input.productName.trim().toLowerCase(), (input.setName ?? "").trim().toLowerCase(), grade].join(
          "|",
        ),
      );
  }
  let ticker = `${POKEMON_TICKER_PREFIX}${body}${grade}`.replace(/[^A-Z0-9:.-]/g, "");
  if (ticker.length > 32) {
    ticker = `${POKEMON_TICKER_PREFIX}${shortHash(ticker)}${grade}`.slice(0, 32);
  }
  return ticker;
}

export type PokemonPositionInput = {
  category?: string | null;
  productName?: string | null;
  setName?: string | null;
  gradeCompany?: string | null;
  gradeValue?: string | null;
  certNumber?: string | null;
  imageUrl?: string | null;
  cardmarketId?: string | null;
  externalId?: string | null;
};

export type PokemonPosition =
  | {
      ok: true;
      ticker: string;
      companyName: string;
      category: PokemonTcgCategory;
      productName: string;
      setName: string | null;
      gradeCompany: string | null;
      gradeValue: string | null;
      certNumber: string | null;
      imageUrl: string | null;
      cardmarketId: string | null;
      externalId: string | null;
    }
  | { ok: false; message: string };

function cleanHttpsUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (!/^https:\/\//i.test(v)) return null;
  return v.slice(0, 2000);
}

/** Z polí formulára / API zostaví ticker a názov. Rovnaké pre klienta aj server. */
export function buildPokemonPosition(input: PokemonPositionInput): PokemonPosition {
  const category = (input.category ?? "").trim().toUpperCase();
  if (!isPokemonTcgCategory(category)) {
    return { ok: false, message: "Vyberte typ položky: raw karta, graded alebo sealed." };
  }
  const productName = (input.productName ?? "").trim();
  if (productName.length < 2) {
    return { ok: false, message: "Zadajte názov karty alebo produktu." };
  }
  const setName = (input.setName ?? "").trim() || null;
  let gradeCompany: string | null = null;
  let gradeValue: string | null = null;
  if (category === "GRADED_CARD") {
    const company = (input.gradeCompany ?? "").trim().toUpperCase();
    const value = (input.gradeValue ?? "").trim();
    if (!isPokemonGradeCompany(company)) {
      return { ok: false, message: "Pri graded karte vyberte spoločnosť (PSA, BGS, CGC…)." };
    }
    if (!/^\d{1,2}(\.5)?$/.test(value)) {
      return { ok: false, message: "Pri graded karte vyberte stupeň, napríklad 10 alebo 9.5." };
    }
    gradeCompany = company;
    gradeValue = value;
  }
  const certRaw = (input.certNumber ?? "").trim();
  const certNumber = certRaw ? certRaw.replace(/[^\w-]/g, "").slice(0, 32) || null : null;
  const externalRaw = (input.externalId ?? "").trim().toLowerCase();
  const externalId = externalRaw ? externalRaw.replace(/[^a-z0-9.-]/g, "").slice(0, 64) || null : null;
  const cmRaw = (input.cardmarketId ?? "").trim();
  const cardmarketId = /^\d{1,20}$/.test(cmRaw) ? cmRaw : null;
  const imageUrl = cleanHttpsUrl(input.imageUrl);
  const ticker = buildPokemonTicker({
    category,
    externalId,
    gradeCompany,
    gradeValue,
    productName,
    setName,
  });
  return {
    ok: true,
    ticker,
    companyName: pokemonDisplayName({
      productName,
      setName,
      category,
      gradeCompany,
      gradeValue,
    }),
    category,
    productName,
    setName,
    gradeCompany,
    gradeValue,
    certNumber,
    imageUrl,
    cardmarketId,
    externalId,
  };
}
