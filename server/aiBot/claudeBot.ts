import Anthropic from "@anthropic-ai/sdk";
import { formatAnthropicError } from "../finviz/claudeEvaluator";
import type { AiBotRunContext } from "./contextBuilder";
import type {
  AiBotAction,
  AiBotAnalysisPayload,
  AiBotHorizon,
  AiBotMarketNote,
  AiBotMarketOutlook,
  AiBotNewsDigestItem,
  AiBotOpportunity,
  AiBotPortfolioAuditItem,
  AiBotSectorTrend,
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
  let s = raw
    .replace(/^\uFEFF/, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");

  // Neescapované reálne newlines vnútri stringov → \n
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
      if (ch === "\t") {
        out += "\\t";
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  s = out;

  // Orezaný JSON: doplň chýbajúce } ]
  const opens = (s.match(/\{/g) || []).length;
  const closes = (s.match(/\}/g) || []).length;
  const openArr = (s.match(/\[/g) || []).length;
  const closeArr = (s.match(/\]/g) || []).length;
  // Odstráň neukončený trailing string / hodnotu
  s = s.replace(/,\s*"[^"]*$/s, "");
  s = s.replace(/,\s*$/s, "");
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
  if (start >= 0 && end > start) {
    candidates.push(trimmed.slice(start, end + 1));
  }
  // Aj keď chýba uzatváracia }, skús od prvej {
  if (start >= 0) {
    candidates.push(trimmed.slice(start));
  }
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

function extractJsonStringField(text: string, field: string): string | undefined {
  const re = new RegExp(`"${field}"\\s*:\\s*"`, "i");
  const m = re.exec(text);
  if (!m) return undefined;
  let i = m.index + m[0].length;
  let out = "";
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length) {
      out += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '"') break;
    out += ch;
    i++;
  }
  return out.trim() || undefined;
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

function asStringList(v: unknown, max = 4): string[] | null {
  if (!Array.isArray(v)) return null;
  const list = v
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, max);
  return list.length ? list : null;
}

function asSentiment(v: unknown): AiBotMarketOutlook["sentiment"] {
  const s = String(v || "")
    .toLowerCase()
    .replace(/-/g, "_");
  if (s === "risk_on" || s === "riskon") return "risk_on";
  if (s === "risk_off" || s === "riskoff") return "risk_off";
  if (s === "mixed") return "mixed";
  return "uncertain";
}

