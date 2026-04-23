import { CASH_FLOW_TICKER, type Transaction } from "@shared/schema";
import { sumCloseTradeCashFlowEurFromRows } from "@shared/cashFromTransactions";
import { computeFifoRealizedGainsFromTransactions, type OpenFifoLot } from "@shared/fifoRealizedGains";
import { getTickerCurrency } from "@shared/tickerCurrency";
import { buildEurPerUnitByTxnIdForTransactions } from "./eurAtTransactionDate";
import { convertAmountBetween, type AllExchangeRates } from "./convertAmountBetween";

function eurPerOneUnitOfCcy(ccy: string, rates: AllExchangeRates): number {
  const c = ccy.toUpperCase();
  if (c === "EUR") return 1;
  if (c === "USD") return rates.usdToEur;
  if (c === "CZK") return rates.czkToEur;
  if (c === "PLN") return rates.plnToEur;
  if (c === "GBP") return rates.gbpToEur;
  return 1;
}

function dividendNetEur(tx: Transaction[], rates: AllExchangeRates): number {
  let net = 0;
  for (const t of tx) {
    if (t.type === "DIVIDEND") {
      const sh = parseFloat(t.shares);
      const p = parseFloat(t.pricePerShare);
      const tax = parseFloat(t.commission || "0");
      const ccy = getTickerCurrency(t.ticker);
      const gross = sh * p;
      net += convertAmountBetween(gross - tax, ccy, "EUR", rates);
    }
  }
  for (const t of tx) {
    if (t.type === "TAX") {
      const sh = parseFloat(t.shares);
      const p = parseFloat(t.pricePerShare);
      const ccy = getTickerCurrency(t.ticker);
      net += convertAmountBetween(sh * p, ccy, "EUR", rates);
    }
  }
  return net;
}

export interface PnlBreakdownResult {
  currency: string;
  /** FIFO akcie (EUR) + XTB „close trade“ hotovosť — rovnaká logika ako GET /api/realized-gains → realizedGainTotal, v mene UI. */
  realizedCapitalGain: number;
  unrealizedPriceGain: number;
  unrealizedFxGain: number;
  /** Presný trojčlen: krížový člen (ΔP·ΔFX); môže byť 0 ak sa zlúčil do kapitálu. */
  unrealizedCrossComponent: number;
  residualUnrealized: number;
  dividendNet: number;
  /**
   * Odhad: čisté dividendy z posledných 12 mesiacov (v behu) ako proxy pre ďalších 12 ms.
   */
  projectedDividendNext12m: number;
  /**
   * Nerealizovaný kladný zisk z lotov s časovým testom ≥365 dní (orientačné oslobodenie) — v zobrazovacej mene.
   */
  unrealizedTaxExempt: number;
  method: {
    realized: "FIFO";
    costEur: string;
  };
}

const MS_365D = 365 * 24 * 60 * 60 * 1000;

/**
 * Nerealizované: presný rozklad (ΔV = čistý FX + kapitál + kríž); ak sa book líši od
 * pBuy·fBuy (provízia), zvyšok ide do `res`.
 */
