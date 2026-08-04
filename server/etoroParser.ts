import * as XLSX from "xlsx";
import { CASH_FLOW_TICKER } from "@shared/schema";
import type { ImportLogEntry, ParsedTransaction, XTBImportResult } from "./xtbParser";

const TRADABLE_ASSETS = new Set(["Stocks", "ETF", "Crypto"]);

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

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function findSheetName(sheetNames: string[], candidates: string[]): string | null {
  for (const candidate of candidates) {
    const c = stripDiacritics(candidate.toLowerCase());
    const hit = sheetNames.find((name) => {
      const n = stripDiacritics(name.toLowerCase());
      return n === c || n.includes(c);
    });
    if (hit) return hit;
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
    "CON.DE": "CON.DE",
  };
  return mappings[cleaned] || cleaned;
}

function parseInstrument(details: string): { ticker: string; quoteCurrency: string } | null {
  const trimmed = details.trim();
  const slash = trimmed.lastIndexOf("/");
  if (slash <= 0) return null;
  const symbol = trimmed.slice(0, slash).trim().toUpperCase();
  const quoteCurrency = trimmed.slice(slash + 1).trim().toUpperCase();
  if (!symbol || !quoteCurrency) return null;
  return { ticker: cleanTicker(symbol), quoteCurrency };
}

function parseEurFromDetails(details: string): number | null {
  const match = details.match(/([\d.,]+)\s*EUR\b/i);
  if (!match) return null;
  const n = parseAmount(match[1]);
  return n > 0 ? n : null;
}

function parseUnits(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-") return 0;
  return parseAmount(value);
}

function pricingFromActivity(
  amount: number,
  units: number,
  quoteCurrency: string,
): {
  priceEur: number;
  originalCurrency: string;
  instrumentPricePerShare?: number;
  baseCurrencyAmount: number;
} {
  const perShare = units > 0 ? amount / units : 0;
  if (quoteCurrency === "EUR") {
    return {
      priceEur: perShare,
      originalCurrency: "EUR",
      baseCurrencyAmount: amount,
    };
  }
  return {
    priceEur: perShare,
    originalCurrency: quoteCurrency || "USD",
    instrumentPricePerShare: perShare,
    baseCurrencyAmount: amount,
  };
}

