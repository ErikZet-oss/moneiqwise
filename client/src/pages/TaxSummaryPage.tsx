import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useMobileRedesign } from "@/hooks/useMobileUi";
import {
  buildAccountantBundleCsv,
  finiteEur,
  type TaxSummaryApiResponse,
} from "@/lib/taxSummary";
import TaxSummaryMobile from "@/pages/redesign/TaxSummaryMobile";
import {
  FileDown,
  ShieldCheck,
  Clock,
  FileText,
  Info,
} from "lucide-react";

export type { TaxSummaryApiResponse } from "@/lib/taxSummary";
export { finiteEur, buildAccountantBundleCsv } from "@/lib/taxSummary";

function TaxSummaryClassic() {
  const { formatCurrency } = useCurrency();
  const { portfolios } = usePortfolio();

  const [year, setYear] = useState<number>(new Date().getUTCFullYear());
  const [portfolio, setPortfolio] = useState<string>("all");
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
    staleTime: 60 * 1000,
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
    if (!yearChoices.includes(year) && yearChoices.length > 0) {
      setYear(yearChoices[0]!);
    }
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

  const shortTermLabel = "Zdaniteľný základ (krátkodobé, po zápočte strát v roku)";
  const longTermLabel = "Oslobodený / dlh. držba (realiz. zisky, orient.)";

  const portfolioList = useMemo(
    () => [
      { id: "all" as const, name: "Všetky portfóliá" },
      ...portfolios.map((p) => ({ id: p.id, name: p.name })),
    ],
    [portfolios],
  );

  return (
    <div className="flex flex-col gap-3 pb-8">
      <div>
        <h1 className="text-lg font-semibold">Daňový asistent</h1>
        <p className="text-xs md:text-[13px] text-muted-foreground mt-1">
          Ročné súčty pre orientáciu pred podaním a účtovníctvom. Čísla sú v EUR z backendu.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col sm:flex-row gap-3 sm:gap-4 flex-wrap items-end p-4">
          <div className="space-y-1.5 w-full sm:w-36">
            <Label htmlFor="tax-year" className="text-[11px] text-muted-foreground">Kalendárny rok</Label>
            <Select
              value={String(year)}
              onValueChange={(v) => setYear(parseInt(v, 10))}
            >
              <SelectTrigger id="tax-year" className="w-full md:h-9 md:text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearChoices.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 w-full sm:w-52">
            <Label className="text-[11px] text-muted-foreground">Portfólio</Label>
            <Select value={portfolio} onValueChange={setPortfolio}>
              <SelectTrigger className="md:h-9 md:text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {portfolioList.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground w-full sm:w-auto sm:flex-1 sm:pb-2.5">
            <Info className="h-3.5 w-3.5 shrink-0" />
            <span>
              Výber portfólia ovplyvňuje len túto stránku (dáta z API <code className="text-[11px]">/api/tax-summary</code>).
            </span>
          </p>
        </CardContent>
      </Card>

      {query.isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {query.isError && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 text-destructive text-sm">
            {(query.error as Error).message}
          </CardContent>
        </Card>
      )}

      {d && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card
              className={
                finiteEur(d.realized?.longTermGainsEur) > 0
                  ? "border-emerald-500/60 bg-emerald-500/5 dark:border-[var(--rd-border-strong)] dark:bg-card"
                  : "border-border"
              }
            >
              <CardHeader className="p-4 pb-2 space-y-1">
                <div className="flex items-center gap-1.5 text-emerald-600 dark:!text-[var(--rd-profit)]">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-semibold uppercase leading-3 tracking-[0.8px]">V suchu (orient.)</span>
                </div>
                <CardTitle className="text-sm font-medium">{longTermLabel}</CardTitle>
                <CardDescription>holding ≥ 365 dní, realiz. zisk v EUR (FIFO diely)</CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-1">
                <p className="text-2xl md:text-[22px] md:leading-[26px] font-bold leading-tight tracking-tight tabular-nums text-emerald-700 dark:text-emerald-400 dark:!text-[var(--rd-profit)]">
                  {formatCurrency(finiteEur(d.forForms?.taxExempt?.realizedGainsEur))}
                </p>
                {finiteEur(d.forForms?.taxExempt?.realizedLossesEur) > 0.01 && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Realiz. straty (dlh.):{" "}
                    {formatCurrency(-finiteEur(d.forForms?.taxExempt?.realizedLossesEur))}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card
              className={
                finiteEur(d.realized?.netShortTermTaxableEur) > 0
                  ? "border-orange-500/50 bg-orange-500/5 dark:border-[var(--rd-border-strong)] dark:bg-card"
                  : "border-border"
              }
            >
              <CardHeader className="p-4 pb-2 space-y-1">
                <div className="flex items-center gap-1.5 text-orange-600 dark:!text-[var(--rd-warning)]">
                  <Clock className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-semibold uppercase leading-3 tracking-[0.8px]">Krátkodobé</span>
                </div>
                <CardTitle className="text-sm font-medium">{shortTermLabel}</CardTitle>
                <CardDescription>Zápočet kladné − straty v rámci roka</CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-1">
                <p className="text-2xl md:text-[22px] md:leading-[26px] font-bold leading-tight tracking-tight tabular-nums text-orange-600 dark:!text-[var(--rd-warning)]">
                  {formatCurrency(finiteEur(d.realized?.netShortTermTaxableEur))}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  +{formatCurrency(finiteEur(d.realized?.taxableGainsEur))} / −
                  {formatCurrency(finiteEur(d.realized?.taxableLossesEur))} (zisk / strata)
                </p>
              </CardContent>
            </Card>

            <Card
              className={
                finiteEur(d.skEstimate?.estimatedTotalTaxEur) > 0
                  ? "border-destructive/50 bg-destructive/5 dark:border-[var(--rd-border-strong)] dark:bg-card"
                  : "border-border"
              }
            >
              <CardHeader className="p-4 pb-2 space-y-1">
                <div
                  className={
                    "flex items-center gap-1.5 " +
                    (finiteEur(d.skEstimate?.estimatedTotalTaxEur) > 0
                      ? "text-destructive dark:!text-[var(--rd-loss)]"
                      : "text-muted-foreground")
                  }
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-semibold uppercase leading-3 tracking-[0.8px]">Marec / dane</span>
                </div>
                <CardTitle className="text-sm font-medium">Odhadovaná daň (19 % / pásy)</CardTitle>
                <CardDescription>Orient. podľa kratk. základu, nie konečné rozhodnutie</CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-1">
                <p
                  className={
                    "text-2xl md:text-[22px] md:leading-[26px] font-bold leading-tight tracking-tight tabular-nums " +
                    (finiteEur(d.skEstimate?.estimatedTotalTaxEur) > 0 ? "text-destructive dark:!text-[var(--rd-loss)]" : "")
                  }
                >
                  {formatCurrency(finiteEur(d.skEstimate?.estimatedTotalTaxEur))}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Jednoducho 19 %: {formatCurrency(finiteEur(d.skEstimate?.estimatedTaxEur19Simple))}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between p-4">
              <div className="min-w-0 space-y-0.5">
                <p className="text-[15px] font-semibold leading-5">Exportovať pre účtovníctvo</p>
                <p className="text-[11px] text-muted-foreground">
                  Súbor CSV (UTF-8) – realizácie, dividendy a stručná meta. Otvorí sa v Excele.
                </p>
              </div>
              <Button
                onClick={onDownload}
                className="gap-2 shrink-0"
                variant="default"
                data-testid="button-tax-csv"
              >
                <FileDown className="h-4 w-4" />
                Exportovať CSV
              </Button>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium">Dividendy v roku {d.year}</CardTitle>
              <CardDescription>
                Hrubá, zrazená (pole commission v appke), čisté – v EUR. Zahraničné DTT nie sú automatická.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-3 md:p-0 md:pt-1">
              {(d.dividends?.items ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground md:px-4 md:pb-4">V tomto roku žiadne dividendy v dátach.</p>
              ) : (
                <>
                  {(() => {
                    const items = d.dividends?.items ?? [];
                    const firstTenTickers = Array.from(new Set(items.map((x) => x.ticker))).slice(0, 10);
                    const visibleItems = showAllTickers
                      ? items
                      : items.filter((x) => firstTenTickers.includes(x.ticker));
                    const hiddenTickerCount =
                      Array.from(new Set(items.map((x) => x.ticker))).length - firstTenTickers.length;
                    return (
                      <>
                  <div className="mb-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm md:px-4">
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 dark:bg-background">
                      <div className="text-[10px] font-semibold uppercase leading-3 tracking-[0.8px] text-tertiary">Hrubý súčet</div>
                      <div className="mt-1 text-[15px] font-semibold tabular-nums">
                        {formatCurrency(finiteEur(d.dividends?.grossEur))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 dark:bg-background">
                      <div className="text-[10px] font-semibold uppercase leading-3 tracking-[0.8px] text-tertiary">Zrážky (súčet, orient.)</div>
                      <div className="mt-1 text-[15px] font-semibold tabular-nums text-red-600 dark:!text-[var(--rd-loss)]">
                        {formatCurrency(finiteEur(d.dividends?.withholdingEur))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 dark:bg-background">
                      <div className="text-[10px] font-semibold uppercase leading-3 tracking-[0.8px] text-tertiary">Čisté</div>
                      <div className="mt-1 text-[15px] font-semibold tabular-nums text-green-600 dark:!text-[var(--rd-profit)]">
                        {formatCurrency(finiteEur(d.dividends?.netEur))}
                      </div>
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dátum</TableHead>
                        <TableHead>Ticker</TableHead>
                        <TableHead className="text-right">Hrubé</TableHead>
                        <TableHead className="text-right">Zrážka</TableHead>
                        <TableHead className="text-right">Čisté</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleItems.map((r) => (
                        <TableRow key={r.transactionId}>
                          <TableCell className="text-muted-foreground tabular-nums">{r.date}</TableCell>
                          <TableCell className="font-semibold">{r.ticker}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatCurrency(finiteEur(r.grossEur))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {formatCurrency(finiteEur(r.withholdingEur))}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums text-green-600 dark:!text-[var(--rd-profit)]">
                            {formatCurrency(finiteEur(r.netEur))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {hiddenTickerCount > 0 && (
                    <div className="mt-3 flex items-center justify-between gap-2 md:mt-0 md:border-t md:border-border md:px-4 md:py-3">
                      <p className="text-[11px] text-muted-foreground">
                        Zobrazených prvých {firstTenTickers.length} tickerov z{" "}
                        {firstTenTickers.length + hiddenTickerCount}.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAllTickers((v) => !v)}
                      >
                        {showAllTickers ? "Zobraziť menej" : "Zobraziť viac"}
                      </Button>
                    </div>
                  )}
                      </>
                    );
                  })()}
                </>
              )}
            </CardContent>
          </Card>

          <p className="text-[11px] text-muted-foreground border-t border-border/60 pt-4 leading-relaxed max-w-3xl">
            {d.disclaimer ?? ""}
          </p>
        </>
      )}
    </div>
  );
}

export default function TaxSummaryPage() {
  const redesign = useMobileRedesign();
  return redesign ? <TaxSummaryMobile /> : <TaxSummaryClassic />;
}
