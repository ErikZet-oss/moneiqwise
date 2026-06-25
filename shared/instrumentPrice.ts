import type { Transaction } from "./schema";
import { inferTradeCurrency } from "./transactionEur";
import { getTickerCurrency } from "./tickerCurrency";

/**
 * Cena za kus v mene inštrumentu (napr. USD pri US akciách).
 * Preferuje `instrument_price_per_share`; záloha z XTB stĺpca kurzu v `exchangeRateAtTransaction`.
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
  const tradeCcy = inferTradeCurrency(txn);
  const px = parseFloat(String(txn.pricePerShare ?? "0"));

  if (quoteCcy === tradeCcy && Number.isFinite(px) && px > 0) {
    return px;
  }

  if (quoteCcy !== "EUR" && tradeCcy === "EUR") {
    const ex = parseFloat(String(txn.exchangeRateAtTransaction ?? "0"));
    // Na EUR účte XTB často ukladá otváraciu cenu v USD do stĺpca kurzu (nie FX ~0,9).
    if (Number.isFinite(ex) && ex >= 0.05 && ex <= 500_000) {
      if (ex > 2 || quoteCcy === "CZK" || quoteCcy === "PLN") {
        return ex;
      }
    }
  }

  return 0;
}