function unrealizedSplitEur(
  openLots: Record<string, OpenFifoLot[]>,
  priceByTicker: Map<string, number>,
  eNowByCcy: (ccy: string) => number,
  now: Date,
): { cap: number; fx: number; cross: number; res: number; taxExemptEur: number } {
  let cap = 0;
  let fx = 0;
  let cross = 0;
  let res = 0;
  let taxExemptEur = 0;
  for (const [key, arr] of Object.entries(openLots)) {
    const parts = key.split("::");
    const ticker = (parts[1] ?? parts[0]) ?? "";
    if (!ticker) continue;
    const pNow = priceByTicker.get(ticker.toUpperCase());
    if (pNow == null || !Number.isFinite(pNow)) continue;
    for (const lot of arr) {
      if (lot.remainingShares <= 0) continue;
      const fBuy = lot.eurPerUnit;
      const fNow = eNowByCcy(lot.ccy);
      const pBuy = lot.priceLocal;
      const rem = lot.remainingShares;
      const cps = lot.costPerShareEur;
      const vNowEur = rem * pNow * fNow;
      const bookEur = rem * cps;
      const T = vNowEur - bookEur;
      const dp = pNow - pBuy;
      const df = fNow - fBuy;
      const pureFx = rem * pBuy * df;
      const crossI = rem * dp * df;
      const capCore = rem * fBuy * dp;
      const dCap = capCore + crossI;
      const fromParts = dCap + pureFx;
      cap += dCap;
      fx += pureFx;
      cross += crossI;
      res += T - fromParts;
      if (T > 0) {
        const t0 = new Date(`${lot.acquiredAt}T00:00:00Z`);
        if (Number.isFinite(t0.getTime()) && now.getTime() - t0.getTime() >= MS_365D) {
          taxExemptEur += T;
        }
      }
    }
  }
  return { cap, fx, cross, res, taxExemptEur };
}

function toUser(eur: number, userCcy: string, rates: AllExchangeRates): number {
  return convertAmountBetween(eur, "EUR", userCcy, rates);
}

function dividendNetEurLast12m(tx: Transaction[], rates: AllExchangeRates, now: Date): number {
  const cutoff = new Date(
    now.getTime() - 365 * 24 * 60 * 60 * 1000,
  );
  return dividendNetEur(
    tx.filter((t) => new Date(t.transactionDate as unknown as string) >= cutoff),
    rates,
  );
}

export async function computePnlBreakdown(
  userTransactions: Transaction[],
  userCcy: string,
  rates: AllExchangeRates,
  currentPriceByTicker: Record<string, number>,
  prebuiltEurPerTxn?: Map<string, number | null>,
): Promise<PnlBreakdownResult> {
  const now = new Date();
  const m =
    prebuiltEurPerTxn ??
    (await buildEurPerUnitByTxnIdForTransactions(userTransactions));
  const { summary, openLots } = computeFifoRealizedGainsFromTransactions(
    userTransactions,
    m,
    now,
  );
  const priceByTicker = new Map<string, number>();
  for (const t of userTransactions) {
    if (t.type === "BUY" || t.type === "SELL") {
      const u = t.ticker.toUpperCase();
      if (u === "CASH" || u === CASH_FLOW_TICKER) continue;
      if (!priceByTicker.has(u)) {
        const p = currentPriceByTicker[u];
        if (p != null && Number.isFinite(p)) priceByTicker.set(u, p);
      }
    }
  }
  const eNowByCcy = (ccy: string) => eurPerOneUnitOfCcy(ccy, rates);
  const { cap, fx, cross, res, taxExemptEur } = unrealizedSplitEur(
    openLots,
    priceByTicker,
    eNowByCcy,
    now,
  );
  const divEur = dividendNetEur(userTransactions, rates);
  const last12mDiv = dividendNetEurLast12m(userTransactions, rates, now);
  const closeTradeNetEur = sumCloseTradeCashFlowEurFromRows(userTransactions);
  const realizedStockAndCloseEur = summary.totalRealized + closeTradeNetEur;
  return {
    currency: userCcy,
    realizedCapitalGain: toUser(realizedStockAndCloseEur, userCcy, rates),
    unrealizedPriceGain: toUser(cap, userCcy, rates),
    unrealizedFxGain: toUser(fx, userCcy, rates),
    unrealizedCrossComponent: toUser(cross, userCcy, rates),
    residualUnrealized: toUser(res, userCcy, rates),
    dividendNet: toUser(divEur, userCcy, rates),
    projectedDividendNext12m: toUser(last12mDiv, userCcy, rates),
    unrealizedTaxExempt: toUser(taxExemptEur, userCcy, rates),
    method: {
      realized: "FIFO",
      costEur: "baseCurrencyAmount | exchangeRateAtTransaction | Frankfurter (ECB) v deň transakcie",
    },
  };
}
