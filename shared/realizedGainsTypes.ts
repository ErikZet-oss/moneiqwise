export interface RealizedTickerRow {
  ticker: string;
  companyName: string;
  totalGain: number;
  totalSold: number;
  transactions: number;
}

export interface RealizedGainsComputedSummary {
  totalRealized: number;
  realizedYTD: number;
  realizedThisMonth: number;
  realizedToday: number;
  byTicker: RealizedTickerRow[];
  transactionCount: number;
}