function asSectorBias(v: unknown): AiBotSectorTrend["bias"] {
  const s = String(v || "").toLowerCase();
  if (s === "bullish" || s === "bearish" || s === "neutral") return s;
  return "neutral";
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
        newsDrivers: asStringList(item?.newsDrivers, 4),
      }))
    : [];

  const newOpportunities: AiBotOpportunity[] = Array.isArray(raw?.newOpportunities)
    ? raw.newOpportunities
        .slice(0, 3)
        .map((item: any) => {
          const whyNow = item?.whyNow != null ? String(item.whyNow).trim() : "";
          const newsDrivers = asStringList(item?.newsDrivers, 4);
          let thesis = String(item?.thesis || item?.rationale || "").trim();
          if (!thesis || /^bez tézy\.?$/i.test(thesis)) {
            if (whyNow) thesis = whyNow;
            else if (newsDrivers?.length)
              thesis = `Investičná téza podľa noviniek: ${newsDrivers.join("; ")}.`;
            else thesis = "";
          }
          return {
            ticker: String(item?.ticker || "").toUpperCase(),
            companyName: item?.companyName != null ? String(item.companyName) : null,
            thesis,
            horizon: asHorizon(item?.horizon),
            risks: item?.risks != null ? String(item.risks) : null,
            whyNow: whyNow || null,
            conviction: asConviction(item?.conviction),
            newsDrivers,
          };
        })
        .filter((x: AiBotOpportunity) => x.ticker && x.thesis.length >= 40)
    : [];


  const marketNotes: AiBotMarketNote[] = Array.isArray(raw?.marketNotes)
    ? raw.marketNotes.slice(0, 8).map((item: any) => ({
        title: String(item?.title || "Poznámka").trim(),
        detail: String(item?.detail || item?.text || "").trim(),
      }))
    : [];

  const outlookRaw = raw?.marketOutlook;
  const marketOutlook: AiBotMarketOutlook | null =
    outlookRaw && typeof outlookRaw === "object"
      ? {
          sentiment: asSentiment(outlookRaw.sentiment),
          narrative:
            String(outlookRaw.narrative || outlookRaw.summary || "").trim() ||
            "Bez makronaratívu.",
          drivers: asStringList(outlookRaw.drivers, 6) || [],
        }
      : null;

  const sectorTrends: AiBotSectorTrend[] = Array.isArray(raw?.sectorTrends)
    ? raw.sectorTrends.slice(0, 6).map((item: any) => ({
        sector: String(item?.sector || "Sektor").trim(),
        bias: asSectorBias(item?.bias),
        why: String(item?.why || item?.detail || "").trim() || "Bez zdôvodnenia.",
      }))
    : [];

  const newsDigest: AiBotNewsDigestItem[] = Array.isArray(raw?.newsDigest)
    ? raw.newsDigest.slice(0, 8).map((item: any) => ({
        title: String(item?.title || "Článok").trim(),
        publisher: item?.publisher != null ? String(item.publisher) : null,
        link: item?.link != null ? String(item.link) : null,
        whyItMatters: String(item?.whyItMatters || item?.detail || "").trim() || "—",
        relatedTickers: asStringList(item?.relatedTickers, 6)?.map((t) =>
          t.toUpperCase(),
        ) ?? null,
      }))
    : [];

  return {
    summary: String(raw?.summary || "").trim() || "Analýza dokončená.",
    marketOutlook,
    sectorTrends: sectorTrends.filter((x) => x.sector && x.why),
    newsDigest: newsDigest.filter((x) => x.title),
    portfolioAudit: portfolioAudit.filter((x) => x.ticker),
    newOpportunities: newOpportunities.filter((x) => x.ticker),
    marketNotes: marketNotes.filter((x) => x.detail),
    model: MODEL,
    sourcesUsed,
  };
}

/** Keď JSON úplne padne — aspoň HOLD brief z kontextu, aby UI nebolo prázdne. */
function looseFallbackFromContext(
  ctx: AiBotRunContext,
  text: string,
  sourcesUsed: string[],
): AiBotAnalysisPayload {
  const summary =
    extractJsonStringField(text, "summary") ||
    (text.trim().slice(0, 280) || "Analýza prebehla, ale Claude nevrátil čistý JSON. Skús Spustiť znova.");

  const topNews = ctx.news.slice(0, 5);
  return {
    summary,
    marketOutlook: {
      sentiment: "uncertain",
      narrative:
        "Dočasný brief — Claude nevrátil platný JSON. Spusti AI Bot znova pre hĺbkový rozbor podľa noviniek.",
      drivers: topNews.map((n) => n.title).slice(0, 4),
    },
    sectorTrends: [],
    newsDigest: topNews.map((n) => ({
      title: n.title,
      publisher: n.publisher || null,
      link: n.link || null,
      whyItMatters: n.summary || "Článok z kontextu (fallback pred novým behom).",
      relatedTickers: n.ticker ? [n.ticker] : null,
    })),
    portfolioAudit: ctx.holdings.slice(0, 25).map((h) => ({
      ticker: h.ticker,
      companyName: h.companyName,
      action: "HOLD" as const,
      weightPct: h.weightPct,
      horizon: null,
      conviction: null,
      rationale:
        "Dočasný HOLD — odpoveď modelu nebola v platnom JSON. Spusti AI Bot znova pre plný audit.",
      risks: null,
      invalidation: null,
      newsDrivers: null,
    })),
    newOpportunities: [],
    marketNotes: [
      {
        title: "Parsovanie JSON",
        detail:
          "Model nevrátil platný JSON (často orezanie odpovede). Brief je dočasný fallback.",
      },
    ],
    model: MODEL,
    sourcesUsed,
  };
}

