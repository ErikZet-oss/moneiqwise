import type {
  AiAuditorAnalysis,
  AiAuditorImpact,
  AiAuditorMacroBlock,
  AiAuditorNewsItem,
  AiAuditorRiskLevel,
  AiAuditorScoreBreakdown,
  AiAuditorSentiment,
} from "./types";

function asImpact(v: unknown): AiAuditorImpact {
  const s = String(v || "").toLowerCase();
  if (s === "positive" || s === "neutral" || s === "negative" || s === "mixed") return s;
  return "neutral";
}

function asRisk(v: unknown): AiAuditorRiskLevel {
  const s = String(v || "").toLowerCase();
  if (s === "low" || s === "medium" || s === "high") return s;
  return "medium";
}

function asSentiment(v: unknown): AiAuditorSentiment {
  const s = String(v || "").toLowerCase();
  if (s === "positive" || s === "neutral" || s === "negative") return s;
  return "neutral";
}

function clampScore(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function impactToScore(impact: AiAuditorImpact): number {
  switch (impact) {
    case "positive":
      return 78;
    case "neutral":
      return 62;
    case "mixed":
      return 48;
    case "negative":
      return 32;
  }
}

function riskToScore(level: AiAuditorRiskLevel): number {
  switch (level) {
    case "low":
      return 78;
    case "medium":
      return 52;
    case "high":
      return 28;
  }
}

function hydrateMacro(raw: any, fallback: string): AiAuditorMacroBlock {
  const detail = String(raw?.detail || "").trim() || fallback;
  return {
    impact: asImpact(raw?.impact),
    detail,
    deepDive: String(raw?.deepDive || "").trim() || detail,
    mitigation:
      String(raw?.mitigation || "").trim() ||
      "Zváž diverzifikáciu a menšiu koncentráciu v najcitlivejších pozíciách.",
  };
}

/** Doplní nové polia do starších uložených auditov (spätná kompatibilita). */
export function hydrateAiAuditorAnalysis(raw: any): AiAuditorAnalysis {
  const healthScore = clampScore(raw?.healthScore, 50);
  const fedRates = hydrateMacro(raw?.macroStress?.fedRates, "Bez detailu.");
  const inflation = hydrateMacro(raw?.macroStress?.inflation, "Bez detailu.");
  const sectorLevel = asRisk(raw?.macroStress?.sectorConcentration?.level);
  const sectorDetail =
    String(raw?.macroStress?.sectorConcentration?.detail || "").trim() ||
    "Sektorová koncentrácia nebola vyhodnotená.";

  const newsSentiment: AiAuditorNewsItem[] = Array.isArray(raw?.newsSentiment)
    ? raw.newsSentiment.map((n: any) => {
        const why = String(n?.whyItMatters || "").trim();
        return {
          ticker: String(n?.ticker || "").toUpperCase().trim(),
          headline: String(n?.headline || "").trim(),
          sentiment: asSentiment(n?.sentiment),
          whyItMatters: why,
          portfolioImpactDetail:
            String(n?.portfolioImpactDetail || "").trim() || why,
          sourceUrl:
            typeof n?.sourceUrl === "string" && n.sourceUrl.startsWith("http")
              ? n.sourceUrl
              : null,
        };
      })
    : [];

  const sb = raw?.scoreBreakdown;
  const scoreBreakdown: AiAuditorScoreBreakdown = {
    sectorConcentration: {
      score: clampScore(sb?.sectorConcentration?.score, riskToScore(sectorLevel)),
      detail:
        String(sb?.sectorConcentration?.detail || "").trim() || sectorDetail,
    },
    fedSensitivity: {
      score: clampScore(sb?.fedSensitivity?.score, impactToScore(fedRates.impact)),
      detail: String(sb?.fedSensitivity?.detail || "").trim() || fedRates.detail,
    },
    newsSentiment: {
      score: clampScore(
        sb?.newsSentiment?.score,
        newsSentiment.length
          ? Math.round(
              newsSentiment.reduce(
                (a, n) =>
                  a +
                  (n.sentiment === "positive"
                    ? 75
                    : n.sentiment === "negative"
                      ? 30
                      : 55),
                0,
              ) / newsSentiment.length,
            )
          : 55,
      ),
      detail:
        String(sb?.newsSentiment?.detail || "").trim() ||
        "Sentiment správ voči tvojim holdingom.",
    },
    inflationResilience: {
      score: clampScore(
        sb?.inflationResilience?.score,
        impactToScore(inflation.impact),
      ),
      detail:
        String(sb?.inflationResilience?.detail || "").trim() || inflation.detail,
    },
  };

  return {
    healthScore,
    healthLabel: String(raw?.healthLabel || "").trim() || "Bez hodnotenia",
    summaryOneLiner:
      String(raw?.summaryOneLiner || "").trim() ||
      "Analýza portfólia voči aktuálnemu makro prostrediu.",
    scoreBreakdown,
    macroStress: {
      fedRates,
      inflation,
      sectorConcentration: {
        level: sectorLevel,
        detail: sectorDetail,
        deepDive:
          String(raw?.macroStress?.sectorConcentration?.deepDive || "").trim() ||
          sectorDetail,
        mitigation:
          String(raw?.macroStress?.sectorConcentration?.mitigation || "").trim() ||
          "Zváž zníženie váhy najväčšieho sektora a doplnenie defenzívnejších ETF.",
        topSectors: Array.isArray(raw?.macroStress?.sectorConcentration?.topSectors)
          ? raw.macroStress.sectorConcentration.topSectors
          : [],
      },
    },
    newsSentiment,
    recommendations: Array.isArray(raw?.recommendations) ? raw.recommendations : [],
    model: String(raw?.model || ""),
    sourcesUsed: Array.isArray(raw?.sourcesUsed) ? raw.sourcesUsed : [],
  };
}
