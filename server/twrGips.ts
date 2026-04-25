import { mtmValueAtEod } from "./gipsMtmValue";
import { storage } from "./storage";
import type { AllExchangeRates } from "./convertAmountBetween";

type HistoricalFn = (ticker: string) => Promise<Record<string, number>>;

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function spCloseOnOrBefore(
  h: Record<string, number> | undefined,
  iso: string,
): number | null {
  if (!h) return null;
  if (h[iso] != null) return h[iso];
  for (let i = 1; i <= 21; i++) {
    const t = addDaysIso(iso, -i);
    if (h[t] != null) return h[t];
  }
  return null;
}

export interface GipsTwrResult {
  userCurrency: string;
  timeWeightedReturn: number;
  sp500TimeWeightedReturn: number;
  linkedPeriods: number;
  note: string;
  method: "GIPS chain medzi dátumami s vklady/výbormi, MTM + hotovosť (ako dashboard)";
}

/**
 * TWR: násobok (1+Ri) medzi dátumami. B = EOD d_k, E = EOD d_{k+1}−1 deň; Ri = E/B−1; pri B≤0 sa segment preskočí.
 */
export async function computeGipsTwr(
  userId: string,
  portfolio: string | null,
  userCurrency: string,
  rates: AllExchangeRates,
  todayIso: string,
  fetchHistorical: HistoricalFn,
  /** EOD kotácie; zvyčajne z batch fetchu v rout-e */
  currentPrices: Record<string, number>,
): Promise<GipsTwrResult> {
  const tw = await storage.getTransactionsByUser(
    userId,
    portfolio === "all" ? null : portfolio,
  );
  if (tw.length === 0) {
    return {
      userCurrency: userCurrency,
      timeWeightedReturn: 0,
      sp500TimeWeightedReturn: 0,
      linkedPeriods: 0,
      note: "Bez transakcií",
      method: "GIPS chain medzi dátumami s vklady/výbormi, MTM + hotovosť (ako dashboard)",
    };
  }

  const sorted = [...tw].sort(
    (a, b) =>
      new Date(a.transactionDate as unknown as string).getTime() -
      new Date(b.transactionDate as unknown as string).getTime(),
  );
  const tickerSet = new Set<string>();
  for (const t of sorted) {
    const u = t.ticker?.toUpperCase() ?? "";
    if (
      u &&
      u !== "CASH" &&
      u !== "PORTFOLIO_CASH_FLOW" &&
      u !== "CASH_INTEREST"
    ) {
      tickerSet.add(u);
    }
  }
  const tickers = Array.from(tickerSet);
  const historical: Record<string, Record<string, number>> = {};
  for (const t of tickers) {
    try {
      historical[t] = (await fetchHistorical(t)) || {};
    } catch {
      historical[t] = {};
    }
  }
  const spHist = (await fetchHistorical("^GSPC")) || {};

  const firstIso = new Date(sorted[0].transactionDate as unknown as string)
    .toISOString()
    .slice(0, 10);
  const dw = new Set<string>();
  for (const t of sorted) {
    if (t.type === "DEPOSIT" || t.type === "WITHDRAWAL") {
      const iso = new Date(t.transactionDate as unknown as string)
        .toISOString()
        .slice(0, 10);
      dw.add(iso);
    }
  }
  const anchorList = [firstIso, ...Array.from(dw).sort(), todayIso]
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();

  let twr = 1;
  let spTwr = 1;
  let nSeg = 0;
  for (let i = 0; i < anchorList.length - 1; i++) {
    const bIso = anchorList[i];
    const nextA = anchorList[i + 1];
    if (bIso > todayIso) break;
    const rawE = addDaysIso(nextA, -1);
    const eCap =
      rawE < bIso
        ? bIso
        : (rawE > todayIso ? todayIso : rawE);

    const bVal = mtmValueAtEod(
      sorted,
      bIso,
      historical,
      {},
      currentPrices,
      rates,
      userCurrency,
      todayIso,
    );
    const eVal = mtmValueAtEod(
      sorted,
      eCap,
      historical,
      {},
      currentPrices,
      rates,
      userCurrency,
      todayIso,
    );
    if (bVal > 1e-9) {
      twr *= eVal / bVal;
      const sb = spCloseOnOrBefore(spHist, bIso) ?? 1;
      const se = spCloseOnOrBefore(spHist, eCap) ?? sb;
      if (sb > 0) spTwr *= se / sb;
      nSeg++;
    }
  }

  return {
    userCurrency: userCurrency,
    timeWeightedReturn: twr - 1,
    sp500TimeWeightedReturn: spTwr - 1,
    linkedPeriods: nSeg,
    note: "GIPS: podobné obdobia pre portfólio a S&P 500 (ceny uzávierky). Vklady/ výbery oddeľujú segmenty (B = EOD d, E = deň pred ďalšou kotvou).",
    method: "GIPS chain medzi dátumami s vklady/výbormi, MTM + hotovosť (ako dashboard)",
  };
}