function sanitizeContext(ctx: AiBotRunContext) {
  // Top 25 podľa váhy — pri „Všetkých“ je toť pozícií.
  const holdings = ctx.holdings.slice(0, 25).map((h) => ({
    ticker: h.ticker,
    companyName: h.companyName,
    shares: Number.isFinite(h.shares) ? Number(h.shares.toFixed(4)) : 0,
    averageCost: Number.isFinite(h.averageCost) ? Number(h.averageCost.toFixed(4)) : 0,
    price: h.price != null && Number.isFinite(h.price) ? Number(h.price.toFixed(4)) : null,
    changePercent:
      h.changePercent != null && Number.isFinite(h.changePercent)
        ? Number(h.changePercent.toFixed(2))
        : null,
    weightPct:
      h.weightPct != null && Number.isFinite(h.weightPct)
        ? Number(h.weightPct.toFixed(2))
        : null,
    unrealizedPnlPct:
      h.unrealizedPnlPct != null && Number.isFinite(h.unrealizedPnlPct)
        ? Number(h.unrealizedPnlPct.toFixed(2))
        : null,
    pe: h.pe != null && Number.isFinite(h.pe) ? Number(h.pe.toFixed(2)) : null,
    high52w: h.high52w != null && Number.isFinite(h.high52w) ? Number(h.high52w.toFixed(2)) : null,
    low52w: h.low52w != null && Number.isFinite(h.low52w) ? Number(h.low52w.toFixed(2)) : null,
    pctFrom52wHigh:
      h.pctFrom52wHigh != null && Number.isFinite(h.pctFrom52wHigh)
        ? Number(h.pctFrom52wHigh.toFixed(1))
        : null,
    pctFrom52wLow:
      h.pctFrom52wLow != null && Number.isFinite(h.pctFrom52wLow)
        ? Number(h.pctFrom52wLow.toFixed(1))
        : null,
    sma50: h.sma50 != null && Number.isFinite(h.sma50) ? Number(h.sma50.toFixed(2)) : null,
    sma200: h.sma200 != null && Number.isFinite(h.sma200) ? Number(h.sma200.toFixed(2)) : null,
    pctFromSma50:
      h.pctFromSma50 != null && Number.isFinite(h.pctFromSma50)
        ? Number(h.pctFromSma50.toFixed(1))
        : null,
    pctFromSma200:
      h.pctFromSma200 != null && Number.isFinite(h.pctFromSma200)
        ? Number(h.pctFromSma200.toFixed(1))
        : null,
  }));

  const movers = ctx.movers.slice(0, 8).map((m) => ({
    ticker: m.ticker,
    companyName: m.companyName,
    price: m.price != null && Number.isFinite(m.price) ? Number(m.price.toFixed(4)) : null,
    changePercent:
      m.changePercent != null && Number.isFinite(m.changePercent)
        ? Number(m.changePercent.toFixed(2))
        : null,
    pe: m.pe != null && Number.isFinite(m.pe) ? Number(m.pe.toFixed(2)) : null,
    sector: m.sector,
  }));

  // Pri veľa holdingoch skráť news, aby v odpovedi ostalo miesto na portfolioAudit.
  const newsCap = holdings.length >= 15 ? 14 : holdings.length >= 10 ? 18 : 24;
  const news = (ctx.news || []).slice(0, newsCap).map((n) => ({
    title: n.title.slice(0, 160),
    publisher: n.publisher?.slice(0, 40) || null,
    link: n.link || null,
    publishedAt: n.publishedAt,
    summary: n.summary?.slice(0, 180) || null,
    relatedTicker: n.ticker,
    topic: n.query,
  }));

  return {
    slot: ctx.slotLabel,
    portfolio: ctx.portfolioLabel,
    totalMarketValue: Number.isFinite(ctx.totalMarketValue)
      ? Math.round(ctx.totalMarketValue * 100) / 100
      : 0,
    holdings,
    externalCandidates: movers,
    recentNews: news,
    alreadyOwnedOrWatching: Array.from(
      new Set([
        ...holdings.map((h) => h.ticker),
        ...ctx.watchlistTickers.map((t) => t.toUpperCase()),
      ]),
    ).slice(0, 60),
  };
}

