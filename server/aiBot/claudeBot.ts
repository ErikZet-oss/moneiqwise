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

function sanitizeContext(ctx: AiBotRunContext) {
  const holdings = ctx.holdings.slice(0, 40).map((h) => ({
    ticker: h.ticker,
    companyName: h.companyName,
    shares: Number.isFinite(h.shares) ? h.shares : 0,
    averageCost: Number.isFinite(h.averageCost) ? h.averageCost : 0,
    price: h.price != null && Number.isFinite(h.price) ? h.price : null,
    changePercent:
      h.changePercent != null && Number.isFinite(h.changePercent) ? h.changePercent : null,
    marketValue:
      h.marketValue != null && Number.isFinite(h.marketValue) ? h.marketValue : null,
    weightPct: h.weightPct != null && Number.isFinite(h.weightPct) ? h.weightPct : null,
    unrealizedPnlPct:
      h.unrealizedPnlPct != null && Number.isFinite(h.unrealizedPnlPct)
        ? h.unrealizedPnlPct
        : null,
    pe: h.pe != null && Number.isFinite(h.pe) ? h.pe : null,
  }));

  const movers = ctx.movers.slice(0, 10).map((m) => ({
    ticker: m.ticker,
    companyName: m.companyName,
    price: m.price != null && Number.isFinite(m.price) ? m.price : null,
    changePercent:
      m.changePercent != null && Number.isFinite(m.changePercent) ? m.changePercent : null,
    pe: m.pe != null && Number.isFinite(m.pe) ? m.pe : null,
    sector: m.sector,
  }));

  return {
    slot: ctx.slotLabel,
    portfolio: ctx.portfolioLabel,
    totalMarketValue: Number.isFinite(ctx.totalMarketValue)
      ? Math.round(ctx.totalMarketValue * 100) / 100
      : 0,
    holdings,
    externalCandidates: movers,
    alreadyOwnedOrWatching: Array.from(
      new Set([
        ...holdings.map((h) => h.ticker),
        ...ctx.watchlistTickers.map((t) => t.toUpperCase()),
      ]),
    ).slice(0, 80),
  };
}

export async function runClaudeAiBotAnalysis(
  ctx: AiBotRunContext,
): Promise<AiBotAnalysisPayload> {
  const client = getAnthropicClient();
  const userPayload = sanitizeContext(ctx);

  // Rovnaký tvar requestu ako AI Skener (bez samostatného system param / temperature),
  // aby sme sa vyhli Anthropic HTTP 400 na niektorých modeloch / konfiguráciách.
  const prompt = `Si investičný asistent pre retail investora v appke Moneiqwise.

Úlohy:
1) Pre každú pozíciu v portfóliu navrhni akciu BUY, SELL, TRIM alebo HOLD.
2) Zohľadni % váhu v portfóliu (koncentrácia), denný pohyb, nerealizovaný P/L.
3) Z externých tipov vyber 1–2 nové akcie, ktoré používateľ ešte nemá (ani vo watchliste).
4) Pre návrhy uveď horizon "swing" alebo "long", conviction 1–5, riziká a invalidáciu.
5) Pridaj krátke marketNotes (dôležité veci dňa).

Pravidlá:
- Buď vecný, nie hype. Nie si finančný poradca.
- Neodporúčaj crypto ani meme pump bez fundamentu.
- Odpoveď VÝHRADNE ako čistý JSON objekt (bez markdown) s poliami:
  summary, portfolioAudit, newOpportunities, marketNotes.
portfolioAudit item: ticker, companyName, action, weightPct, horizon, conviction, rationale, risks, invalidation.
newOpportunities item: ticker, companyName, thesis, horizon, risks, whyNow, conviction.
marketNotes item: title, detail.

Kontext:
${JSON.stringify(userPayload, null, 2)}`;

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 2500,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = msg.content.find((b) => b.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const parsed = extractJsonObject(text);
    return normalizeAnalysis(parsed, ctx.sourcesUsed);
  } catch (err) {
    console.error("[ai-bot] Claude error:", err);
    throw new Error(formatAnthropicError(err));
  }
}

export { MODEL as AI_BOT_MODEL };
