import type { Transaction } from "@shared/schema";
import { exchangeRatesEcb } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { inferTradeCurrency } from "@shared/transactionEur";
import { buySellLineEur } from "@shared/transactionEur";

const frankCache = new Map<string, { eurPerUnit: number; t: number }>();
const FRANK_TTL = 6 * 60 * 60 * 1000;

/**
 * Vráti EUR **za 1 jednotku** cudzej meny (USD atď.) v dátume ECB (Frankfurter).
 * Base = EUR, API: GET /{date} → `rates.USD` = 1 EUR = `rates.USD` USD, teda
 * 1 USD = 1/rates.USD EUR.
 *
 * Postup: pamäť → `exchange_rates` (DB) → API → uloženie do DB.
 */
export async function eurPerOneUnit(
  ccy: string,
  isoDate: string,
): Promise<number | null> {
  if (ccy === "EUR") return 1;
  const c = ccy.toUpperCase();
  const key = `${isoDate}|${c}`;
  const hit = frankCache.get(key);
  if (hit && Date.now() - hit.t < FRANK_TTL) return hit.eurPerUnit;

  const fromDb = await eurPerOneUnitFromDb(c, isoDate);
  if (fromDb != null) {
    frankCache.set(key, { eurPerUnit: fromDb, t: Date.now() });
    return fromDb;
  }

  try {
    const res = await fetch(`https://api.frankfurter.app/${isoDate}`);
    if (!res.ok) return null;
    const j = (await res.json()) as { rates?: Record<string, number> };
    const r = j.rates;
    if (!r || typeof r[c] !== "number" || r[c] <= 0) return null;
    const eur = 1 / r[c];
    await persistEcbRate(isoDate, c, eur);
    frankCache.set(key, { eurPerUnit: eur, t: Date.now() });
    return eur;
  } catch {
    return null;
  }
}

async function eurPerOneUnitFromDb(ccy: string, isoDate: string): Promise<number | null> {
  const c = ccy.toUpperCase();
  const [row] = await db
    .select()
    .from(exchangeRatesEcb)
    .where(
      and(eq(exchangeRatesEcb.isoDate, isoDate), eq(exchangeRatesEcb.currency, c)),
    )
    .limit(1);
  if (!row) return null;
  const n = parseFloat(String(row.eurPerUnit));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function persistEcbRate(
  isoDate: string,
  currency: string,
  eurPerUnit: number,
): Promise<void> {
  try {
    await db
      .insert(exchangeRatesEcb)
      .values({
        isoDate,
        currency: currency.toUpperCase(),
        eurPerUnit: String(eurPerUnit),
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [exchangeRatesEcb.isoDate, exchangeRatesEcb.currency],
        set: { eurPerUnit: String(eurPerUnit), fetchedAt: new Date() },
      });
  } catch (err) {
    console.warn("eurAtTransactionDate: could not cache ECB rate in DB:", err);
  }
}

function txnIsoDate(t: Transaction): string {
  const d = new Date(t.transactionDate as unknown as string);
  return d.toISOString().slice(0, 10);
}

function needsFrankfurtFallback(t: Transaction): boolean {
  if (t.type !== "BUY" && t.type !== "SELL") return false;
  const ccy = inferTradeCurrency(t);
  if (ccy === "EUR") return false;
  if (t.baseCurrencyAmount != null && String(t.baseCurrencyAmount).trim() !== "") {
    return false;
  }
  if (
    t.exchangeRateAtTransaction != null &&
    String(t.exchangeRateAtTransaction).trim() !== "" &&
    parseFloat(String(t.exchangeRateAtTransaction)) > 0
  ) {
    return false;
  }
  return true;
}

/**
 * Pre transakcie bez uloženého kurzu dopĺňa eur/1 jednotku danej meny z Frankfurter.
 */
export async function buildEurPerUnitByTxnIdForTransactions(
  txns: Transaction[],
): Promise<Map<string, number | null>> {
  const m = new Map<string, number | null>();
  const unique = new Map<string, { iso: string; ccy: string }>();
  for (const t of txns) {
    m.set(t.id, null);
    if (!needsFrankfurtFallback(t)) continue;
    const ccy = inferTradeCurrency(t);
    const iso = txnIsoDate(t);
    const k = `${iso}::${ccy}`;
    if (!unique.has(k)) unique.set(k, { iso, ccy });
  }
  const resolved = new Map<string, number | null>();
  for (const [k, v] of Array.from(unique.entries())) {
    resolved.set(k, await eurPerOneUnit(v.ccy, v.iso));
  }
  for (const t of txns) {
    if (!needsFrankfurtFallback(t)) continue;
    const ccy = inferTradeCurrency(t);
    const iso = txnIsoDate(t);
    const e = resolved.get(`${iso}::${ccy}`) ?? null;
    m.set(t.id, e);
  }
  return m;
}

export function transactionLineEurForDisplay(
  t: Transaction,
  m: Map<string, number | null>,
): { eur: number; fromFrankfurt: boolean } {
  const fb = m.get(t.id) ?? null;
  const { eur, source } = buySellLineEur(t, fb);
  return { eur, fromFrankfurt: source === "frankfurtFallback" };
}

export { needsFrankfurtFallback };
