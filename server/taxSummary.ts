import type { Transaction } from "@shared/schema";
import { getTickerCurrency } from "@shared/tickerCurrency";
import {
  computeFifoRealizedPortionsEur,
  type FifoRealizedPortionEur,
} from "@shared/fifoRealizedPortions";
import { buildEurPerUnitByTxnIdForTransactions } from "./eurAtTransactionDate";
import { convertAmountBetween, type AllExchangeRates } from "./convertAmountBetween";

/**
 * Orient. horná hranica 19% pausalizácie fyz. osôb (základ, nie finálna dávka).
 * Môžete nahradiť reálnou hranicou v EUR podľa roka (OECD / MF SR).
 * Ak je 0, zapíše sa plná 19% na celý kladný základ (fallback).
 */
export const SK_PERSONAL_INCOME_TAX_19_BRACKET_FLOOR_EUR_2024_STYLE = 0 as number;

export interface TaxSummaryDividendRowEur {
  transactionId: string;
  date: string;
  grossEur: number;
  /** Zrazená / účtovaná zrážka (commission) v hrubej očakávanej mene, prepoč. na EUR. */
  withholdingEur: number;
  netEur: number;
  ticker: string;
}

export interface TaxSummaryResult {
  /** Kalendárny rok, ktorý spracovanie pokrýva (predaje + dividendy). */
  year: number;
  baseCurrency: "EUR";
  disclaimer: string;
  /** FIFO rozpad realizovaných diel v EUR pre daný rok predajov. */
  realized: {
    /** Súčet diel s držbou &lt; 365 dní, len kladné získy. */
    taxableGainsEur: number;
    /** Súčet ztrát z diel s držbou &lt; 365 dní (absolút). */
    taxableLossesEur: number;
    /** max(0, kladné – straty) v rámci „krátkodobej“ kategórie (orient. základ 19% / 25%). */
    netShortTermTaxableEur: number;
    /** Súčet kladných diel s držbou ≥ 365 dní (orient. oslobodenie titulov, nie daň. poradenstvo). */
    longTermGainsEur: number;
    longTermLossesEur: number;
    totalRealizedGainEur: number;
  };
  skEstimate: {
    taxRate19: 0.19;
    taxRate25: 0.25;
    /** Jednoduchý model: 19% z netto krátkodobých ziskov po zápočte strát v rámci roka. */
    estimatedTaxEur19Simple: number;
    /** Pausalizácia 19% a 25% podľa hranice (ak je 0, len pás 19% na whole neto). */
    estimatedTaxEurByBracket: { fromEur: number; toEur: number; rate: number; taxEur: number }[];
    estimatedTotalTaxEur: number;
  };
  dividends: {
    count: number;
    grossEur: number;
    /** Zrážka z dividend (commission) – orient., nie vždy = zahraničné WHT. */
    withholdingEur: number;
    netEur: number;
    /** Pre CSV: jeden riadok = jeden výplatný záznam. */
    items: TaxSummaryDividendRowEur[];
  };
  /** Ploché pole pre budúci PDF/CSV – diely FIFO pri predaji. */
  disposalPortions: FifoRealizedPortionEur[];
  /**
   * Stručné podsumá pre „skutočný svet“: oslobodené = držané aspoň 1 rok (orient.),
   * zdaniteľné = krátkodobé po zápočte v rámci roka.
   */
  forForms: {
    taxExempt: { label: string; realizedGainsEur: number; realizedLossesEur: number };
    taxable: {
      label: string;
      shortTermGainsEur: number;
      shortTermLossesEur: number;
      netShortTermAfterLossOffsetEur: number;
    };
  };
}

function portionInYear(p: FifoRealizedPortionEur, year: number): boolean {
  return p.saleYear === year;
}

function dividendLineEur(
  t: Pick<
    Transaction,
    "ticker" | "shares" | "pricePerShare" | "commission"
  >,
  rates: AllExchangeRates,
): { grossEur: number; withholdingEur: number; netEur: number } {
  const ccy = getTickerCurrency(t.ticker);
  const sh = parseFloat(t.shares);
  const pps = parseFloat(t.pricePerShare);
  const wht = parseFloat(t.commission || "0");
  const gross = sh * pps;
  if (!Number.isFinite(gross)) {
    return { grossEur: 0, withholdingEur: 0, netEur: 0 };
  }
  return {
    grossEur: convertAmountBetween(gross, ccy, "EUR", rates),
    withholdingEur: convertAmountBetween(Math.abs(wht), ccy, "EUR", rates),
    netEur: convertAmountBetween(gross - wht, ccy, "EUR", rates),
  };
}

