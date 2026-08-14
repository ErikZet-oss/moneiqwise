import type { Transaction } from "./schema";

/** Stĺpec `realizedGain` pod touto hranicou (v mene obchodu) považujeme za FIFO/prepočet šum — close-trade má prednosť. */
export const INSIGNIFICANT_STORED_REALIZED_GAIN = 0.01;

/** Pod touto hranicou v abs. hodnote nikdy neblokujeme XTB close-trade párovanie. */
export const MIN_AUTHORITATIVE_STORED_REALIZED_GAIN = 1;

export function hasAuthoritativeStoredRealizedGain(
  sell: Pick<Transaction, "realizedGain">,
  closeTradeEur?: number,
): boolean {
  const rg = parseFloat(String(sell.realizedGain ?? "0"));
  if (!Number.isFinite(rg) || Math.abs(rg) < INSIGNIFICANT_STORED_REALIZED_GAIN) {
    return false;
  }
  if (
    closeTradeEur != null &&
    Number.isFinite(closeTradeEur) &&
    Math.abs(closeTradeEur) > 1 &&
    Math.abs(rg) < Math.abs(closeTradeEur) * 0.15
  ) {
    return false;
  }
  return Math.abs(rg) >= MIN_AUTHORITATIVE_STORED_REALIZED_GAIN;
}

export function shouldPreferCloseTradeGain(
  sell: Pick<Transaction, "realizedGain">,
  closeTradeEur: number,
): boolean {
  if (!Number.isFinite(closeTradeEur) || Math.abs(closeTradeEur) < 1e-6) return false;
  return !hasAuthoritativeStoredRealizedGain(sell, closeTradeEur);
}

/** Rovnaká detekcia ako História: hotovosť z uzavretia pozície (XTB import). */
export function isCloseTradeCashRow(tx: Transaction): boolean {
  if (tx.type !== "DEPOSIT" && tx.type !== "WITHDRAWAL") return false;
  const label = String(tx.companyName || "").toLowerCase();
  return label.includes("close trade") || label.includes("profit of position");
}

function cashLineAbsEur(
  t: Pick<Transaction, "baseCurrencyAmount" | "shares" | "pricePerShare">,
): number {
  const baseEur = parseFloat(String(t.baseCurrencyAmount ?? "NaN"));
  if (Number.isFinite(baseEur) && Math.abs(baseEur) > 1e-9) return Math.abs(baseEur);
  const shares = parseFloat(String(t.shares ?? "NaN"));
  const price = parseFloat(String(t.pricePerShare ?? "NaN"));
  if (Number.isFinite(shares) && Number.isFinite(price)) return Math.abs(shares * price);
  return 0;
}

/**
 * XTB cash pri predaji:
 * - **Cost-return**: Stock sale = vrátenie nákupu, close trade = P/L (sale+|close|≈trh) → close nechať.
 * - **Market proceeds**: Stock sale už = trh, close trade znova P/L → close **vynechať** (inak +P/L naviac).
 */
export function closeTradeIdsDuplicatingMarketSellProceeds(
  transactions: Transaction[],
): Set<string> {
  const exclude = new Set<string>();
  const sells = transactions.filter((t) => String(t.type ?? "").trim().toUpperCase() === "SELL");
  const closes = transactions.filter((t) => isCloseTradeCashRow(t));
  if (sells.length === 0 || closes.length === 0) return exclude;

  const usedClose = new Set<string>();
  const maxDiffMs = 60 * 60 * 1000;

  for (const sell of sells) {
    const sellTs = new Date(sell.transactionDate as unknown as string).getTime();
    if (!Number.isFinite(sellTs)) continue;
    let best: Transaction | null = null;
    let bestDiff = Infinity;
    for (const c of closes) {
      if (usedClose.has(c.id)) continue;
      const cashTs = new Date(c.transactionDate as unknown as string).getTime();
      if (!Number.isFinite(cashTs)) continue;
      const diff = Math.abs(cashTs - sellTs);
      if (diff > maxDiffMs) continue;
      if (diff < bestDiff) {
        bestDiff = diff;
        best = c;
      }
    }
    if (!best) continue;
    usedClose.add(best.id);

    const saleEur = cashLineAbsEur(sell);
    const ctEur = cashLineAbsEur(best);
    if (!(saleEur > 0) || !(ctEur > 0)) continue;

    const sh = Math.abs(parseFloat(String(sell.shares ?? "0")));
    const inst = parseFloat(
      String((sell as { instrumentPricePerShare?: string | null }).instrumentPricePerShare ?? "NaN"),
    );
    const ex = parseFloat(String(sell.exchangeRateAtTransaction ?? "NaN"));
    const px = parseFloat(String(sell.pricePerShare ?? "NaN"));

    let marketEur: number | null = null;
    if (sh > 0 && Number.isFinite(inst) && inst > 0) {
      if (Number.isFinite(ex) && ex > 0 && Math.abs(ex - 1) > 1e-6) {
        marketEur = sh * inst * ex;
      } else if (Number.isFinite(px) && px > 0 && Math.abs(px - inst) / inst > 0.05) {
        // EUR účet: Amount/ks (px) je v EUR, @cena (inst) v USD/GBP — market z close+sale.
        marketEur = saleEur + ctEur;
      } else {
        marketEur = sh * inst;
      }
    }

    if (marketEur != null && marketEur > 1) {
      const proceedsErr = Math.abs(saleEur - marketEur) / marketEur;
      const costReturnErr = Math.abs(saleEur + ctEur - marketEur) / marketEur;
      if (proceedsErr < 0.04 && costReturnErr > 0.08) {
        exclude.add(best.id);
      }
      continue;
    }

    // Bez spoľahlivého marketEur: rovnaká „cena/ks“ ako instrument ≈ predaj v trhovej cene.
    if (Number.isFinite(px) && Number.isFinite(inst) && inst > 0 && Math.abs(px - inst) / inst < 0.03) {
      exclude.add(best.id);
    }
  }

  return exclude;
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
    if (hasAuthoritativeStoredRealizedGain(sell)) continue;

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
