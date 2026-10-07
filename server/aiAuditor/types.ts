export type AiAuditorImpact = "positive" | "neutral" | "negative" | "mixed";
export type AiAuditorRiskLevel = "low" | "medium" | "high";
export type AiAuditorSentiment = "positive" | "neutral" | "negative";

export type AiAuditorMacroBlock = {
  impact: AiAuditorImpact;
  detail: string;
  /** Hĺbkový rozbor (scenáre) — zobrazí sa po rozkliknutí. */
  deepDive: string;
  /** Konkrétny návrh, ako riziko znížiť. */
  mitigation: string;
};

export type AiAuditorSectorConcentration = {
  level: AiAuditorRiskLevel;
  detail: string;
  deepDive: string;
  mitigation: string;
  topSectors: { name: string; weightPct: number }[];
};

export type AiAuditorNewsItem = {
  ticker: string;
  headline: string;
  sentiment: AiAuditorSentiment;
  /** Krátky text na karte. */
  whyItMatters: string;
  /** Claude: váha v portfóliu, dopad v €, prečo to „bolelo“. */
  portfolioImpactDetail: string;
  /** Priamy odkaz na Yahoo / zdroj. */
  sourceUrl: string | null;
};

export type AiAuditorRecommendation = {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
};

/** Čiastkové skóre 0–100 (vyššie = lepšie / zdravšie). */
export type AiAuditorScoreFactor = {
  score: number;
  detail: string;
};

export type AiAuditorScoreBreakdown = {
  sectorConcentration: AiAuditorScoreFactor;
  fedSensitivity: AiAuditorScoreFactor;
  newsSentiment: AiAuditorScoreFactor;
  inflationResilience: AiAuditorScoreFactor;
};

export type AiAuditorAnalysis = {
  healthScore: number;
  healthLabel: string;
  summaryOneLiner: string;
  scoreBreakdown: AiAuditorScoreBreakdown;
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
