import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { Button, Card, Select, StatTile, TopBar } from "@/redesign/ui";
import { PageBody } from "./mobileChrome";

type TaxSummaryApiResponse = {
  year: number;
  portfolio: string;
  availableYears?: number[];
  longTermExemptGainEur?: number;
  longTermRealizedLossEur?: number;
  shortTermTaxableBaseEur?: number;
  shortTermGainEur?: number;
  shortTermLossEur?: number;
  estimatedTaxSimple19Eur?: number;
  dividendsGrossEur?: number;
  dividendsTaxEur?: number;
  dividendsNetEur?: number;
};

export default function TaxSummaryMobile() {
  const { formatCurrency } = useCurrency();
  const { portfolios } = usePortfolio();
  const [year, setYear] = useState<number>(new Date().getUTCFullYear());
  const [portfolio, setPortfolio] = useState("all");

  const query = useQuery<TaxSummaryApiResponse>({
    queryKey: ["/api/tax-summary", year, portfolio],
    queryFn: async () => {
      const p = `portfolio=${encodeURIComponent(portfolio)}&year=${encodeURIComponent(String(year))}`;
      const res = await fetch(`/api/tax-summary?${p}`, { credentials: "include" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message || "Chyba pri naÄŤĂ­tanĂ­ daĹovĂ©ho prehÄľadu");
      }
      return res.json();
    },
    staleTime: 60_000,
  });

  const d = query.data;
  const yearChoices = useMemo(() => {
    const fromApi = (d?.availableYears ?? []).filter((y) => Number.isFinite(y));
    if (fromApi.length > 0) return fromApi;
    const now = new Date().getUTCFullYear();
    return Array.from({ length: 8 }, (_, i) => now - i);
  }, [d?.availableYears]);

  useEffect(() => {
    if (!yearChoices.includes(year) && yearChoices.length > 0) setYear(yearChoices[0]!);
  }, [yearChoices, year]);

  const onDownload = useCallback(() => {
    if (!d) return;
    const blob = new Blob(
      [
        [
          "year,portfolio,shortTermTaxableBaseEur,estimatedTaxSimple19Eur,dividendsNetEur",
          `${d.year},${d.portfolio},${d.shortTermTaxableBaseEur ?? 0},${d.estimatedTaxSimple19Eur ?? 0},${d.dividendsNetEur ?? 0}`,
        ].join("\r\n"),
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `moneiqwise-dan-${d.year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [d]);

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline="RoÄŤnĂ© sĂşÄŤty" title="DaĹovĂ˝ asistent" />
      <PageBody>
        <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
          RoÄŤnĂ© sĂşÄŤty pre orientĂˇciu pred podanĂ­m a ĂşÄŤtovnĂ­ctvom. ÄŚĂ­sla sĂş v EUR.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="KalendĂˇrny rok"
            value={String(year)}
            onChange={(v) => setYear(parseInt(v, 10))}
            options={yearChoices.map((y) => ({ value: String(y), label: String(y) }))}
          />
          <Select
            label="PortfĂłlio"
            value={portfolio}
            onChange={setPortfolio}
            options={[
              { value: "all", label: "VĹˇetky portfĂłliĂˇ" },
              ...portfolios.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </div>

        {query.isPending ? (
          <p className="text-sm text-[var(--rd-text-tertiary)]">NaÄŤĂ­tavamâ€¦</p>
        ) : query.isError ? (
          <p className="text-sm text-[var(--rd-loss)]">{(query.error as Error).message}</p>
        ) : (
          <>
            <Card>
              <h3 className="text-[15px] font-semibold">V suchu (orient.)</h3>
              <p className="text-xs text-[var(--rd-text-tertiary)]">OslobodenĂ˝ / dlh. drĹľba â‰Ą 365 dnĂ­</p>
              <p className="mt-2 rd-type-display-lg text-[var(--rd-profit)]">
                {formatCurrency(d?.longTermExemptGainEur ?? 0)}
              </p>
              <p className="text-xs text-[var(--rd-text-tertiary)]">
                Realiz. straty (dlh.): {formatCurrency(d?.longTermRealizedLossEur ?? 0)}
              </p>
            </Card>
            <Card>
              <h3 className="text-[15px] font-semibold">KrĂˇtkodobĂ©</h3>
              <p className="text-xs text-[var(--rd-text-tertiary)]">ZdaniteÄľnĂ˝ zĂˇklad po zĂˇpoÄŤte strĂˇt</p>
              <p className="mt-2 rd-type-display-lg">{formatCurrency(d?.shortTermTaxableBaseEur ?? 0)}</p>
              <p className="text-xs text-[var(--rd-text-tertiary)]">
                +{formatCurrency(d?.shortTermGainEur ?? 0)} / â’{formatCurrency(Math.abs(d?.shortTermLossEur ?? 0))}
              </p>
            </Card>
            <Card>
              <h3 className="text-[15px] font-semibold">Marec / dane</h3>
              <p className="text-xs text-[var(--rd-text-tertiary)]">OdhadovanĂˇ daĹ (19 %)</p>
              <p className="mt-2 rd-type-display-lg">{formatCurrency(d?.estimatedTaxSimple19Eur ?? 0)}</p>
            </Card>
            <div className="grid grid-cols-3 gap-3">
              <StatTile label="HrubĂ˝ sĂşÄŤet" value={formatCurrency(d?.dividendsGrossEur ?? 0)} />
              <StatTile label="ZrĂˇĹľka" value={formatCurrency(d?.dividendsTaxEur ?? 0)} />
              <StatTile label="Netto" value={formatCurrency(d?.dividendsNetEur ?? 0)} />
            </div>
            <Button className="w-full" variant="Secondary" onClick={onDownload}>
              ExportovaĹĄ pre ĂşÄŤtovnĂ­ctvo
            </Button>
          </>
        )}
      </PageBody>
    </div>
  );
}
