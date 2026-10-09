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
  AiAuditorScoreBreakdown,
  AiAuditorScoreFactor,
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

function clampScore(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function asScoreFactor(raw: any, fallbackScore: number, fallbackDetail: string): AiAuditorScoreFactor {
  return {
    score: clampScore(raw?.score, fallbackScore),
    detail: String(raw?.detail || "").trim() || fallbackDetail,
  };
}

function asMacroBlock(raw: any, fallbackDetail: string): AiAuditorMacroBlock {
  const detail = String(raw?.detail || "").trim() || fallbackDetail;
  const deepDive = String(raw?.deepDive || "").trim() || detail;
  const mitigation =
    String(raw?.mitigation || "").trim() ||
    "Zváž diverzifikáciu a menšiu koncentráciu v najcitlivejších pozíciách.";
  return {
    impact: asImpact(raw?.impact),
    detail,
    deepDive,
    mitigation,
  };
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

function sentimentAvgScore(items: AiAuditorNewsItem[]): number {
  if (items.length === 0) return 55;
  let sum = 0;
  for (const n of items) {
    sum += n.sentiment === "positive" ? 75 : n.sentiment === "negative" ? 30 : 55;
  }
  return Math.round(sum / items.length);
}

function resolveNewsUrl(
  ticker: string,
  headline: string,
  rawUrl: unknown,
  ctx: AiBotRunContext,
): string | null {
  const fromModel = String(rawUrl || "").trim();
  if (fromModel.startsWith("http://") || fromModel.startsWith("https://")) {
    return fromModel;
  }
  const t = ticker.toUpperCase();
  const h = headline.toLowerCase();
  const news = ctx.news || [];
  const exact = news.find(
    (n) =>
      (n.ticker || "").toUpperCase() === t &&
      n.title.toLowerCase() === h &&
      n.link,
  );
  if (exact?.link) return exact.link;
  const partial = news.find(
    (n) =>
      (n.ticker || "").toUpperCase() === t &&
      n.link &&
      (n.title.toLowerCase().includes(h.slice(0, 40)) ||
        h.includes(n.title.toLowerCase().slice(0, 40))),
  );
  if (partial?.link) return partial.link;
  const byTicker = news.find((n) => (n.ticker || "").toUpperCase() === t && n.link);
  return byTicker?.link || null;
}

function normalizeAnalysis(rawInput: any, ctx: AiBotRunContext): AiAuditorAnalysis {
  const raw =
    rawInput?.analysis && typeof rawInput.analysis === "object" && !Array.isArray(rawInput.analysis)
      ? rawInput.analysis
      : rawInput;
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

  const newsRaw = Array.isArray(raw?.newsSentiment)
    ? raw.newsSentiment
    : Array.isArray(raw?.news)
      ? raw.news
      : Array.isArray(raw?.sentiment)
        ? raw.sentiment
        : [];
  let newsSentiment: AiAuditorNewsItem[] = newsRaw
    .map((n: any) => {
      const ticker = String(n?.ticker || n?.symbol || "").toUpperCase().trim();
      const headline = String(n?.headline || n?.title || n?.summary || "").trim();
      const whyItMatters = String(
        n?.whyItMatters || n?.why || n?.rationale || n?.detail || "",
      ).trim();
      const portfolioImpactDetail =
        String(n?.portfolioImpactDetail || n?.impact || "").trim() || whyItMatters;
      return {
        ticker,
        headline,
        sentiment: asSentiment(n?.sentiment),
        whyItMatters,
        portfolioImpactDetail,
        sourceUrl: resolveNewsUrl(ticker, headline, n?.sourceUrl ?? n?.url, ctx),
      };
    })
    .filter((n: AiAuditorNewsItem) => n.ticker && n.headline)
    .slice(0, 8);

  // If the model omitted news (truncation / wrong keys), seed from context headlines.
  if (newsSentiment.length === 0 && Array.isArray(ctx.news) && ctx.news.length > 0) {
    newsSentiment = ctx.news
      .slice(0, 6)
      .map((n) => {
        const ticker = String(n.ticker || n.query || "").toUpperCase().trim();
        const headline = String(n.title || "").trim();
        const summary = String(n.summary || "").trim();
        return {
          ticker,
          headline,
          sentiment: "neutral" as const,
          whyItMatters: summary || "Aktuálna správa viazaná na portfólio / makrostory.",
          portfolioImpactDetail: summary,
          sourceUrl: resolveNewsUrl(ticker, headline, n.link || null, ctx),
        };
      })
      .filter((n: AiAuditorNewsItem) => n.ticker && n.headline);
  }

  const recsRaw = Array.isArray(raw?.recommendations)
    ? raw.recommendations
    : Array.isArray(raw?.recs)
      ? raw.recs
      : Array.isArray(raw?.tips)
        ? raw.tips
        : [];
  const recommendations: AiAuditorRecommendation[] = recsRaw
    .map((r: any) => {
      const p = String(r?.priority || "medium").toLowerCase();
      return {
        title: String(r?.title || r?.name || r?.action || "").trim(),
        detail: String(r?.detail || r?.text || r?.description || r?.body || "").trim(),
        priority: (p === "high" || p === "low" ? p : "medium") as
          | "high"
          | "medium"
          | "low",
      };
    })
    .filter((r: AiAuditorRecommendation) => r.title && r.detail)
    .slice(0, 4);

  const fedRates = asMacroBlock(
    raw?.macroStress?.fedRates,
    "Citlivosť na sadzby Fedu nebola vyhodnotená.",
  );
  const inflation = asMacroBlock(
    raw?.macroStress?.inflation,
    "Inflačný stres nebol vyhodnotený.",
  );
  const sectorLevel = asRisk(raw?.macroStress?.sectorConcentration?.level);
  const sectorDetail =
    String(raw?.macroStress?.sectorConcentration?.detail || "").trim() ||
    "Sektorová koncentrácia nebola vyhodnotená.";
  const sectorDeep =
    String(raw?.macroStress?.sectorConcentration?.deepDive || "").trim() || sectorDetail;
  const sectorMit =
    String(raw?.macroStress?.sectorConcentration?.mitigation || "").trim() ||
    "Zváž zníženie váhy najväčšieho sektora a doplnenie defenzívnejších ETF.";

  const sb = raw?.scoreBreakdown;
  const scoreBreakdown: AiAuditorScoreBreakdown = {
    sectorConcentration: asScoreFactor(
      sb?.sectorConcentration,
      riskToScore(sectorLevel),
      sectorDetail,
    ),
    fedSensitivity: asScoreFactor(
      sb?.fedSensitivity,
      impactToScore(fedRates.impact),
      fedRates.detail,
    ),
    newsSentiment: asScoreFactor(
      sb?.newsSentiment,
      sentimentAvgScore(newsSentiment),
      newsSentiment[0]?.whyItMatters ||
        "Sentiment správ voči tvojim holdingom.",
    ),
    inflationResilience: asScoreFactor(
      sb?.inflationResilience,
      impactToScore(inflation.impact),
      inflation.detail,
    ),
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
        deepDive: sectorDeep,
        mitigation: sectorMit,
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
    link: n.link || null,
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
healthScore a čiastkové skóre 0–100: vyššie = zdravšie / odolnejšie (nižšia koncentrácia, nižšia citlivosť na Fed, lepší sentiment, vyššia inflačná odolnosť).
Pri správach použi sourceUrl z recentNews.link, ak sedí headline; inak null.
portfolioImpactDetail: spomeň váhu tickera v portfóliu (weightPct) a približný dopad na hodnotu portfólia v EUR (totalMarketValue × weight).
deepDive: 2–4 vety so scenárom (napr. −10 % Nasdaq). mitigation: jeden konkrétny krok.`;

  // newsSentiment + recommendations early so truncation (max_tokens) does not drop them.
  const user = `Vyhodnoť portfólio a vráť JSON s kľúčmi (v tomto poradí — najprv správy a tipy):
{
  "healthScore": 0-100,
  "healthLabel": "krátky status",
  "summaryOneLiner": "1 úderná veta",
  "newsSentiment": [
    {
      "ticker": "NVDA",
      "headline": "...",
      "sentiment": "positive|neutral|negative",
      "whyItMatters": "1–2 vety na kartu",
      "portfolioImpactDetail": "váha v portfóliu + dopad v EUR + prečo to bolí/pomáha",
      "sourceUrl": "https://... alebo null"
    }
  ],
  "recommendations": [
    { "title": "...", "detail": "...", "priority": "high|medium|low" }
  ],
  "scoreBreakdown": {
    "sectorConcentration": { "score": 0-100, "detail": "prečo toto skóre (koncentrácia)" },
    "fedSensitivity": { "score": 0-100, "detail": "citlivosť rastových titulov na sadzby" },
    "newsSentiment": { "score": 0-100, "detail": "nálada správ k holdingom" },
    "inflationResilience": { "score": 0-100, "detail": "schopnosť firiem preniesť infláciu" }
  },
  "macroStress": {
    "fedRates": {
      "impact": "positive|neutral|negative|mixed",
      "detail": "krátky súhrn na karte",
      "deepDive": "scenáre a dopad na portfólio (max 3 vety)",
      "mitigation": "konkrétny krok na zníženie rizika"
    },
    "inflation": {
      "impact": "positive|neutral|negative|mixed",
      "detail": "...",
      "deepDive": "...",
      "mitigation": "..."
    },
    "sectorConcentration": {
      "level": "low|medium|high",
      "detail": "...",
      "deepDive": "...",
      "mitigation": "...",
      "topSectors": [{ "name": "...", "weightPct": 12.5 }]
    }
  }
}
Presne 3–4 recommendations. newsSentiment max 6 položiek viazaných na holdings (povinné, ak recentNews nie je prázdne).
DÁTA:
${JSON.stringify(userPayload)}`;

  try {
    // Newer Claude models reject `temperature` ("temp is deprecated for this model").
    const msg = await client.messages.create({
      model: AI_AUDITOR_MODEL,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (msg.stop_reason === "max_tokens") {
      console.warn("[ai-auditor] Claude response truncated (max_tokens); normalizing partial JSON");
    }
    const parsed = extractJsonObject(text);
    return normalizeAnalysis(parsed, ctx);
  } catch (err) {
    const wrapped = new Error(formatAnthropicError(err));
    (wrapped as any).cause = err;
    throw wrapped;
  }
}
