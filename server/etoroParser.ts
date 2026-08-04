import * as XLSX from "xlsx";
import { CASH_FLOW_TICKER } from "@shared/schema";
import type { ImportLogEntry, ParsedTransaction, XTBImportResult } from "./xtbParser";

const DERIVATIVE_TYPES = new Set(["CFD", "OPT", "FUT", "FOP", "Crypto Margin"]);
const TRADABLE_TYPES = new Set(["Stocks", "ETF"]);

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeHeader(value: unknown): string {
  return stripDiacritics(String(value ?? "").toLowerCase().trim());
}

function parseAmount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  let s = String(value)
    .replace(/[$€£]/g, "")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, "")
    .trim();
  if (!s || s === "-") return 0;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function parseEtoroDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (value == null || value === "") return null;
  const raw = String(value).trim();

  const dmy = raw.match(
    /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (dmy) {
    const d = new Date(
      Number(dmy[3]),
      Number(dmy[2]) - 1,
      Number(dmy[1]),
      Number(dmy[4] ?? 0),
      Number(dmy[5] ?? 0),
      Number(dmy[6] ?? 0),
    );
    if (!Number.isNaN(d.getTime())) return d;
  }

  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (ymd) {
    const d = new Date(
      Number(ymd[1]),
      Number(ymd[2]) - 1,
      Number(ymd[3]),
      Number(ymd[4] ?? 0),
      Number(ymd[5] ?? 0),
      Number(ymd[6] ?? 0),
    );
    if (!Number.isNaN(d.getTime())) return d;
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function findSheetName(sheetNames: string[], candidates: string[]): string | null {
  const normalized = sheetNames.map((name) => ({ name, norm: stripDiacritics(name.toLowerCase()) }));
  for (const candidate of candidates) {
    const c = stripDiacritics(candidate.toLowerCase());
    const hit = normalized.find((s) => s.norm === c || s.norm.includes(c));
    if (hit) return hit.name;
  }
  return null;
}

function sheetToRows(workbook: XLSX.WorkBook, sheetName: string): unknown[][] {
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) return [];
  return XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true }) as unknown[][];
}

function buildHeaderIndex(headerRow: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  headerRow.forEach((cell, index) => {
    const key = normalizeHeader(cell);
    if (key) map.set(key, index);
  });
  return map;
}

function col(headers: Map<string, number>, ...names: string[]): number | undefined {
  for (const name of names) {
    const idx = headers.get(normalizeHeader(name));
    if (idx != null) return idx;
  }
  return undefined;
}

function cell(row: unknown[], index: number | undefined): unknown {
  if (index == null || index < 0) return undefined;
  return row[index];
}

function cleanTicker(raw: string): string {
  const cleaned = raw.toUpperCase().trim();
  const mappings: Record<string, string> = {
    "BRK.B": "BRK-B",
    "BRK.A": "BRK-A",
  };
  return mappings[cleaned] || cleaned;
}

function extractTickerFromDetails(details: string): string | null {
  const trimmed = details.trim();
  if (!trimmed.includes("/")) return null;
  const slash = trimmed.lastIndexOf("/");
  const symbol = trimmed.slice(0, slash).trim().toUpperCase();
  return symbol ? cleanTicker(symbol) : null;
}

function extractTickerFromAction(action: string): string | null {
  const parts = action.trim().split(/\s+/);
  if (parts.length < 2) return null;
  return cleanTicker(parts.slice(1).join(" "));
}

function buildPositionSymbolMap(rows: unknown[][], log: ImportLogEntry[]): Map<number, string> {
  const map = new Map<number, string>();
  if (rows.length < 2) return map;

  const headers = buildHeaderIndex(rows[0]);
  const detailsIdx = col(headers, "Details");
  const positionIdx = col(headers, "Position ID");

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row?.length) continue;
    const details = String(cell(row, detailsIdx) ?? "").trim();
    const positionRaw = cell(row, positionIdx);
    const positionId = Number.parseInt(String(positionRaw ?? ""), 10);
    if (!Number.isFinite(positionId) || !details.includes("/")) continue;
    const ticker = extractTickerFromDetails(details);
    if (ticker) map.set(positionId, ticker);
  }

  log.push({
    row: 0,
    status: "success",
    message: `Mapovanie symbolov z Account Activity: ${map.size} pozícií`,
  });
  return map;
}

