import * as XLSX from 'xlsx';
import { CASH_FLOW_TICKER } from '@shared/schema';

/** Odstráni kombinujúce znaky (diakritiku); nepoužívame \p{M} kvôli kompatibilite s runtime/TS. */
function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export interface ParsedTransaction {
  date: Date;
  ticker: string;
  type: 'BUY' | 'SELL' | 'DIVIDEND' | 'TAX' | 'DEPOSIT' | 'WITHDRAWAL';
  quantity: number;
  priceEur: number;
  totalAmountEur: number;
  originalComment?: string;
  externalId?: string; // XTB transaction/position ID
  linkedDividendId?: string; // For TAX entries - links to parent DIVIDEND externalId
  /** Preferovaný kľúč pre deduplikáciu importu (pre hotovostné operácie = XTB ID). */
  transactionId?: string;
  /** Mena účtu / sumy na riadku (z metadát exportu, predvolene EUR). */
  originalCurrency?: string;
  /** Kurz pôvodnej meny do EUR; pri EUR účte 1. */
  exchangeRateAtTransaction?: number;
  /** Suma v EUR (základná mena) — pri EUR účte zhodné s |Amount|. */
  baseCurrencyAmount?: number;
  /** Voliteľný názov v histórii (napr. „Close trade“ namiesto všeobecného Vklad/Výber). */
  companyName?: string;
}

export interface ImportLogEntry {
  row: number;
  status: 'success' | 'warning' | 'error' | 'skipped';
  message: string;
  data?: ParsedTransaction;
  originalData?: Record<string, any>;
}

export interface XTBImportResult {
  transactions: ParsedTransaction[];
  log: ImportLogEntry[];
  summary: {
    total: number;
    success: number;
    warnings: number;
    errors: number;
    skipped: number;
  };
}

/**
 * Normalizácia tickeru pre Yahoo Finance.
 * Neodstraňujeme .DE / .L / .MI / … — Yahoo ich pri európskych nástrojoch vyžaduje (napr. SXR8.DE, RRU.DE).
 * Odstránenie .DE/.L spôsobovalo zlé kotácie ETF a 0 % zisku (iný nástroj alebo prázdne dáta).
 * Redundantné je hlavne .US (US akcie Yahoo uvádza bez prípony).
 */
function cleanTicker(ticker: string): string {
  if (!ticker) return "";

  let cleaned = ticker.toUpperCase().trim();

  // XTB „.UK“ (Londýn) → Yahoo „.L“ (LSE)
  if (cleaned.endsWith(".UK")) {
    cleaned = `${cleaned.slice(0, -3)}.L`;
  }
  // XTB Francúzsko „.FR“ = Euronext Paríž; Yahoo má ten istý nástroj ako „.PA“, nie .FR
  if (cleaned.endsWith(".FR")) {
    cleaned = `${cleaned.slice(0, -3)}.PA`;
  }

  const redundantSuffixes = [".US"];
  for (const suffix of redundantSuffixes) {
    if (cleaned.endsWith(suffix)) {
      cleaned = cleaned.slice(0, -suffix.length);
      break;
    }
  }

  const tickerMappings: Record<string, string> = {
    "BRK.B": "BRK-B",
    "BRK.A": "BRK-A",
    "BF.B": "BF-B",
    "BF.A": "BF-A",
    "UST.FR": "UST.MI",
    "ASML.NL": "ASML",
    /** XTB „.NL“ (Amsterdam); Yahoo kotuje napr. IMAE ako IMAE.AS */
    "IMAE.NL": "IMAE.AS",
    // Rolls-Royce: XTB/Yahoo LSE aj pri „RR“ mapovať na Xetra pre jednotné kotácie
    RR: "RRU.DE",
    "RR.L": "RRU.DE",
  };

  return tickerMappings[cleaned] || cleaned;
}

// Parse amount string (handle commas, currency symbols, thousands separators, NBSP)
function parseAmount(amountStr: string | number): number {
  if (typeof amountStr === 'number') {
    return Number.isFinite(amountStr) ? amountStr : 0;
  }
  if (!amountStr) return 0;

  let s = amountStr
    .toString()
    .replace(/[$€£]/g, '')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\s+/g, '')
    .trim();

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // 1.234,56 → 1234.56 alebo 1,234.56 → 1234.56
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma && !hasDot) {
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length <= 4) {
      s = `${parts[0].replace(/\D/g, '') || parts[0]}.${parts[1]}`;
    } else {
      s = s.replace(/,/g, '');
    }
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

// Parse date from various formats
function parseDate(dateStr: string | Date | number): Date | null {
  if (!dateStr) return null;
  
  if (dateStr instanceof Date) return dateStr;
  
  // Excel serial date number
  if (typeof dateStr === 'number') {
    const parsed = XLSX.SSF.parse_date_code(dateStr);
    if (parsed) {
      return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, parsed.S || 0);
    }
    return null;
  }
  
  const dateString = dateStr.toString().trim();

  // Excel serial ako reťazec "45370" (niekedy pri exporte)
  const numericTry = Number(dateString.replace(',', '.'));
  if (
    Number.isFinite(numericTry) &&
    numericTry > 20000 &&
    numericTry < 80000 &&
    /^\d+([.,]\d+)?$/.test(dateString.trim())
  ) {
    const parsedSerial = XLSX.SSF.parse_date_code(numericTry);
    if (parsedSerial) {
      return new Date(
        parsedSerial.y,
        parsedSerial.m - 1,
        parsedSerial.d,
        parsedSerial.H || 0,
        parsedSerial.M || 0,
        parsedSerial.S || 0
      );
    }
  }

  // Format: DD/MM/YYYY HH:MM:SS
  let match = dateString.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (match) {
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = match;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 
                    parseInt(hour), parseInt(minute), parseInt(second));
  }
  
  // Format: DD.MM.YYYY HH:MM:SS
  match = dateString.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (match) {
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = match;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 
                    parseInt(hour), parseInt(minute), parseInt(second));
  }
  
  // Format: YYYY-MM-DD
  match = dateString.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const [, year, month, day] = match;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  }
  
  // Try native Date parsing
  const parsed = new Date(dateString);
  if (!isNaN(parsed.getTime())) return parsed;
  
  return null;
}

