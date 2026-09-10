import { storage } from "../storage";
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
  /** Pri schedule: prázdne PTF nevyrobí brief (menej šumu v histórii). */
  skipIfEmpty?: boolean;
}): Promise<AiBotBrief | null> {
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
    if (input.skipIfEmpty) return null;
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
      contextSnapshot: {
        portfolioLabel: ctx.portfolioLabel,
        totalMarketValue: 0,
        holdingCount: 0,
        moverCount: 0,
        newsCount: ctx.news?.length ?? 0,
        sourcesUsed: ctx.sourcesUsed,
      },
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

/** Automat: Všetky portfóliá + každé PTF zvlášť. */
export async function runAiBotScheduledForUser(input: {
  userId: string;
  slot: Exclude<AiBotSlot, "manual">;
}): Promise<{ ran: number; skippedEmpty: number; failed: number }> {
  const portfolios = await storage.getPortfoliosByUser(input.userId);
  const targets: Array<{ id: string; label: string }> = [
    { id: "all", label: "Všetky portfóliá" },
    ...portfolios.map((p) => ({ id: p.id, label: p.name })),
  ];

  let ran = 0;
  let skippedEmpty = 0;
  let failed = 0;

  for (const target of targets) {
    try {
      const brief = await runAiBotForUser({
        userId: input.userId,
        portfolioId: target.id,
        slot: input.slot,
        skipIfEmpty: true,
      });
      if (brief) {
        ran += 1;
        console.log(
          `[ai-bot] ${input.slot} ok user=${input.userId} ptf=${target.label}`,
        );
      } else {
        skippedEmpty += 1;
      }
    } catch (err) {
      failed += 1;
      console.error(
        `[ai-bot] ${input.slot} failed user=${input.userId} ptf=${target.label}:`,
        err,
      );
    }
  }

  return { ran, skippedEmpty, failed };
}
