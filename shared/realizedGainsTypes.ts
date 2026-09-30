export interface RealizedBrokerRow {
  brokerKey: string;
  brokerLabel: string;
  totalGain: number;
  totalCost: number;
  totalSold: number;
  transactions: number;
  totalSharesSold: number;
  avgBuyPricePerShare: number;
  avgSellPricePerShare: number;
  priceCurrency: string;
}

export interface RealizedTickerRow {
  ticker: string;
  companyName: string;
  totalGain: number;
  /** FIFO náklad predaných kusov v EUR (základ pre zhodnotenie). */
  totalCost: number;
  totalSold: number;
  transactions: number;
  /** Súčet predaných kusov (pre vážený priemer cien). */
  totalSharesSold: number;
  /** Vážený priemer nákupnej ceny/ks v `priceCurrency`. */
  avgBuyPricePerShare: number;
  /** Vážený priemer predajnej ceny/ks v `priceCurrency`. */
  avgSellPricePerShare: number;
  priceCurrency: string;
  /** Rozpad predajov podľa brokera (portfólio / import). */
  byBroker: RealizedBrokerRow[];
}

export interface RealizedGainsComputedSummary {
  totalRealized: number;
  realizedYTD: number;
  realizedThisMonth: number;
  realizedToday: number;
  byTicker: RealizedTickerRow[];
  transactionCount: number;
}