// Find header row in data
function findHeaderRow(data: any[][], headerKeywords: string[]): { headerIndex: number; headers: string[] } {
  for (let i = 0; i < Math.min(20, data.length); i++) {
    const row = data[i];
    if (!row) continue;
    
    const rowStr = row.map(c => (c || '').toString().toLowerCase()).join(' ');
    const matchCount = headerKeywords.filter(kw => rowStr.includes(kw.toLowerCase())).length;
    
    if (matchCount >= 2) {
      return {
        headerIndex: i,
        headers: row.map(c => (c || '').toString().toLowerCase().trim())
      };
    }
  }
  return { headerIndex: -1, headers: [] };
}

/** Z horných riadkov XTB exportu ( bunka „Currency“ + riadok pod ňou ) — ISO 4217, inak EUR. */
function parseAccountCurrencyFromXtBMeta(data: any[][]): string {
  for (let i = 0; i < Math.min(20, data.length - 1); i++) {
    const row = data[i];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] ?? '')
        .trim()
        .toLowerCase();
      if (cell === 'currency') {
        const below = data[i + 1]?.[c];
        const code = String(below ?? '')
          .trim()
          .toUpperCase();
        if (/^[A-Z]{3}$/.test(code)) return code;
      }
    }
  }
  return 'EUR';
}

function readIso3CurrencyFromCell(cell: unknown, fallback: string): string {
  const s = String(cell ?? "")
    .trim()
    .toUpperCase();
  if (/^[A-Z]{3}$/.test(s)) return s;
  const t = s.split(/[\s/()]+/)[0];
  if (t && /^[A-Z]{3}$/.test(t)) return t;
  return fallback;
}

type FxColumnIndices = {
  exRateCol: number;
  rowCcyCol: number;
  eurValueCol: number;
};

/** Stĺpce: kurz (k EUR), mena operácie, prípadná suma v EUR z výpisu XTB. */
function detectFxColumns(headers: string[]): FxColumnIndices {
  return {
    exRateCol: getColumnIndex(headers, [
      "exchange rate to eur",
      "euro rate",
      "exchange rate",
      "exch. rate",
      "exch rate",
      "fx rate",
      "forex rate",
      "client exchange",
      "client exchange rate",
      "rate to eur",
      "kurs wymiany",
      "kurs wymiany eur",
      "smenný kurz",
      "smenny kurz",
      "menový kurz k eur",
      "menovy kurz k eur",
      "kurz nbp eur",
    ]),
    rowCcyCol: getColumnIndex(headers, [
      "instrument currency",
      "trading currency",
      "order currency",
      "operation currency",
      "op. currency",
      "symbol currency",
      "object currency",
      "ccy",
      "order ccy",
      "currency of trade",
      "currency of symbol",
      "pôvodná mena",
      "povodna mena",
    ]),
    eurValueCol: getColumnIndexByPriority(headers, [
      "value in eur",
      "gross in eur",
      "net in eur",
      "settlement in eur",
      "book cost in eur",
      "value (eur",
      "value (eur)",
      "value eur",
      "value (€",
      "amount in eur",
      "amount (eur",
      "euro value",
      "eurový ekvivalent",
      "eurov ekvivalent",
      "ekvivalent v eur",
      "v eur",
      "v hodnote eur",
      "w eur",
    ]),
  };
}

/**
 * Mena riadku, menový kurz z XTB a suma v EUR. `lineSign` +1 nákup/divi/vklad, -1 výber/daň.
 */
function buildForexForXtBLine(
  accountCurrency: string,
  row: any[],
  fx: FxColumnIndices,
  lineAmountAbs: number,
  lineSign: 1 | -1,
  /**
   * Akies/SELL na EUR účte: stĺpec „Suma/Amount“ býva v EUR (mena účtu), zatiaľ čo
   * „Operation currency / instrument“ môže byť USD. Nereálne: suma (EUR) × eur/USD.
   * Neuvádzať pre dividendu/bank, kde je suma môže byť v mene výplaty inštrumentu.
   */
  useAccountAmountForEurWallet = false,
): { originalCurrency: string; exchangeRateAtTransaction: number; baseCurrencyAmount: number } {
  const orig = readIso3CurrencyFromCell(
    fx.rowCcyCol >= 0 ? row[fx.rowCcyCol] : null,
    accountCurrency
  );
  let ex = 1;
  if (fx.exRateCol >= 0) {
    const v = parseAmount(row[fx.exRateCol]);
    if (Number.isFinite(v) && v > 0) ex = v;
  } else if (orig === "EUR") {
    ex = 1;
  }

  let outOrig = orig;
  let base: number;
  if (fx.eurValueCol >= 0) {
    const eurV = parseAmount(row[fx.eurValueCol]);
    if (lineSign < 0) {
      base = -Math.abs(eurV);
    } else {
      base = Math.abs(eurV);
    }
  } else if (orig === "EUR") {
    base = lineSign * lineAmountAbs;
  } else if (useAccountAmountForEurWallet && accountCurrency === "EUR" && orig !== "EUR") {
    base = lineSign * lineAmountAbs;
    ex = 1;
    outOrig = "EUR";
  } else {
    if (ex !== 1) {
      base = lineSign * (lineAmountAbs * ex);
    } else {
      base = lineSign * lineAmountAbs;
    }
  }
  if (!Number.isFinite(base) || (base === 0 && lineAmountAbs > 0)) {
    base = lineSign * lineAmountAbs;
  }
  if (ex <= 0 || !Number.isFinite(ex)) ex = 1;
  return {
    originalCurrency: outOrig,
    exchangeRateAtTransaction: ex,
    baseCurrencyAmount: base,
  };
}