function eurPricePerShare(
  amountEur: number,
  units: number,
  instrumentRate: number,
  fxRate: number,
): { priceEur: number; instrumentPricePerShare?: number; exchangeRateAtTransaction?: number } {
  if (units > 0 && amountEur > 0) {
    return { priceEur: amountEur / units };
  }
  if (instrumentRate > 0 && fxRate > 0) {
    return {
      priceEur: instrumentRate / fxRate,
      instrumentPricePerShare: instrumentRate,
      exchangeRateAtTransaction: fxRate,
    };
  }
  if (instrumentRate > 0) {
    return { priceEur: instrumentRate, instrumentPricePerShare: instrumentRate };
  }
  return { priceEur: 0 };
}

function parseClosedPositions(
  rows: unknown[][],
  positionSymbols: Map<number, string>,
  log: ImportLogEntry[],
): ParsedTransaction[] {
  const out: ParsedTransaction[] = [];
  if (rows.length < 2) return out;

  const headers = buildHeaderIndex(rows[0]);
  const positionIdx = col(headers, "Position ID");
  const actionIdx = col(headers, "Action");
  const longShortIdx = col(headers, "Long / Short", "Long/Short");
  const amountIdx = col(headers, "Amount");
  const unitsIdx = col(headers, "Units / Contracts", "Units");
  const openDateIdx = col(headers, "Open Date");
  const closeDateIdx = col(headers, "Close Date");
  const leverageIdx = col(headers, "Leverage");
  const typeIdx = col(headers, "Type");
  const openRateIdx = col(headers, "Open Rate");
  const closeRateIdx = col(headers, "Close Rate");
  const fxOpenIdx = col(headers, "FX rate at open (USD)", "FX Rate at Open (USD)");
  const fxCloseIdx = col(headers, "FX rate at close (USD)", "FX Rate at Close (USD)");
  const profitEurIdx = col(headers, "Profit(EUR)", "Profit (EUR)");

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row?.length) continue;

    const assetType = String(cell(row, typeIdx) ?? "").trim();
    const leverage = parseAmount(cell(row, leverageIdx));
    const positionId = Number.parseInt(String(cell(row, positionIdx) ?? ""), 10);
    const action = String(cell(row, actionIdx) ?? "").trim();
    const longShort = String(cell(row, longShortIdx) ?? "").trim().toLowerCase();

    if (DERIVATIVE_TYPES.has(assetType) || leverage > 1) {
      log.push({
        row: i + 1,
        status: "skipped",
        message: `[${positionId || "?"}] Preskočené (${assetType || "derivát"}, leverage ${leverage || 1})`,
      });
      continue;
    }
    if (assetType && !TRADABLE_TYPES.has(assetType)) {
      log.push({
        row: i + 1,
        status: "skipped",
        message: `[${positionId || "?"}] Nepodporovaný typ aktíva: ${assetType}`,
      });
      continue;
    }

    const units = parseAmount(cell(row, unitsIdx));
    const amount = parseAmount(cell(row, amountIdx));
    const openDate = parseEtoroDate(cell(row, openDateIdx));
    const closeDate = parseEtoroDate(cell(row, closeDateIdx));
    if (!openDate || !closeDate || units <= 0) {
      log.push({
        row: i + 1,
        status: "warning",
        message: `[${positionId || "?"}] Neúplný riadok Closed Positions (dátum alebo units)`,
      });
      continue;
    }

    const ticker =
      (Number.isFinite(positionId) ? positionSymbols.get(positionId) : undefined) ||
      extractTickerFromAction(action) ||
      "";
    if (!ticker) {
      log.push({
        row: i + 1,
        status: "warning",
        message: `[${positionId || "?"}] Nepodarilo sa určiť ticker`,
      });
      continue;
    }

    const openRate = parseAmount(cell(row, openRateIdx));
    const closeRate = parseAmount(cell(row, closeRateIdx));
    const fxOpen = parseAmount(cell(row, fxOpenIdx));
    const fxClose = parseAmount(cell(row, fxCloseIdx));
    const profitEur = parseAmount(cell(row, profitEurIdx));

    const isLong = longShort.includes("long") || action.toLowerCase().startsWith("buy");
    if (!isLong) {
      log.push({
        row: i + 1,
        status: "skipped",
        message: `[${positionId}] Short pozície zatiaľ nie sú podporované`,
      });
      continue;
    }

    const openPricing = eurPricePerShare(amount, units, openRate, fxOpen || 1);
    const closeAmountEur =
      amount + (Number.isFinite(profitEur) ? profitEur : 0);
    const closePricing = eurPricePerShare(closeAmountEur, units, closeRate, fxClose || fxOpen || 1);

    const positionKey = Number.isFinite(positionId) ? String(positionId) : `row-${i + 1}`;

    out.push({
      date: openDate,
      ticker,
      type: "BUY",
      quantity: units,
      priceEur: openPricing.priceEur,
      totalAmountEur: amount > 0 ? amount : openPricing.priceEur * units,
      originalComment: action,
      externalId: `etoro:${positionKey}:open`,
      transactionId: `etoro:${positionKey}:open`,
      originalCurrency: openPricing.instrumentPricePerShare ? "USD" : "EUR",
      exchangeRateAtTransaction: openPricing.exchangeRateAtTransaction ?? 1,
      baseCurrencyAmount: amount > 0 ? amount : openPricing.priceEur * units,
      instrumentPricePerShare: openPricing.instrumentPricePerShare,
      companyName: action,
    });

    out.push({
      date: closeDate,
      ticker,
      type: "SELL",
      quantity: units,
      priceEur: closePricing.priceEur,
      totalAmountEur: closeAmountEur > 0 ? closeAmountEur : closePricing.priceEur * units,
      originalComment: action,
      externalId: `etoro:${positionKey}:close`,
      transactionId: `etoro:${positionKey}:close`,
      originalCurrency: closePricing.instrumentPricePerShare ? "USD" : "EUR",
      exchangeRateAtTransaction: closePricing.exchangeRateAtTransaction ?? (fxClose || 1),
      baseCurrencyAmount: closeAmountEur > 0 ? closeAmountEur : closePricing.priceEur * units,
      instrumentPricePerShare: closePricing.instrumentPricePerShare,
      companyName: action,
    });

    log.push({
      row: i + 1,
      status: "success",
      message: `[${positionKey}] ${ticker}: BUY ${units} @ open, SELL @ close`,
    });
  }

  return out;
}

