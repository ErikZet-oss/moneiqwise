export type AiAuditorImpact = "positive" | "neutral" | "negative" | "mixed";
export type AiAuditorRiskLevel = "low" | "medium" | "high";
export type AiAuditorSentiment = "positive" | "neutral" | "negative";

export type AiAuditorAnalysis = {
  healthScore: number;
  healthLabel: string;
  summaryOneLiner: string;
  macroStress: {
    fedRates: { impact: AiAuditorImpact; detail: string };
    inflation: { impact: AiAuditorImpact; detail: string };
    sectorConcentration: {
      level: AiAuditorRiskLevel;
      detail: string;
      topSectors: { name: string; weightPct: number }[];
    };
  };
  newsSentiment: {
    ticker: string;
    headline: string;
    sentiment: AiAuditorSentiment;
    whyItMatters: string;
  }[];
  recommendations: {
    title: string;
    detail: string;
    priority: "high" | "medium" | "low";
  }[];
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

export type AiAuditorLatestResponse = {
  run: AiAuditorRun | null;
  usage: AiAuditorUsage;
};

export function impactLabelSk(impact: AiAuditorImpact): string {
  switch (impact) {
    case "positive":
      return "Pozitívny";
    case "negative":
      return "Negatívny";
    case "mixed":
      return "Zmiešaný";
    default:
      return "Neutrálny";
  }
}

export function riskLabelSk(level: AiAuditorRiskLevel): string {
  switch (level) {
    case "low":
      return "Nízke";
    case "high":
      return "Vysoké";
    default:
      return "Stredné";
  }
}

export function sentimentLabelSk(s: AiAuditorSentiment): string {
  switch (s) {
    case "positive":
      return "Pozitívny";
    case "negative":
      return "Negatívny";
    default:
      return "Neutrálny";
  }
}
