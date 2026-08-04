type SupportedCcy = "EUR" | "USD" | "CZK" | "PLN" | "GBP" | "HKD";
export type AllExchangeRates = {
  eurToUsd: number;
  usdToEur: number;
  eurToCzk: number;
  czkToEur: number;
  eurToPln: number;
  plnToEur: number;
  eurToGbp: number;
  gbpToEur: number;
  eurToHkd: number;
  hkdToEur: number;
};

export function convertAmountBetween(
  amount: number,
  from: SupportedCcy,
  to: string,
  rates: AllExchangeRates,
): number {
  if (from === to) return amount;
  let eur: number;
  switch (from) {
    case "EUR":
      eur = amount;
      break;
    case "USD":
      eur = amount * rates.usdToEur;
      break;
    case "CZK":
      eur = amount * rates.czkToEur;
      break;
    case "PLN":
      eur = amount * rates.plnToEur;
      break;
    case "GBP":
      eur = amount * rates.gbpToEur;
      break;
    case "HKD":
      eur = amount * rates.hkdToEur;
      break;
    default:
      eur = amount;
  }
  switch (to.toUpperCase()) {
    case "EUR":
      return eur;
    case "USD":
      return eur * rates.eurToUsd;
    case "CZK":
      return eur * rates.eurToCzk;
    case "PLN":
      return eur * rates.eurToPln;
    case "GBP":
      return eur * rates.eurToGbp;
    case "HKD":
      return eur * rates.eurToHkd;
    default:
      return eur;
  }
}