/** Primárny zdroj: hárok Account Activity (všetky transakcie). */
function parseAccountActivity(rows: unknown[][], log: ImportLogEntry[]): ParsedTransaction[] {
  const out: ParsedTransaction[] = [];
  if (rows.length < 2) return out;

  const headers = buildHeaderIndex(rows[0]);
  const dateIdx = col(headers, "Date");
  const typeIdx = col(headers, "Type");
  const detailsIdx = col(headers, "Details");
  const amountIdx = col(headers, "Amount");
  const unitsIdx = col(headers, "Units / Contracts", "Units");
  const positionIdx = col(headers, "Position ID");
  const assetTypeIdx = col(headers, "Asset type");

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row?.length) continue;

    const typeRaw = String(cell(row, typeIdx) ?? "").trim();
    const typeNorm = typeRaw.toLowerCase();
    const details = String(cell(row, detailsIdx) ?? "").trim();
    const amount = parseAmount(cell(row, amountIdx));
    const units = parseUnits(cell(row, unitsIdx));
    const date = parseEtoroDate(cell(row, dateIdx));
    const positionRaw = String(cell(row, positionIdx) ?? "").trim();
    const positionId = positionRaw && positionRaw !== "-" ? positionRaw : "";
    const assetType = String(cell(row, assetTypeIdx) ?? "").trim();

    if (!date) {
      log.push({ row: i + 1, status: "warning", message: `[${typeRaw}] Chýba dátum` });
      continue;
    }

    if (typeNorm === "deposit") {
      if (amount === 0) continue;
      const eurFromDetails = parseEurFromDetails(details);
      const depositEur = eurFromDetails ?? Math.abs(amount);
      out.push({
        date,
        ticker: CASH_FLOW_TICKER,
        type: "DEPOSIT",
        quantity: 0,
        priceEur: 0,
        totalAmountEur: depositEur,
        originalComment: details || typeRaw,
        transactionId: `etoro:activity:${positionId || i + 1}:deposit:${date.getTime()}`,
        originalCurrency: eurFromDetails != null ? "EUR" : "USD",
        exchangeRateAtTransaction: 1,
        baseCurrencyAmount: depositEur,
        companyName: "Vklad (eToro)",
      });
      log.push({ row: i + 1, status: "success", message: `Vklad +${depositEur.toFixed(2)}` });
      continue;
    }

    if (typeNorm === "deposit conversion fee") {
      if (amount === 0) continue;
      const fee = Math.abs(amount);
      out.push({
        date,
        ticker: CASH_FLOW_TICKER,
        type: "TAX",
        quantity: 0,
        priceEur: 0,
        totalAmountEur: -fee,
        originalComment: details || "Deposit Conversion Fee",
        transactionId: `etoro:activity:${i + 1}:conv-fee:${date.getTime()}`,
        originalCurrency: "USD",
        exchangeRateAtTransaction: 1,
        baseCurrencyAmount: -fee,
        companyName: "Poplatok za konverziu vkladu (eToro)",
      });
      log.push({ row: i + 1, status: "success", message: `Poplatok za konverziu vkladu -${fee.toFixed(2)}` });
      continue;
    }

    if (typeNorm.includes("withdraw")) {
      if (amount === 0) continue;
      out.push({
        date,
        ticker: CASH_FLOW_TICKER,
        type: "WITHDRAWAL",
        quantity: 0,
        priceEur: 0,
        totalAmountEur: -Math.abs(amount),
        originalComment: details || typeRaw,
        transactionId: `etoro:activity:${i + 1}:withdraw:${date.getTime()}`,
        originalCurrency: "EUR",
        exchangeRateAtTransaction: 1,
        baseCurrencyAmount: -Math.abs(amount),
        companyName: "Výber (eToro)",
      });
      log.push({ row: i + 1, status: "success", message: `Výber -${Math.abs(amount).toFixed(2)}` });
      continue;
    }

    if (typeNorm === "opening and closing spread") {
      log.push({
        row: i + 1,
        status: "skipped",
        message: `[${positionId || "?"}] Spread ${details || ""} (${amount})`,
      });
      continue;
    }

    if (typeNorm === "open position" || typeNorm === "position closed") {
      if (assetType && !TRADABLE_ASSETS.has(assetType)) {
        log.push({
          row: i + 1,
          status: "skipped",
          message: `[${positionId || "?"}] ${typeRaw} — ${assetType} (nepodporovaný typ aktíva)`,
        });
        continue;
      }

      const instrument = parseInstrument(details);
      if (!instrument || units <= 0 || amount === 0) {
        log.push({
          row: i + 1,
          status: "warning",
          message: `[${positionId || "?"}] ${typeRaw} — neúplné dáta (${details})`,
        });
        continue;
      }

      const pricing = pricingFromActivity(amount, units, instrument.quoteCurrency);
      const isBuy = typeNorm === "open position";
      const txType = isBuy ? "BUY" : "SELL";
      const suffix = isBuy ? "open" : "close";
      const txKey = positionId || `${i + 1}`;

      out.push({
        date,
        ticker: instrument.ticker,
        type: txType,
        quantity: units,
        priceEur: pricing.priceEur,
        totalAmountEur: pricing.baseCurrencyAmount,
        originalComment: `${typeRaw}: ${details}`,
        externalId: `etoro:${txKey}:${suffix}`,
        transactionId: `etoro:${txKey}:${suffix}`,
        originalCurrency: pricing.originalCurrency,
        exchangeRateAtTransaction: 1,
        baseCurrencyAmount: pricing.baseCurrencyAmount,
        instrumentPricePerShare: pricing.instrumentPricePerShare,
        companyName: details,
      });

      log.push({
        row: i + 1,
        status: "success",
        message: `[${txKey}] ${instrument.ticker} ${txType} ${units} @ ${pricing.priceEur.toFixed(2)} (${instrument.quoteCurrency})`,
      });
      continue;
    }

    if (typeRaw) {
      log.push({
        row: i + 1,
        status: "skipped",
        message: `Nepodporovaný typ: ${typeRaw}`,
      });
    }
  }

  return out;
}

