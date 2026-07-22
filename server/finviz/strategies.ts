export type AiScannerStrategyId = "dip_buyer" | "garp" | "dividend";

export type AiScannerStrategy = {
  id: AiScannerStrategyId;
  label: string;
  shortLabel: string;
  description: string;
  /** Finviz `f=` filter codes (comma-separated when joined). */
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
    filters: [
      "cap_midover",
      "ta_rsi_nos30",
      "ta_perf4w_u-10",
      "sh_avgvol_o200",
    ],
  },
  garp: {
    id: "garp",
    label: "GARP Strategy",
    shortLabel: "GARP",
    description: "Rast za rozumnú cenu — EPS/sales growth + rozumné P/E.",
    filters: [
      "cap_midover",
      "fa_pe_u25",
      "fa_eps5years_o15",
      "fa_sales5years_o10",
      "sh_avgvol_o200",
    ],
  },
  dividend: {
    id: "dividend",
    label: "Dividend Compounder",
    shortLabel: "Div.",
    description: "Stabilné dividendy — yield, payout a veľkosť firmy.",
    filters: [
      "cap_midover",
      "fa_div_o3",
      "fa_payoutratio_u70",
      "fa_pe_u30",
      "sh_avgvol_o200",
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
