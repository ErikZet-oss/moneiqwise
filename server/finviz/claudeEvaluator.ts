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
  pros: string[];
  cons: string[];
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

function normalizeTickerKey(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\./g, "-");
}

type RawStrategyPick = {
  ticker?: string;
  symbol?: string;
  comment?: string;
  reason?: string;
  summary?: string;
  rationale?: string;
  risk?: string;
  pros?: unknown;
  cons?: unknown;
  negatives?: unknown;
};

function asStringList(value: unknown, max = 5): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x).trim()).filter(Boolean).slice(0, max);
}

function extractPickComment(pick: RawStrategyPick): string {
  for (const value of [pick.comment, pick.reason, pick.summary, pick.rationale]) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function buildCommentFromLists(pros: string[], cons: string[]): string {
  const parts: string[] = [];
  if (pros.length) parts.push(`Plusy: ${pros.join("; ")}.`);
  if (cons.length) parts.push(`Riziká: ${cons.join("; ")}.`);
  return parts.join(" ");
}

function resolveRowTicker(pick: RawStrategyPick, byTicker: Map<string, FinvizScreenerRow>): FinvizScreenerRow | null {
  const candidates = [pick.ticker, pick.symbol]
    .map((t) => String(t || "").trim())
    .filter(Boolean);
  for (const raw of candidates) {
    const row = byTicker.get(normalizeTickerKey(raw));
    if (row) return row;
  }
  return null;
}

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
    max_tokens: 2500,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = msg.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const parsed = extractJsonObject(text) as {
    insight?: string;
    topPicks?: RawStrategyPick[];
  };

  const byTicker = new Map(limited.map((r) => [normalizeTickerKey(r.ticker), r]));
  const topPicks: AiTopPick[] = [];
  for (const pick of parsed.topPicks ?? []) {
    const row = resolveRowTicker(pick, byTicker);
    if (!row) continue;

    const pros = asStringList(pick.pros);
    const cons = asStringList(pick.cons ?? pick.negatives);
    let comment = extractPickComment(pick);
    if (!comment && (pros.length || cons.length)) {
      comment = buildCommentFromLists(pros, cons);
    }

    topPicks.push({
      ticker: row.ticker,
      companyName: row.companyName,
      comment: comment || "Claude nevrátil komentár — skús spustiť skener znova (Obnoviť).",
      risk: String(pick.risk || "").trim() || (cons[0] ?? ""),
      pros,
      cons,
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
        comment: "Automatický výber podľa skenera (AI nevrátila platné tickery). Spusti skener znova pre Claude komentár.",
        risk: "",
        pros: [],
        cons: [],
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
