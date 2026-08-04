/**
 * eToro / app symbol → Yahoo Finance crypto ticker.
 * Niektoré coiny na Yahoo nemajú tvar BTC-USD (napr. Sui = SUI20947-USD).
 */
const YAHOO_CRYPTO_BY_SYMBOL: Record<string, string> = {
  SUI: "SUI20947-USD",
};

const YAHOO_CRYPTO_ALIASES: Record<string, string> = {
  "SUI-USD": "SUI20947-USD",
};

/** eToro krypto symbol (SUI) + quote (USD) → Yahoo ticker. */
export function resolveCryptoYahooTicker(symbol: string, quoteCurrency = "USD"): string {
  const sym = symbol.trim().toUpperCase();
  const mapped = YAHOO_CRYPTO_BY_SYMBOL[sym];
  if (mapped) return mapped;
  const quote = quoteCurrency.trim().toUpperCase() || "USD";
  const naive = `${sym}-${quote}`;
  return YAHOO_CRYPTO_ALIASES[naive] ?? naive;
}

/** Normalizuje uložený / legacy ticker na Yahoo symbol (aj pre kotácie). */
export function toYahooCryptoTicker(ticker: string): string {
  const upper = ticker.trim().toUpperCase();
  const alias = YAHOO_CRYPTO_ALIASES[upper];
  if (alias) return alias;

  const pair = upper.match(/^([A-Z0-9]+)-([A-Z0-9]+)$/);
  if (pair) {
    const mapped = YAHOO_CRYPTO_BY_SYMBOL[pair[1]];
    if (mapped) return mapped;
  }

  const symOnly = YAHOO_CRYPTO_BY_SYMBOL[upper];
  if (symOnly) return symOnly;

  return upper;
}

export function cryptoDisplayName(yahooTicker: string): string | null {
  const upper = yahooTicker.trim().toUpperCase();
  if (upper === "SUI20947-USD") return "Sui USD";
  return null;
}
