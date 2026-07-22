import { applyCategoryToFilters, type FinvizCategoryId } from "./categories";

export type AiScannerStrategyId = "dip_buyer" | "garp" | "dividend";

export type AiScannerStrategy = {
  id: AiScannerStrategyId;
  label: string;
  shortLabel: string;
  description: string;
  /** Finviz sector category (without sec_ in filters). */
  category: FinvizCategoryId;
  /** Finviz `f=` filter codes. Excludes sector filter — category is applied at runtime. */
  filters: string[];
};

/**
 * Prednastavené stratégie — Finviz filter kódy.
 * @see https://finviz.com/screener.ashx
 */
export const AI_SCANNER_STRATEGIES: Record<AiScannerStrategyId, AiScannerStrategy> = {
  dip_buyer: {
    id: "dip_buyer",
    label: "The Dip Buyer",
    shortLabel: "Dip",
    description: "Akcie v poklese s prepredaným RSI — hľadanie zliav.",
    category: "all",
    filters: [
      "cap_midover",
      "ta_rsi_nos30",
      "ta_perf4w_u-10",
      "sh_avgvol_o200",
    ],
  },
  garp: {
    id: "garp",
    label: "The GARP Strategy",
    shortLabel: "GARP",
    description:
      "Rýchlo rastúce firmy za rozumnú cenu — nízky PEG, rast EPS/sales, Debt/Eq < 1.",
    category: "all",
    filters: [
      "fa_peg_low", // PEG < 1 (Finviz nemá under 1.5)
      "fa_estltgrowth_o15", // EPS growth next 5Y > 15%
      "fa_sales5years_o10", // Sales growth past 5Y > 10%
      "fa_debteq_u1", // Debt/Equity < 1
    ],
  },
  dividend: {
    id: "dividend",
    label: "The Dividend Compounder",
    shortLabel: "Div.",
    description:
      "Stabilné dividendové mašiny — yield > 2 %, payout < 60 %, rastúce EPS, Large/Mega.",
    category: "all",
    filters: [
      "cap_largeover", // Large + Mega
      "fa_div_o2", // Yield > 2 % (Finviz nemá o25 = 2.5 %)
      "fa_payoutratio_u60",
      "fa_epsqoq_pos", // EPS QoQ positive
    ],
  },
};

export function getStrategy(id: string): AiScannerStrategy | null {
  if (id === "dip_buyer" || id === "garp" || id === "dividend") {
    return AI_SCANNER_STRATEGIES[id];
  }
  return null;
}

export function listStrategies(): AiScannerStrategy[] {
  return Object.values(AI_SCANNER_STRATEGIES);
}

/** Normalizuje Finviz filter kódy z UI (čiarka / nový riadok). */
export function normalizeStrategyFilters(raw: string[] | string): string[] {
  const parts = Array.isArray(raw)
    ? raw
    : String(raw)
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  return parts.map((s) => s.replace(/\s+/g, ""));
}

/** Strategy with sector category merged into Finviz filter list for screener run. */
export function strategyRuntimeFilters(strategy: AiScannerStrategy): string[] {
  return applyCategoryToFilters(strategy.filters, strategy.category);
}
