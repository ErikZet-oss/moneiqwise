import { toYahooTicker } from "../yahooTicker";
import { storage } from "../storage";

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function yahooDailyCloses(
  ticker: string,
  range: "5d" | "1mo" = "1mo",
): Promise<Array<{ date: string; close: number }>> {
  const yahoo = toYahooTicker(ticker);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}` +
    `?interval=1d&range=${range}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as any;
  const result = data?.chart?.result?.[0];
  const ts: number[] = result?.timestamp || [];
  const closes: Array<number | null> =
    result?.indicators?.quote?.[0]?.close || [];
  const out: Array<{ date: string; close: number }> = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null || !Number.isFinite(c)) continue;
    out.push({
      date: new Date(ts[i]! * 1000).toISOString().slice(0, 10),
      close: Number(c),
    });
  }
  return out;
}

function pctChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return ((to - from) / from) * 100;
}

export type HoldingWeekMove = {
  ticker: string;
  weekChangePct: number | null;
  priceWeekAgo: number | null;
  priceNow: number | null;
  approxContributionEur: number | null;
};

export type AiChatPerformanceBlock = {
  source: "snapshots" | "holdings_yahoo" | "mixed" | "none";
  asOf: string;
  weekStartDate: string | null;
  weekEndDate: string | null;
  valueNowEur: number | null;
  valueWeekAgoEur: number | null;
  weekChangeEur: number | null;
  weekChangePct: number | null;
  investedNowEur: number | null;
  investedWeekAgoEur: number | null;
  note: string;
  topWeekGainers: HoldingWeekMove[];
  topWeekLosers: HoldingWeekMove[];
  holdingsWeekMoves: HoldingWeekMove[];
};

/**
 * Týždenná výkonnosť portfólia zo snapshotov + ~1W zmena cien holdingov (Yahoo).
 */
