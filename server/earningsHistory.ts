/**
 * História earnings podľa rokov / kvartálov (Asset detail).
 * Zdroje: Finnhub → Alpha Vantage → Yahoo quoteSummary.
 */
import YahooFinance from "yahoo-finance2";
import { toYahooTicker } from "./yahooTicker";

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || "";
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY || "";

export type EarningsQuarterRow = {
  year: number;
  quarter: number;
  periodEnd: string | null;
  label: string;
  epsActual: number | null;
  epsEstimate: number | null;
  epsSurprise: number | null;
  epsSurprisePercent: number | null;
  revenue: number | null;
  netIncome: number | null;
  reportedDate: string | null;
};

export type EarningsYearGroup = {
  year: number;
  revenue: number | null;
  netIncome: number | null;
  profitMargin: number | null;
  quarters: EarningsQuarterRow[];
};

export type EarningsHistoryPayload = {
  ticker: string;
  currency: string | null;
  source: "finnhub" | "alphavantage" | "yahoo" | null;
  years: EarningsYearGroup[];
};

type CacheEntry = { t: number; v: EarningsHistoryPayload };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let yahooFinance: InstanceType<typeof YahooFinance> | null = null;

function getYahooFinance(): InstanceType<typeof YahooFinance> {
  if (!yahooFinance) {
    yahooFinance = new YahooFinance({
      suppressNotices: ["yahooSurvey"],
    });
  }
  return yahooFinance;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "object" && v !== null && "raw" in v) {
    return num((v as { raw: unknown }).raw);
  }
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoDateFromUnknown(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date && Number.isFinite(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  }
  if (typeof v === "object" && v !== null && "raw" in v) {
    return isoDateFromUnknown((v as { raw: unknown }).raw);
  }
  return null;
}

/** Finnhub / Alpha často chcú US symbol bez prípony. */
function toUsStyleSymbol(ticker: string): string {
  const upper = ticker.trim().toUpperCase();
  if (upper.endsWith(".US")) return upper.slice(0, -3);
  return upper;
}

function quarterFromPeriodEnd(iso: string | null): { year: number; quarter: number } | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  const quarter = Math.ceil(m / 3);
  return { year: y, quarter };
}

/** "3Q2025" / "Q3 2025" / "2025Q3" */
function parseQuarterLabel(raw: string): { year: number; quarter: number } | null {
  const s = raw.trim();
  let m = s.match(/^(\d)Q(\d{4})$/i);
  if (m) return { quarter: Number(m[1]), year: Number(m[2]) };
  m = s.match(/^Q(\d)\s*(\d{4})$/i);
  if (m) return { quarter: Number(m[1]), year: Number(m[2]) };
  m = s.match(/^(\d{4})Q(\d)$/i);
  if (m) return { year: Number(m[1]), quarter: Number(m[2]) };
  return null;
}

function emptyPayload(ticker: string): EarningsHistoryPayload {
  return { ticker, currency: null, source: null, years: [] };
}

function groupYears(
  quarters: EarningsQuarterRow[],
  yearly: Array<{ year: number; revenue: number | null; netIncome: number | null; profitMargin: number | null }>,
  currency: string | null,
  source: EarningsHistoryPayload["source"],
  ticker: string,
): EarningsHistoryPayload {
  const byYear = new Map<number, EarningsYearGroup>();

  for (const y of yearly) {
    byYear.set(y.year, {
      year: y.year,
      revenue: y.revenue,
      netIncome: y.netIncome,
      profitMargin: y.profitMargin,
      quarters: [],
    });
  }

  for (const q of quarters) {
    let g = byYear.get(q.year);
    if (!g) {
      g = { year: q.year, revenue: null, netIncome: null, profitMargin: null, quarters: [] };
      byYear.set(q.year, g);
    }
    g.quarters.push(q);
  }

  const years = Array.from(byYear.values())
    .map((g) => ({
      ...g,
      quarters: g.quarters.sort((a, b) => b.quarter - a.quarter),
    }))
    .sort((a, b) => b.year - a.year);

  return { ticker, currency, source, years };
}

