import { format, parse, parseISO, startOfDay } from "date-fns";
import { sk } from "date-fns/locale";

export type PortfolioNotificationKind =
  | "ownership"
  | "ath"
  | "earnings"
  | "dividend"
  | "macro"
  | "move-up"
  | "move-down";

export type PortfolioNotificationItem = {
  id: string;
  kind: PortfolioNotificationKind;
  title: string;
  subtitle: string;
  dateIso: string | null;
  tone: "default" | "positive" | "negative" | "warning";
  infoUrl?: string;
};

export type OwnershipAlertItem = {
  id: string;
  date: string | null;
  actorName: string;
  shares: number | null;
  value: number | null;
  kind: "INSIDER" | "INSTITUTION";
  action: "BUY" | "SELL";
  note: string | null;
};

export type AthReachedPortfolio = {
  id: string;
  name: string;
  previousAthDate: string | null;
};

const ATH_VALUE_EPS = 1e-6;

export function formatNotificationDate(value: string | null): string {
  if (!value) return "bez dátumu";
  try {
    return format(parseISO(value), "d. M. yyyy", { locale: sk });
  } catch {
    try {
      return format(parse(value, "yyyy-MM-dd", new Date()), "d. M. yyyy", { locale: sk });
    } catch {
      return value;
    }
  }
}

export function formatOwnershipCount(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)} mld`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)} mil`;
  return value.toLocaleString("sk-SK", { maximumFractionDigits: 0 });
}

export function findPreviousAthDate(
  points: Array<{ date: string; totalValue: number }>,
  todayIso: string,
): string | null {
  if (points.length < 2) return null;
  const lastPoint = points[points.length - 1];
  const endIdx =
    lastPoint?.date && String(lastPoint.date).startsWith(todayIso)
      ? points.length - 1
      : points.length;
  let runningMax = Number.NEGATIVE_INFINITY;
  let lastAthDate: string | null = null;
  for (let i = 0; i < endIdx; i++) {
    const p = points[i];
    const v = p?.totalValue;
    if (!Number.isFinite(v)) continue;
    if (v! > runningMax + ATH_VALUE_EPS) {
      runningMax = v!;
      lastAthDate = p!.date;
    } else if (Math.abs(v! - runningMax) <= ATH_VALUE_EPS) {
      lastAthDate = p!.date;
    }
  }
  return Number.isFinite(runningMax) ? lastAthDate : null;
}

export function portfolioReachedAthToday(
  points: Array<{ date: string; totalValue: number }>,
  todayIso: string,
): boolean {
  if (points.length < 2) return false;
  const lastPoint = points[points.length - 1];
  if (!lastPoint?.date || !String(lastPoint.date).startsWith(todayIso)) return false;
  const last = lastPoint.totalValue;
  if (!Number.isFinite(last)) return false;
  let prevMax = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < points.length - 1; i++) {
    const v = points[i]?.totalValue;
    if (Number.isFinite(v)) prevMax = Math.max(prevMax, v!);
  }
  if (!Number.isFinite(prevMax)) return false;
  return last > prevMax + ATH_VALUE_EPS;
}

export function todayIsoLocal(): string {
  return format(startOfDay(new Date()), "yyyy-MM-dd");
}

