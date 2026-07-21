import type { Holding, Transaction } from "./schema";
import { computeFifoRealizedGainsFromTransactions } from "./fifoRealizedGains";
import type { TradeCurrency } from "./transactionEur";

export type HoldingPnlRates = {
  usdToEur: number;
  gbpToEur: number;
  czkToEur: number;
  plnToEur: number;
};

export type OpenHoldingPnlCost = {
  /** Náklad otvorenej pozície v EUR (FIFO book). */
  investedEur: number;
  /**
   * Vážený priemer otváracej ceny / ks v mene inštrumentu (ako XTB open),
   * nie prepočet EUR nákladu cez aktuálny FX.
   */
  openAvgPriceLocal: number | null;
  openPriceCurrency: TradeCurrency | null;
};

/**
 * Nákladová základňa + otváracia cena pre zisk % (ako XTB „Čistý zisk %“):
 * súčet FIFO nákladov otvorených lotov v EUR (rovnaké ako rozbalené nákupy).
 * Záloha: `totalInvested` z holdingu.
 *
 * `eurPerUnitByTxnId` — historické kurzy (Frankfurter / DB); rovnaké ako asset-lots API.
 */
export function computeOpenHoldingPnlCost(
  holding: Pick<Holding, "ticker" | "shares" | "totalInvested" | "portfolioId">,
  portfolioTransactions: Transaction[],
  _rates: HoldingPnlRates,
  eurPerUnitByTxnId?: Map<string, number | null>,
): OpenHoldingPnlCost {
  const holdingShares = parseFloat(String(holding.shares));
  const eurPaid = parseFloat(String(holding.totalInvested));
  if (!(holdingShares > 0)) {
    return { investedEur: 0, openAvgPriceLocal: null, openPriceCurrency: null };
  }

  const eurM = eurPerUnitByTxnId ?? new Map<string, number | null>();
  if (!eurPerUnitByTxnId) {
    for (const t of portfolioTransactions) eurM.set(t.id, null);
  }

  const { openLots } = computeFifoRealizedGainsFromTransactions(
    portfolioTransactions,
    eurM,
  );
  const upper = String(holding.ticker ?? "")
    .trim()
    .toUpperCase();
  const pid = holding.portfolioId ?? "__none__";

  let fifoBook = 0;
  let fifoShares = 0;
  let openNotional = 0;
  let openCcy: TradeCurrency | null = null;
  for (const [key, lots] of Object.entries(openLots)) {
    // Pri konkrétnom portfóliu len jeho loty; pri agregácii (portfolioId null) všetky.
    if (holding.portfolioId != null) {
      if (key !== `${pid}::${upper}`) continue;
    } else if (!key.endsWith(`::${upper}`)) {
      continue;
    }
    for (const lot of lots) {
      if (lot.remainingShares <= 1e-8) continue;
      fifoBook += lot.remainingShares * lot.costPerShareEur;
      fifoShares += lot.remainingShares;
      if (lot.priceLocal > 0) {
        openNotional += lot.remainingShares * lot.priceLocal;
        openCcy = lot.ccy;
      }
    }
  }

  const sharesMatch =
    fifoShares > 1e-8 &&
    Math.abs(fifoShares - holdingShares) <= Math.max(1e-4, holdingShares * 1e-2);
  const openAvgPriceLocal =
    fifoShares > 1e-8 && openNotional > 0 ? openNotional / fifoShares : null;
  const openPriceCurrency = fifoShares > 1e-8 ? openCcy : null;

  if (fifoBook > 0 && fifoShares > 1e-8) {
    const investedEur = sharesMatch
      ? fifoBook
      : fifoBook * (holdingShares / fifoShares);
    return {
      investedEur,
      openAvgPriceLocal,
      openPriceCurrency,
    };
  }

  const investedEur =
    Number.isFinite(eurPaid) && eurPaid > 0 ? eurPaid : 0;
  return { investedEur, openAvgPriceLocal: null, openPriceCurrency: null };
}

/**
 * Nákladová základňa pre zisk % — len EUR suma (spätná kompatibilita).
 */
export function computePnlInvestedEur(
  holding: Pick<Holding, "ticker" | "shares" | "totalInvested" | "portfolioId">,
  portfolioTransactions: Transaction[],
  rates: HoldingPnlRates,
  eurPerUnitByTxnId?: Map<string, number | null>,
): number {
  return computeOpenHoldingPnlCost(holding, portfolioTransactions, rates, eurPerUnitByTxnId)
    .investedEur;
}
