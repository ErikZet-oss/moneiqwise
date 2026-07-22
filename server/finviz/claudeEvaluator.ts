import Anthropic from "@anthropic-ai/sdk";
import type { FinvizScreenerRow, FinvizQuoteSnapshot } from "./scraper";
import type { AiScannerStrategy } from "./strategies";
import {
  DEFAULT_AI_PROMPTS,
  applyPromptTemplate,
} from "./defaultPrompts";

export type AiTopPick = {
  ticker: string;
  companyName: string;
  comment: string;
  risk: string;
  metrics: {
    price: number | null;
    changePercent: number | null;
    pe: number | null;
    marketCap: string | null;
    sector: string | null;
  };
};

export type AiStrategyEvaluation = {
  insight: string;
  topPicks: AiTopPick[];
  model: string;
};

export type AiTickerVerdict = {
  ticker: string;
  companyName: string | null;
  verdict: "vhodna" | "opatrne" | "nevhodna" | "neiste";
  summary: string;
  pros: string[];
  cons: string[];
  model: string;
};

function getAnthropicClient(): Anthropic {
  const raw = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  const key = raw.replace(/^["']|["']$/g, "").trim();
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY_MISSING");
  }
  return new Anthropic({ apiKey: key });
}

export function formatAnthropicError(err: unknown): string {
  if (!err) return "Neznáma chyba AI.";
  if (err instanceof Anthropic.APIError) {
    const status = err.status ? `HTTP ${err.status}` : "API";
    const msg = err.message?.trim() || "Anthropic API error";
    if (err.status === 401) return `${status}: Neplatný ANTHROPIC_API_KEY.`;
    if (err.status === 403) return `${status}: Prístup zamietnutý (kľúč / organizácia).`;
    if (err.status === 429) return `${status}: Rate limit / kredity Anthropic.`;
    if (err.status === 404) {
      const used =
        process.env.ANTHROPIC_MODEL?.trim().replace(/^["']|["']$/g, "") ||
        "claude-sonnet-5";
      return `${status}: Neplatný model (${used}). Nastav ANTHROPIC_MODEL na Renderi.`;
    }
    return `${status}: ${msg}`;
  }
  if (err instanceof Error) {
    if (err.message === "ANTHROPIC_API_KEY_MISSING") {
      return "Chýba ANTHROPIC_API_KEY v Environment Variables na Renderi.";
    }
    if (err.message === "AI_JSON_PARSE") {
      return "Claude nevrátil platný JSON. Skús znova.";
    }
    return err.message;
  }
  return String(err);
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1].trim() : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI_JSON_PARSE");
  return JSON.parse(raw.slice(start, end + 1));
}

const MODEL = process.env.ANTHROPIC_MODEL?.trim().replace(/^["']|["']$/g, "") || "claude-sonnet-5";

export async function evaluateStrategyPicks(
  strategy: AiScannerStrategy,
  rows: FinvizScreenerRow[],
  promptTemplate?: string,
): Promise<AiStrategyEvaluation> {
  const client = getAnthropicClient();
  const limited = rows.slice(0, 20);
  const list = limited.map((r) => ({
    ticker: r.ticker,
    company: r.companyName,
    sector: r.sector,
    marketCap: r.marketCap,
    pe: r.pe,
    price: r.price,
    changePercent: r.changePercent,
  }));

  const prompt = applyPromptTemplate(promptTemplate?.trim() || DEFAULT_AI_PROMPTS.strategy, {
    strategyLabel: strategy.label,
    strategyDescription: strategy.description,
    stockListJson: JSON.stringify(list, null, 2),
  });

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = msg.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const parsed = extractJsonObject(text) as {
    insight?: string;
    topPicks?: Array<{ ticker?: string; comment?: string; risk?: string }>;
  };

  const byTicker = new Map(limited.map((r) => [r.ticker.toUpperCase(), r]));
  const topPicks: AiTopPick[] = [];
  for (const pick of parsed.topPicks ?? []) {
    const t = String(pick.ticker || "").toUpperCase();
    const row = byTicker.get(t);
    if (!row) continue;
    topPicks.push({
      ticker: row.ticker,
      companyName: row.companyName,
      comment: String(pick.comment || "").trim() || "Bez komentára.",
      risk: String(pick.risk || "").trim() || "",
      metrics: {
        price: row.price,
        changePercent: row.changePercent,
        pe: row.pe,
        marketCap: row.marketCap,
        sector: row.sector,
      },
    });
    if (topPicks.length >= 3) break;
  }

  // Fallback: ak AI nevrátila platné tickery, vezmi prvé 3 zo skenera
  if (topPicks.length === 0) {
    for (const row of limited.slice(0, 3)) {
      topPicks.push({
        ticker: row.ticker,
        companyName: row.companyName,
        comment: "Automatický výber podľa skenera (AI nevrátila platné tickery).",
        risk: "",
        metrics: {
          price: row.price,
          changePercent: row.changePercent,
          pe: row.pe,
          marketCap: row.marketCap,
          sector: row.sector,
        },
      });
    }
  }

  return {
    insight: String(parsed.insight || "").trim() || `Výsledok stratégie ${strategy.label}.`,
    topPicks,
    model: MODEL,
  };
}

export async function evaluateTickerSnapshot(
  snapshot: FinvizQuoteSnapshot,
  promptTemplate?: string,
): Promise<AiTickerVerdict> {
  const client = getAnthropicClient();
  const interestingKeys = [
    "P/E",
    "Forward P/E",
    "PEG",
    "EPS (ttm)",
    "EPS next Y",
    "EPS next 5Y",
    "Sales past 5Y",
    "ROI",
    "ROE",
    "ROA",
    "Debt/Eq",
    "Gross Margin",
    "Oper. Margin",
    "Profit Margin",
    "Dividend %",
    "Payout",
    "RSI (14)",
    "SMA20",
    "SMA50",
    "SMA200",
    "Perf Week",
    "Perf Month",
    "Perf Year",
    "Target Price",
    "Recom",
    "Market Cap",
    "Avg Volume",
    "Short Float",
    "Insider Own",
    "Inst Own",
  ];

  const slim: Record<string, string> = {};
  for (const k of interestingKeys) {
    if (snapshot.metrics[k]) slim[k] = snapshot.metrics[k];
  }
  // include a few more if sparse
  if (Object.keys(slim).length < 8) {
    for (const [k, v] of Object.entries(snapshot.metrics)) {
      if (!slim[k]) slim[k] = v;
      if (Object.keys(slim).length >= 25) break;
    }
  }

  const prompt = applyPromptTemplate(promptTemplate?.trim() || DEFAULT_AI_PROMPTS.ticker, {
    ticker: snapshot.ticker,
    companyName: snapshot.companyName || "N/A",
    metricsJson: JSON.stringify(slim, null, 2),
  });

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 900,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = msg.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const parsed = extractJsonObject(text) as {
    verdict?: string;
    summary?: string;
    pros?: string[];
    cons?: string[];
  };

  const verdictRaw = String(parsed.verdict || "neiste").toLowerCase();
  const verdict: AiTickerVerdict["verdict"] =
    verdictRaw === "vhodna" || verdictRaw === "opatrne" || verdictRaw === "nevhodna" || verdictRaw === "neiste"
      ? verdictRaw
      : "neiste";

  return {
    ticker: snapshot.ticker,
    companyName: snapshot.companyName,
    verdict,
    summary: String(parsed.summary || "").trim() || "Nepodarilo sa zostaviť verdikt.",
    pros: Array.isArray(parsed.pros) ? parsed.pros.map(String).slice(0, 5) : [],
    cons: Array.isArray(parsed.cons) ? parsed.cons.map(String).slice(0, 5) : [],
    model: MODEL,
  };
}
