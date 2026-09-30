import type { Transaction } from "./schema";
import { inferTradeCurrency, type TradeCurrency } from "./transactionEur";
import { getTickerCurrency, type QuoteCurrency } from "./tickerCurrency";

function accountLineCurrency(
  txn: Pick<Transaction, "currency" | "originalCurrency" | "ticker">,
): TradeCurrency {
  const leg = txn.currency?.trim().toUpperCase();
  if (leg === "EUR" || leg === "USD" || leg === "GBP" || leg === "CZK" || leg === "PLN" || leg === "HKD") {
    return leg;
  }
  return inferTradeCurrency(txn);
}

/** XTB stĺpec kurzu: pri EUR účte tu býva cena inštrumentu (USD/PLN), nie vždy FX ~0,9. */
export function exchangeColumnLooksLikeInstrumentPrice(
  ex: number,
  quoteCcy: QuoteCurrency,
): boolean {
  if (!Number.isFinite(ex) || ex <= 0 || ex > 500_000) return false;
  if (quoteCcy === "CZK" || quoteCcy === "PLN" || quoteCcy === "HKD") {
    return ex >= 0.05;
  }
  if (quoteCcy === "USD" || quoteCcy === "GBP") {
    return ex > 2;
  }
  return ex > 2;
}

/**
 * Cena za kus v mene inštrumentu (napr. USD pri US akciách, PLN pri .WA).
 * Preferuje `instrument_price_per_share`; potom kurz z XTB (`exchangeRateAtTransaction`).
 */
export function resolveInstrumentPricePerShare(
  txn: Pick<
    Transaction,
    | "instrumentPricePerShare"
    | "pricePerShare"
    | "ticker"
    | "originalCurrency"
    | "currency"
    | "exchangeRateAtTransaction"
  >,
): number {
  const fromDb = parseFloat(String(txn.instrumentPricePerShare ?? "0"));
  if (Number.isFinite(fromDb) && fromDb > 0) return fromDb;

  const quoteCcy = getTickerCurrency(txn.ticker);
  const accountCcy = accountLineCurrency(txn);
  const ex = parseFloat(String(txn.exchangeRateAtTransaction ?? "0"));

  if (quoteCcy !== "EUR" && exchangeColumnLooksLikeInstrumentPrice(ex, quoteCcy)) {
    return ex;
  }

  const px = parseFloat(String(txn.pricePerShare ?? "0"));

  /**
   * XTB EUR účet + US akcia: `pricePerShare` = €/ks, `exchangeRateAtTransaction` = €/USD
   * → $/ks = €/ks ÷ (€/USD). (MU ~1046 USD, nie ~263 EUR v stĺpci Cena/ks.)
   */
  if (
    quoteCcy !== "EUR" &&
    accountCcy === "EUR" &&
    Number.isFinite(px) &&
    px > 0 &&
    Number.isFinite(ex) &&
    ex > 0 &&
    ex < 2
  ) {
    return Math.abs(px) / ex;
  }

  if (quoteCcy === accountCcy && Number.isFinite(px) && px > 0) {
    return Math.abs(px);
  }

  return 0;
}