function parseAccountActivity(rows: unknown[][], log: ImportLogEntry[]): ParsedTransaction[] {
  const out: ParsedTransaction[] = [];
  if (rows.length < 2) return out;

  const headers = buildHeaderIndex(rows[0]);
  const dateIdx = col(headers, "Date");
  const typeIdx = col(headers, "Type");
  const detailsIdx = col(headers, "Details");
  const amountIdx = col(headers, "Amount");
  const positionIdx = col(headers, "Position ID");

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row?.length) continue;

    const typeRaw = String(cell(row, typeIdx) ?? "").trim().toLowerCase();
    const amount = parseAmount(cell(row, amountIdx));
    const date = parseEtoroDate(cell(row, dateIdx));
    if (!date || amount === 0) continue;

    if (typeRaw.includes("deposit")) {
      out.push({
        date,
        ticker: CASH_FLOW_TICKER,
        type: "DEPOSIT",
        quantity: 0,
        priceEur: 0,
        totalAmountEur: Math.abs(amount),
        originalComment: String(cell(row, detailsIdx) ?? ""),
        transactionId: `etoro:activity:${i + 1}:deposit`,
        originalCurrency: "EUR",
        exchangeRateAtTransaction: 1,
        baseCurrencyAmount: Math.abs(amount),
        companyName: "Vklad (eToro)",
      });
      log.push({ row: i + 1, status: "success", message: `Vklad +${Math.abs(amount).toFixed(2)} EUR` });
      continue;
    }

    if (typeRaw.includes("withdraw")) {
      out.push({
        date,
        ticker: CASH_FLOW_TICKER,
        type: "WITHDRAWAL",
        quantity: 0,
        priceEur: 0,
        totalAmountEur: -Math.abs(amount),
        originalComment: String(cell(row, detailsIdx) ?? ""),
        transactionId: `etoro:activity:${i + 1}:withdraw`,
        originalCurrency: "EUR",
        exchangeRateAtTransaction: 1,
        baseCurrencyAmount: -Math.abs(amount),
        companyName: "Výber (eToro)",
      });
      log.push({ row: i + 1, status: "success", message: `Výber -${Math.abs(amount).toFixed(2)} EUR` });
      continue;
    }

    if (typeRaw.includes("open position") || typeRaw.includes("position closed")) {
      continue;
    }

    const positionId = String(cell(row, positionIdx) ?? "").trim();
    if (positionId) {
      log.push({
        row: i + 1,
        status: "skipped",
        message: `[${positionId}] Account Activity: ${typeRaw || "neznámy typ"}`,
      });
    }
  }

  return out;
}