function buildPrompt(userPayload: unknown, compact: boolean): string {
  if (compact) {
    return `Return ONLY valid minified JSON. No markdown.
Keys IN THIS ORDER (portfolioAudit EARLY — never omit):
summary,
marketOutlook:{sentiment:risk_on|risk_off|mixed|uncertain,narrative,drivers[]},
portfolioAudit:[{ticker,companyName,action,weightPct,horizon,conviction,rationale,risks,invalidation,newsDrivers[]}],
sectorTrends:[{sector,bias:bullish|bearish|neutral,why}],
newsDigest:[{title,publisher,link,whyItMatters,relatedTickers[]}],
newOpportunities:[{ticker,companyName,thesis,horizon,risks,whyNow,conviction,newsDrivers[]}],
marketNotes:[{title,detail}].
MUST include EVERY holdings[] ticker in portfolioAudit.
rationale = 3-5 clear Slovak sentences. thesis = 2-4 Slovak sentences. Never "Bez tézy".
Cite recentNews. Use SMA50/SMA200 and 52w high/low from holdings when writing rationale.
action=BUY|SELL|TRIM|HOLD.
Context:
${JSON.stringify(userPayload)}`;
  }

  return `Si senior investičný analytik pre retail investora v appke Moneiqwise.
Píš po SLOVENSKY, kultivovane a zrozumiteľne — ako v kvalitnom investičnom bulletine (nie heslá, nie anglické skratky bez vysvetlenia).

Musíš spraviť HĹBKOVÝ rozbor podľa aktuálnych noviniek v poli recentNews.
Nestačí všeobecné frázovanie — viaž rozhodnutia na konkrétne titulky (Fed/inflácia, Trump/cla, geopolitika, sektory, firemné správy).

KRITICKÉ: portfolioAudit je jadro briefu. Musí obsahovať KAŽDÚ pozíciu z holdings[].
Ak by odpoveď bola dlhá, radšej skráť newsDigest/marketNotes — NIKDY nevynechaj portfolioAudit.

Úlohy (poradie v JSON STRIKTNE dodrž — audit hneď po outlooku):
1) summary: 2–4 vety, čo je dnes najdôležitejšie pre toto portfólio.
2) marketOutlook: sentiment (risk_on|risk_off|mixed|uncertain), naratív 3–5 viet, drivers[].
3) portfolioAudit: pre KAŽDÝ ticker z holdings:
   - action: BUY|SELL|TRIM|HOLD
   - rationale: 4–6 viet, plynulý text — váha v portfóliu, P/L, denný pohyb, technické levely (sma50/sma200, pctFromSma50/pctFromSma200, high52w/low52w, pctFrom52wHigh/pctFrom52wLow), novinky, prečo táto akcia; formuluj ako radu investorovi.
   - Zmien techniku explicitne, ak je relevantná (napr. pod SMA200, blízko 52w low, predĺženie nad SMA50).
   - risks + invalidation: 1–2 vety každá
   - newsDrivers: 1–3 titulky z recentNews (ak relevantné)
   - horizon: swing|long, conviction 1–5
4) sectorTrends: 3–5 sektorov, bias + why (2–3 vety).
5) newsDigest: 3–5 článkov (title/publisher/link + whyItMatters).
6) newOpportunities: 1–2 tipy mimo alreadyOwnedOrWatching; thesis 3–5 viet (povinná).
7) marketNotes: max 3 krátke poznámky.

Pravidlá:
- Odpovedz VÝHRADNE platným JSON. Žiadny markdown, žiadny text okolo.
- Neklaď titulky, ktoré nie sú v recentNews.
- Ak recentNews je prázdne, povedz to v marketOutlook.narrative a buď opatrný.
- JSON polia v poradí: summary, marketOutlook, portfolioAudit, sectorTrends, newsDigest, newOpportunities, marketNotes.

Kontext:
${JSON.stringify(userPayload)}`;
}