/**
 * Množstvo z komentára „3 @ 126.50“ alebo „20/25 @ 1158“ / „1/6“ (čiastočný uzáver = prvé číslo =
 * celé kusy v riadku). Pre XTB vždy platí, že `a/b` znamená „a kusov z b“, nie zlomok akcie.
 */
function quantityFromXtBTradeToken(qtyStr: string): number {
  const s = qtyStr.trim();
  if (!s.includes('/')) return parseAmount(s);

  const bits = s.split('/').map((x) => x.trim()).filter(Boolean);
  if (bits.length !== 2) return parseAmount(s);
  const rawA = bits[0];
  const rawB = bits[1];
  const a = parseAmount(rawA);
  const b = parseAmount(rawB);
  if (!(a > 0 && b > 0)) return 0;
  // XTB formát "a/b" = počet kusov v tomto riadku (a), nie zlomkový podiel.
  return a;
}

/**
 * XTB komentár (Cash operations): „CLOSE BUY 10 @ 7,867“, „OPEN BUY 3 @ 126.50“,
 * „CLOSE BUY 20/25 @ 1158“ (čiastočný uzáver), „OPEN BUY 0,5188 @ 99,4612“, …
 */
function extractQtyPriceFromXTBComment(comment: string): { qty: number; rate: number } {
  const c = (comment || '').trim();
  if (!c) return { qty: 0, rate: 0 };

  const m = c.match(/(?:OPEN|CLOSE)\s+(?:BUY|SELL)\s+([\d./,]+)\s+@\s+([\d.,]+)/i);
  if (!m) return { qty: 0, rate: 0 };

  const qty = quantityFromXtBTradeToken(m[1]);
  const rate = parseAmount(m[2]);
  if (qty > 0 && rate > 0) return { qty, rate };
  return { qty: 0, rate: 0 };
}

function extractLegacyQtyFromComment(comment: string): number {
  let quantity = 0;
  const qtyMatch =
    comment.match(/(\d+(?:\.\d+)?)\s*(?:@|x|ks|pcs)/i) ||
    comment.match(/(?:BUY|SELL|CLOSE)\s+(?:BUY|SELL)?\s*(\d+(?:\.\d+)?)/i) ||
    comment.match(/(\d+(?:\.\d+)?)\s*$/);
  if (qtyMatch) quantity = parseAmount(qtyMatch[1]);
  return quantity > 0 ? quantity : 0;
}

/** Určenie ks a ceny za kus: voliteľné stĺpce XTB, potom OPEN/CLOSE BUY @ …, potom fallback regex. */
function resolveQtyPriceForTrade(
  comment: string,
  row: any[],
  qtyCol: number,
  rateCol: number,
  totalAmountAbs: number
): { quantity: number; pricePerShare: number } {
  let quantity = 0;
  if (qtyCol !== -1) {
    const q = parseAmount(row[qtyCol]);
    if (q > 0) quantity = q;
  }

  const parsed = extractQtyPriceFromXTBComment(comment);
  if (quantity <= 0 && parsed.qty > 0) quantity = parsed.qty;

  if (quantity <= 0) quantity = extractLegacyQtyFromComment(comment);

  const rateFromCol = rateCol !== -1 ? parseAmount(row[rateCol]) : 0;

  if (quantity <= 0 && parsed.rate > 0 && totalAmountAbs > 0) {
    quantity = totalAmountAbs / parsed.rate;
  }

  if (quantity <= 0 && rateFromCol > 0 && totalAmountAbs > 0) {
    quantity = totalAmountAbs / rateFromCol;
  }

  let pricePerShare = 0;
  if (quantity > 0 && totalAmountAbs > 0) {
    pricePerShare = totalAmountAbs / quantity;
  } else if (parsed.rate > 0) {
    pricePerShare = parsed.rate;
  } else if (rateFromCol > 0) {
    pricePerShare = rateFromCol;
  }

  return { quantity, pricePerShare };
}

/** Porovnanie hlavičky stĺpca s aliasmi (EN/SK, diakritika). */
function getColumnIndex(headers: string[], possibleNames: string[]): number {
  const norm = (s: string) =>
    stripDiacritics(s.toLowerCase().trim());

  const aliases = possibleNames.map((n) => norm(n));
  for (let i = 0; i < headers.length; i++) {
    const h = norm(headers[i] || "");
    if (!h) continue;
    for (const a of aliases) {
      if (!a) continue;
      if (h === a || h.includes(a) || a.includes(h)) return i;
    }
  }
  return -1;
}

/**
 * Postupne skúša presné/úzke názvy — vyhne sa tomu, že prvý stĺpec "Amount" v tabuľke
 * (často v mene inštrumentu) prebije neskorší "Amount (EUR)".
 */
