import Anthropic from "@anthropic-ai/sdk";
import { formatAnthropicError } from "../finviz/claudeEvaluator";
import type { AiBotRunContext } from "./contextBuilder";
import type {
  AiBotAction,
  AiBotAnalysisPayload,
  AiBotHorizon,
  AiBotMarketNote,
  AiBotOpportunity,
  AiBotPortfolioAuditItem,
} from "./types";

const MODEL =
  process.env.ANTHROPIC_MODEL?.trim().replace(/^["']|["']$/g, "") ||
  "claude-sonnet-5";

function getAnthropicClient(): Anthropic {
  const raw = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  const key = raw.replace(/^["']|["']$/g, "").trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY_MISSING");
  return new Anthropic({ apiKey: key });
}

function repairJsonLike(raw: string): string {
  return raw
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("AI_JSON_PARSE");
  const candidates: string[] = [];
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRegex.exec(trimmed)) !== null) {
    if (fenceMatch[1]?.trim()) candidates.push(fenceMatch[1].trim());
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  candidates.push(trimmed);
  for (const raw of candidates) {
    for (const attempt of [raw, repairJsonLike(raw)]) {
      try {
        return JSON.parse(attempt);
      } catch {
        /* next */
      }
    }
  }
  throw new Error("AI_JSON_PARSE");
}

function asAction(v: unknown): AiBotAction {
  const s = String(v || "").toUpperCase();
  if (s === "BUY" || s === "SELL" || s === "TRIM" || s === "HOLD") return s;
  return "HOLD";
}

function asHorizon(v: unknown): AiBotHorizon | null {
  const s = String(v || "").toLowerCase();
  if (s === "swing" || s === "long") return s;
  return null;
}

function asConviction(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function normalizeAnalysis(raw: any, sourcesUsed: string[]): AiBotAnalysisPayload {
  const portfolioAudit: AiBotPortfolioAuditItem[] = Array.isArray(raw?.portfolioAudit)
    ? raw.portfolioAudit.map((item: any) => ({
        ticker: String(item?.ticker || "").toUpperCase(),
        companyName: item?.companyName != null ? String(item.companyName) : null,
        action: asAction(item?.action),
        weightPct:
          item?.weightPct != null && Number.isFinite(Number(item.weightPct))
            ? Number(item.weightPct)
            : null,
        horizon: asHorizon(item?.horizon),
        conviction: asConviction(item?.conviction),
        rationale: String(item?.rationale || item?.reason || "").trim() || "Bez zdôvodnenia.",
        risks: item?.risks != null ? String(item.risks) : null,
        invalidation: item?.invalidation != null ? String(item.invalidation) : null,
      }))
    : [];

  const newOpportunities: AiBotOpportunity[] = Array.isArray(raw?.newOpportunities)
    ? raw.newOpportunities.slice(0, 3).map((item: any) => ({
        ticker: String(item?.ticker || "").toUpperCase(),
        companyName: item?.companyName != null ? String(item.companyName) : null,
        thesis: String(item?.thesis || item?.rationale || "").trim() || "Bez tézy.",
        horizon: asHorizon(item?.horizon),
        risks: item?.risks != null ? String(item.risks) : null,
        whyNow: item?.whyNow != null ? String(item.whyNow) : null,
        conviction: asConviction(item?.conviction),
      }))
    : [];

  const marketNotes: AiBotMarketNote[] = Array.isArray(raw?.marketNotes)
    ? raw.marketNotes.slice(0, 8).map((item: any) => ({
        title: String(item?.title || "Poznámka").trim(),
        detail: String(item?.detail || item?.text || "").trim(),
      }))
    : [];

  return {
    summary: String(raw?.summary || "").trim() || "Analýza dokončená.",
    portfolioAudit: portfolioAudit.filter((x) => x.ticker),
    newOpportunities: newOpportunities.filter((x) => x.ticker),
    marketNotes: marketNotes.filter((x) => x.detail),
    model: MODEL,
    sourcesUsed,
  };
}

export async function runClaudeAiBotAnalysis(
  ctx: AiBotRunContext,
): Promise<AiBotAnalysisPayload> {
  const client = getAnthropicClient();

  const system = `Si investičný asistent pre retail investora v appke Moneiqwise.
Úlohy:
1) Pre každú pozíciu v portfóliu navrhni akciu BUY, SELL, TRIM alebo HOLD.
2) Zohľadni % váhu v portfóliu (koncentrácia), denný pohyb, nerealizovaný P/L a celkový kontext.
3) Z externých trhových tipov vyber 1–2 nové akcie, ktoré používateľ ešte nemá (ani vo watchliste).
4) Pre návrhy uveď horizon: "swing" alebo "long", conviction 1–5, riziká a invalidáciu tézy.
5) Pridaj krátke marketNotes (dôležité veci dňa na journal).

Pravidlá:
- Buď vecný, nie hype. Nie si finančný poradca; ide o analytický brief.
- Neodporúčaj crypto, ani meme pump bez fundamentu.
- Odpoveď VÝHRADNE ako čistý JSON objekt (bez markdown) s poliami:
  summary (string),
  portfolioAudit (array),
  newOpportunities (array),
  marketNotes (array).
Každý portfolioAudit item: ticker, companyName, action, weightPct, horizon, conviction, rationale, risks, invalidation.
Každý newOpportunities item: ticker, companyName, thesis, horizon, risks, whyNow, conviction.
Každý marketNotes item: title, detail.`;

  const userPayload = {
    slot: ctx.slotLabel,
    portfolio: ctx.portfolioLabel,
    totalMarketValueEurApprox: Math.round(ctx.totalMarketValue * 100) / 100,
    holdings: ctx.holdings,
    externalCandidates: ctx.movers,
    alreadyOwnedOrWatching: [
      ...ctx.holdings.map((h) => h.ticker),
      ...ctx.watchlistTickers,
    ],
  };

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0.3,
      system,
      messages: [
        {
          role: "user",
          content: `Analyzuj tento JSON kontext a vráť JSON brief:\n${JSON.stringify(userPayload)}`,
        },
      ],
    });
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");
    const parsed = extractJsonObject(text);
    return normalizeAnalysis(parsed, ctx.sourcesUsed);
  } catch (err) {
    const friendly = formatAnthropicError(err);
    throw new Error(friendly);
  }
}

export { MODEL as AI_BOT_MODEL };
