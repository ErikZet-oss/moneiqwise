/**
 * Mena obchodnej jednotky podľa sufixu (rovnaká heuristika ako na serveri).
 * Používa sa pre náklad, ak chýba originalCurrency.
 */
export function getTickerCurrency(
  ticker: string,
): "EUR" | "USD" | "GBP" | "CZK" | "PLN" {
  const u = ticker.toUpperCase();
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
