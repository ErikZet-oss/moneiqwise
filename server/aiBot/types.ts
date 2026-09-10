export type AiBotAction = "BUY" | "SELL" | "TRIM" | "HOLD";
export type AiBotHorizon = "swing" | "long";
export type AiBotSlot = "preopen" | "preclose" | "manual";

export type AiBotPortfolioAuditItem = {
  ticker: string;
  companyName: string | null;
  action: AiBotAction;
  weightPct: number | null;
  horizon: AiBotHorizon | null;
  conviction: number | null;
  rationale: string;
  risks: string | null;
  invalidation: string | null;
  /** Titulky / témy z noviniek, o ktoré sa opiera */
  newsDrivers: string[] | null;
};

export type AiBotOpportunity = {
  ticker: string;
  companyName: string | null;
  thesis: string;
  horizon: AiBotHorizon | null;
  risks: string | null;
  whyNow: string | null;
  conviction: number | null;
  newsDrivers: string[] | null;
};

export type AiBotMarketNote = {
  title: string;
  detail: string;
};

export type AiBotMarketOutlook = {
  sentiment: "risk_on" | "risk_off" | "mixed" | "uncertain";
  narrative: string;
  drivers: string[];
};

export type AiBotSectorTrend = {
  sector: string;
  bias: "bullish" | "bearish" | "neutral";
  why: string;
};

export type AiBotNewsDigestItem = {
  title: string;
  publisher: string | null;
  link: string | null;
  whyItMatters: string;
  relatedTickers: string[] | null;
};

export type AiBotAnalysisPayload = {
  summary: string;
  marketOutlook: AiBotMarketOutlook | null;
  sectorTrends: AiBotSectorTrend[];
  newsDigest: AiBotNewsDigestItem[];
  portfolioAudit: AiBotPortfolioAuditItem[];
  newOpportunities: AiBotOpportunity[];
  marketNotes: AiBotMarketNote[];
  model: string;
  sourcesUsed: string[];
};

export type AiBotSettings = {
  userId: string;
  enabled: boolean;
  portfolioId: string; // "all" or uuid
  updatedAt: string;
};

export type AiBotBrief = {
  id: string;
  userId: string;
  portfolioId: string;
  /** Ľudský názov PTF v čase behu (alebo „Všetky portfóliá“) */
  portfolioLabel: string;
  slot: AiBotSlot;
  summary: string;
  analysis: AiBotAnalysisPayload;
  contextSnapshot: unknown;
  model: string | null;
  createdAt: string;
};
