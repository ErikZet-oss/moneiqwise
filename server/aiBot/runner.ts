import { buildAiBotContext } from "./contextBuilder";
import { runClaudeAiBotAnalysis, AI_BOT_MODEL } from "./claudeBot";
import { getAiBotSettings, insertAiBotBrief } from "./store";
import type { AiBotBrief, AiBotSlot } from "./types";

const SLOT_LABEL: Record<AiBotSlot, string> = {
  preopen: "Pred open (US)",
  preclose: "15 min pred close (US)",
  manual: "Manuálne spustenie",
};

export async function runAiBotForUser(input: {
  userId: string;
  portfolioId?: string | null;
  slot: AiBotSlot;
}): Promise<AiBotBrief> {
  const settings = await getAiBotSettings(input.userId);
  const portfolioId =
    (input.portfolioId && String(input.portfolioId).trim()) ||
    settings.portfolioId ||
    "all";

  const ctx = await buildAiBotContext(
    input.userId,
    portfolioId,
    SLOT_LABEL[input.slot],
  );

  if (ctx.holdings.length === 0) {
    const emptyAnalysis = {
      summary:
        "V zvolenom portfóliu nie sú žiadne pozície na audit. Pridaj holdingy alebo vyber iné portfólio.",
      marketOutlook: null,
      sectorTrends: [],
      newsDigest: [],
      portfolioAudit: [],
      newOpportunities: [],
      marketNotes: [
        {
          title: "Prázdne portfólio",
          detail: "AI Bot čaká na holdingy pred ďalšou analýzou.",
        },
      ],
      model: AI_BOT_MODEL,
      sourcesUsed: ctx.sourcesUsed,
    };
    return insertAiBotBrief({
      userId: input.userId,
      portfolioId,
      slot: input.slot,
      summary: emptyAnalysis.summary,
      analysis: emptyAnalysis,
      contextSnapshot: ctx,
      model: AI_BOT_MODEL,
    });
  }

  const analysis = await runClaudeAiBotAnalysis(ctx);
  return insertAiBotBrief({
    userId: input.userId,
    portfolioId,
    slot: input.slot,
    summary: analysis.summary,
    analysis,
    contextSnapshot: {
      portfolioLabel: ctx.portfolioLabel,
      totalMarketValue: ctx.totalMarketValue,
      holdingCount: ctx.holdings.length,
      moverCount: ctx.movers.length,
      newsCount: ctx.news.length,
      sourcesUsed: ctx.sourcesUsed,
    },
    model: analysis.model,
  });
}
