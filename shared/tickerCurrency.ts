/** Syntetický ticker z XTB importu (úrok z free cash). */
export const CASH_INTEREST_TICKER = "CASH_INTEREST" as const;

/** Zobrazenie v UI namiesto „cash-interest“ / CASH_INTEREST. */
export const CASH_INTEREST_DISPLAY_NAME = "Úrok z cash XTB";

export const CASH_INTEREST_TAX_DISPLAY_NAME = "Daň z úroku z cash XTB";

/**
 * Mena obchodnej jednotky podľa sufixu (rovnaká heuristika ako na serveri).
 * Používa sa pre náklad, ak chýba originalCurrency.
 */
export function getTickerCurrency(
  ticker: string,
): "EUR" | "USD" | "GBP" | "CZK" | "PLN" {
  const u = ticker.toUpperCase();
  if (u === CASH_INTEREST_TICKER || u === "PORTFOLIO_CASH_FLOW" || u === "CASH") {
    return "EUR";
  }
  if (
    u.endsWith(".DE") ||
    u.endsWith(".F") ||
    u.endsWith(".BE") ||
    u.endsWith(".DU") ||
    u.endsWith(".HM") ||
    u.endsWith(".SG") ||
    u.endsWith(".MU")
  ) {
    return "EUR";
  }
  if (
    u.endsWith(".PA") ||
    u.endsWith(".FR") ||
    u.endsWith(".AS") ||
    u.endsWith(".MI") ||
    u.endsWith(".VI") ||
    u.endsWith(".BR") ||
    u.endsWith(".SW")
  ) {
    return "EUR";
  }
  if (u.endsWith(".PR")) return "CZK";
  if (u.endsWith(".WA")) return "PLN";
  if (u.endsWith(".L")) return "GBP";
  return "USD";
}
