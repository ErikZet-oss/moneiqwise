import { CASH_FLOW_TICKER, type Transaction } from "@shared/schema";
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
  realizedCapitalGain: number;
  unrealizedPriceGain: number;
  unrealizedFxGain: number;
  residualUnrealized: number;
  dividendNet: number;
  method: {
    realized: "FIFO";
    costEur: string;
  };
}

/**
 * Nerealizované: cena (pri fBuy) a FX (pri pNow).
 */
function unrealizedSplitEur(
  openLots: Record<string, OpenFifoLot[]>,
  priceByTicker: Map<string, number>,
  eNowByCcy: (ccy: string) => number,
): { cap: number; fx: number; res: number } {
  let cap = 0;
  let fx = 0;
  let tot = 0;
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
      const C = rem * fBuy * (pNow - pBuy);
      const F = rem * pNow * (fNow - fBuy);
      const resid = T - C - F;
      cap += C;
      fx += F;
      tot += T;
    }
  }
  return { cap, fx, res: tot - cap - fx };
}

function toUser(eur: number, userCcy: string, rates: AllExchangeRates): number {
  return convertAmountBetween(eur, "EUR", userCcy, rates);
}

export async function computePnlBreakdown(
  userTransactions: Transaction[],
  userCcy: string,
  rates: AllExchangeRates,
  currentPriceByTicker: Record<string, number>,
): Promise<PnlBreakdownResult> {
  const m = await buildEurPerUnitByTxnIdForTransactions(userTransactions);
  const { summary, openLots } = computeFifoRealizedGainsFromTransactions(
    userTransactions,
    m,
    new Date(),
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
  const { cap, fx, res } = unrealizedSplitEur(openLots, priceByTicker, eNowByCcy);
  const divEur = dividendNetEur(userTransactions, rates);
  return {
    currency: userCcy,
    realizedCapitalGain: toUser(summary.totalRealized, userCcy, rates),
    unrealizedPriceGain: toUser(cap, userCcy, rates),
    unrealizedFxGain: toUser(fx, userCcy, rates),
    residualUnrealized: toUser(res, userCcy, rates),
    dividendNet: toUser(divEur, userCcy, rates),
    method: {
      realized: "FIFO",
      costEur: "baseCurrencyAmount | exchangeRateAtTransaction | Frankfurter (ECB) v deň transakcie",
    },
  };
}