export function buildImportantNotifications(input: {
  ownershipRows: Array<
    OwnershipAlertItem & { ticker: string; currency: string | null }
  >;
  athReached: AthReachedPortfolio[];
  calendarEvents: Array<{
    type: "earnings" | "dividend" | "macro";
    date: string;
    title: string;
    subtitle: string;
    infoUrl?: string;
  }>;
  holdings: Array<{ ticker: string; shares: string; companyName?: string | null }>;
  quotes: Record<string, { changePercent?: number } | undefined>;
  isPokemonTicker: (ticker: string) => boolean;
}): PortfolioNotificationItem[] {
  const items: PortfolioNotificationItem[] = [];
  const todayIso = todayIsoLocal();
  const ownershipCutoffMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const calendarHorizonIso = format(
    new Date(startOfDay(new Date()).getTime() + 7 * 24 * 60 * 60 * 1000),
    "yyyy-MM-dd",
  );

  for (const row of input.ownershipRows) {
    const eventMs = row.date ? Date.parse(row.date) : NaN;
    if (Number.isFinite(eventMs) && eventMs < ownershipCutoffMs) continue;
    const actorKindLabel = row.kind === "INSIDER" ? "Insider" : "Inštitúcia";
    const actionLabel = row.action === "BUY" ? "nákup" : "predaj";
    const sharesLabel = row.shares != null ? `${formatOwnershipCount(row.shares)} ks` : "počet ks —";
    const valueLabel =
      row.value != null
        ? `${formatOwnershipCount(row.value)}${row.currency ? ` ${row.currency}` : ""}`
        : "hodnota —";
    items.push({
      id: `ownership-${row.id}`,
      kind: "ownership",
      title: `${row.ticker}: ${actorKindLabel} ${actionLabel}`,
      subtitle: `${row.actorName} · ${sharesLabel} · ${valueLabel}`,
      dateIso: row.date,
      tone: row.action === "BUY" ? "positive" : "warning",
      infoUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(row.ticker)}`,
    });
  }

  for (const p of input.athReached) {
    items.push({
      id: `ath-${p.id}`,
      kind: "ath",
      title: `${p.name} dosiahlo ATH`,
      subtitle: p.previousAthDate
        ? `Predchádzajúce ATH: ${format(parse(p.previousAthDate, "yyyy-MM-dd", new Date()), "d. M. yyyy", {
            locale: sk,
          })}`
        : "Prvé zachytené ATH",
      dateIso: todayIso,
      tone: "positive",
    });
  }

  for (const ev of input.calendarEvents
    .filter((e) => e.date >= todayIso && e.date <= calendarHorizonIso)
    .slice(0, 8)) {
    const label =
      ev.type === "earnings" ? "Earnings" : ev.type === "dividend" ? "Dividenda" : "Makro udalosť";
    items.push({
      id: `calendar-${ev.type}-${ev.date}-${ev.title}`,
      kind: ev.type,
      title: `${label}: ${ev.title}`,
      subtitle: ev.subtitle,
      dateIso: ev.date,
      tone: ev.type === "macro" ? "warning" : "default",
      infoUrl: ev.infoUrl,
    });
  }

  const seen = new Set<string>();
  for (const h of input.holdings) {
    const ticker = (h.ticker || "").toUpperCase();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    const shares = parseFloat(h.shares);
    if (!Number.isFinite(shares) || shares <= 0) continue;
    if (ticker === "CASH" || input.isPokemonTicker(ticker)) continue;
    const pct = Number(input.quotes[ticker]?.changePercent);
    if (!Number.isFinite(pct) || Math.abs(pct) < 5) continue;
    const rising = pct >= 0;
    items.push({
      id: `move-${ticker}`,
      kind: rising ? "move-up" : "move-down",
      title: `${ticker} ${rising ? "rastie" : "klesá"} ${Math.abs(pct).toFixed(2)}%`,
      subtitle: (h.companyName || ticker).trim(),
      dateIso: todayIso,
      tone: rising ? "positive" : "negative",
      infoUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`,
    });
  }

  const rank = (n: PortfolioNotificationItem) => {
    switch (n.kind) {
      case "move-down":
        return 0;
      case "ownership":
        return 1;
      case "move-up":
        return 2;
      case "ath":
        return 3;
      case "earnings":
        return 4;
      case "dividend":
        return 5;
      case "macro":
        return 6;
      default:
        return 10;
    }
  };

  return items
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      const ta = a.dateIso ? Date.parse(a.dateIso) : -Infinity;
      const tb = b.dateIso ? Date.parse(b.dateIso) : -Infinity;
      return tb - ta;
    })
    .slice(0, 30);
}
