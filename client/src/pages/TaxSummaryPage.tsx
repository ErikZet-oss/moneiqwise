import { useState, useMemo, useCallback } from "react";
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
import {
  FileDown,
  ShieldCheck,
  AlertTriangle,
  BarChart2,
} from "lucide-react";

const YEAR_CHOICES = [2024, 2025, 2026] as const;

type CsvTable = {
  header: readonly string[];
  rows: (string | number | boolean)[][];
};

export type TaxSummaryApiResponse = {
  year: number;
  baseCurrency: "EUR";
  disclaimer: string;
  realized: {
    taxableGainsEur: number;
    taxableLossesEur: number;
    netShortTermTaxableEur: number;
    longTermGainsEur: number;
    longTermLossesEur: number;
    totalRealizedGainEur: number;
  };
  forForms: {
    taxExempt: { label: string; realizedGainsEur: number; realizedLossesEur: number };
    taxable: {
      label: string;
      shortTermGainsEur: number;
      shortTermLossesEur: number;
      netShortTermAfterLossOffsetEur: number;
    };
  };
  skEstimate: {
    taxRate19: 0.19;
    taxRate25: 0.25;
    estimatedTaxEur19Simple: number;
    estimatedTaxEurByBracket: { fromEur: number; toEur: number; rate: number; taxEur: number }[];
    estimatedTotalTaxEur: number;
  };
  dividends: {
    count: number;
    grossEur: number;
    withholdingEur: number;
    netEur: number;
    items: {
      transactionId: string;
      date: string;
      grossEur: number;
      withholdingEur: number;
      netEur: number;
      ticker: string;
    }[];
  };
  exportCsv: {
    disposals: CsvTable;
    dividends: CsvTable;
  };
  portfolio: string;
  generatedAt: number;
};

