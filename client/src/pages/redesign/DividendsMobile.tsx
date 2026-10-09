import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  startOfMonth,
  addMonths,
  subMonths,
} from "date-fns";
import { sk } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { useChartSettings } from "@/hooks/useChartSettings";
import { usePortfolio } from "@/hooks/usePortfolio";
import { Avatar, Card, Dialog, StatTile, TopBar } from "@/redesign/ui";
import { PageBody, signedMoney } from "./mobileChrome";

type DividendSummary = {
  trailing12mNet?: number;
  yieldPct?: number;
  yocPct?: number;
  byDay?: Record<string, { net: number; items: Array<{ ticker: string; companyName?: string; net: number; gross?: number; tax?: number }> }>;
};

export default function DividendsMobile() {
  const { formatCurrency: formatRaw } = useCurrency();
  const { hideAmounts } = useChartSettings();
  const { getQueryParam, isAllPortfolios, selectedPortfolio } = usePortfolio();
  const formatCurrency = (n: number) => (hideAmounts ? "â€˘â€˘â€˘â€˘â€˘â€˘" : formatRaw(n));
  const portfolioParam = getQueryParam();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [dayKey, setDayKey] = useState<string | null>(null);

  const { data } = useQuery<DividendSummary>({
    queryKey: ["/api/dividends", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/dividends?portfolio=${encodeURIComponent(portfolioParam)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("dividends");
      return res.json();
    },
  });

  const days = useMemo(() => {
    const start = startOfMonth(month);
    const end = endOfMonth(month);
    return eachDayOfInterval({ start, end });
  }, [month]);

  const startPad = (getDay(startOfMonth(month)) + 6) % 7; // Monday-first
  const byDay = data?.byDay ?? {};
  const selected = dayKey ? byDay[dayKey] : null;

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar
        overline={isAllPortfolios ? "VĹˇetky portfĂłliĂˇ" : selectedPortfolio?.name || "PortfĂłlio"}
        title="Dividendy"
      />
      <PageBody>
        <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
          KalendĂˇr, roÄŤnĂ˝ prehÄľad a yield analytika
        </p>
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="12M prĂ­jem" value={formatCurrency(data?.trailing12mNet ?? 0)} sub="forward" />
          <StatTile
            label="Yield"
            value={data?.yieldPct != null ? `${data.yieldPct.toFixed(2)}%` : "â€”"}
            sub="aktuĂˇlny"
          />
          <StatTile
            label="YOC"
            value={data?.yocPct != null ? `${data.yocPct.toFixed(2)}%` : "â€”"}
            sub="na nĂˇklady"
          />
        </div>

        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold">DividendovĂ˝ kalendĂˇr</h3>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="PredoĹˇlĂ˝ mesiac" className="size-[30px] inline-flex items-center justify-center" onClick={() => setMonth((m) => subMonths(m, 1))}>
                <ChevronLeft className="size-4" />
              </button>
              <button type="button" aria-label="ÄŽalĹˇĂ­ mesiac" className="size-[30px] inline-flex items-center justify-center" onClick={() => setMonth((m) => addMonths(m, 1))}>
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
          <p className="rd-type-h2 capitalize">{format(month, "LLLL yyyy", { locale: sk })}</p>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-[var(--rd-text-tertiary)]">
            {["Po", "Ut", "St", "Ĺ t", "Pi", "So", "Ne"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: startPad }).map((_, i) => (
              <div key={`pad-${i}`} />
            ))}
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const entry = byDay[key];
              const net = entry?.net ?? 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => entry && setDayKey(key)}
                  className="flex min-h-[40px] flex-col items-center justify-center rounded-[var(--rd-radius-xs)] text-xs"
                >
                  <span className="font-mono text-[var(--rd-text-secondary)]">{format(day, "d")}</span>
                  {net !== 0 ? (
                    <span className="font-mono text-[10px] text-[var(--rd-profit)]">
                      {signedMoney(formatCurrency, net).replace(" ", "")}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </Card>
      </PageBody>

      <Dialog
        open={!!dayKey}
        title={dayKey ? format(new Date(dayKey), "EEEE d. MMMM yyyy", { locale: sk }) : ""}
        body={selected ? `Celkom netto v tento deĹ: ${formatCurrency(selected.net)}` : undefined}
        onClose={() => setDayKey(null)}
      >
        <div className="mt-3 space-y-3">
          {(selected?.items ?? []).map((item, idx) => (
            <div key={`${item.ticker}-${idx}`} className="flex items-center gap-3">
              <Avatar ticker={item.ticker} companyName={item.companyName || undefined} />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-medium">{item.ticker}</p>
                <p className="truncate text-xs text-[var(--rd-text-tertiary)]">{item.companyName || "â€”"}</p>
              </div>
              <p className="font-mono text-sm text-[var(--rd-profit)]">{signedMoney(formatCurrency, item.net)}</p>
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
