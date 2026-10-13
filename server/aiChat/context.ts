import { buildAiBotContext } from "../aiBot/contextBuilder";
import { getLatestAiAuditorRun } from "../aiAuditor/store";
import { resolveAuditorPortfolioId } from "../aiAuditor/runner";
import { DEFAULT_CONTEXT_FLAGS, type AiChatContextFlags, type AiChatGem } from "./types";

export type AiChatBuiltContext = {
  portfolioScope: string;
  portfolioLabel: string;
  flags: AiChatContextFlags;
  gemName: string | null;
  gemInstructions: string | null;
  summary: Record<string, unknown>;
  toolSteps: string[];
};

export async function buildAiChatContext(input: {
  userId: string;
  portfolioScope?: string | null;
  gem?: AiChatGem | null;
  useNews?: boolean;
}): Promise<AiChatBuiltContext> {
  const flags: AiChatContextFlags = {
    ...DEFAULT_CONTEXT_FLAGS,
    ...(input.gem?.contextFlags ?? {}),
  };
  if (input.useNews === false) flags.news = false;
  if (input.useNews === true) flags.news = true;

  const portfolioScope = await resolveAuditorPortfolioId(
    input.userId,
    input.portfolioScope ?? "all",
  );
  const toolSteps: string[] = [];
  const summary: Record<string, unknown> = {
    portfolioScope,
    gem: input.gem
      ? { name: input.gem.name, instructions: input.gem.instructions }
      : null,
  };

  if (flags.portfolio) {
    const ctx = await buildAiBotContext(
      input.userId,
      portfolioScope,
      "AI Chat",
    );
    toolSteps.push(`Načítané pozície (${ctx.holdings.length})`);
    summary.portfolioLabel = ctx.portfolioLabel;
    summary.totalMarketValue = ctx.totalMarketValue;
    summary.holdings = ctx.holdings.slice(0, 40).map((h) => ({
      ticker: h.ticker,
      name: h.companyName,
      weightPct: h.weightPct != null ? Number(h.weightPct.toFixed(2)) : null,
      price: h.price,
      changePercent: h.changePercent,
      unrealizedPnlPct:
        h.unrealizedPnlPct != null ? Number(h.unrealizedPnlPct.toFixed(2)) : null,
      marketValue: h.marketValue != null ? Math.round(h.marketValue) : null,
    }));
    if (flags.news) {
      summary.news = (ctx.news || []).slice(0, 12).map((n) => ({
        title: n.title,
        publisher: n.publisher,
        link: n.link,
        ticker: n.ticker,
        summary: n.summary,
      }));
      toolSteps.push(`Správy (${Math.min((ctx.news || []).length, 12)})`);
    }
    if (flags.watchlist) {
      summary.watchlistTickers = ctx.watchlistTickers.slice(0, 30);
      toolSteps.push(`Watchlist (${ctx.watchlistTickers.length})`);
    }
    summary.portfolioLabel = ctx.portfolioLabel;
  } else {
    summary.portfolioLabel =
      portfolioScope === "all" ? "Všetky portfóliá" : portfolioScope;
  }

  if (flags.dividends) {
    // Dividend calendar is assembled on the client/API routes; here we flag intent
    // so the model knows to discuss dividends from holdings + known cashflows.
    summary.dividendsNote =
      "Použi holdingy a známe dividendové dáta z kontextu; ak chýbajú ex-dates, povedz to otvorene.";
    toolSteps.push("Dividendová história a ex-dates");
  }

  if (flags.macroAudit) {
    try {
      const run = await getLatestAiAuditorRun(input.userId, portfolioScope);
      if (run?.analysis) {
        const a = run.analysis as any;
        summary.macroAudit = {
          healthScore: a.healthScore ?? a.score ?? null,
          summary: a.summary ?? a.executiveSummary ?? null,
          risks: Array.isArray(a.risks) ? a.risks.slice(0, 5) : null,
          recommendations: Array.isArray(a.recommendations)
            ? a.recommendations.slice(0, 5)
            : null,
          createdAt: run.createdAt,
        };
        toolSteps.push("Posledný makro audit");
      }
    } catch {
      /* optional */
    }
  }

  if (toolSteps.length === 0) toolSteps.push("Základný kontext");

  return {
    portfolioScope,
    portfolioLabel: String(summary.portfolioLabel || "Portfólio"),
    flags,
    gemName: input.gem?.name ?? null,
    gemInstructions: input.gem?.instructions ?? null,
    summary,
    toolSteps,
  };
}
