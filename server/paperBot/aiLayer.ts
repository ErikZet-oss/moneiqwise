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

function repairJsonLike(raw: string): string {
  return raw
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

function extractJson(text: string): unknown {
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
  if (start >= 0 && end > start) {
    candidates.push(trimmed.slice(start, end + 1));
  }
  candidates.push(trimmed);

  for (const candidate of candidates) {
    for (const attempt of [candidate, repairJsonLike(candidate)]) {
      try {
        return JSON.parse(attempt);
      } catch {
        // try next
      }
    }
  }
  throw new Error("AI_JSON_PARSE");
}

function biasToScore(bias: AiSymbolVerdict["bias"]): number {
  if (bias === "bullish") return 80;
  if (bias === "bearish") return 20;
  return 50;
}

function parseVerdicts(
  parsed: unknown,
  symbols: string[],
): Map<string, AiSymbolVerdict> {
  const map = new Map<string, AiSymbolVerdict>();
  const root = parsed as {
    verdicts?: Array<{
      symbol?: string;
      bias?: string;
      confidence?: number;
      reason?: string;
    }>;
  };
  for (const v of root.verdicts ?? []) {
    const symbol = String(v.symbol || "")
      .trim()
      .toUpperCase();
    if (!symbol) continue;
    const biasRaw = String(v.bias || "neutral").toLowerCase();
    const bias: AiSymbolVerdict["bias"] =
      biasRaw === "bullish" || biasRaw === "bearish" ? biasRaw : "neutral";
    const confidence = Math.min(100, Math.max(0, Number(v.confidence) || 0));
    map.set(symbol, {
      symbol,
      bias,
      confidence,
      reason: String(v.reason || "").slice(0, 160),
    });
  }
  // Ensure every requested symbol has at least a neutral fallback if model skipped some
  for (const symbol of symbols) {
    if (!map.has(symbol)) {
      map.set(symbol, {
        symbol,
        bias: "neutral",
        confidence: 40,
        reason: "Model nevyplnil verdict — neutral default",
      });
    }
  }
  return map;
}

export type AiMarketSnapshot = {
  symbol: string;
  close: number | null;
  rsi14: number | null;
  ema50: number | null;
  ema200: number | null;
  macdHist: number | null;
};

async function requestVerdictJson(
  client: Anthropic,
  prompt: string,
  maxTokens: number,
  extraInstruction?: string,
): Promise<string> {
  const userContent = extraInstruction
    ? `${prompt}\n\n${extraInstruction}`
    : prompt;
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system:
      "You are a JSON API. Reply with a single valid JSON object only. No markdown fences, no commentary.",
    messages: [
      { role: "user", content: userContent },
      // Prefill forces JSON object start — reduces prose / invalid schemas.
      { role: "assistant", content: '{"verdicts":[' },
    ],
  });
  const continuation = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n");
  return `{"verdicts":[${continuation}`;
}

/**
 * Fetch news for universe and ask Claude for per-symbol verdicts.
 * Verdicts only nudge quant score — they never create a trade alone.
 * Note: newer Claude models reject `temperature` — do not pass it.
 */
export async function fetchPaperBotAiVerdicts(input: {
  symbols: string[];
  market?: AiMarketSnapshot[];
}): Promise<{
  verdicts: Map<string, AiSymbolVerdict>;
  model: string | null;
  error: string | null;
  newsCount: number;
}> {
  const symbols = input.symbols
    .map((s) => s.toUpperCase())
    .filter(Boolean)
    .slice(0, 12);
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
    .slice(0, 12)
    .map(
      (n) =>
        `- [${n.ticker ?? "MACRO"}] ${n.title}${n.summary ? ` — ${n.summary.slice(0, 160)}` : ""}`,
    )
    .join("\n");

  const marketBySymbol = new Map(
    (input.market ?? []).map((m) => [m.symbol.toUpperCase(), m]),
  );
  const marketLines = symbols
    .map((symbol) => {
      const m = marketBySymbol.get(symbol);
      if (!m) return `- ${symbol}`;
      const parts = [
        symbol,
        m.close != null ? `close=${m.close.toFixed(2)}` : null,
        m.rsi14 != null ? `RSI14=${m.rsi14.toFixed(1)}` : null,
        m.ema50 != null ? `EMA50=${m.ema50.toFixed(2)}` : null,
        m.ema200 != null ? `EMA200=${m.ema200.toFixed(2)}` : null,
        m.macdHist != null ? `MACDhist=${m.macdHist.toFixed(3)}` : null,
      ].filter(Boolean);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");

  const exampleSymbol = symbols[0] ?? "AAPL";
  const prompt = `Si AI vrstva paper trading bota. AI NIKDY nevytvára trade sama — len sentiment k tickerom.
Zohľadni správy AJ trhový snapshot (RSI/EMA/MACD). Ak správa a technika idú proti sebe, zníž confidence.

Tickery (povinné — jeden verdict pre každý): ${symbols.join(", ")}

Trhový snapshot:
${marketLines || "(nedostupný)"}

Správy:
${newsLines || "(žiadne správy)"}

Schéma odpovede (platný JSON, bez markdown):
{"verdicts":[{"symbol":"${exampleSymbol}","bias":"neutral","confidence":50,"reason":"kratky dovod"}]}

Pravidlá:
- bias je presne jedna z hodnôt: bullish, bearish, neutral
- confidence je číslo 0 až 100
- reason max 120 znakov, bez úvodzoviek vo vnútri textu
- vráť práve ${symbols.length} verdictov, jeden na každý ticker zo zoznamu`;

  const maxTokens = Math.min(2500, 400 + symbols.length * 120);

  try {
    let text = await requestVerdictJson(client, prompt, maxTokens);
    let parsed: unknown;
    try {
      parsed = extractJson(text);
    } catch (firstErr) {
      console.warn(
        "[paper-bot] AI JSON parse failed, retrying. Preview:",
        text.slice(0, 400),
      );
      text = await requestVerdictJson(
        client,
        prompt,
        maxTokens,
        "IMPORTANT: Previous reply was invalid JSON. Continue only with valid JSON array elements and closing braces. bias must be bullish, bearish, or neutral.",
      );
      try {
        parsed = extractJson(text);
      } catch (secondErr) {
        console.warn(
          "[paper-bot] AI JSON parse failed after retry. Preview:",
          text.slice(0, 600),
        );
        throw secondErr instanceof Error ? secondErr : firstErr;
      }
    }

    const map = parseVerdicts(parsed, symbols);
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
