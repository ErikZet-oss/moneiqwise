import Anthropic from "@anthropic-ai/sdk";
import { collectAiBotNewsContext } from "../aiBot/newsContext";
import { formatAnthropicError } from "../finviz/claudeEvaluator";
import type { SignalDecision } from "./indicators";

const MODEL =
  process.env.ANTHROPIC_MODEL?.trim().replace(/^["']|["']$/g, "") ||
  "claude-sonnet-5";

export type AiSymbolVerdict = {
  symbol: string;
  bias: "bullish" | "bearish" | "neutral";
  confidence: number;
  reason: string;
};

function getAnthropicClient(): Anthropic | null {
  const raw = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  const key = raw.replace(/^["']|["']$/g, "").trim();
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence?.[1]?.trim() || trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI_JSON_PARSE");
  return JSON.parse(raw.slice(start, end + 1));
}

function biasToScore(bias: AiSymbolVerdict["bias"]): number {
  if (bias === "bullish") return 80;
  if (bias === "bearish") return 20;
  return 50;
}

/**
 * Fetch news for universe and ask Claude for per-symbol verdicts.
 * Verdicts only nudge quant score — they never create a trade alone.
 */
export async function fetchPaperBotAiVerdicts(input: {
  symbols: string[];
}): Promise<{
  verdicts: Map<string, AiSymbolVerdict>;
  model: string | null;
  error: string | null;
  newsCount: number;
}> {
  const symbols = input.symbols.map((s) => s.toUpperCase()).filter(Boolean);
  const empty = {
    verdicts: new Map<string, AiSymbolVerdict>(),
    model: null as string | null,
    error: null as string | null,
    newsCount: 0,
  };
  if (symbols.length === 0) return empty;

  const client = getAnthropicClient();
  if (!client) {
    return { ...empty, error: "ANTHROPIC_API_KEY_MISSING" };
  }

  const { news } = await collectAiBotNewsContext({ holdingTickers: symbols });
  const newsLines = news
    .slice(0, 18)
    .map(
      (n) =>
        `- [${n.ticker ?? "MACRO"}] ${n.title}${n.summary ? ` — ${n.summary}` : ""}`,
    )
    .join("\n");

  const prompt = `Si AI vrstva paper trading bota. AI NIKDY nevytvára trade sama — len sentiment k tickerom.

Tickery: ${symbols.join(", ")}

Správy:
${newsLines || "(žiadne správy)"}

Vráť LEN JSON:
{
  "verdicts": [
    { "symbol": "AAPL", "bias": "bullish"|"bearish"|"neutral", "confidence": 0-100, "reason": "max 120 znakov" }
  ]
}
Jeden verdict na každý ticker zo zoznamu. Ak nie sú relevantné správy, bias=neutral, confidence nižšie.`;

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1200,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n");
    const parsed = extractJson(text) as {
      verdicts?: Array<{
        symbol?: string;
        bias?: string;
        confidence?: number;
        reason?: string;
      }>;
    };
    const map = new Map<string, AiSymbolVerdict>();
    for (const v of parsed.verdicts ?? []) {
      const symbol = String(v.symbol || "")
        .trim()
        .toUpperCase();
      if (!symbol) continue;
      const biasRaw = String(v.bias || "neutral").toLowerCase();
      const bias: AiSymbolVerdict["bias"] =
        biasRaw === "bullish" || biasRaw === "bearish" ? biasRaw : "neutral";
      const confidence = Math.min(
        100,
        Math.max(0, Number(v.confidence) || 0),
      );
      map.set(symbol, {
        symbol,
        bias,
        confidence,
        reason: String(v.reason || "").slice(0, 160),
      });
    }
    return {
      verdicts: map,
      model: MODEL,
      error: null,
      newsCount: news.length,
    };
  } catch (err) {
    console.warn("[paper-bot] AI layer failed:", formatAnthropicError(err));
    return {
      ...empty,
      error: formatAnthropicError(err),
      newsCount: news.length,
    };
  }
}

export type NudgedDecision = SignalDecision & {
  quantScore: number;
  aiScore: number | null;
  finalScore: number;
  aiApplied: boolean;
  aiBlocked: boolean;
};

/**
 * Blend quant score with AI. AI never opens alone — only modulates / can block weak buys.
 */
export function applyAiNudge(input: {
  signal: SignalDecision;
  verdict: AiSymbolVerdict | null;
  influencePct: number;
  minConfidence: number;
}): NudgedDecision {
  const { signal, verdict, influencePct, minConfidence } = input;
  const w = Math.min(100, Math.max(0, influencePct)) / 100;
  const quantScore = signal.score;

  if (!verdict || w <= 0 || verdict.confidence < minConfidence) {
    return {
      ...signal,
      quantScore,
      aiScore: null,
      finalScore: quantScore,
      aiApplied: false,
      aiBlocked: false,
    };
  }

  const aiScore = biasToScore(verdict.bias);
  const finalScore = quantScore * (1 - w) + aiScore * w;

  // Strong bearish AI can block a BUY entry
  const aiBlocked =
    signal.action === "BUY" &&
    verdict.bias === "bearish" &&
    verdict.confidence >= Math.max(minConfidence, 65);

  let action = signal.action;
  let reason = signal.reason;
  if (aiBlocked) {
    action = "HOLD";
    reason = `AI blocked BUY (${verdict.bias}, conf ${verdict.confidence}%) — ${verdict.reason}`;
  } else if (signal.action === "BUY" && finalScore < 52) {
    action = "HOLD";
    reason = `AI nudge znížil skóre na ${finalScore.toFixed(0)} (<52) — ${verdict.reason}`;
  } else if (signal.action === "BUY") {
    reason = `${signal.reason} | AI ${verdict.bias} ${verdict.confidence}% → score ${finalScore.toFixed(0)}`;
  }

  return {
    action,
    score: finalScore,
    reason,
    indicators: signal.indicators,
    quantScore,
    aiScore,
    finalScore,
    aiApplied: true,
    aiBlocked,
  };
}