function escapeCsvField(value: string | number | boolean): string {
  const s = value === true ? "true" : value === false ? "false" : String(value);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function tableToCsvRows(table: CsvTable): string {
  const lines: string[] = [table.header.map(escapeCsvField).join(",")];
  for (const row of table.rows) {
    lines.push(row.map(escapeCsvField).join(","));
  }
  return lines.join("\r\n");
}

function buildAccountantBundleCsv(data: TaxSummaryApiResponse): string {
  const meta = [
    "# moneiqwise;danove-podklady;utf-8",
    `# rok;${data.year};portfolio;${data.portfolio};generovane-utc;${new Date(data.generatedAt).toISOString()}`,
    "# suhrn",
    `realizovany-zisk-celkom-eur;${data.realized.totalRealizedGainEur.toFixed(4)}`,
    `zdanitelny-kratkodoby-zaklad-eur;${data.realized.netShortTermTaxableEur.toFixed(4)}`,
    `odhad-dane-celkom-eur;${data.skEstimate.estimatedTotalTaxEur.toFixed(4)}`,
  ];
  const disposals = tableToCsvRows({
    header: [...data.exportCsv.disposals.header] as string[],
    rows: data.exportCsv.disposals.rows as (string | number | boolean)[][],
  });
  const dividends = tableToCsvRows({
    header: [...data.exportCsv.dividends.header] as string[],
    rows: data.exportCsv.dividends.rows as (string | number | boolean)[][],
  });
  return (
    "\uFEFF" +
    [
      ...meta,
      "",
      "=== disposals_fifo ===",
      disposals,
      "",
      "=== dividends ===",
      dividends,
    ].join("\r\n")
  );
}

export default function TaxSummaryPage() {
  const { formatCurrency } = useCurrency();
  const { portfolios } = usePortfolio();

  const [year, setYear] = useState<number>(2025);
  const [portfolio, setPortfolio] = useState<string>("all");

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
  });

  const d = query.data;

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
    <div className="max-w-4xl mx-auto space-y-8 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Daňový asistent</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Ročné súčty pre orientáciu pred podaním a účtovníctvom. Čísla sú v EUR z backendu.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 flex-wrap items-end">
        <div className="space-y-2 w-full sm:w-44">
          <Label htmlFor="tax-year">Kalendárny rok</Label>
          <Select
            value={String(year)}
            onValueChange={(v) => setYear(parseInt(v, 10))}
          >
            <SelectTrigger id="tax-year" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEAR_CHOICES.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 flex-1 min-w-[200px]">
          <Label>Portfólio</Label>
          <Select value={portfolio} onValueChange={setPortfolio}>
            <SelectTrigger>
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
        <p className="text-xs text-muted-foreground w-full sm:max-w-md">
          Výber portfólia ovplyvňuje len túto stránku (dáta z API <code className="text-xs">/api/tax-summary</code>).
        </p>
      </div>

      {query.isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {query.isError && (
        <Card className="border-destructive/50">
          <CardContent className="pt-6 text-destructive text-sm">
            {(query.error as Error).message}
          </CardContent>
        </Card>
      )}

      {d && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card
              className={
                "border-2 " +
                (d.realized.longTermGainsEur > 0
                  ? "border-emerald-500/60 bg-emerald-500/5"
                  : "border-border")
              }
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 text-emerald-600">
                  <ShieldCheck className="h-5 w-5" />
                  <span className="text-xs font-medium uppercase">V suchu (orient.)</span>
                </div>
                <CardTitle className="text-base">{longTermLabel}</CardTitle>
                <CardDescription>holding ≥ 365 dní, realiz. zisk v EUR (FIFO diely)</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatCurrency(d.forForms.taxExempt.realizedGainsEur)}
                </p>
                {d.forForms.taxExempt.realizedLossesEur > 0.01 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Realiz. straty (dlh.): {formatCurrency(-d.forForms.taxExempt.realizedLossesEur)}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card
              className={
                "border-2 " +
                (d.realized.netShortTermTaxableEur > 0
                  ? "border-orange-500/50 bg-orange-500/5"
                  : "border-border")
              }
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 text-orange-600">
                  <BarChart2 className="h-5 w-5" />
                  <span className="text-xs font-medium uppercase">Krátkodobé</span>
                </div>
                <CardTitle className="text-base">{shortTermLabel}</CardTitle>
                <CardDescription>Zápočet kladné − straty v rámci roka</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold tabular-nums">
                  {formatCurrency(d.realized.netShortTermTaxableEur)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  +{formatCurrency(d.realized.taxableGainsEur)} / −{formatCurrency(d.realized.taxableLossesEur)} (zisk / strata)
                </p>
              </CardContent>
            </Card>

            <Card
              className={
                "border-2 " +
                (d.skEstimate.estimatedTotalTaxEur > 0
                  ? "border-destructive/50 bg-destructive/5"
                  : "border-border")
              }
            >
              <CardHeader className="pb-2">
                <div
                  className={
                    "flex items-center gap-2 " +
                    (d.skEstimate.estimatedTotalTaxEur > 0
                      ? "text-destructive"
                      : "text-muted-foreground")
                  }
                >
                  <AlertTriangle className="h-5 w-5" />
                  <span className="text-xs font-medium uppercase">Marec / dane</span>
                </div>
                <CardTitle className="text-base">Odhadovaná daň (19 % / pásy)</CardTitle>
                <CardDescription>Orient. podľa kratk. základu, nie konečné rozhodnutie</CardDescription>
              </CardHeader>
              <CardContent>
                <p
                  className={
                    "text-2xl font-bold tabular-nums " +
                    (d.skEstimate.estimatedTotalTaxEur > 0 ? "text-destructive" : "")
                  }
                >
                  {formatCurrency(d.skEstimate.estimatedTotalTaxEur)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Jednoducho 19 %: {formatCurrency(d.skEstimate.estimatedTaxEur19Simple)}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
            <Button
              onClick={onDownload}
              className="gap-2"
              variant="default"
              data-testid="button-tax-csv"
            >
              <FileDown className="h-4 w-4" />
              Exportovať pre účtovníctvo
            </Button>
            <p className="text-xs text-muted-foreground">
              Súbor CSV (UTF-8) – realizácie, dividendy a stručná meta. Otvorí sa v Excele.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Dividendy v roku {d.year}</CardTitle>
              <CardDescription>
                Hrubá, zrazená (pole commission v appke), čisté – v EUR. Zahraničné DTT nie sú automatická.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {d.dividends.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">V tomto roku žiadne dividendy v dátach.</p>
              ) : (
                <>
                  <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                    <div>
                      <div className="text-muted-foreground">Hrubý súčet</div>
                      <div className="font-semibold tabular-nums">
                        {formatCurrency(d.dividends.grossEur)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Zrážky (súčet, orient.)</div>
                      <div className="font-semibold tabular-nums">
                        {formatCurrency(d.dividends.withholdingEur)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Čisté</div>
                      <div className="font-semibold tabular-nums text-green-600">
                        {formatCurrency(d.dividends.netEur)}
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
                      {d.dividends.items.map((r) => (
                        <TableRow key={r.transactionId}>
                          <TableCell className="font-mono text-sm">{r.date}</TableCell>
                          <TableCell className="font-mono">{r.ticker}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(r.grossEur)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {formatCurrency(r.withholdingEur)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(r.netEur)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground border-t border-border/60 pt-4 leading-relaxed max-w-3xl">
            {d.disclaimer}
          </p>
        </>
      )}
    </div>
  );
}
