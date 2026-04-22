import type { Transaction } from "@shared/schema";
import { transactionLotKey } from "@shared/lotKey";
import { computeFifoRealizedGainsFromTransactions, type OpenFifoLot } from "@shared/fifoRealizedGains";
import { buildEurPerUnitByTxnIdForTransactions } from "./eurAtTransactionDate";
import { convertAmountBetween, type AllExchangeRates } from "./convertAmountBetween";

const MS_365D = 365 * 24 * 60 * 60 * 1000;

function eurPerOneUnitOfCcy(ccy: string, rates: AllExchangeRates): number {
  const c = ccy.toUpperCase();
  if (c === "EUR") return 1;
  if (c === "USD") return rates.usdToEur;
  if (c === "CZK") return rates.czkToEur;
  if (c === "PLN") return rates.plnToEur;
  if (c === "GBP") return rates.gbpToEur;
  return 1;
}

export type OpenFifoLotApiRow = {
  acquiredAt: string;
  remainingShares: number;
  pricePerShareLocal: number;
  /** Menovka z riadka / inferTrade (USD, …). */
  purchaseCurrency: string;
  /** EUR za 1 jednotku cudzej meny (ECB) v deň nákupu. */
  eurPerUnitAtPurchase: number;
  currentPriceAvailable: boolean;
  /** PnL v zobrazovacej mene. */
  currentPnl: number;
  currentPnlEur: number;
  taxFree: boolean;
  /** Dni do dosiahnutia 365; null ak už tax free. */
  daysToTaxFree: number | null;
  /** Posledné ≤30 dní do oslobodenia (k „majáku“ v UI). */
  inTaxFreeCountdown: boolean;
  daysHeld: number;
};

function taxInfo(acquiredAt: string, now: Date) {
  const t0 = new Date(`${acquiredAt}T00:00:00Z`);
  if (!Number.isFinite(t0.getTime())) {
    return { taxFree: false, daysToTaxFree: 365, inTaxFreeCountdown: true, daysHeld: 0 };
  }
  const ageMs = now.getTime() - t0.getTime();
  const daysHeld = ageMs / (24 * 60 * 60 * 1000);
  const taxFree = ageMs >= MS_365D;
  if (taxFree) {
    return { taxFree: true, daysToTaxFree: null, inTaxFreeCountdown: false, daysHeld };
  }
  const dLeft = Math.max(0, Math.ceil(365 - daysHeld));
  return {
    taxFree: false,
    daysToTaxFree: dLeft,
    inTaxFreeCountdown: dLeft > 0 && dLeft <= 30,
    daysHeld,
  };
}

function pnlEurForLot(
  lot: OpenFifoLot,
  pNow: number,
  rates: AllExchangeRates,
): { pnlEur: number; vNowEur: number; bookEur: number } {
  const fNow = eurPerOneUnitOfCcy(lot.ccy, rates);
  const rem = lot.remainingShares;
  const vNowEur = rem * pNow * fNow;
  const bookEur = rem * lot.costPerShareEur;
  return { pnlEur: vNowEur - bookEur, vNowEur, bookEur };
}

/**
 * Otvorené FIFO loty pre daný ticker a portfólio (kľúč = portfólio::ticker).
 * `pNow` = trhová cena / ks v mene `getTickerCurrency(ticker)`.
 */
export function buildOpenFifoLotRowList(
  tradeTx: Transaction[],
  eurM: Map<string, number | null>,
  now: Date,
  rates: AllExchangeRates,
  userCcy: string,
  pNow: number | null,
): OpenFifoLotApiRow[] {
  if (!tradeTx.length) return [];
  const priceOk = pNow != null && Number.isFinite(pNow) && pNow >= 0;
  const pUse = priceOk ? pNow! : 0;

  const { openLots } = computeFifoRealizedGainsFromTransactions(tradeTx, eurM, now);
  const rep = tradeTx[0]!;
  const key = transactionLotKey(rep);
  const queue: OpenFifoLot[] = (openLots[key] ?? []).filter(
    (l) => l.remainingShares > 1e-8,
  );
  if (queue.length === 0) return [];

  return queue.map((lot) => {
    const { pnlEur } = pnlEurForLot(lot, pUse, rates);
    const t = taxInfo(lot.acquiredAt, now);
    const pnlReady = pnlEur;
    return {
      acquiredAt: lot.acquiredAt,
      remainingShares: lot.remainingShares,
      pricePerShareLocal: lot.priceLocal,
      purchaseCurrency: String(lot.ccy),
      eurPerUnitAtPurchase: lot.eurPerUnit,
      currentPriceAvailable: priceOk,
      currentPnl: priceOk
        ? convertAmountBetween(pnlReady, "EUR", userCcy, rates)
        : 0,
      currentPnlEur: priceOk ? pnlReady : 0,
      taxFree: t.taxFree,
      daysToTaxFree: t.daysToTaxFree,
      inTaxFreeCountdown: t.inTaxFreeCountdown,
      daysHeld: t.daysHeld,
    };
  });
}

export async function loadTradeTransactionsForAssetLots(
  txns: Transaction[],
  tickerUpper: string,
): Promise<{
  eurM: Map<string, number | null>;
  forFifo: Transaction[];
}> {
  const forFifo = txns
    .filter(
      (t) =>
        (t.type === "BUY" || t.type === "SELL") &&
        t.ticker.toUpperCase() === tickerUpper,
    )
    .sort(
      (a, b) =>
        new Date(a.transactionDate as unknown as string).getTime() -
        new Date(b.transactionDate as unknown as string).getTime(),
    );
  const eurM = await buildEurPerUnitByTxnIdForTransactions(forFifo);
  return { eurM, forFifo };
}
