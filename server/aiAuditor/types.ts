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

/** Skrátený tvar AI Bot briefu — uložený spolu s Macro Audítom. */
export type AiAuditorActionBrief = {
  summary: string;
  marketOutlook: {
    sentiment: "risk_on" | "risk_off" | "mixed" | "uncertain";
    narrative: string;
    drivers: string[];
  } | null;
  sectorTrends: Array<{
    sector: string;
    bias: "bullish" | "bearish" | "neutral";
    why: string;
  }>;
  newsDigest: Array<{
    title: string;
    publisher: string | null;
    link: string | null;
    whyItMatters: string;
    relatedTickers: string[] | null;
  }>;
  portfolioAudit: Array<{
    ticker: string;
    companyName: string | null;
    action: "BUY" | "SELL" | "TRIM" | "HOLD";
    weightPct: number | null;
    horizon: "swing" | "long" | null;
    conviction: number | null;
    rationale: string;
    risks: string | null;
    invalidation: string | null;
    newsDrivers: string[] | null;
  }>;
  newOpportunities: Array<{
    ticker: string;
    companyName: string | null;
    thesis: string;
    horizon: "swing" | "long" | null;
    risks: string | null;
    whyNow: string | null;
    conviction: number | null;
    newsDrivers: string[] | null;
  }>;
  marketNotes: Array<{ title: string; detail: string }>;
  model: string;
  sourcesUsed: string[];
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
  /** Pass 2 — akcie BUY/SELL/TRIM/HOLD (AI Bot kvalita). */
  actionBrief: AiAuditorActionBrief | null;
  /** Ak pass 2 zlyhal, Macro ostane; UI ukáže hlášku. */
  actionBriefError: string | null;
  /** Pass 2 beží na pozadí — UI polluje /latest. */
  actionBriefPending?: boolean;
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
