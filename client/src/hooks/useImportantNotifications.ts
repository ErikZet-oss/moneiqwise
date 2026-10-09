import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { isPokemonTicker } from "@shared/pokemonTcg";
import {
  buildImportantNotifications,
  findPreviousAthDate,
  portfolioReachedAthToday,
  todayIsoLocal,
  type AthReachedPortfolio,
  type OwnershipAlertItem,
  type PortfolioNotificationItem,
} from "@/lib/importantNotifications";

type HoldingLike = { ticker: string; shares: string; companyName?: string | null };
type QuoteLike = { changePercent?: number };

type OwnershipAlertResponse = {
  ticker: string;
  currency: string | null;
  items: OwnershipAlertItem[];
};

type EarningsRes = {
  all?: Array<{ ticker: string; date: string; companyName?: string; session?: string | null }>;
};

type DividendsRes = {
  all?: Array<{ ticker: string; date: string; kind: "ex_dividend" | "payment" }>;
};

type MacroRes = {
  all?: Array<{ date: string; title: string; shortLabel: string }>;
};

type HistoryAllRes = {
  points: Array<{ date: string; totalValue: number }>;
};

export function useImportantNotifications({
  holdings,
  quotes,
  portfolioParam,
  portfolios,
  selectedPortfolioId,
  isAllPortfolios,
  enabled = true,
}: {
  holdings: HoldingLike[];
  quotes: Record<string, QuoteLike | undefined>;
  portfolioParam: string;
  portfolios: Array<{ id: string; name: string }>;
  selectedPortfolioId: string | null | undefined;
  isAllPortfolios: boolean;
  enabled?: boolean;
}): {
  notifications: PortfolioNotificationItem[];
  count: number;
} {
  const ownershipTickers = useMemo(() => {
    if (!enabled || holdings.length === 0) return [] as string[];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const h of holdings) {
      const sh = parseFloat(h.shares);
      const t = (h.ticker || "").toUpperCase();
      if (!Number.isFinite(sh) || sh <= 0) continue;
      if (!t || t === "CASH" || isPokemonTicker(t)) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= 15) break;
    }
    return out;
  }, [enabled, holdings]);

  const ownershipQueries = useQueries({
    queries: ownershipTickers.map((ticker) => ({
      queryKey: ["/api/assets", ticker, "ownership-activity", "alerts", portfolioParam],
      queryFn: async () => {
        const res = await fetch(
          `/api/assets/${encodeURIComponent(ticker)}/ownership-activity?includeAll=1`,
          { credentials: "include" },
        );
        if (!res.ok) throw new Error("ownership activity");
        return res.json() as Promise<OwnershipAlertResponse>;
      },
      enabled: enabled && ownershipTickers.length > 0,
      staleTime: 30 * 60 * 1000,
    })),
  });

  const { data: nextEarnings } = useQuery<EarningsRes>({
    queryKey: ["/api/holdings/next-earnings", portfolioParam, "notifications"],
    queryFn: async () => {
      const res = await fetch(
        `/api/holdings/next-earnings?portfolio=${encodeURIComponent(portfolioParam)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("next earnings");
      return res.json();
    },
    staleTime: 45 * 60 * 1000,
    enabled,
  });

  const { data: upcomingDividends } = useQuery<DividendsRes>({
    queryKey: ["/api/dividends/upcoming", portfolioParam, "notifications"],
    queryFn: async () => {
      const res = await fetch(
        `/api/dividends/upcoming?portfolio=${encodeURIComponent(portfolioParam)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("upcoming dividends");
      return res.json();
    },
    staleTime: 45 * 60 * 1000,
    enabled,
  });

  const { data: upcomingMacro } = useQuery<MacroRes>({
    queryKey: ["/api/macro-events/upcoming", "notifications"],
    queryFn: async () => {
      const res = await fetch("/api/macro-events/upcoming", { credentials: "include" });
      if (!res.ok) throw new Error("macro events");
      return res.json();
    },
    staleTime: 12 * 60 * 60 * 1000,
    enabled,
  });

  const portfolioIdsKey = portfolios.map((p) => p.id).join(",");
  const { data: athHistoryByPortfolio } = useQuery<Record<string, HistoryAllRes>>({
    queryKey: ["/api/portfolio-history", "ath-check", "notifications", portfolioIdsKey],
    enabled: enabled && portfolios.length > 0,
    queryFn: async () => {
      const out: Record<string, HistoryAllRes> = {};
      await Promise.all(
        portfolios.map(async (p) => {
          const params = new URLSearchParams();
          params.set("portfolio", p.id);
          params.set("range", "all");
          const res = await fetch(`/api/portfolio-history?${params.toString()}`, {
            credentials: "include",
          });
          if (!res.ok) {
            out[p.id] = { points: [] };
            return;
          }
          out[p.id] = (await res.json()) as HistoryAllRes;
        }),
      );
      return out;
    },
    staleTime: 60 * 1000,
  });

  const ownershipRows = useMemo(() => {
    const rows: Array<OwnershipAlertItem & { ticker: string; currency: string | null }> = [];
    ownershipQueries.forEach((q, idx) => {
      const ticker = ownershipTickers[idx];
      if (!ticker) return;
      const payload = q.data;
      if (!payload?.items?.length) return;
      for (const item of payload.items.slice(0, 6)) {
        rows.push({
          ...item,
          ticker,
          currency: payload.currency ?? null,
        });
      }
    });
    rows.sort((a, b) => {
      const ta = a.date ? Date.parse(a.date) : -Infinity;
      const tb = b.date ? Date.parse(b.date) : -Infinity;
      if (tb !== ta) return tb - ta;
      return (b.value ?? -Infinity) - (a.value ?? -Infinity);
    });
    return rows.slice(0, 12);
  }, [ownershipQueries, ownershipTickers]);

  const athReached = useMemo(() => {
    if (!athHistoryByPortfolio) return [] as AthReachedPortfolio[];
    const todayIso = todayIsoLocal();
    const reached: AthReachedPortfolio[] = [];
    for (const p of portfolios) {
      const points = athHistoryByPortfolio[p.id]?.points ?? [];
      if (!portfolioReachedAthToday(points, todayIso)) continue;
      reached.push({
        id: p.id,
        name: p.name,
        previousAthDate: findPreviousAthDate(points, todayIso),
      });
    }
    if (isAllPortfolios) return reached;
    return reached.filter((p) => p.id === selectedPortfolioId);
  }, [athHistoryByPortfolio, isAllPortfolios, portfolios, selectedPortfolioId]);

  const calendarEvents = useMemo(() => {
    const out: Array<{
      type: "earnings" | "dividend" | "macro";
      date: string;
      title: string;
      subtitle: string;
      infoUrl?: string;
    }> = [];
    for (const e of nextEarnings?.all ?? []) {
      const t = e.ticker.toUpperCase();
      out.push({
        type: "earnings",
        date: e.date,
        title: `${t} — výsledky`,
        subtitle: e.companyName || t,
        infoUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(t)}`,
      });
    }
    for (const d of upcomingDividends?.all ?? []) {
      const t = d.ticker.toUpperCase();
      out.push({
        type: "dividend",
        date: d.date,
        title: d.kind === "ex_dividend" ? `${t} — ex-dividend` : `${t} — výplata dividendy`,
        subtitle: d.kind === "ex_dividend" ? "Posledná šanca pred ex-dátumom" : "Dátum výplaty",
        infoUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(t)}`,
      });
    }
    for (const m of upcomingMacro?.all ?? []) {
      out.push({
        type: "macro",
        date: m.date,
        title: m.shortLabel,
        subtitle: m.title,
        infoUrl: "https://finance.yahoo.com/calendar/economic",
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  }, [nextEarnings?.all, upcomingDividends?.all, upcomingMacro?.all]);

  const notifications = useMemo(
    () =>
      enabled
        ? buildImportantNotifications({
            ownershipRows,
            athReached,
            calendarEvents,
            holdings,
            quotes,
            isPokemonTicker,
          })
        : [],
    [athReached, calendarEvents, enabled, holdings, ownershipRows, quotes],
  );

  return {
    notifications,
    count: notifications.length,
  };
}