function parseDividends(
  rows: unknown[][],
  positionSymbols: Map<number, string>,
  log: ImportLogEntry[],
): ParsedTransaction[] {
  const out: ParsedTransaction[] = [];
  if (rows.length < 2) return out;

  const headers = buildHeaderIndex(rows[0]);
  const dateIdx = col(headers, "Date of Payment", "Date");
  const nameIdx = col(headers, "Instrument Name", "Instrument");
  const netEurIdx = col(headers, "Net Dividend Received (EUR)", "Net dividends");
  const netUsdIdx = col(headers, "Net Dividend Received (USD)");
  const taxEurIdx = col(headers, "Withholding Tax Amount (EUR)");
  const taxUsdIdx = col(headers, "Withholding Tax Amount (USD)");
  const positionIdx = col(headers, "Position ID");

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row?.length) continue;

    const date = parseEtoroDate(cell(row, dateIdx));
    const netEur = parseAmount(cell(row, netEurIdx));
    const netUsd = parseAmount(cell(row, netUsdIdx));
    const taxEur = parseAmount(cell(row, taxEurIdx));
    const taxUsd = parseAmount(cell(row, taxUsdIdx));
    const positionId = Number.parseInt(String(cell(row, positionIdx) ?? ""), 10);
    const instrumentName = String(cell(row, nameIdx) ?? "").trim();

    const dividendEur = netEur > 0 ? netEur : 0;
    const dividendUsd = netUsd > 0 ? netUsd : 0;
    const taxAmountEur = taxEur > 0 ? taxEur : taxUsd > 0 ? taxUsd : 0;

    if (!date || (dividendEur <= 0 && dividendUsd <= 0)) continue;

    const ticker =
      (Number.isFinite(positionId) ? positionSymbols.get(positionId) : undefined) ||
      (instrumentName ? cleanTicker(instrumentName.split(/\s+/)[0]) : "DIVIDEND");

    const amountEur = dividendEur > 0 ? dividendEur : dividendUsd;
    const positionKey = Number.isFinite(positionId) ? String(positionId) : `div-${i + 1}`;

    out.push({
      date,
      ticker,
      type: "DIVIDEND",
      quantity: 0,
      priceEur: 0,
      totalAmountEur: amountEur,
      originalComment: instrumentName,
      externalId: `etoro:${positionKey}:dividend`,
      transactionId: `etoro:${positionKey}:dividend`,
      originalCurrency: dividendEur > 0 ? "EUR" : "USD",
      exchangeRateAtTransaction: 1,
      baseCurrencyAmount: amountEur,
      companyName: instrumentName || ticker,
    });

    if (taxAmountEur > 0) {
      out.push({
        date,
        ticker,
        type: "TAX",
        quantity: 0,
        priceEur: 0,
        totalAmountEur: -taxAmountEur,
        originalComment: `Withholding tax — ${instrumentName}`,
        externalId: `etoro:${positionKey}:dividend-tax`,
        transactionId: `etoro:${positionKey}:dividend-tax`,
        linkedDividendId: `etoro:${positionKey}:dividend`,
        originalCurrency: taxEur > 0 ? "EUR" : "USD",
        exchangeRateAtTransaction: 1,
        baseCurrencyAmount: -taxAmountEur,
        companyName: instrumentName || ticker,
      });
    }

    log.push({
      row: i + 1,
      status: "success",
      message: `[${ticker}] Dividenda ${amountEur.toFixed(2)}${taxAmountEur > 0 ? `, daň -${taxAmountEur.toFixed(2)}` : ""}`,
    });
  }

  return out;
}

