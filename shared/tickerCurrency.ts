import { isPhysicalMetalTicker } from "./physicalMetal";

/** Syntetický ticker z XTB importu (úrok z free cash). */
export const CASH_INTEREST_TICKER = "CASH_INTEREST" as const;

/** Zobrazenie v UI namiesto „cash-interest“ / CASH_INTEREST. */
export const CASH_INTEREST_DISPLAY_NAME = "Úrok z cash XTB";

export const CASH_INTEREST_TAX_DISPLAY_NAME = "Daň z úroku z cash XTB";

export type QuoteCurrency = "EUR" | "USD" | "GBP" | "CZK" | "PLN";

/**
 * Mena trhovej kotácie (Yahoo) podľa sufixu / typu aktíva.
 * PM:XAG = spot striebra v USD/oz.
 */
export function getTickerCurrency(ticker: string): QuoteCurrency {
  const u = ticker.toUpperCase();
  if (u === CASH_INTEREST_TICKER || u === "PORTFOLIO_CASH_FLOW" || u === "CASH") {
    return "EUR";
  }
  if (u.startsWith("PM:")) {
    return "USD";
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

/**
 * Mena nákupnej ceny / investovanej sumy v holdingu.
 * Fyzické kovy: nákup sa zadáva v EUR (formulár), kotácia zostáva USD.
 */
export function getTickerCostCurrency(ticker: string): QuoteCurrency {
  if (isPhysicalMetalTicker(ticker)) return "EUR";
  return getTickerCurrency(ticker);
}