async function tryFinnhub(ticker: string): Promise<EarningsHistoryPayload | null> {
  if (!FINNHUB_API_KEY) return null;
  const symbol = toUsStyleSymbol(ticker);
  try {
    const url =
      `https://finnhub.io/api/v1/stock/earnings?symbol=${encodeURIComponent(symbol)}` +
      `&limit=40&token=${FINNHUB_API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const quarters: EarningsQuarterRow[] = [];
    for (const row of rows) {
      const year = num(row?.year);
      const quarter = num(row?.quarter);
      if (year == null || quarter == null || quarter < 1 || quarter > 4) continue;
      const periodEnd = typeof row?.period === "string" ? row.period.slice(0, 10) : null;
      const epsActual = num(row?.actual);
      const epsEstimate = num(row?.estimate);
      const epsSurprise = num(row?.surprise);
      let epsSurprisePercent = num(row?.surprisePercent);
      // Finnhub often returns surprise % as already percent (e.g. 4.5); keep as-is if |x| > 1
      if (epsSurprisePercent != null && Math.abs(epsSurprisePercent) <= 1 && epsEstimate) {
        epsSurprisePercent = epsSurprisePercent * 100;
      }
      quarters.push({
        year: Math.trunc(year),
        quarter: Math.trunc(quarter),
        periodEnd,
        label: `Q${Math.trunc(quarter)} ${Math.trunc(year)}`,
        epsActual,
        epsEstimate,
        epsSurprise,
        epsSurprisePercent,
        revenue: null,
        netIncome: null,
        reportedDate: null,
      });
    }
    if (quarters.length === 0) return null;
    return groupYears(quarters, [], null, "finnhub", ticker);
  } catch {
    return null;
  }
}

async function tryAlphaVantage(ticker: string): Promise<EarningsHistoryPayload | null> {
  if (!ALPHA_VANTAGE_API_KEY) return null;
  const symbol = toUsStyleSymbol(ticker);
  // Alpha je spoľahlivá hlavne pre US tickery bez burzovej prípony
  if (symbol.includes(".")) return null;
  try {
    const url =
      `https://www.alphavantage.co/query?function=EARNINGS&symbol=${encodeURIComponent(symbol)}` +
      `&apikey=${ALPHA_VANTAGE_API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    const quarterly = data?.quarterlyEarnings;
    if (!Array.isArray(quarterly) || quarterly.length === 0) return null;

    const quarters: EarningsQuarterRow[] = [];
    for (const row of quarterly.slice(0, 40)) {
      const periodEnd = typeof row?.fiscalDateEnding === "string" ? row.fiscalDateEnding.slice(0, 10) : null;
      const yq = quarterFromPeriodEnd(periodEnd);
      if (!yq) continue;
      const epsActual = num(row?.reportedEPS);
      const epsEstimate = num(row?.estimatedEPS);
      const epsSurprise = num(row?.surprise);
      const epsSurprisePercent = num(row?.surprisePercentage);
      const reportedDate =
        typeof row?.reportedDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(row.reportedDate)
          ? row.reportedDate.slice(0, 10)
          : null;
      quarters.push({
        year: yq.year,
        quarter: yq.quarter,
        periodEnd,
        label: `Q${yq.quarter} ${yq.year}`,
        epsActual,
        epsEstimate,
        epsSurprise,
        epsSurprisePercent,
        revenue: null,
        netIncome: null,
        reportedDate,
      });
    }
    if (quarters.length === 0) return null;
    return groupYears(quarters, [], null, "alphavantage", ticker);
  } catch {
    return null;
  }
}

async function tryYahoo(ticker: string): Promise<EarningsHistoryPayload | null> {
  try {
    const yahooTicker = toYahooTicker(ticker);
    const yf = getYahooFinance();
    const result = await yf.quoteSummary(yahooTicker, {
      modules: ["earnings", "earningsHistory"],
    });

    const earnings = result.earnings as Record<string, unknown> | undefined;
    const historyMod = result.earningsHistory as { history?: Array<Record<string, unknown>> } | undefined;
    const currency =
      (typeof earnings?.financialCurrency === "string" ? earnings.financialCurrency : null) ||
      (historyMod?.history?.[0] && typeof historyMod.history[0].currency === "string"
        ? String(historyMod.history[0].currency)
        : null);

    const chart = earnings?.earningsChart as
      | {
          quarterly?: Array<Record<string, unknown>>;
        }
      | undefined;
    const financials = earnings?.financialsChart as
      | {
          yearly?: Array<Record<string, unknown>>;
          quarterly?: Array<Record<string, unknown>>;
        }
      | undefined;

    const yearly = (financials?.yearly ?? [])
      .map((row) => {
        const year = num(row.date);
        if (year == null) return null;
        return {
          year: Math.trunc(year),
          revenue: num(row.revenue),
          netIncome: num(row.earnings),
          profitMargin: num(row.profitMargin),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    const revenueByLabel = new Map<string, { revenue: number | null; netIncome: number | null }>();
    for (const row of financials?.quarterly ?? []) {
      const dateLabel = typeof row.date === "string" ? row.date : "";
      const parsed = parseQuarterLabel(dateLabel);
      if (!parsed) continue;
      revenueByLabel.set(`Q${parsed.quarter} ${parsed.year}`, {
        revenue: num(row.revenue),
        netIncome: num(row.earnings),
      });
    }

    const byKey = new Map<string, EarningsQuarterRow>();

    const upsert = (partial: EarningsQuarterRow) => {
      const key = `${partial.year}-Q${partial.quarter}`;
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, partial);
        return;
      }
      byKey.set(key, {
        ...prev,
        periodEnd: prev.periodEnd ?? partial.periodEnd,
        epsActual: prev.epsActual ?? partial.epsActual,
        epsEstimate: prev.epsEstimate ?? partial.epsEstimate,
        epsSurprise: prev.epsSurprise ?? partial.epsSurprise,
        epsSurprisePercent: prev.epsSurprisePercent ?? partial.epsSurprisePercent,
        revenue: prev.revenue ?? partial.revenue,
        netIncome: prev.netIncome ?? partial.netIncome,
        reportedDate: prev.reportedDate ?? partial.reportedDate,
      });
    };

    for (const row of historyMod?.history ?? []) {
      const periodEnd = isoDateFromUnknown(row.quarter);
      const yq = quarterFromPeriodEnd(periodEnd);
      if (!yq) continue;
      const epsActual = num(row.epsActual);
      const epsEstimate = num(row.epsEstimate);
      const epsSurprise = num(row.epsDifference);
      let surprisePct = num(row.surprisePercent);
      if (surprisePct != null && Math.abs(surprisePct) <= 1) surprisePct *= 100;
      const label = `Q${yq.quarter} ${yq.year}`;
      const fin = revenueByLabel.get(label);
      upsert({
        year: yq.year,
        quarter: yq.quarter,
        periodEnd,
        label,
        epsActual,
        epsEstimate,
        epsSurprise,
        epsSurprisePercent: surprisePct,
        revenue: fin?.revenue ?? null,
        netIncome: fin?.netIncome ?? null,
        reportedDate: null,
      });
    }

    for (const row of chart?.quarterly ?? []) {
      const dateLabel = typeof row.date === "string" ? row.date : String(row.calendarQuarter ?? "");
      const parsed = parseQuarterLabel(dateLabel) ?? parseQuarterLabel(String(row.fiscalQuarter ?? ""));
      if (!parsed) continue;
      const label = `Q${parsed.quarter} ${parsed.year}`;
      const fin = revenueByLabel.get(label);
      let surprisePct = num(row.surprisePct);
      if (surprisePct == null) {
        const diff = num(row.difference);
        const est = num(row.estimate);
        if (diff != null && est != null && est !== 0) surprisePct = (diff / Math.abs(est)) * 100;
      }
      const epsActual = num(row.actual);
      const epsEstimate = num(row.estimate);
      const epsSurprise =
        num(row.difference) ??
        (epsActual != null && epsEstimate != null ? epsActual - epsEstimate : null);
      upsert({
        year: parsed.year,
        quarter: parsed.quarter,
        periodEnd: isoDateFromUnknown(row.periodEndDate),
        label,
        epsActual,
        epsEstimate,
        epsSurprise,
        epsSurprisePercent: surprisePct,
        revenue: fin?.revenue ?? null,
        netIncome: fin?.netIncome ?? null,
        reportedDate: isoDateFromUnknown(row.reportedDate),
      });
    }

    // Kvartálne finančné bez EPS (staršie obdobia v financialsChart)
    for (const [label, fin] of Array.from(revenueByLabel.entries())) {
      const m = label.match(/^Q(\d)\s+(\d{4})$/);
      const parsed = m ? { quarter: Number(m[1]), year: Number(m[2]) } : null;
      if (!parsed) continue;
      const qKey = `${parsed.year}-Q${parsed.quarter}`;
      if (byKey.has(qKey)) continue;
      upsert({
        year: parsed.year,
        quarter: parsed.quarter,
        periodEnd: null,
        label,
        epsActual: null,
        epsEstimate: null,
        epsSurprise: null,
        epsSurprisePercent: null,
        revenue: fin.revenue,
        netIncome: fin.netIncome,
        reportedDate: null,
      });
    }

    const quarters = Array.from(byKey.values());
    if (quarters.length === 0 && yearly.length === 0) return null;
    return groupYears(quarters, yearly, currency, "yahoo", ticker);
  } catch {
    return null;
  }
}

export async function fetchEarningsHistoryForAsset(ticker: string): Promise<EarningsHistoryPayload> {
  const key = ticker.trim().toUpperCase();
  if (!key || key === "CASH") return emptyPayload(key || ticker);

  const cached = cache.get(key);
  if (cached && Date.now() - cached.t < CACHE_TTL_MS) {
    return cached.v;
  }

  let v =
    (await tryFinnhub(key)) ||
    (await tryAlphaVantage(key)) ||
    (await tryYahoo(key)) ||
    emptyPayload(key);

  // Doplň ročné súhrny z Yahoo, ak Finnhub/Alpha dali len kvartály
  if (v.source && v.source !== "yahoo" && v.years.every((y) => y.revenue == null)) {
    const yahoo = await tryYahoo(key);
    if (yahoo && yahoo.years.length > 0) {
      const yearlyByYear = new Map(yahoo.years.map((y) => [y.year, y]));
      v = {
        ...v,
        currency: v.currency ?? yahoo.currency,
        years: v.years.map((y) => {
          const yy = yearlyByYear.get(y.year);
          if (!yy) return y;
          return {
            ...y,
            revenue: y.revenue ?? yy.revenue,
            netIncome: y.netIncome ?? yy.netIncome,
            profitMargin: y.profitMargin ?? yy.profitMargin,
            quarters: y.quarters.map((q) => {
              const match = yy.quarters.find((qq) => qq.quarter === q.quarter);
              if (!match) return q;
              return {
                ...q,
                revenue: q.revenue ?? match.revenue,
                netIncome: q.netIncome ?? match.netIncome,
              };
            }),
          };
        }),
      };
      // roky len z Yahoo (bez kvartálov) pridaj, ak chýbajú
      for (const yy of yahoo.years) {
        if (!v.years.some((y) => y.year === yy.year)) {
          v.years.push({
            year: yy.year,
            revenue: yy.revenue,
            netIncome: yy.netIncome,
            profitMargin: yy.profitMargin,
            quarters: [],
          });
        }
      }
      v.years.sort((a, b) => b.year - a.year);
    }
  }

  cache.set(key, { t: Date.now(), v });
  return v;
}
