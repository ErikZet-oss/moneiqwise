export type AiAuditorImpact = "positive" | "neutral" | "negative" | "mixed";
export type AiAuditorRiskLevel = "low" | "medium" | "high";
export type AiAuditorSentiment = "positive" | "neutral" | "negative";

export type AiAuditorMacroBlock = {
  impact: AiAuditorImpact;
  detail: string;
};

export type AiAuditorSectorConcentration = {
  level: AiAuditorRiskLevel;
  detail: string;
  topSectors: { name: string; weightPct: number }[];
};

export type AiAuditorNewsItem = {
  ticker: string;
  headline: string;
  sentiment: AiAuditorSentiment;
  whyItMatters: string;
};

export type AiAuditorRecommendation = {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
};

export type AiAuditorAnalysis = {
  healthScore: number;
  healthLabel: string;
  summaryOneLiner: string;
  macroStress: {
    fedRates: AiAuditorMacroBlock;
    inflation: AiAuditorMacroBlock;
    sectorConcentration: AiAuditorSectorConcentration;
  };
  newsSentiment: AiAuditorNewsItem[];
  recommendations: AiAuditorRecommendation[];
  model: string;
  sourcesUsed: string[];
};

export type AiAuditorRun = {
  id: string;
  userId: string;
  portfolioId: string;
  portfolioLabel: string;
  analysis: AiAuditorAnalysis;
  model: string | null;
  createdAt: string;
};

export type AiAuditorUsage = {
  portfolioId: string;
  used: number;
  limit: number;
  resetsAt: string;
  dayKey: string;
};

export const AI_AUDITOR_DAILY_LIMIT = 3;
