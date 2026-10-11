import { buildAiBotContext } from "../aiBot/contextBuilder";
import { runClaudeAiBotAnalysis } from "../aiBot/claudeBot";
import { storage } from "../storage";
import { runClaudeAiAuditorAnalysis, AI_AUDITOR_MODEL } from "./claudeAuditor";
import {
  getAiAuditorUsage,
  insertAiAuditorRun,
  tryConsumeAiAuditorQuota,
  updateAiAuditorRunAnalysis,
} from "./store";
import type {
  AiAuditorActionBrief,
  AiAuditorAnalysis,
  AiAuditorRun,
  AiAuditorUsage,
} from "./types";

export async function resolveAuditorPortfolioId(
  userId: string,
  rawPortfolioId: string | null | undefined,
): Promise<string> {
  const portfolioId = (rawPortfolioId && String(rawPortfolioId).trim()) || "all";
  if (portfolioId === "all") return "all";
  // Category aggregate scope (`cat:<id>`) — keep as-is when category exists.
  if (portfolioId.startsWith("cat:")) {
    const categoryId = portfolioId.slice(4).trim();
    if (!categoryId) return "all";
    const cat = await storage.getPortfolioCategoryById(categoryId, userId);
    return cat ? portfolioId : "all";
  }
  const pf = await storage.getPortfolioById(portfolioId, userId);
  return pf ? portfolioId : "all";
}

function emptyAnalysis(sourcesUsed: string[]): AiAuditorAnalysis {
  return {
    healthScore: 0,
    healthLabel: "Bez pozícií",
    summaryOneLiner:
      "V zvolenom portfóliu nie sú žiadne pozície na audit. Pridaj holdingy alebo vyber iné portfólio.",
    scoreBreakdown: {
      sectorConcentration: { score: 50, detail: "Portfólio je prázdne." },
      fedSensitivity: { score: 50, detail: "Bez holdingov." },
      newsSentiment: { score: 50, detail: "Bez holdingov." },
      inflationResilience: { score: 50, detail: "Bez holdingov." },
    },
    macroStress: {
      fedRates: {
        impact: "neutral",
        detail: "Bez holdingov nie je možné vyhodnotiť vplyv sadzieb.",
        deepDive: "Bez holdingov nie je možné vyhodnotiť vplyv sadzieb.",
        mitigation: "Pridaj pozície a spusti audit znova.",
      },
      inflation: {
        impact: "neutral",
        detail: "Bez holdingov nie je možné vyhodnotiť inflačný vplyv.",
        deepDive: "Bez holdingov nie je možné vyhodnotiť inflačný vplyv.",
        mitigation: "Pridaj pozície a spusti audit znova.",
      },
      sectorConcentration: {
        level: "low",
        detail: "Portfólio je prázdne.",
        deepDive: "Portfólio je prázdne.",
        mitigation: "Pridaj transakcie alebo vyber iné portfólio.",
        topSectors: [],
      },
    },
    newsSentiment: [],
    recommendations: [
      {
        title: "Doplň pozície",
        detail: "Pridaj transakcie alebo vyber iné portfólio a spusti audit znova.",
        priority: "high",
      },
    ],
    actionBrief: null,
    actionBriefError: null,
    actionBriefPending: false,
    model: AI_AUDITOR_MODEL,
    sourcesUsed,
  };
}

function toActionBrief(payload: Awaited<ReturnType<typeof runClaudeAiBotAnalysis>>): AiAuditorActionBrief {
  return {
    summary: payload.summary,
    marketOutlook: payload.marketOutlook,
    sectorTrends: payload.sectorTrends,
    newsDigest: payload.newsDigest,
    portfolioAudit: payload.portfolioAudit,
    newOpportunities: payload.newOpportunities,
    marketNotes: payload.marketNotes,
    model: payload.model,
    sourcesUsed: payload.sourcesUsed,
  };
}