/**
 * Dátum v kalendárnom roku (UTC, podľa dňa v transactionDate).
 */
function inCalendarYear(
  t: Pick<Transaction, "transactionDate">,
  year: number,
): boolean {
  const d = new Date(t.transactionDate as unknown as string);
  return d.getUTCFullYear() === year;
}

export async function buildTaxSummary(
  year: number,
  transactions: Transaction[],
  rates: AllExchangeRates,
  bracket19FloorEur: number = SK_PERSONAL_INCOME_TAX_19_BRACKET_FLOOR_EUR_2024_STYLE,
): Promise<TaxSummaryResult> {
  const m = await buildEurPerUnitByTxnIdForTransactions(transactions);
  const allPortions = computeFifoRealizedPortionsEur(transactions, m);
  const portions = allPortions.filter((p) => portionInYear(p, year));

  let stGain = 0;
  let stLoss = 0;
  let ltGain = 0;
  let ltLoss = 0;
  for (const p of portions) {
    if (p.holdingAtLeast365Days) {
      if (p.gainEur > 0) ltGain += p.gainEur;
      else ltLoss += -p.gainEur;
    } else {
      if (p.gainEur > 0) stGain += p.gainEur;
      else stLoss += -p.gainEur;
    }
  }

  const netShort = Math.max(0, stGain - stLoss);
  let est19 = netShort * 0.19;
  const byBracket: TaxSummaryResult["skEstimate"]["estimatedTaxEurByBracket"] = [];

  if (bracket19FloorEur > 0 && netShort > bracket19FloorEur) {
    const upTo = bracket19FloorEur;
    const t19 = upTo * 0.19;
    const rest = netShort - upTo;
    const t25 = rest * 0.25;
    byBracket.push({ fromEur: 0, toEur: upTo, rate: 0.19, taxEur: t19 });
    byBracket.push({ fromEur: upTo, toEur: netShort, rate: 0.25, taxEur: t25 });
    est19 = t19 + t25;
  } else {
    byBracket.push({ fromEur: 0, toEur: netShort, rate: 0.19, taxEur: est19 });
  }

  const divs = transactions.filter(
    (t) => t.type === "DIVIDEND" && inCalendarYear(t, year),
  );
  const items: TaxSummaryDividendRowEur[] = [];
  let grossD = 0;
  let whtD = 0;
  for (const t of divs) {
    const o = dividendLineEur(t, rates);
    items.push({
      transactionId: t.id,
      date: new Date(t.transactionDate as unknown as string)
        .toISOString()
        .slice(0, 10),
      grossEur: o.grossEur,
      withholdingEur: o.withholdingEur,
      netEur: o.netEur,
      ticker: t.ticker,
    });
    grossD += o.grossEur;
    whtD += o.withholdingEur;
  }
  const netD = items.reduce((s, i) => s + i.netEur, 0);

  const totalRealized = portions.reduce((s, p) => s + p.gainEur, 0);

  return {
    year,
    baseCurrency: "EUR",
    disclaimer:
      "Orientačný prehľad podľa dát v aplikácii a FIFO. Nie právne ani daňové rozhodnutie; 19%/25% a 365 dní môžu " +
      "odliehať od zákona. Overte u daňového poradcu.",
    forForms: {
      taxExempt: {
        label: "Oslobodené (držané aspoň 365 dní) – kapitálové pri realizácii, orientačne",
        realizedGainsEur: ltGain,
        realizedLossesEur: ltLoss,
      },
      taxable: {
        label:
          "Zdaniteľné (kapitál < 365 d) – straty môžu mazať kladné v tom istom kalendárnom roku, orient. základ 19/25 %",
        shortTermGainsEur: stGain,
        shortTermLossesEur: stLoss,
        netShortTermAfterLossOffsetEur: netShort,
      },
    },
    realized: {
      taxableGainsEur: stGain,
      taxableLossesEur: stLoss,
      netShortTermTaxableEur: netShort,
      longTermGainsEur: ltGain,
      longTermLossesEur: ltLoss,
      totalRealizedGainEur: totalRealized,
    },
    skEstimate: {
      taxRate19: 0.19,
      taxRate25: 0.25,
      estimatedTaxEur19Simple: netShort * 0.19,
      estimatedTaxEurByBracket: byBracket,
      estimatedTotalTaxEur: est19,
    },
    dividends: {
      count: items.length,
      grossEur: grossD,
      withholdingEur: whtD,
      netEur: netD,
      items,
    },
    disposalPortions: portions,
  };
}