function parseDividends(
  rows: unknown[][],
  tickerByPosition: Map<string, string>,
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
    const positionRaw = String(cell(row, positionIdx) ?? "").trim();
    const positionKey = positionRaw && positionRaw !== "-" ? positionRaw : `div-${i + 1}`;
    const instrumentName = String(cell(row, nameIdx) ?? "").trim();

    const dividendEur = netEur > 0 ? netEur : 0;
    const dividendUsd = netUsd > 0 ? netUsd : 0;
    const taxAmount = taxEur > 0 ? taxEur : taxUsd > 0 ? taxUsd : 0;

    if (!date || (dividendEur <= 0 && dividendUsd <= 0)) continue;

    const ticker =
      tickerByPosition.get(positionKey) ||
      (instrumentName ? cleanTicker(instrumentName.split(/\s+/)[0]) : "DIVIDEND");

    const amountEur = dividendEur > 0 ? dividendEur : dividendUsd;

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

    if (taxAmount > 0) {
      out.push({
        date,
        ticker,
        type: "TAX",
        quantity: 0,
        priceEur: 0,
        totalAmountEur: -taxAmount,
        originalComment: `Withholding tax — ${instrumentName}`,
        externalId: `etoro:${positionKey}:dividend-tax`,
        transactionId: `etoro:${positionKey}:dividend-tax`,
        linkedDividendId: `etoro:${positionKey}:dividend`,
        originalCurrency: taxEur > 0 ? "EUR" : "USD",
        exchangeRateAtTransaction: 1,
        baseCurrencyAmount: -taxAmount,
        companyName: instrumentName || ticker,
      });
    }

    log.push({
      row: i + 1,
      status: "success",
      message: `[${ticker}] Dividenda ${amountEur.toFixed(2)}${taxAmount > 0 ? `, daň -${taxAmount.toFixed(2)}` : ""}`,
    });
  }

  return out;
}

function buildPositionTickerMap(rows: unknown[][]): Map<string, string> {
  const map = new Map<string, string>();
  if (rows.length < 2) return map;

  const headers = buildHeaderIndex(rows[0]);
  const detailsIdx = col(headers, "Details");
  const positionIdx = col(headers, "Position ID");

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const details = String(cell(row, detailsIdx) ?? "").trim();
    const positionRaw = String(cell(row, positionIdx) ?? "").trim();
    if (!positionRaw || positionRaw === "-" || !details.includes("/")) continue;
    const instrument = parseInstrument(details);
    if (instrument) map.set(positionRaw, instrument.ticker);
  }
  return map;
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

    const activitySheet = findSheetName(workbook.SheetNames, ["Account Activity"]);
    const dividendsSheet = findSheetName(workbook.SheetNames, ["Dividends"]);

    if (!activitySheet) {
      log.push({
        row: 0,
        status: "error",
        message:
          "Chýba hárok Account Activity. Stiahnite Account Statement z eToro (Profil → Nastavenia → Account Statement).",
      });
      return summarize(log, transactions);
    }

    const activityRows = sheetToRows(workbook, activitySheet);
    log.push({ row: 0, status: "success", message: `Spracovávam hárok: ${activitySheet}` });

    const tickerByPosition = buildPositionTickerMap(activityRows);
    transactions.push(...parseAccountActivity(activityRows, log));

    if (dividendsSheet) {
      log.push({ row: 0, status: "success", message: `Spracovávam hárok: ${dividendsSheet}` });
      transactions.push(
        ...parseDividends(sheetToRows(workbook, dividendsSheet), tickerByPosition, log),
      );
    }

    transactions.sort((a, b) => a.date.getTime() - b.date.getTime());
    log.push({
      row: 0,
      status: "success",
      message: `Celkom transakcií na import: ${transactions.length}`,
    });

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
