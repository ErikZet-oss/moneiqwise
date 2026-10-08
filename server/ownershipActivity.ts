/**
 * Insider / institutional purchase activity pre detail aktíva (Yahoo quoteSummary).
 */
import YahooFinance from "yahoo-finance2";
import { toYahooTicker } from "./yahooTicker";

export type OwnershipActivityKind = "INSIDER" | "INSTITUTION";

export type OwnershipActivityItem = {
  id: string;
  date: string | null;
  actorName: string;
  shares: number | null;
  value: number | null;
  kind: OwnershipActivityKind;
  action: "BUY" | "SELL";
  note: string | null;
};

export type OwnershipActivityPayload = {
  ticker: string;
  currency: string | null;
  items: OwnershipActivityItem[];
  source: "yahoo" | null;
};

type CacheEntry = { t: number; v: OwnershipActivityPayload };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;

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

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
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

function classifyInsiderTransaction(text: string | null): "buy" | "sell" | "unknown" {
  const s = (text ?? "").toLowerCase();
  if (!s) return "unknown";
  if (/(sale|sold|dispose|disposition)/i.test(s)) return "sell";
  if (/(purchase|buy|bought|acquir|acquisition|exercise)/i.test(s)) return "buy";
  return "unknown";
}

function emptyPayload(ticker: string): OwnershipActivityPayload {
  return {
    ticker,
    currency: null,
    items: [],
    source: null,
  };
}

function toShortNote(parts: Array<string | null>): string | null {
  const s = parts
    .filter((p): p is string => !!p)
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" · ");
  if (!s) return null;
  return s.length > 140 ? `${s.slice(0, 137)}...` : s;
}

type OwnershipActivityFetchOptions = {
  includeInsiderSells?: boolean;
  includeInstitutionDecreases?: boolean;
  maxItems?: number;
};

export async function fetchOwnershipActivityForAsset(
  ticker: string,
  options?: OwnershipActivityFetchOptions,
): Promise<OwnershipActivityPayload> {
  const key = ticker.trim().toUpperCase();
  if (!key || key === "CASH") return emptyPayload(ticker);

  const includeInsiderSells = options?.includeInsiderSells === true;
  const includeInstitutionDecreases = options?.includeInstitutionDecreases === true;
  const maxItems = Math.max(1, Math.min(200, options?.maxItems ?? 60));
  const cacheKey = `${key}|iSell:${includeInsiderSells ? 1 : 0}|instDec:${includeInstitutionDecreases ? 1 : 0}|max:${maxItems}`;

  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.t < CACHE_TTL_MS) return cached.v;

  const yahooTicker = toYahooTicker(key);
  try {
    const result = await getYahooFinance().quoteSummary(yahooTicker, {
      modules: ["price", "insiderTransactions", "institutionOwnership", "fundOwnership"],
    });

    const items: OwnershipActivityItem[] = [];
    let seq = 0;

    const insiderRows =
      (result.insiderTransactions as { transactions?: Array<Record<string, unknown>> } | undefined)
        ?.transactions ?? [];
    for (const row of insiderRows.slice(0, 80)) {
      const transactionText = str(row.transactionText);
      const txKind = classifyInsiderTransaction(transactionText);
      if (txKind === "unknown") continue;
      if (txKind === "sell" && !includeInsiderSells) continue;
      items.push({
        id: `insider-${key}-${seq++}`,
        date: isoDateFromUnknown(row.startDate),
        actorName: str(row.filerName) ?? "Neznámy insider",
        shares: num(row.shares),
        value: num(row.value),
        kind: "INSIDER",
        action: txKind === "sell" ? "SELL" : "BUY",
        note: toShortNote([str(row.filerRelation), transactionText]),
      });
    }

    const pushInstitutionRows = (
      rows: Array<Record<string, unknown>> | undefined,
      label: string,
    ) => {
      for (const row of (rows ?? []).slice(0, 120)) {
        const pctChange = num(row.pctChange);
        if (pctChange == null) continue;
        if (pctChange > 0) {
          items.push({
            id: `inst-${key}-${seq++}`,
            date: isoDateFromUnknown(row.reportDate),
            actorName: str(row.organization) ?? str(row.name) ?? "Neznáma inštitúcia",
            shares: num(row.position),
            value: num(row.value),
            kind: "INSTITUTION",
            action: "BUY",
            note: toShortNote([label, `Zmena podielu +${(pctChange * 100).toFixed(2)}%`]),
          });
          continue;
        }
        if (!includeInstitutionDecreases) continue;
        items.push({
          id: `inst-${key}-${seq++}`,
          date: isoDateFromUnknown(row.reportDate),
          actorName: str(row.organization) ?? str(row.name) ?? "Neznáma inštitúcia",
          shares: num(row.position),
          value: num(row.value),
          kind: "INSTITUTION",
          action: "SELL",
          note: toShortNote([label, `Zmena podielu ${(pctChange * 100).toFixed(2)}%`]),
        });
      }
    };

    pushInstitutionRows(
      (result.institutionOwnership as { ownershipList?: Array<Record<string, unknown>> } | undefined)
        ?.ownershipList,
      "Inštitúcia",
    );
    pushInstitutionRows(
      (result.fundOwnership as { ownershipList?: Array<Record<string, unknown>> } | undefined)
        ?.ownershipList,
      "Fond",
    );

    items.sort((a, b) => {
      const ta = a.date ? Date.parse(a.date) : -Infinity;
      const tb = b.date ? Date.parse(b.date) : -Infinity;
      if (tb !== ta) return tb - ta;
      const vb = b.value ?? -Infinity;
      const va = a.value ?? -Infinity;
      return vb - va;
    });

    const priceMod = (result.price ?? {}) as Record<string, unknown>;
    const payload: OwnershipActivityPayload = {
      ticker: key,
      currency: str(priceMod.currency),
      items: items.slice(0, maxItems),
      source: "yahoo",
    };
    cache.set(cacheKey, { t: Date.now(), v: payload });
    return payload;
  } catch (err) {
    console.warn(`[ownershipActivity] Yahoo failed for ${key}:`, err);
    const empty = emptyPayload(key);
    cache.set(cacheKey, { t: Date.now(), v: empty });
    return empty;
  }
}
