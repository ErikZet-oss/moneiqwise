export type TaxCsvTable = {
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
    disposals: TaxCsvTable;
    dividends: TaxCsvTable;
  };
  portfolio: string;
  availableYears?: number[];
  generatedAt: number;
};

/** API / persist cache môže vrátiť numeric ako string alebo NaN. */
export function finiteEur(n: unknown): number {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string" && n.trim() !== "") {
    const x = parseFloat(n);
    if (Number.isFinite(x)) return x;
  }
  return 0;
}

function escapeCsvField(value: string | number | boolean): string {
  const s = value === true ? "true" : value === false ? "false" : String(value);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function tableToCsvRows(table: TaxCsvTable): string {
  const lines: string[] = [table.header.map(escapeCsvField).join(",")];
  for (const row of table.rows) {
    lines.push(row.map(escapeCsvField).join(","));
  }
  return lines.join("\r\n");
}

export function buildAccountantBundleCsv(data: TaxSummaryApiResponse): string {
  const meta = [
    "# moneiqwise;danove-podklady;utf-8",
    `# rok;${data.year};portfolio;${data.portfolio};generovane-utc;${new Date(data.generatedAt).toISOString()}`,
    "# suhrn",
    `realizovany-zisk-celkom-eur;${finiteEur(data.realized?.totalRealizedGainEur).toFixed(4)}`,
    `zdanitelny-kratkodoby-zaklad-eur;${finiteEur(data.realized?.netShortTermTaxableEur).toFixed(4)}`,
    `odhad-dane-celkom-eur;${finiteEur(data.skEstimate?.estimatedTotalTaxEur).toFixed(4)}`,
  ];
  const disposals = tableToCsvRows({
    header: [...(data.exportCsv?.disposals?.header ?? [])] as string[],
    rows: (data.exportCsv?.disposals?.rows ?? []) as (string | number | boolean)[][],
  });
  const dividends = tableToCsvRows({
    header: [...(data.exportCsv?.dividends?.header ?? [])] as string[],
    rows: (data.exportCsv?.dividends?.rows ?? []) as (string | number | boolean)[][],
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
