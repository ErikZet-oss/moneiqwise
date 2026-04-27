import * as XLSX from "xlsx";
import type { Transaction } from "@shared/schema";
import type { AllExchangeRates } from "@shared/convertAmountBetween";
import { inferTradeCurrency } from "@shared/transactionEur";
import type { HistoryPoint } from "./portfolioHistorySeries";
import type { OpenFifoLot } from "@shared/fifoRealizedGains";
import type { RealizedGainsComputedSummary } from "@shared/realizedGainsTypes";

function aoaSheet(name: string, rows: (string | number | null | undefined)[][]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = rows[0]?.map(() => ({ wch: 14 })) ?? [];
  return ws;
}

function jsonSheet<T extends Record<string, unknown>>(name: string, rows: T[]): XLSX.WorkSheet {
  if (rows.length === 0) {
    return XLSX.utils.aoa_to_sheet([[`(${name}: žiadne riadky)`]]);
  }
  return XLSX.utils.json_to_sheet(rows);
}

export function buildCalculationAuditWorkbook(params: {
  portfolioParam: string;
  portfolioLabel: string;
  userCurrency: string;
  generatedAtIso: string;
  methodNote: string;
  rates: AllExchangeRates;
  transactions: Transaction[];
  eurPerUnitByTxnId: Map<string, number | null>;
  historyPoints: HistoryPoint[];
  fifoSummary: RealizedGainsComputedSummary;
  fifoRealizedByYear: Record<number, number>;
  fifoRealizedByYearMonth: Record<string, number>;
  openLots: Record<string, OpenFifoLot[]>;
}): Buffer {
  const wb = XLSX.utils.book_new();

  const metaRows: (string | number)[][] = [
    ["Kľúč", "Hodnota"],
    ["Portfólio (param)", params.portfolioParam],
    ["Portfólio (názov)", params.portfolioLabel],
    ["Preferovaná mena (MTM série)", params.userCurrency],
    ["Vygenerované (UTC)", params.generatedAtIso],
    ["Metodika MTM / TWR", params.methodNote],
    [
      "Popis",
      "Transakcie = stav z DB. Denne_MTMTWR = rovnaký výpočet ako grafy (MTM + hotovosť, čisté vklady, segment TWR). FIFO = interný FIFO v EUR podľa kurzov pri transakcii.",
    ],
  ];
  XLSX.utils.book_append_sheet(wb, aoaSheet("Meta", metaRows), "Meta");

  const rateRows: (string | number)[][] = [["Kurz", "Hodnota"]];
  for (const [k, v] of Object.entries(params.rates)) {
    if (typeof v === "number" && Number.isFinite(v)) rateRows.push([k, v]);
  }
  XLSX.utils.book_append_sheet(wb, aoaSheet("Kurzy_ECB_snapshot", rateRows), "Kurzy_ECB_snapshot");

  const txRows = params.transactions.map((t) => ({
    id: t.id,
    transactionDate: t.transactionDate
      ? new Date(t.transactionDate as unknown as string).toISOString()
      : "",
    portfolioId: t.portfolioId ?? "",
    type: t.type,
    ticker: t.ticker,
    companyName: t.companyName,
    shares: String(t.shares),
    pricePerShare: String(t.pricePerShare),
    commission: String(t.commission ?? ""),
    currency: t.currency ?? "",
    originalCurrency: t.originalCurrency ?? "",
    exchangeRateAtTransaction: t.exchangeRateAtTransaction != null ? String(t.exchangeRateAtTransaction) : "",
    baseCurrencyAmount: t.baseCurrencyAmount != null ? String(t.baseCurrencyAmount) : "",
    inferredTradeCcy: inferTradeCurrency(t),
    eurPerUnitComputed: (() => {
      const v = params.eurPerUnitByTxnId.get(t.id);
      return v == null ? "" : String(v);
    })(),
    realizedGainDb: String(t.realizedGain ?? ""),
    costBasis: String(t.costBasis ?? ""),
    externalId: t.externalId ?? "",
    transactionId: t.transactionId ?? "",
  }));
  XLSX.utils.book_append_sheet(wb, jsonSheet("Transakcie", txRows as unknown as Record<string, unknown>[]), "Transakcie");

  const dailyHeader: (string | number | null | undefined)[][] = [
    [
      "date",
      `totalValue_${params.userCurrency}`,
      `netInvested_${params.userCurrency}`,
      `deltaTotal_${params.userCurrency}`,
      "portfolioCumulativePct",
      "sp500CumulativePct",
    ],
  ];
  const dailyBody = params.historyPoints.map((p, i) => {
    const prev = i > 0 ? params.historyPoints[i - 1] : null;
    const delta = prev ? p.totalValue - prev.totalValue : 0;
    return [
      p.date,
      p.totalValue,
      p.netInvested,
      delta,
      p.portfolioCumulativePct,
      p.sp500CumulativePct,
    ];
  });
  XLSX.utils.book_append_sheet(wb, aoaSheet("Denne_MTMTWR", [...dailyHeader, ...dailyBody]), "Denne_MTMTWR");

  const byYear = Object.entries(params.fifoRealizedByYear)
    .map(([y, v]) => ({ rok: Number(y), realizovanyZiskEUR: v }))
    .sort((a, b) => a.rok - b.rok);
  XLSX.utils.book_append_sheet(wb, jsonSheet("FIFO_rok_EUR", byYear as unknown as Record<string, unknown>[]), "FIFO_rok_EUR");

  const byYm = Object.entries(params.fifoRealizedByYearMonth)
    .map(([ym, v]) => ({ rokMesiac: ym, realizovanyZiskEUR: v }))
    .sort((a, b) => a.rokMesiac.localeCompare(b.rokMesiac));
  XLSX.utils.book_append_sheet(
    wb,
    jsonSheet("FIFO_mesiac_EUR", byYm as unknown as Record<string, unknown>[]),
    "FIFO_mesiac_EUR",
  );

  const tickerSum = params.fifoSummary.byTicker.map((r) => ({
    ticker: r.ticker,
    companyName: r.companyName,
    realizovanyZiskEUR: r.totalGain,
    predajEurSuma: r.totalSold,
    pocetPredajov: r.transactions,
  }));
  XLSX.utils.book_append_sheet(wb, jsonSheet("FIFO_ticker_EUR", tickerSum as unknown as Record<string, unknown>[]), "FIFO_ticker_EUR");

  const lotRows: Record<string, unknown>[] = [];
  for (const [lotKey, lots] of Object.entries(params.openLots)) {
    for (const lot of lots) {
      if (lot.remainingShares <= 1e-12) continue;
      lotRows.push({
        lotKey,
        acquiredAt: lot.acquiredAt,
        remainingShares: lot.remainingShares,
        costPerShareEur: lot.costPerShareEur,
        priceLocal: lot.priceLocal,
        eurPerUnit: lot.eurPerUnit,
        ccy: lot.ccy,
      });
    }
  }
  XLSX.utils.book_append_sheet(wb, jsonSheet("FIFO_otvorene_loty", lotRows), "FIFO_otvorene_loty");

  const fifoMetaRows: (string | number)[][] = [
    ["Položka", "EUR"],
    ["Celkový realizovaný zisk (FIFO)", params.fifoSummary.totalRealized],
    ["Realizovaný YTD", params.fifoSummary.realizedYTD],
    ["Realizovaný tento mesiac", params.fifoSummary.realizedThisMonth],
    ["Realizovaný dnes", params.fifoSummary.realizedToday],
    ["Počet spracovaných predajov (FIFO engine)", params.fifoSummary.transactionCount],
  ];
  XLSX.utils.book_append_sheet(wb, aoaSheet("FIFO_suhrn", fifoMetaRows), "FIFO_suhrn");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
