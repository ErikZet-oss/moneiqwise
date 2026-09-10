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
};

export type AiBotOpportunity = {
  ticker: string;
  companyName: string | null;
  thesis: string;
  horizon: AiBotHorizon | null;
  risks: string | null;
  whyNow: string | null;
  conviction: number | null;
};

export type AiBotMarketNote = {
  title: string;
  detail: string;
};

export type AiBotAnalysisPayload = {
  summary: string;
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
  slot: AiBotSlot;
  summary: string;
  analysis: AiBotAnalysisPayload;
  contextSnapshot: unknown;
  model: string | null;
  createdAt: string;
};