function getColumnIndexByPriority(
  headers: string[],
  candidates: string[],
): number {
  for (const c of candidates) {
    const i = getColumnIndex(headers, [c]);
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * XTB často má stĺpec Symbol aj ISIN; ak sa zhodí skôr ISIN, ETF sa importuje pod ISIN (zlá cena/kotácia).
 * Preferuj symbol/ticker pred ISIN.
 */
function getSymbolColumnIndex(headers: string[]): number {
  const norm = (s: string) => stripDiacritics((s || "").toLowerCase().trim());

  const ranked: { i: number; rank: number }[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = norm(headers[i]);
    if (!h) continue;

    let rank = 100;
    if (h === "symbol" || h === "ticker") rank = 0;
    else if (h.includes("symbol")) rank = 1;
    else if (h.includes("ticker")) rank = 2;
    else if (h.includes("instrument")) rank = 3;
    else if (h === "isin") rank = 5;
    else if (h.includes("isin")) rank = 6;
    else continue;

    ranked.push({ i, rank });
  }

  ranked.sort((a, b) => a.rank - b.rank);
  if (ranked.length > 0) return ranked[0].i;

  return getColumnIndex(headers, ["symbol", "ticker", "isin"]);
}

/** Iná ako bankový SEPA/Wire; predtým „transfer“ preskakovalo aj bežné bankové príjmy. */
function isXtBInternalPortTransferType(typeStr: string): boolean {
  return (
    /internal|between (your )?account|p2p|peer|wallet.*wallet|sub-?account/i.test(typeStr) ||
    /vnutorn|převod mezi|prevod (v rámci|v ramci|medzi|medzi (ú|u)čt)/i.test(typeStr)
  );
}

/** Názov typu operácie: bankový SEPA/Wire/… (nie vždy je v texte "deposit", ale obsahuje „transfer“). */
function isXtBExternalWireOrBankInOutType(typeStr: string): boolean {
  if (isXtBInternalPortTransferType(typeStr)) return false;
  return (
    /\b(wire|sepa|swift|instant (payment|top-?up))\b/i.test(typeStr) ||
    (typeStr.includes("bank") && typeStr.includes("transfer"))
  );
}

/**
 * Stĺpec typu operácie: alias „type“ nesmie zodpovedať hlavičke „DateTime“ (podreťazec „type“).
 */
function getXtBCashOperationTypeColumnIndex(headers: string[]): number {
  const norm = (s: string) => stripDiacritics((s || "").toLowerCase().trim());
  const hNorm = headers.map((x) => norm(String(x)));

  const priority = [
    "operation type",
    "operation",
    "transaction type",
    "typ operacji",
    "typ operace",
    "druh operace",
    "druh operácie",
    "druh transakce",
    "druh transakcie",
  ];
  for (const p of priority) {
    const i = hNorm.findIndex((h) => h === p || (h.length > 0 && h.includes(p)));
    if (i >= 0) return i;
  }
  for (let i = 0; i < hNorm.length; i++) {
    const h = hNorm[i];
    if (h === "type" || h === "typ" || h === "druh") return i;
  }
  for (let i = 0; i < hNorm.length; i++) {
    const h = hNorm[i];
    if (!h || h.includes("datetime")) continue;
    if (/\btype\b/.test(h) && !/\bdate\b.*\btime\b/.test(h)) return i;
  }
  return getColumnIndex(headers, ["typ", "druh"]);
}

/**
 * Presuny medzi účtami/portfóliami XTB — neimportovať. Komentár často obsahuje „transfer“, keď stĺpec typ je zavádzajúci.
 * SEPA/Swift/IBAN ponechať (externý bankový pohyb).
 */
function isXtBIgnoredInternalPortfolioTransfer(typeStr: string, comment: string): boolean {
  const low = stripDiacritics(`${typeStr} ${(comment || "").toLowerCase()}`.trim()).toLowerCase();
  if (!low) return false;

  if (/\b(sepa|swift|iban)\b/.test(low)) return false;
  if (/\bincoming\b/.test(low) && /\b(payment|transfer|wire)\b/.test(low)) return false;

  if (isXtBInternalPortTransferType(low)) return true;

  if (
    /\b(transfer|prevod|presun|przelew|převod)\b/.test(low) &&
    /(portfolio|between your|between accounts|medzi (účt|uct|portf)|peňaženk|penazenk|wallet|vnutorn|internal|sub-?account|xtb)/i.test(
      low,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Presun hotovosti medzi číslami účtov XTB (napr. „Transfer from 2108575 to 2114611“).
 * Bez tohto riadku je hotovosť v jednom portfóliu v aplikácii príliš vysoká o súčet odchodov.
 */
function isXtBInterWalletCashTransfer(typeStr: string, comment: string): boolean {
  const low = stripDiacritics(`${typeStr} ${comment || ""}`.toLowerCase());
  if (!/\btransfer\b/.test(low)) return false;
  if (/\b(sepa|swift|iban)\b/.test(low)) return false;
  return /from\s+\d+\s+to\s+\d+/.test(low);
}

function isFreeFundsInterestLine(
  typeStr: string,
  typePlain: string,
  comment: string,
): boolean {
  const c = stripDiacritics((comment || "").toLowerCase());
  const hasInterest =
    typeStr.includes("interest") || typePlain.includes("interest") || c.includes("interest");
  const hasFreeFunds =
    typeStr.includes("free-funds") ||
    typeStr.includes("free funds") ||
    typePlain.includes("free-funds") ||
    typePlain.includes("free funds") ||
    c.includes("free-funds") ||
    c.includes("free funds");
  return hasInterest && hasFreeFunds;
}

function isFreeFundsInterestTaxLine(
  typeStr: string,
  typePlain: string,
  comment: string,
): boolean {
  if (!isFreeFundsInterestLine(typeStr, typePlain, comment)) return false;
  const c = stripDiacritics((comment || "").toLowerCase());
  return (
    typeStr.includes("tax") ||
    typePlain.includes("tax") ||
    typePlain.includes("withholding") ||
    typePlain.includes("zrazkova") ||
    c.includes("tax") ||
    c.includes("withholding") ||
    c.includes("zrazkova")
  );
}

// Parse CASH OPERATION HISTORY sheet
function parseCashOperations(data: any[][], log: ImportLogEntry[]): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  const accountCurrency = parseAccountCurrencyFromXtBMeta(data);

  // Hlavička: EN (type, time, amount) alebo SK/CZ/PL (typ, druh, čas, suma, …)
  const { headerIndex, headers } = findHeaderRow(data, [
    'type',
    'typ',
    'druh', // CZ: „Druh operace“
    'time',
    'čas',
    'datum',
    'dátum',
    'amount',
    'suma',
    'částka',
    'castka',
    'hodnota', // CZ: často „Hodnota“
    'symbol',
    'id',
    'operation', // XTB / „Operation type“
  ]);
  
  if (headerIndex === -1) {
    log.push({
      row: 0,
      status: 'warning',
      message: 'CASH OPERATION HISTORY: Nenašla sa hlavička',
    });
    return transactions;
  }
  
  // Map columns (EN + SK názvy z XTB exportov)
  const idCol = getColumnIndex(headers, ['id', 'číslo', 'cislo', 'operation id']);
  const typeCol = getXtBCashOperationTypeColumnIndex(headers);
  const timeCol = getColumnIndex(headers, ['time', 'čas', 'dátum', 'datum', 'date']);
  const commentCol = getColumnIndex(headers, ['comment', 'komentár', 'komentar', 'poznámka', 'poznamka']);
  const symbolCol = getSymbolColumnIndex(headers);
  /**
   * Ktorý stĺpec „sumy“ brať: musí dávať odtok hotovosti v **mene účtu** (EUR) alebo
   * nominál v cudzej mene, ktorú potom prepočítame. Ak je v CSV stĺpec s EUR, preferovať
   * ho PRED všeobecným "Amount" (kde môže byť len nominál v USD, nie odtok v EUR).
   * Podobne má prioritu stĺpec s „value“ v EUR, nie „Value / Nominal v mene inštrumentu“.
   */
  const amountCol = getColumnIndexByPriority(headers, [
    "value in eur",
    "gross in eur",
    "eurový ekvivalent",
    "eurov ekvivalent",
    "ekvivalent v eur",
    "settlement in eur",
    "amount (eur)",
    "suma (eur)",
    "amount in eur",
    "hodnota v eur",
    "amount", // až nakoniec — môže byť nominál v cudzej mene
    "suma",
    "částka",
    "castka",
    "hodnota",
    "value",
    "gross",
    "kwota",
  ]);
  const qtyCol = getColumnIndex(headers, [
    'quantity',
    'volume',
    'units',
    'pcs',
    'object volume',
    'mnozstvo',
    'množstvo',
    'pocet',
    'počet',
    'kusy',
    // nie „amount of stock“ — getColumnIndex by zhodilo stĺpec „Amount“ s podreťazcom „amount“
  ]);
  const rateCol = getColumnIndex(headers, [
    'open rate',
    'unit price',
    'price per share',
    'course',
    'kurz',
    'executed course',
    'execution price',
  ]);
  const fxCols = detectFxColumns(headers);

  if (typeCol === -1 || timeCol === -1 || amountCol === -1) {
    log.push({
      row: 0,
      status: 'warning',
      message: 'CASH OPERATION HISTORY: Chýbajú potrebné stĺpce (type, time, amount)',
    });
    return transactions;
  }
  
  // Process rows
  for (let i = headerIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.every(cell => !cell || cell.toString().trim() === '')) continue;
    
    const operationId = idCol !== -1 ? (row[idCol] || '').toString().trim() : '';
    const typeStr = (row[typeCol] || '').toString().toLowerCase().trim();
    const typePlain = stripDiacritics(typeStr);
    const time = parseDate(row[timeCol]);
    const comment = commentCol !== -1 ? (row[commentCol] || '').toString() : '';
    const symbolRaw = symbolCol !== -1 ? (row[symbolCol] || '').toString().trim() : '';
    const amount = parseAmount(row[amountCol]);
    
    if (!time) continue;
    
    const ticker = cleanTicker(symbolRaw);

    // Interné presuny (medzi portfóliami / peňaženkami) — neimportovať.
    if (isXtBIgnoredInternalPortfolioTransfer(typeStr, comment)) {
      log.push({
        row: i + 1,
        status: "skipped",
        message: `[${operationId}] Preskočené (interný presun): ${typeStr}`,
      });
      continue;
    }

    let isDeposit =
      typeStr.includes('deposit') ||
      typePlain.includes('vklad');
    let isWithdrawal =
      typeStr.includes('withdrawal') ||
      typePlain.includes('vyber') ||
      typeStr.includes('výber');

    const interWalletCashTransfer = isXtBInterWalletCashTransfer(typeStr, comment);

    if (!isDeposit && !isWithdrawal) {
      if (isXtBExternalWireOrBankInOutType(typeStr) && amount !== 0) {
        if (amount > 0) isDeposit = true;
        else isWithdrawal = true;
      }
      if (!isDeposit && !isWithdrawal && interWalletCashTransfer && amount !== 0) {
        if (amount > 0) isDeposit = true;
        else isWithdrawal = true;
      }
    }

    if (isDeposit || isWithdrawal) {
      const absAmt = Math.abs(amount);
      if (!(absAmt > 0)) {
        log.push({
          row: i + 1,
          status: 'warning',
          message: `[${operationId}] ${isDeposit ? 'Vklad' : 'Výber'}: nulová alebo neplatná suma`,
        });
        continue;
      }

      const lineSign: 1 | -1 = isDeposit ? 1 : -1;
      const forex = buildForexForXtBLine(accountCurrency, row, fxCols, absAmt, lineSign);
      const signedTotal = lineSign * absAmt;

      transactions.push({
        date: time,
        ticker: CASH_FLOW_TICKER,
        type: isDeposit ? 'DEPOSIT' : 'WITHDRAWAL',
        quantity: 0,
        priceEur: 0,
        totalAmountEur: signedTotal,
        originalComment: comment,
        externalId: operationId,
        transactionId: operationId || undefined,
        originalCurrency: forex.originalCurrency,
        exchangeRateAtTransaction: forex.exchangeRateAtTransaction,
        baseCurrencyAmount: forex.baseCurrencyAmount,
        companyName: interWalletCashTransfer ? "Presun medzi účtami XTB" : undefined,
      });

      log.push({
        row: i + 1,
        status: 'success',
        message: `[${operationId}] ${isDeposit ? 'DEPOSIT' : 'WITHDRAWAL'}${interWalletCashTransfer ? " (presun účtov)" : ""} ${signedTotal >= 0 ? '+' : ''}${signedTotal.toFixed(2)} ${accountCurrency}`,
      });
      continue;
    }

    // Interné prevody v rámci XTB (nie SEPA/Wire, tie sú vyššie ako vklad/výber)
    const rowMeta = stripDiacritics(`${typeStr} ${(comment || "").toLowerCase()}`.trim()).toLowerCase();
    if (isXtBInternalPortTransferType(rowMeta) && !isDeposit && !isWithdrawal) {
      log.push({
        row: i + 1,
        status: 'skipped',
        message: `Preskočené (interný prevod): ${typeStr}`,
      });
      continue;
    }

    /**
     * XTB: „Close trade“ / „Profit of position“ — samostatná hotovosť (P/L, FX, uzavretie u brokera).
     * Tieto riadky sme predtým preskakovali (strach z duplicity so Stock sale); v praxi XTB sem dáva
     * reálny pohyb na účte, ktorý sa inak v súčte s vkladmi/predajmi nezrovná. Importujeme ako
     * DEPOSIT/WITHDRAWAL (podľa znamienka sumy). Ak by ste videli zjavné zdvojenie s iným riadkom,
     * dajte vedieť — závisí od formátu exportu.
     */
    const isCloseTradeCash =
      typeStr.includes('close trade') ||
      typePlain.includes('close trade') ||
      typeStr.includes('closed trade') ||
      typeStr.includes('profit of position') ||
      typePlain.includes('profit of position');
    if (isCloseTradeCash) {
      const absAmt = Math.abs(amount);
      if (!(absAmt > 0)) {
        log.push({
          row: i + 1,
          status: 'warning',
          message: `[${operationId}] ${typeStr.trim()}: nulová alebo neplatná suma (preskočené)`,
        });
        continue;
      }
      const isCredited = amount > 0;
      const lineSign: 1 | -1 = isCredited ? 1 : -1;
      const forex = buildForexForXtBLine(accountCurrency, row, fxCols, absAmt, lineSign);
      const base = Number.isFinite(forex.baseCurrencyAmount) ? forex.baseCurrencyAmount : lineSign * absAmt;
      const totalEur = base;
      transactions.push({
        date: time,
        ticker: CASH_FLOW_TICKER,
        type: isCredited ? 'DEPOSIT' : 'WITHDRAWAL',
        quantity: 0,
        priceEur: 0,
        totalAmountEur: totalEur,
        originalComment: comment,
        externalId: operationId,
        transactionId: operationId || undefined,
        originalCurrency: forex.originalCurrency,
        exchangeRateAtTransaction: forex.exchangeRateAtTransaction,
        baseCurrencyAmount: base,
        companyName: 'Close trade (hotovosť z XTB)',
      });
      log.push({
        row: i + 1,
        status: 'success',
        message: `[${operationId}] ${isCredited ? 'DEPOSIT' : 'WITHDRAWAL'} (close trade) ${totalEur >= 0 ? '+' : ''}${totalEur.toFixed(2)} EUR — hotovosť z uzavretia`,
      });
      continue;
    }
    
    const isFreeFundsInterest = isFreeFundsInterestLine(typeStr, typePlain, comment);
    const isFreeFundsInterestTax = isFreeFundsInterestTaxLine(typeStr, typePlain, comment);
    const resolvedDividendTicker = isFreeFundsInterest ? "CASH_INTEREST" : ticker;
    // Determine transaction type
    
    // STOCK PURCHASE - BUY (vrátane „Stocks/ETF purchase“ z anglického exportu)
    if (
      typeStr.includes('purchase') ||
      typeStr.includes('nákup') ||
      typePlain.includes('nakup') ||
      typePlain.includes('stock buy') ||
      typeStr.includes('etf') && typeStr.includes('compra')
    ) {
      if (!ticker) {
        log.push({
          row: i + 1,
          status: 'warning',
          message: `Nákup bez tickera: ${comment}`,
        });
        continue;
      }
      
      const totalAmount = Math.abs(amount);
      const { quantity, pricePerShare } = resolveQtyPriceForTrade(
        comment,
        row,
        qtyCol,
        rateCol,
        totalAmount
      );

      if (!quantity || quantity <= 0 || !pricePerShare || !Number.isFinite(pricePerShare)) {
        log.push({
          row: i + 1,
          status: 'warning',
          message: `Nákup: nepodarilo sa určiť množstvo/cenu (ID ${operationId}, komentár: ${comment.slice(0, 80)})`,
        });
        continue;
      }

      const buyFx = buildForexForXtBLine(
        accountCurrency,
        row,
        fxCols,
        totalAmount,
        1,
        accountCurrency === "EUR",
      );
      
      transactions.push({
        date: time,
        ticker,
        type: 'BUY',
        quantity,
        priceEur: pricePerShare,
        totalAmountEur: totalAmount,
        originalComment: comment,
        externalId: operationId,
        originalCurrency: buyFx.originalCurrency,
        exchangeRateAtTransaction: buyFx.exchangeRateAtTransaction,
        baseCurrencyAmount: buyFx.baseCurrencyAmount,
      });
      
      log.push({
        row: i + 1,
        status: 'success',
        message: `[${operationId}] BUY ${quantity} ${ticker} @ ${pricePerShare.toFixed(2)} EUR = ${totalAmount.toFixed(2)} EUR`,
      });
    }
    // STOCK SALE - SELL (anglický export často „Sell“ / „Stock sell“ — bez podreťazca „sale“)
    else if (
      typeStr.includes('sale') ||
      /\bsell\b/i.test(typeStr) ||
      typeStr.includes('predaj') ||
      typePlain.includes('predaj') ||
      typePlain.includes('stock sell') ||
      (typeStr.includes('etf') && typeStr.includes('vende'))
    ) {
      if (!ticker) {
        log.push({
          row: i + 1,
          status: 'warning',
          message: `Predaj bez tickera: ${comment}`,
        });
        continue;
      }
      
      const totalAmount = Math.abs(amount);
      const { quantity, pricePerShare } = resolveQtyPriceForTrade(
        comment,
        row,
        qtyCol,
        rateCol,
        totalAmount
      );

      if (!quantity || quantity <= 0 || !pricePerShare || !Number.isFinite(pricePerShare)) {
        log.push({
          row: i + 1,
          status: 'warning',
          message: `Predaj: nepodarilo sa určiť množstvo/cenu (ID ${operationId}, komentár: ${comment.slice(0, 80)})`,
        });
        continue;
      }

      const sellFx = buildForexForXtBLine(
        accountCurrency,
        row,
        fxCols,
        totalAmount,
        1,
        accountCurrency === "EUR",
      );
      
      transactions.push({
        date: time,
        ticker,
        type: 'SELL',
        quantity,
        priceEur: pricePerShare,
        totalAmountEur: totalAmount,
        originalComment: comment,
        externalId: operationId,
        originalCurrency: sellFx.originalCurrency,
        exchangeRateAtTransaction: sellFx.exchangeRateAtTransaction,
        baseCurrencyAmount: sellFx.baseCurrencyAmount,
      });
      
      log.push({
        row: i + 1,
        status: 'success',
        message: `[${operationId}] SELL ${quantity} ${ticker} @ ${pricePerShare.toFixed(2)} EUR = ${totalAmount.toFixed(2)} EUR`,
      });
    }
    // DIVIDEND
    else if (
      typeStr.includes('divident') ||
      typeStr.includes('dividend') ||
      typePlain.includes('dividend') ||
      typePlain.includes('dividenda')
    ) {
      // DIVIDEND - positive amount
      if (!resolvedDividendTicker) {
        log.push({
          row: i + 1,
          status: 'warning',
          message: `Dividenda bez tickera: ${comment}`,
        });
        continue;
      }
      
      const divAm = Math.abs(amount);
      const divFx = buildForexForXtBLine(accountCurrency, row, fxCols, divAm, 1);

      transactions.push({
        date: time,
        ticker: resolvedDividendTicker,
        type: 'DIVIDEND',
        quantity: 0,
        priceEur: 0,
        totalAmountEur: divAm,
        originalComment: comment,
        externalId: operationId,
        originalCurrency: divFx.originalCurrency,
        exchangeRateAtTransaction: divFx.exchangeRateAtTransaction,
        baseCurrencyAmount: divFx.baseCurrencyAmount,
        companyName: isFreeFundsInterest ? "Úrok z voľných prostriedkov" : undefined,
      });
      
      log.push({
        row: i + 1,
        status: 'success',
        message: `[${operationId}] DIVIDEND ${resolvedDividendTicker}: +${Math.abs(amount).toFixed(2)} EUR`,
      });
    }
    // TAX
    else if (
      typeStr.includes('withholding tax') ||
      typeStr.includes('tax') ||
      typePlain.includes('withholding') ||
      typePlain.includes('zrazkova') ||
      isFreeFundsInterestTax
    ) {
      // TAX - stored as negative
      const taxTicker = ticker || (isFreeFundsInterestTax || isFreeFundsInterest ? "CASH_INTEREST" : "");
      
      if (taxTicker) {
        // Find the most recent DIVIDEND transaction for the same ticker to link
        let linkedDividendId: string | undefined;
        for (let j = transactions.length - 1; j >= 0; j--) {
          const prevTx = transactions[j];
          if (prevTx.type === 'DIVIDEND' && prevTx.ticker === taxTicker) {
            // Check if timestamps are close (within 1 minute)
            const timeDiff = Math.abs(time.getTime() - prevTx.date.getTime());
            if (timeDiff < 60000) { // 60 seconds
              linkedDividendId = prevTx.externalId;
              break;
            }
          }
        }
        
        const taxAm = Math.abs(amount);
        const taxFx = buildForexForXtBLine(accountCurrency, row, fxCols, taxAm, -1);
        
        transactions.push({
          date: time,
          ticker: taxTicker,
          type: 'TAX',
          quantity: 0,
          priceEur: 0,
          totalAmountEur: -Math.abs(amount), // Negative for tax
          originalComment: comment,
          externalId: operationId,
          linkedDividendId,
          originalCurrency: taxFx.originalCurrency,
          exchangeRateAtTransaction: taxFx.exchangeRateAtTransaction,
          baseCurrencyAmount: taxFx.baseCurrencyAmount,
          companyName: taxTicker === "CASH_INTEREST" ? "Daň z úroku voľných prostriedkov" : undefined,
        });
        
        const linkInfo = linkedDividendId ? ` (k dividende ${linkedDividendId})` : '';
        log.push({
          row: i + 1,
          status: 'success',
          message: `[${operationId}] TAX ${taxTicker}: -${Math.abs(amount).toFixed(2)} EUR${linkInfo}`,
        });
      } else {
        log.push({
          row: i + 1,
          status: 'skipped',
          message: `[${operationId}] Daň bez tickera: ${comment}`,
        });
      }
    } else if (typeStr.includes('sec fee') || typeStr.includes('fee')) {
      // Fees - skip or log
      log.push({
        row: i + 1,
        status: 'skipped',
        message: `[${operationId}] Poplatok: ${typeStr} ${amount.toFixed(2)} EUR`,
      });
    } else if (typeStr.includes('interest')) {
      if (isFreeFundsInterest) {
        const intAm = Math.abs(amount);
        const intFx = buildForexForXtBLine(accountCurrency, row, fxCols, intAm, 1);
        transactions.push({
          date: time,
          ticker: "CASH_INTEREST",
          type: "DIVIDEND",
          quantity: 0,
          priceEur: 0,
          totalAmountEur: intAm,
          originalComment: comment,
          externalId: operationId,
          originalCurrency: intFx.originalCurrency,
          exchangeRateAtTransaction: intFx.exchangeRateAtTransaction,
          baseCurrencyAmount: intFx.baseCurrencyAmount,
          companyName: "Úrok z voľných prostriedkov",
        });
        log.push({
          row: i + 1,
          status: "success",
          message: `[${operationId}] DIVIDEND CASH_INTEREST: +${intAm.toFixed(2)} EUR`,
        });
      } else {
        // Other interest lines remain skipped.
        log.push({
          row: i + 1,
          status: 'skipped',
          message: `[${operationId}] Úrok: ${comment}`,
        });
      }
    } else {
      log.push({
        row: i + 1,
        status: 'skipped',
        message: `[${operationId}] Neznámy typ: ${typeStr}`,
      });
    }
  }
  
  return transactions;
}

// Main parsing function
export async function parseXTBFile(fileBuffer: Buffer, _fileName: string): Promise<XTBImportResult> {
  const log: ImportLogEntry[] = [];
  const transactions: ParsedTransaction[] = [];

  try {
    // Read workbook
    const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });

    log.push({
      row: 0,
      status: 'success',
      message: `Nájdené hárky: ${workbook.SheetNames.join(', ')}`,
    });

    // Hárok „Cash operation history“ / slovenské varianty (XTB export)
    const sheetNorm = (s: string) => stripDiacritics(s.toLowerCase());
    const cashSheet = workbook.SheetNames.find((name) => {
      const n = sheetNorm(name);
      return (
        n.includes('cash operation') ||
        n.includes('cashoper') ||
        n.includes('cash oper') || // "Cash operation history" | skrátene
        (n.includes('cash') && n.includes('oper')) ||
        n.includes('hotovost') ||
        n.includes('penazne oper') || // CZ: peněžní operace
        n.includes('penezni oper') ||
        n.includes('penežní operace') ||
        n.includes('penizni operace') ||
        n.includes('penazneoperacie') ||
        n.includes('história hotovost') ||
        n.includes('historia hotovost') ||
        n.includes('history of cash') ||
        n.includes('historie vklady') // CZ varianty
      );
    });

    const sheetNameToUse =
      cashSheet ||
      (workbook.SheetNames.length > 0 ? workbook.SheetNames[0] : null);

    if (sheetNameToUse) {
      if (!cashSheet) {
        log.push({
          row: 0,
          status: 'warning',
          message: `Hárok s hotovosťou podľa názvu nenájdený — skúšam prvý hárok: „${workbook.SheetNames[0]}“`,
        });
      }
      const worksheet = workbook.Sheets[sheetNameToUse];
      // raw: true — čísla a dátumy ako hodnoty bunky (nie lokalizovaný text); zníži chyby pri sumách a dátumoch
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true }) as any[][];

      log.push({
        row: 0,
        status: 'success',
        message: `Spracovávam hárok: ${sheetNameToUse}`,
      });

      const cashTransactions = parseCashOperations(data, log);
      transactions.push(...cashTransactions);
    }

    if (!workbook.SheetNames.length) {
      log.push({
        row: 0,
        status: 'error',
        message: 'Súbor neobsahuje žiadny hárok (prázdny XLSX).',
      });
    } else if (!sheetNameToUse) {
      log.push({
        row: 0,
        status: 'error',
        message: 'Nepodarilo sa otvoriť žiadny hárok.',
      });
    }

    transactions.sort((a, b) => a.date.getTime() - b.date.getTime());

    const successCount = log.filter(l => l.status === 'success').length;
    const warningCount = log.filter(l => l.status === 'warning').length;
    const errorCount = log.filter(l => l.status === 'error').length;
    const skippedCount = log.filter(l => l.status === 'skipped').length;

    return {
      transactions,
      log,
      summary: {
        total: log.length,
        success: successCount,
        warnings: warningCount,
        errors: errorCount,
        skipped: skippedCount,
      },
    };

  } catch (error) {
    log.push({
      row: 0,
      status: 'error',
      message: `Chyba pri spracovaní súboru: ${error instanceof Error ? error.message : 'Neznáma chyba'}`,
    });

    return {
      transactions: [],
      log,
      summary: { total: 0, success: 0, warnings: 0, errors: 1, skipped: 0 },
    };
  }
}
