export type AiAuditorImpact = "positive" | "neutral" | "negative" | "mixed";
export type AiAuditorRiskLevel = "low" | "medium" | "high";
export type AiAuditorSentiment = "positive" | "neutral" | "negative";

export type AiAuditorMacroBlock = {
  impact: AiAuditorImpact;
  detail: string;
  deepDive: string;
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
  whyItMatters: string;
  portfolioImpactDetail: string;
  sourceUrl: string | null;
};

export type AiAuditorRecommendation = {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
};

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

/** Fallback pre staršie audity bez scoreBreakdown / deepDive. */
export function ensureAnalysisShape(raw: AiAuditorAnalysis | null | undefined): AiAuditorAnalysis | null {
  if (!raw) return null;
  const fed = raw.macroStress?.fedRates;
  const inf = raw.macroStress?.inflation;
  const sec = raw.macroStress?.sectorConcentration;
  const news = Array.isArray(raw.newsSentiment) ? raw.newsSentiment : [];

  const impactScore = (impact: AiAuditorImpact | undefined) => {
    if (impact === "positive") return 78;
    if (impact === "neutral") return 62;
    if (impact === "mixed") return 48;
    if (impact === "negative") return 32;
    return 55;
  };
  const riskScore = (level: AiAuditorRiskLevel | undefined) => {
    if (level === "low") return 78;
    if (level === "high") return 28;
    return 52;
  };

  const sb = raw.scoreBreakdown;
  return {
    ...raw,
    scoreBreakdown: {
      sectorConcentration: {
        score: sb?.sectorConcentration?.score ?? riskScore(sec?.level),
        detail: sb?.sectorConcentration?.detail || sec?.detail || "",
      },
      fedSensitivity: {
        score: sb?.fedSensitivity?.score ?? impactScore(fed?.impact),
        detail: sb?.fedSensitivity?.detail || fed?.detail || "",
      },
      newsSentiment: {
        score: sb?.newsSentiment?.score ?? 55,
        detail: sb?.newsSentiment?.detail || "Sentiment správ voči tvojim holdingom.",
      },
      inflationResilience: {
        score: sb?.inflationResilience?.score ?? impactScore(inf?.impact),
        detail: sb?.inflationResilience?.detail || inf?.detail || "",
      },
    },
    macroStress: {
      fedRates: {
        impact: fed?.impact ?? "neutral",
        detail: fed?.detail || "",
        deepDive: fed?.deepDive || fed?.detail || "",
        mitigation:
          fed?.mitigation ||
          "Zváž diverzifikáciu a menšiu koncentráciu v najcitlivejších pozíciách.",
      },
      inflation: {
        impact: inf?.impact ?? "neutral",
        detail: inf?.detail || "",
        deepDive: inf?.deepDive || inf?.detail || "",
        mitigation:
          inf?.mitigation ||
          "Zváž firmy so silnou pricing power alebo inflačne odolnejšie sektory.",
      },
      sectorConcentration: {
        level: sec?.level ?? "medium",
        detail: sec?.detail || "",
        deepDive: sec?.deepDive || sec?.detail || "",
        mitigation:
          sec?.mitigation ||
          "Zváž zníženie váhy najväčšieho sektora a doplnenie defenzívnejších ETF.",
        topSectors: sec?.topSectors ?? [],
      },
    },
    newsSentiment: news.map((n) => ({
      ...n,
      portfolioImpactDetail: n.portfolioImpactDetail || n.whyItMatters || "",
      sourceUrl: n.sourceUrl ?? null,
    })),
    recommendations: Array.isArray(raw.recommendations) ? raw.recommendations : [],
    summaryOneLiner:
      String(raw.summaryOneLiner || "").trim() ||
      "Analýza portfólia voči aktuálnemu makro prostrediu.",
  };
}
