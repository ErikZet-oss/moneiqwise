import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { cn } from "@/lib/utils";
import { Button, Card, Select, TopBar } from "@/redesign/ui";
import { PageBody } from "./mobileChrome";
import {
  buildAccountantBundleCsv,
  finiteEur,
  type TaxSummaryApiResponse,
} from "@/lib/taxSummary";

export default function TaxSummaryMobile() {
  const { formatCurrency } = useCurrency();
  const { portfolios } = usePortfolio();
  const [year, setYear] = useState<number>(new Date().getUTCFullYear());
  const [portfolio, setPortfolio] = useState("all");
  const [showAllTickers, setShowAllTickers] = useState(false);

  const query = useQuery<TaxSummaryApiResponse>({
    queryKey: ["/api/tax-summary", year, portfolio],
    queryFn: async () => {
      const p = `portfolio=${encodeURIComponent(portfolio)}&year=${encodeURIComponent(String(year))}`;
      const res = await fetch(`/api/tax-summary?${p}`, { credentials: "include" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(j.message || "Chyba pri načítaní daňového prehľadu");
      }
      return res.json();
    },
    staleTime: 60_000,
    refetchOnMount: true,
  });

  const d = query.data;
  const yearChoices = useMemo(() => {
    const fromApi = (d?.availableYears ?? []).filter((y) => Number.isFinite(y));
    if (fromApi.length > 0) return fromApi;
    const now = new Date().getUTCFullYear();
    return Array.from({ length: 8 }, (_, i) => now - i);
  }, [d?.availableYears]);

  useEffect(() => {
    setShowAllTickers(false);
  }, [year, portfolio]);

  useEffect(() => {
    if (!yearChoices.includes(year) && yearChoices.length > 0) setYear(yearChoices[0]!);
  }, [yearChoices, year]);

  const onDownload = useCallback(() => {
    if (!d) return;
    const blob = new Blob([buildAccountantBundleCsv(d)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `moneiqwise-dan-${d.year}-pf-${d.portfolio === "all" ? "vsetky" : d.portfolio}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [d]);

  const longGain = finiteEur(d?.forForms?.taxExempt?.realizedGainsEur ?? d?.realized?.longTermGainsEur);
  const longLoss = finiteEur(d?.forForms?.taxExempt?.realizedLossesEur ?? d?.realized?.longTermLossesEur);
  const shortBase = finiteEur(
    d?.forForms?.taxable?.netShortTermAfterLossOffsetEur ?? d?.realized?.netShortTermTaxableEur,
  );
  const shortGain = finiteEur(d?.forForms?.taxable?.shortTermGainsEur ?? d?.realized?.taxableGainsEur);
  const shortLoss = finiteEur(d?.forForms?.taxable?.shortTermLossesEur ?? d?.realized?.taxableLossesEur);
  const taxTotal = finiteEur(d?.skEstimate?.estimatedTotalTaxEur);
  const taxSimple = finiteEur(d?.skEstimate?.estimatedTaxEur19Simple);
  const divGross = finiteEur(d?.dividends?.grossEur);
  const divWithhold = finiteEur(d?.dividends?.withholdingEur);
  const divNet = finiteEur(d?.dividends?.netEur);
  const divItems = d?.dividends?.items ?? [];

  const uniqueTickers = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of divItems) {
      const t = item.ticker || "—";
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  }, [divItems]);

  const visibleItems = useMemo(() => {
    if (showAllTickers || uniqueTickers.length <= 10) return divItems;
    const allowed = new Set(uniqueTickers.slice(0, 10));
    return divItems.filter((item) => allowed.has(item.ticker || "—"));
  }, [divItems, showAllTickers, uniqueTickers]);

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline="Ročné súčty" title="Daňový asistent" />
      <PageBody>
        <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
          Ročné súčty pre orientáciu pred podaním a účtovníctvom. Čísla sú v EUR.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <Select
            label="Kalendárny rok"
            value={String(year)}
            onChange={(v) => setYear(parseInt(v, 10))}
            options={yearChoices.map((y) => ({ value: String(y), label: String(y) }))}
          />
          <Select
            label="Portfólio"
            value={portfolio}
            onChange={setPortfolio}
            options={[
              { value: "all", label: "Všetky portfóliá" },
              ...portfolios.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </div>
        <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
          Výber portfólia ovplyvňuje len túto stránku.
        </p>

        {query.isPending ? (
          <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">Načítavam…</p>
        ) : query.isError ? (
          <p className="rd-type-body-sm text-[var(--rd-loss)]">{(query.error as Error).message}</p>
        ) : (
          <>
            <Card className="gap-1 p-3">
              <p className="rd-type-overline text-[var(--rd-text-tertiary)]">V suchu (orient.)</p>
              <p className="rd-type-h3 text-[var(--rd-text-primary)]">Oslobodený / dlh. držba</p>
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                Holding ≥ 365 dní, realiz. zisk v EUR (FIFO diely)
              </p>
              <p className="rd-type-display-lg text-[var(--rd-profit)]">{formatCurrency(longGain)}</p>
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                Realiz. straty (dlh.): {formatCurrency(-Math.abs(longLoss))}
              </p>
            </Card>

            <Card className="gap-1 p-3">
              <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Krátkodobé</p>
              <p className="rd-type-h3 text-[var(--rd-text-primary)]">Zdaniteľný základ</p>
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                Krátkodobé, po zápočte strát v roku
              </p>
              <p className="rd-type-display-lg text-[var(--rd-text-primary)]">
                {formatCurrency(shortBase)}
              </p>
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                +{formatCurrency(shortGain)} / −{formatCurrency(Math.abs(shortLoss))} (zisk / strata)
              </p>
            </Card>

            <Card className="gap-1 p-3">
              <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Marec / dane</p>
              <p className="rd-type-h3 text-[var(--rd-text-primary)]">Odhadovaná daň (19 % / pásy)</p>
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                Orient. podľa krátk. základu, nie konečné rozhodnutie
              </p>
              <p className="rd-type-display-lg text-[var(--rd-text-primary)]">
                {formatCurrency(taxTotal)}
              </p>
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                Jednoducho 19 %: {formatCurrency(taxSimple)}
              </p>
            </Card>

            <Card className="gap-2 p-3">
              <Button className="w-full" variant="Secondary" onClick={onDownload} data-testid="button-tax-export">
                Exportovať pre účtovníctvo
              </Button>
              <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                Súbor CSV (UTF-8) – realizácie, dividendy a stručná meta. Otvorí sa v Exceli.
              </p>
            </Card>

            <Card className="gap-2 p-3">
              <div>
                <h3 className="rd-type-h3 text-[var(--rd-text-primary)]">
                  Dividendy v roku {d?.year ?? year}
                </h3>
                <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                  Hrubá, zrazená, čisté – v EUR. Zahraničné DTT nie sú automatické.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Hrubý súčet</p>
                  <p className="rd-type-body-strong text-[var(--rd-text-primary)]">
                    {formatCurrency(divGross)}
                  </p>
                </div>
                <div>
                  <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Zrážky</p>
                  <p className="rd-type-body-strong text-[var(--rd-text-primary)]">
                    {formatCurrency(divWithhold)}
                  </p>
                </div>
                <div>
                  <p className="rd-type-overline text-[var(--rd-text-tertiary)]">Čisté</p>
                  <p className="rd-type-body-strong text-[var(--rd-text-primary)]">
                    {formatCurrency(divNet)}
                  </p>
                </div>
              </div>

              {divItems.length === 0 ? (
                <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                  Žiadne dividendy v tomto roku.
                </p>
              ) : (
                <div className="flex flex-col">
                  <div className="flex gap-2 pb-1">
                    <p className="w-[72px] shrink-0 rd-type-overline text-[var(--rd-text-tertiary)]">
                      Dátum
                    </p>
                    <p className="min-w-0 flex-1 rd-type-overline text-[var(--rd-text-tertiary)]">
                      Ticker
                    </p>
                    <p className="w-[52px] shrink-0 text-right rd-type-overline text-[var(--rd-text-tertiary)]">
                      Hrubé
                    </p>
                    <p className="w-[60px] shrink-0 text-right rd-type-overline text-[var(--rd-text-tertiary)]">
                      Zrážka
                    </p>
                    <p className="w-[52px] shrink-0 text-right rd-type-overline text-[var(--rd-text-tertiary)]">
                      Čisté
                    </p>
                  </div>
                  {visibleItems.map((item, i) => (
                    <div key={item.transactionId || `${item.date}-${item.ticker}-${i}`}>
                      {i > 0 ? <div className="h-px w-full bg-[var(--rd-border-subtle)]" /> : null}
                      <div className="flex items-center gap-2 py-1.5">
                        <p className="w-[72px] shrink-0 rd-type-data-sm text-[var(--rd-text-secondary)]">
                          {item.date}
                        </p>
                        <p
                          className={cn(
                            "min-w-0 flex-1 truncate rd-type-data-sm text-[var(--rd-text-primary)]",
                          )}
                          title={item.ticker}
                        >
                          {item.ticker}
                        </p>
                        <p className="w-[52px] shrink-0 text-right rd-type-data-sm text-[var(--rd-text-primary)]">
                          {formatCurrency(finiteEur(item.grossEur))}
                        </p>
                        <p className="w-[60px] shrink-0 text-right rd-type-data-sm text-[var(--rd-text-secondary)]">
                          {formatCurrency(finiteEur(item.withholdingEur))}
                        </p>
                        <p className="w-[52px] shrink-0 text-right rd-type-data-sm text-[var(--rd-text-primary)]">
                          {formatCurrency(finiteEur(item.netEur))}
                        </p>
                      </div>
                    </div>
                  ))}
                  {uniqueTickers.length > 10 ? (
                    <Button
                      variant="Ghost"
                      className="mt-1 w-full"
                      onClick={() => setShowAllTickers((v) => !v)}
                    >
                      {showAllTickers ? "Zobraziť menej" : `Zobraziť všetky tickery (${uniqueTickers.length})`}
                    </Button>
                  ) : null}
                </div>
              )}
            </Card>
          </>
        )}
      </PageBody>
    </div>
  );
}
