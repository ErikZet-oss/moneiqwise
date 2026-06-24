import type { Transaction } from "./schema";

/** Rovnaká detekcia ako História: hotovosť z uzavretia pozície (XTB import). */
export function isCloseTradeCashRow(tx: Transaction): boolean {
  if (tx.type !== "DEPOSIT" && tx.type !== "WITHDRAWAL") return false;
  const label = String(tx.companyName || "").toLowerCase();
  return label.includes("close trade") || label.includes("profit of position");
}

export type CloseTradeFallbackPairing = {
  bySellId: Map<string, number>;
  pairedCloseTradeIds: Set<string>;
};

/**
 * SELL bez vyplneného realizedGain ↔ close trade cash (okno 60 min + záloha ten istý deň).
 * Hodnota je v EUR z `baseCurrencyAmount` alebo shares×price.
 */
export function buildCloseTradeFallbackPairing(transactions: Transaction[]): CloseTradeFallbackPairing {
  const sells = transactions
    .filter((t) => String(t.type ?? "").trim().toUpperCase() === "SELL")
    .sort(
      (a, b) =>
        new Date(a.transactionDate as unknown as string).getTime() -
        new Date(b.transactionDate as unknown as string).getTime(),
    );
  const closeCashRows = transactions
    .filter((t) => isCloseTradeCashRow(t))
    .sort(
      (a, b) =>
        new Date(a.transactionDate as unknown as string).getTime() -
        new Date(b.transactionDate as unknown as string).getTime(),
    );

  const usedCloseIds = new Set<string>();
  const bySellId = new Map<string, number>();
  const maxDiffMs = 60 * 60 * 1000;
  const minuteMs = 60 * 1000;
  const toMinuteKey = (ts: number) => Math.floor(ts / minuteMs);
  const closeByMinute = new Map<number, Transaction[]>();

  for (const c of closeCashRows) {
    const ts = new Date(c.transactionDate as unknown as string).getTime();
    if (!Number.isFinite(ts)) continue;
    const key = toMinuteKey(ts);
    const arr = closeByMinute.get(key) ?? [];
    arr.push(c);
    closeByMinute.set(key, arr);
  }

  for (const sell of sells) {
    const sellRg = parseFloat(String(sell.realizedGain ?? "0"));
    if (Number.isFinite(sellRg) && Math.abs(sellRg) > 1e-9) continue;

    const sellTs = new Date(sell.transactionDate as unknown as string).getTime();
    if (!Number.isFinite(sellTs)) continue;

    let best: { tx: Transaction; diff: number } | null = null;
    const sellMinute = toMinuteKey(sellTs);
    for (let delta = -5; delta <= 5; delta++) {
      const bucket = closeByMinute.get(sellMinute + delta);
      if (!bucket || bucket.length === 0) continue;
      for (const cashTx of bucket) {
        if (usedCloseIds.has(cashTx.id)) continue;
        const cashTs = new Date(cashTx.transactionDate as unknown as string).getTime();
        if (!Number.isFinite(cashTs)) continue;
        const diff = Math.abs(cashTs - sellTs);
        if (diff > maxDiffMs) continue;
        if (!best || diff < best.diff) best = { tx: cashTx, diff };
      }
    }
    if (!best) continue;

    usedCloseIds.add(best.tx.id);
    const baseEur = parseFloat(String(best.tx.baseCurrencyAmount ?? "NaN"));
    const shares = parseFloat(String(best.tx.shares ?? "NaN"));
    const price = parseFloat(String(best.tx.pricePerShare ?? "NaN"));
    const amtEur = Number.isFinite(baseEur)
      ? baseEur
      : Number.isFinite(shares) && Number.isFinite(price)
        ? shares * price
        : NaN;
    if (!Number.isFinite(amtEur) || Math.abs(amtEur) <= 1e-9) continue;
    bySellId.set(sell.id, amtEur);
  }

  // Záloha: ten istý kalendárny deň (XTB export môže mať predaj a close trade hodiny od seba).
  const isoDay = (ts: number) => new Date(ts).toISOString().slice(0, 10);
  const unmatchedSells = sells.filter((s) => !bySellId.has(s.id));
  const unmatchedClose = closeCashRows.filter((c) => !usedCloseIds.has(c.id));
  if (unmatchedSells.length === 1 && unmatchedClose.length === 1) {
    const sell = unmatchedSells[0]!;
    const cashTx = unmatchedClose[0]!;
    const sellTs = new Date(sell.transactionDate as unknown as string).getTime();
    const cashTs = new Date(cashTx.transactionDate as unknown as string).getTime();
    if (Number.isFinite(sellTs) && Number.isFinite(cashTs) && isoDay(sellTs) === isoDay(cashTs)) {
      const baseEur = parseFloat(String(cashTx.baseCurrencyAmount ?? "NaN"));
      const shares = parseFloat(String(cashTx.shares ?? "NaN"));
      const price = parseFloat(String(cashTx.pricePerShare ?? "NaN"));
      const amtEur = Number.isFinite(baseEur)
        ? baseEur
        : Number.isFinite(shares) && Number.isFinite(price)
          ? shares * price
          : NaN;
      if (Number.isFinite(amtEur) && Math.abs(amtEur) > 1e-9) {
        usedCloseIds.add(cashTx.id);
        bySellId.set(sell.id, amtEur);
      }
    }
  }

  return { bySellId, pairedCloseTradeIds: usedCloseIds };
}

/** @deprecated Prefer `buildCloseTradeFallbackPairing` when you need paired close-trade row ids. */
export function buildCloseTradeFallbackEurBySellId(transactions: Transaction[]): Map<string, number> {
  return buildCloseTradeFallbackPairing(transactions).bySellId;
}
