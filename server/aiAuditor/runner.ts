import { buildAiBotContext } from "../aiBot/contextBuilder";
import { storage } from "../storage";
import { runClaudeAiAuditorAnalysis, AI_AUDITOR_MODEL } from "./claudeAuditor";
import {
  getAiAuditorUsage,
  insertAiAuditorRun,
  tryConsumeAiAuditorQuota,
} from "./store";
import type { AiAuditorRun, AiAuditorUsage } from "./types";

export async function resolveAuditorPortfolioId(
  userId: string,
  rawPortfolioId: string | null | undefined,
): Promise<string> {
  const portfolioId = (rawPortfolioId && String(rawPortfolioId).trim()) || "all";
  if (portfolioId === "all") return "all";
  const pf = await storage.getPortfolioById(portfolioId, userId);
  return pf ? portfolioId : "all";
}

export async function runAiAuditorForUser(input: {
  userId: string;
  portfolioId?: string | null;
}): Promise<{ run: AiAuditorRun; usage: AiAuditorUsage }> {
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

  let analysis;
  if (ctx.holdings.length === 0) {
    analysis = {
      healthScore: 0,
      healthLabel: "Bez pozícií",
      summaryOneLiner:
        "V zvolenom portfóliu nie sú žiadne pozície na audit. Pridaj holdingy alebo vyber iné portfólio.",
      macroStress: {
        fedRates: {
          impact: "neutral" as const,
          detail: "Bez holdingov nie je možné vyhodnotiť vplyv sadzieb.",
        },
        inflation: {
          impact: "neutral" as const,
          detail: "Bez holdingov nie je možné vyhodnotiť inflačný vplyv.",
        },
        sectorConcentration: {
          level: "low" as const,
          detail: "Portfólio je prázdne.",
          topSectors: [],
        },
      },
      newsSentiment: [],
      recommendations: [
        {
          title: "Doplň pozície",
          detail: "Pridaj transakcie alebo vyber iné portfólio a spusti audit znova.",
          priority: "high" as const,
        },
      ],
      model: AI_AUDITOR_MODEL,
      sourcesUsed: ctx.sourcesUsed,
    };
  } else {
    analysis = await runClaudeAiAuditorAnalysis(ctx);
  }

  const run = await insertAiAuditorRun({
    userId: input.userId,
    portfolioId,
    portfolioLabel: ctx.portfolioLabel,
    analysis,
    model: analysis.model,
  });

  // Consume quota only after a successful saved run.
  const usageAfter =
    (await tryConsumeAiAuditorQuota(input.userId, portfolioId)) ??
    (await getAiAuditorUsage(input.userId, portfolioId));

  return { run, usage: usageAfter };
}
