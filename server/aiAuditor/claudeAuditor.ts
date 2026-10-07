import Anthropic from "@anthropic-ai/sdk";
import { formatAnthropicError } from "../finviz/claudeEvaluator";
import type { AiBotRunContext } from "../aiBot/contextBuilder";
import type {
  AiAuditorAnalysis,
  AiAuditorImpact,
  AiAuditorMacroBlock,
  AiAuditorNewsItem,
  AiAuditorRecommendation,
  AiAuditorRiskLevel,
  AiAuditorSentiment,
} from "./types";

export const AI_AUDITOR_MODEL =
  process.env.ANTHROPIC_MODEL?.trim().replace(/^["']|["']$/g, "") ||
  "claude-sonnet-5";

function getAnthropicClient(): Anthropic {
  const raw = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  const key = raw.replace(/^["']|["']$/g, "").trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY_MISSING");
  return new Anthropic({ apiKey: key });
}

function repairJsonLike(raw: string): string {
  let s = raw
    .replace(/^\uFEFF/, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        continue;
      }
      if (ch === "\n") {
        out += "\\n";
        continue;
      }
      if (ch === "\r") {
        out += "\\r";
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  s = out;
  const opens = (s.match(/\{/g) || []).length;
  const closes = (s.match(/\}/g) || []).length;
  const openArr = (s.match(/\[/g) || []).length;
  const closeArr = (s.match(/\]/g) || []).length;
  s = s.replace(/,\s*"[^"]*$/, "").replace(/,\s*$/, "");
  for (let i = 0; i < openArr - closeArr; i++) s += "]";
  for (let i = 0; i < opens - closes; i++) s += "}";
  return s;
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
  for (const c of candidates) {
    for (const attempt of [c, repairJsonLike(c)]) {
      try {
        return JSON.parse(attempt);
      } catch {
        /* next */
      }
    }
  }
  throw new Error("AI_JSON_PARSE");
}

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

function asMacroBlock(raw: any): AiAuditorMacroBlock {
  return {
    impact: asImpact(raw?.impact),
    detail: String(raw?.detail || "").trim() || "Bez detailu.",
  };
}

function normalizeAnalysis(raw: any, ctx: AiBotRunContext): AiAuditorAnalysis {
  const scoreRaw = Number(raw?.healthScore);
  const healthScore = Number.isFinite(scoreRaw)
    ? Math.max(0, Math.min(100, Math.round(scoreRaw)))
    : 50;

  const topSectors = Array.isArray(raw?.macroStress?.sectorConcentration?.topSectors)
    ? raw.macroStress.sectorConcentration.topSectors
        .map((s: any) => ({
          name: String(s?.name || "").trim(),
          weightPct: Number(s?.weightPct),
        }))
        .filter((s: { name: string; weightPct: number }) => s.name && Number.isFinite(s.weightPct))
        .slice(0, 6)
    : [];

  const newsSentiment: AiAuditorNewsItem[] = Array.isArray(raw?.newsSentiment)
    ? raw.newsSentiment
        .map((n: any) => ({
          ticker: String(n?.ticker || "").toUpperCase().trim(),
          headline: String(n?.headline || "").trim(),
          sentiment: asSentiment(n?.sentiment),
          whyItMatters: String(n?.whyItMatters || "").trim(),
        }))
        .filter((n: AiAuditorNewsItem) => n.ticker && n.headline)
        .slice(0, 8)
    : [];

  const recommendations: AiAuditorRecommendation[] = Array.isArray(raw?.recommendations)
    ? raw.recommendations
        .map((r: any) => {
          const p = String(r?.priority || "medium").toLowerCase();
          return {
            title: String(r?.title || "").trim(),
            detail: String(r?.detail || "").trim(),
            priority: (p === "high" || p === "low" ? p : "medium") as
              | "high"
              | "medium"
              | "low",
          };
        })
        .filter((r: AiAuditorRecommendation) => r.title && r.detail)
        .slice(0, 4)
    : [];

  return {
    healthScore,
    healthLabel: String(raw?.healthLabel || "").trim() || "Bez hodnotenia",
    summaryOneLiner:
      String(raw?.summaryOneLiner || "").trim() ||
      "Analýza portfólia voči aktuálnemu makro prostrediu.",
    macroStress: {
      fedRates: asMacroBlock(raw?.macroStress?.fedRates),
      inflation: asMacroBlock(raw?.macroStress?.inflation),
      sectorConcentration: {
        level: asRisk(raw?.macroStress?.sectorConcentration?.level),
        detail:
          String(raw?.macroStress?.sectorConcentration?.detail || "").trim() ||
          "Sektorová koncentrácia nebola vyhodnotená.",
        topSectors,
      },
    },
    newsSentiment,
    recommendations,
    model: AI_AUDITOR_MODEL,
    sourcesUsed: ctx.sourcesUsed,
  };
}

export async function runClaudeAiAuditorAnalysis(
  ctx: AiBotRunContext,
): Promise<AiAuditorAnalysis> {
  const client = getAnthropicClient();
  const compactHoldings = ctx.holdings.slice(0, 40).map((h) => ({
    ticker: h.ticker,
    name: h.companyName,
    weightPct: h.weightPct != null ? Math.round(h.weightPct * 10) / 10 : null,
    price: h.price,
    unrealizedPnlPct:
      h.unrealizedPnlPct != null ? Math.round(h.unrealizedPnlPct * 10) / 10 : null,
    changePercent: h.changePercent,
  }));
  const compactNews = (ctx.news || []).slice(0, 24).map((n) => ({
    title: n.title,
    publisher: n.publisher,
    ticker: n.ticker,
    query: n.query,
    published: n.publishedAt,
  }));

  const userPayload = {
    portfolioLabel: ctx.portfolioLabel,
    totalMarketValue: Math.round(ctx.totalMarketValue),
    holdings: compactHoldings,
    recentNews: compactNews,
  };

  const system = `Si senior makro a portfolio analytik pre retail investora (app Moneiqwise).
Odpovedaj VÝHRADNE platným JSON (bez markdown). Texty v JSON hodnotách píš PO SLOVENSKY.
Buď konkrétny voči holdingom a správam; nevymýšľaj tickery, ktoré nie sú v holdings.
healthScore 0–100 = odolnosť portfólia voči aktuálnemu makro prostrediu (Fed, inflácia, sektorová koncentrácia, sentiment správ).`;

  const user = `Vyhodnoť portfólio a vráť JSON s kľúčmi:
{
  "healthScore": 0-100,
  "healthLabel": "krátky status (napr. Vyvážené / Vysoká citlivosť na Fed)",
  "summaryOneLiner": "1 úderná veta",
  "macroStress": {
    "fedRates": { "impact": "positive|neutral|negative|mixed", "detail": "..." },
    "inflation": { "impact": "positive|neutral|negative|mixed", "detail": "..." },
    "sectorConcentration": {
      "level": "low|medium|high",
      "detail": "...",
      "topSectors": [{ "name": "...", "weightPct": 12.5 }]
    }
  },
  "newsSentiment": [
    { "ticker": "NVDA", "headline": "...", "sentiment": "positive|neutral|negative", "whyItMatters": "..." }
  ],
  "recommendations": [
    { "title": "...", "detail": "...", "priority": "high|medium|low" }
  ]
}
Presne 3–4 recommendations. newsSentiment max 6 položiek viazaných na holdings.
DÁTA:
${JSON.stringify(userPayload)}`;

  try {
    // Newer Claude models reject `temperature` ("temp is deprecated for this model").
    const msg = await client.messages.create({
      model: AI_AUDITOR_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const raw = extractJsonObject(text);
    return normalizeAnalysis(raw, ctx);
  } catch (err) {
    const wrapped = new Error(formatAnthropicError(err));
    (wrapped as any).cause = err;
    throw wrapped;
  }
}