async function completeActionBriefInBackground(input: {
  userId: string;
  runId: string;
  ctx: Awaited<ReturnType<typeof buildAiBotContext>>;
  analysis: AiAuditorAnalysis;
}) {
  const { userId, runId, ctx, analysis } = input;
  try {
    const botPayload = await runClaudeAiBotAnalysis(ctx, {
      allowUnderMacroGate: true,
      macroContext: {
        healthScore: analysis.healthScore,
        healthLabel: analysis.healthLabel,
        summaryOneLiner: analysis.summaryOneLiner,
        scoreBreakdown: {
          sectorConcentration: analysis.scoreBreakdown.sectorConcentration,
          fedSensitivity: analysis.scoreBreakdown.fedSensitivity,
          newsSentiment: analysis.scoreBreakdown.newsSentiment,
          inflationResilience: analysis.scoreBreakdown.inflationResilience,
        },
        recommendations: analysis.recommendations.slice(0, 4),
        macroStress: {
          fedRates: {
            impact: analysis.macroStress.fedRates.impact,
            detail: analysis.macroStress.fedRates.detail,
          },
          inflation: {
            impact: analysis.macroStress.inflation.impact,
            detail: analysis.macroStress.inflation.detail,
          },
          sectorConcentration: {
            level: analysis.macroStress.sectorConcentration.level,
            detail: analysis.macroStress.sectorConcentration.detail,
          },
        },
      },
    });
    await updateAiAuditorRunAnalysis({
      runId,
      userId,
      analysis: {
        ...analysis,
        actionBrief: toActionBrief(botPayload),
        actionBriefError: null,
        actionBriefPending: false,
      },
      model: analysis.model,
    });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Akcie na pozíciách sa nepodarilo doplniť.";
    console.warn("[ai-auditor] action brief (pass 2) failed:", msg);
    try {
      await updateAiAuditorRunAnalysis({
        runId,
        userId,
        analysis: {
          ...analysis,
          actionBrief: null,
          actionBriefError: msg,
          actionBriefPending: false,
        },
        model: analysis.model,
      });
    } catch (updateErr) {
      console.error("[ai-auditor] failed to persist pass-2 error:", updateErr);
    }
  }
}

export async function runAiAuditorForUser(input: {
  userId: string;
  portfolioId?: string | null;
}): Promise<{ run: AiAuditorRun; usage: AiAuditorUsage; actionsPending: boolean }> {
  const portfolioId = await resolveAuditorPortfolioId(
    input.userId,
    input.portfolioId,
  );

  // Reconcile first so failed attempts from the old bug don't block the user.
  const usageBefore = await getAiAuditorUsage(input.userId, portfolioId);
  if (usageBefore.used >= usageBefore.limit) {
    const err = new Error("AI_AUDITOR_LIMIT");
    (err as any).usage = usageBefore;
    throw err;
  }

  const ctx = await buildAiBotContext(
    input.userId,
    portfolioId,
    "Manuálny AI Macro Audit",
  );

  let analysis: AiAuditorAnalysis;
  let actionsPending = false;

  if (ctx.holdings.length === 0) {
    analysis = emptyAnalysis(ctx.sourcesUsed);
  } else {
    // Pass 1 — makro / health (vrátime hneď, aby HTTP nespadlo na timeoute)
    analysis = await runClaudeAiAuditorAnalysis(ctx);
    analysis = {
      ...analysis,
      actionBrief: null,
      actionBriefError: null,
      actionBriefPending: true,
    };
    actionsPending = true;
  }

  const run = await insertAiAuditorRun({
    userId: input.userId,
    portfolioId,
    portfolioLabel: ctx.portfolioLabel,
    analysis,
    model: analysis.model,
  });

  // Consume quota only after a successful saved run (1 Spustiť = 1 kvóta).
  const usageAfter =
    (await tryConsumeAiAuditorQuota(input.userId, portfolioId)) ??
    (await getAiAuditorUsage(input.userId, portfolioId));

  if (actionsPending) {
    void completeActionBriefInBackground({
      userId: input.userId,
      runId: run.id,
      ctx,
      analysis,
    });
  }

  return { run, usage: usageAfter, actionsPending };
}