export async function buildAiChatPerformance(input: {
  userId: string;
  portfolioScope: string;
  holdings: Array<{
    ticker: string;
    marketValue: number | null;
    price: number | null;
    shares?: number;
  }>;
  totalMarketValue: number;
}): Promise<AiChatPerformanceBlock> {
  const today = new Date().toISOString().slice(0, 10);
  const startIso = addDaysIso(today, -10);
  const scopeKey =
    !input.portfolioScope || input.portfolioScope === "all"
      ? "all"
      : input.portfolioScope;

  let valueNowEur: number | null = null;
  let valueWeekAgoEur: number | null = null;
  let investedNowEur: number | null = null;
  let investedWeekAgoEur: number | null = null;
  let weekStartDate: string | null = null;
  let weekEndDate: string | null = null;
  let source: AiChatPerformanceBlock["source"] = "none";

  try {
    const rows = await storage.getPortfolioSnapshots(
      input.userId,
      scopeKey,
      startIso,
      today,
    );
    if (rows.length >= 2) {
      const latest = rows[rows.length - 1]!;
      // Cieľ: ~7 kalendárnych dní dozadu (alebo najstarší dostupný bod v okne).
      const target = addDaysIso(String(latest.date).slice(0, 10), -7);
      let weekAgo = rows[0]!;
      for (const r of rows) {
        if (String(r.date).slice(0, 10) <= target) weekAgo = r;
      }
      valueNowEur = Number(latest.totalValueEur);
      valueWeekAgoEur = Number(weekAgo.totalValueEur);
      investedNowEur = Number(latest.investedAmountEur);
      investedWeekAgoEur = Number(weekAgo.investedAmountEur);
      weekStartDate = String(weekAgo.date).slice(0, 10);
      weekEndDate = String(latest.date).slice(0, 10);
      source = "snapshots";
    }
  } catch {
    /* optional */
  }

  if (valueNowEur == null && Number.isFinite(input.totalMarketValue)) {
    valueNowEur = input.totalMarketValue;
  }

  const weekChangeEur =
    valueNowEur != null && valueWeekAgoEur != null
      ? valueNowEur - valueWeekAgoEur
      : null;
  const weekChangePct =
    valueNowEur != null && valueWeekAgoEur != null
      ? pctChange(valueWeekAgoEur, valueNowEur)
      : null;

  // Per-ticker ~1W moves (Yahoo daily closes) — top váhy najprv, max 20.
  const ranked = [...input.holdings]
    .filter((h) => h.ticker && (h.marketValue ?? 0) > 0)
    .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0))
    .slice(0, 20);

  const moves: HoldingWeekMove[] = [];
  await Promise.all(
    ranked.map(async (h) => {
      try {
        const series = await yahooDailyCloses(h.ticker, "1mo");
        if (series.length < 2) {
          moves.push({
            ticker: h.ticker,
            weekChangePct: null,
            priceWeekAgo: null,
            priceNow: h.price,
            approxContributionEur: null,
          });
          return;
        }
        const last = series[series.length - 1]!;
        const target = addDaysIso(last.date, -7);
        let weekAgo = series[0]!;
        for (const p of series) {
          if (p.date <= target) weekAgo = p;
        }
        // Preferuj aspoň 3 obchodné dni dozadu, ak 7d kalendár spadne na rovnaký close.
        if (weekAgo.date === last.date && series.length >= 6) {
          weekAgo = series[series.length - 6]!;
        }
        const wPct = pctChange(weekAgo.close, last.close);
        const contrib =
          wPct != null && h.marketValue != null
            ? (h.marketValue * wPct) / (100 + wPct)
            : null;
        moves.push({
          ticker: h.ticker,
          weekChangePct: wPct != null ? Number(wPct.toFixed(2)) : null,
          priceWeekAgo: Number(weekAgo.close.toFixed(4)),
          priceNow: Number(last.close.toFixed(4)),
          approxContributionEur:
            contrib != null && Number.isFinite(contrib)
              ? Math.round(contrib)
              : null,
        });
      } catch {
        moves.push({
          ticker: h.ticker,
          weekChangePct: null,
          priceWeekAgo: null,
          priceNow: h.price,
          approxContributionEur: null,
        });
      }
    }),
  );

  const withPct = moves.filter((m) => m.weekChangePct != null);
  const topWeekGainers = [...withPct]
    .sort((a, b) => (b.weekChangePct ?? 0) - (a.weekChangePct ?? 0))
    .slice(0, 5);
  const topWeekLosers = [...withPct]
    .sort((a, b) => (a.weekChangePct ?? 0) - (b.weekChangePct ?? 0))
    .slice(0, 5);

  if (withPct.length > 0) {
    source = source === "snapshots" ? "mixed" : "holdings_yahoo";
  }

  // Ak chýbajú snapshoty, odhadni týždeň váženým priemerom Yahoo ~7d pohybov.
  let estimatedFromHoldings = false;
  let outWeekChangeEur = weekChangeEur;
  let outWeekChangePct = weekChangePct;
  if (
    (outWeekChangePct == null || outWeekChangeEur == null) &&
    withPct.length > 0
  ) {
    const byTicker = new Map(ranked.map((h) => [h.ticker, h]));
    let weightSum = 0;
    let weightedPct = 0;
    let contribSum = 0;
    for (const m of withPct) {
      const mv = byTicker.get(m.ticker)?.marketValue ?? 0;
      if (mv <= 0 || m.weekChangePct == null) continue;
      weightSum += mv;
      weightedPct += mv * m.weekChangePct;
      if (m.approxContributionEur != null) contribSum += m.approxContributionEur;
    }
    if (weightSum > 0) {
      estimatedFromHoldings = true;
      if (outWeekChangePct == null) {
        outWeekChangePct = weightedPct / weightSum;
      }
      if (outWeekChangeEur == null) {
        outWeekChangeEur = contribSum;
      }
      if (!weekStartDate && withPct[0]) {
        weekEndDate = today;
        weekStartDate = addDaysIso(today, -7);
      }
    }
  }

  const note =
    source === "none"
      ? "Žiadne snapshoty ani týždenné ceny — neodhaduj týždeň z dennej zmeny."
      : estimatedFromHoldings && source === "holdings_yahoo"
        ? "weekChange* je odhad z Yahoo ~7d cien holdingov (vážený trhovou hodnotou). Nie je to oficiálny TWR zo snapshotov."
        : source === "snapshots" || source === "mixed"
          ? "weekChange* zo snapshotov portfólia (MTM). holdingsWeekMoves sú ~7d zmeny cien z Yahoo; contribution je aproximácia."
          : "Celkové týždenné číslo portfólia zo snapshotov chýba; použi holdingsWeekMoves (Yahoo ~7d).";

  return {
    source,
    asOf: today,
    weekStartDate,
    weekEndDate,
    valueNowEur:
      valueNowEur != null && Number.isFinite(valueNowEur)
        ? Math.round(valueNowEur)
        : null,
    valueWeekAgoEur:
      valueWeekAgoEur != null && Number.isFinite(valueWeekAgoEur)
        ? Math.round(valueWeekAgoEur)
        : null,
    weekChangeEur:
      outWeekChangeEur != null && Number.isFinite(outWeekChangeEur)
        ? Math.round(outWeekChangeEur)
        : null,
    weekChangePct:
      outWeekChangePct != null && Number.isFinite(outWeekChangePct)
        ? Number(outWeekChangePct.toFixed(2))
        : null,
    investedNowEur:
      investedNowEur != null && Number.isFinite(investedNowEur)
        ? Math.round(investedNowEur)
        : null,
    investedWeekAgoEur:
      investedWeekAgoEur != null && Number.isFinite(investedWeekAgoEur)
        ? Math.round(investedWeekAgoEur)
        : null,
    note,
    topWeekGainers,
    topWeekLosers,
    holdingsWeekMoves: moves,
  };
}