function summarize(log: ImportLogEntry[], transactions: ParsedTransaction[]): XTBImportResult {
  return {
    transactions,
    log,
    summary: {
      total: log.length,
      success: log.filter((l) => l.status === "success").length,
      warnings: log.filter((l) => l.status === "warning").length,
      errors: log.filter((l) => l.status === "error").length,
      skipped: log.filter((l) => l.status === "skipped").length,
    },
  };
}

export async function parseEtoroFile(fileBuffer: Buffer, _fileName: string): Promise<XTBImportResult> {
  const log: ImportLogEntry[] = [];
  const transactions: ParsedTransaction[] = [];

  try {
    const workbook = XLSX.read(fileBuffer, { type: "buffer", cellDates: true });
    log.push({
      row: 0,
      status: "success",
      message: `Nájdené hárky: ${workbook.SheetNames.join(", ")}`,
    });

    const activitySheet = findSheetName(workbook.SheetNames, ["Account Activity", "Account activity"]);
    const closedSheet = findSheetName(workbook.SheetNames, ["Closed Positions", "Closed positions"]);
    const dividendsSheet = findSheetName(workbook.SheetNames, ["Dividends"]);

    if (!activitySheet && !closedSheet && !dividendsSheet) {
      log.push({
        row: 0,
        status: "error",
        message:
          "Nerozpoznaný eToro export. Očakávame Account Statement XLS s hárkami Account Activity / Closed Positions / Dividends.",
      });
      return summarize(log, transactions);
    }

    const positionSymbols = activitySheet
      ? buildPositionSymbolMap(sheetToRows(workbook, activitySheet), log)
      : new Map<number, string>();

    if (closedSheet) {
      log.push({ row: 0, status: "success", message: `Spracovávam hárok: ${closedSheet}` });
      transactions.push(
        ...parseClosedPositions(sheetToRows(workbook, closedSheet), positionSymbols, log),
      );
    } else {
      log.push({
        row: 0,
        status: "warning",
        message: "Hárok Closed Positions nenájdený — nákupy/predaje nebudú importované.",
      });
    }

    if (activitySheet) {
      log.push({ row: 0, status: "success", message: `Spracovávam hárok: ${activitySheet}` });
      transactions.push(...parseAccountActivity(sheetToRows(workbook, activitySheet), log));
    }

    if (dividendsSheet) {
      log.push({ row: 0, status: "success", message: `Spracovávam hárok: ${dividendsSheet}` });
      transactions.push(...parseDividends(sheetToRows(workbook, dividendsSheet), positionSymbols, log));
    }

    transactions.sort((a, b) => a.date.getTime() - b.date.getTime());
    return summarize(log, transactions);
  } catch (error) {
    log.push({
      row: 0,
      status: "error",
      message: `Chyba pri spracovaní súboru: ${error instanceof Error ? error.message : "Neznáma chyba"}`,
    });
    return summarize(log, []);
  }
}