function buildAuditOnlyPrompt(userPayload: unknown): string {
  return `Si senior investičný analytik (slovensky, kultivovane).
Doplň LEN portfolioAudit pre KAŽDÚ pozíciu z holdings.
Return ONLY JSON: {"portfolioAudit":[{ticker,companyName,action,weightPct,horizon,conviction,rationale,risks,invalidation,newsDrivers[]}]}
action=BUY|SELL|TRIM|HOLD. rationale = 4–6 viet (váha, P/L, SMA50/SMA200, 52w high/low a % od nich, novinky, odporúčanie).
Cite recentNews where relevant. Never omit a holding ticker.
Context:
${JSON.stringify(userPayload)}`;
}

async function callClaude(prompt: string, maxTokens: number): Promise<string> {
  const client = getAnthropicClient();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = msg.content.find((b) => b.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text : "";
}

function auditCoverageOk(
  analysis: AiBotAnalysisPayload,
  holdingsCount: number,
): boolean {
  if (holdingsCount <= 0) return true;
  const n = analysis.portfolioAudit.length;
  // Aspoň polovica pozícií (pri veľkom PTF), inak považuj za orezané.
  const minNeeded = Math.min(holdingsCount, Math.max(3, Math.ceil(holdingsCount * 0.6)));
  return n >= minNeeded;
}

export async function runClaudeAiBotAnalysis(
  ctx: AiBotRunContext,
): Promise<AiBotAnalysisPayload> {
  const userPayload = sanitizeContext(ctx);
  const holdingsCount = userPayload.holdings.length;
  let lastText = "";

  try {
    // Viac tokenov — plnší audit pozícií (hlavne „Všetky portfóliá“).
    lastText = await callClaude(buildPrompt(userPayload, false), 12288);
    let analysis: AiBotAnalysisPayload | null = null;
    try {
      analysis = normalizeAnalysis(extractJsonObject(lastText), ctx.sourcesUsed);
    } catch {
      /* retry */
    }

    if (!analysis) {
      lastText = await callClaude(buildPrompt(userPayload, true), 8192);
      try {
        analysis = normalizeAnalysis(extractJsonObject(lastText), ctx.sourcesUsed);
      } catch {
        /* fallback */
      }
    }

    if (!analysis) {
      console.warn(
        "[ai-bot] JSON parse failed after retry, using loose fallback. Preview:",
        lastText.slice(0, 400),
      );
      return looseFallbackFromContext(ctx, lastText, ctx.sourcesUsed);
    }

    // Ak chýba audit pozícií (často orezanie pri veľkom PTF) — druhý pass len na audit.
    if (!auditCoverageOk(analysis, holdingsCount)) {
      console.warn(
        `[ai-bot] thin portfolioAudit (${analysis.portfolioAudit.length}/${holdingsCount}), running audit-only pass`,
      );
      try {
        const auditText = await callClaude(buildAuditOnlyPrompt(userPayload), 8192);
        const auditRaw = extractJsonObject(auditText) as any;
        const patched = normalizeAnalysis(
          { ...analysis, portfolioAudit: auditRaw?.portfolioAudit ?? auditRaw },
          ctx.sourcesUsed,
        );
        if (patched.portfolioAudit.length > analysis.portfolioAudit.length) {
          analysis = {
            ...analysis,
            portfolioAudit: patched.portfolioAudit,
            model: analysis.model,
            sourcesUsed: analysis.sourcesUsed,
          };
        }
      } catch (err) {
        console.warn("[ai-bot] audit-only pass failed:", err);
      }
    }

    return analysis;
  } catch (err) {
    if (err instanceof Error && err.message === "AI_JSON_PARSE") {
      return looseFallbackFromContext(ctx, lastText, ctx.sourcesUsed);
    }
    console.error("[ai-bot] Claude error:", err);
    throw new Error(formatAnthropicError(err));
  }
}

export { MODEL as AI_BOT_MODEL };
