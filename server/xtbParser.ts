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

/**
 * Množstvo z komentára „3 @ 126.50“ alebo „20/25 @ 1158“ / „1/6“ (čiastočný uzáver = prvé číslo =
 * celé kusy v riadku). Zlomok akcie len ak menovateľ ≤ 5 (1/2, 3/4 …), nie 1/6 ako ⅙ akcie.
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

  const intLike =
    /^\d+$/.test(rawA.replace(/\s/g, '')) && /^\d+$/.test(rawB.replace(/\s/g, ''));
  if (!intLike) return b !== 0 ? a / b : 0;

  const ai = Math.round(a);
  const bi = Math.round(b);
  // Zlomok akcie: typicky menovateľ 2–5 (1/2, 3/4 …). Nie „1/6“ = 1 ks zo 6 — menovateľ > 5
  // ber ako čiastočný uzáver pozície (prvé číslo = celé kusy v tomto riadku).
  const looksLikeFractionalShare =
    ai < bi && bi <= 5 && ai <= 5;
  if (looksLikeFractionalShare) return ai / bi;

  // „1/6“, „20/25“, „5/25“ … prvé číslo = kusy predané/nakúpené v tomto výpise
  if (ai <= bi) return ai;

  return ai / bi;
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

// Parse CASH OPERATION HISTORY sheet
function parseCashOperations(data: any[][], log: ImportLogEntry[]): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  const accountCurrency = parseAccountCurrencyFromXtBMeta(data);

  // Hlavička: EN (type, time, amount) alebo SK (typ, čas, suma, …)
  const { headerIndex, headers } = findHeaderRow(data, [
    'type',
    'typ',
    'time',
    'čas',
    'datum',
    'dátum',
    'amount',
    'suma',
    'částka',
    'castka',
    'symbol',
    'id',
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
  const typeCol = getColumnIndex(headers, ['type', 'typ', 'druh']);
  const timeCol = getColumnIndex(headers, ['time', 'čas', 'dátum', 'datum', 'date']);
  const commentCol = getColumnIndex(headers, ['comment', 'komentár', 'komentar', 'poznámka', 'poznamka']);
  const symbolCol = getSymbolColumnIndex(headers);
  const amountCol = getColumnIndex(headers, [
    'amount',
    'suma',
    'částka',
    'castka',
    'amount (eur)',
    'suma (eur)',
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

    const isDeposit =
      typeStr.includes('deposit') ||
      typePlain.includes('vklad');
    const isWithdrawal =
      typeStr.includes('withdrawal') ||
      typePlain.includes('vyber') ||
      typeStr.includes('výber');

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

      const signedTotal = isDeposit ? absAmt : -absAmt;
      let exchangeRateAtTransaction: number | undefined;
      let baseCurrencyAmount: number | undefined;
      if (accountCurrency === 'EUR') {
        exchangeRateAtTransaction = 1;
        baseCurrencyAmount = signedTotal;
      }

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
        originalCurrency: accountCurrency,
        exchangeRateAtTransaction,
        baseCurrencyAmount,
      });

      log.push({
        row: i + 1,
        status: 'success',
        message: `[${operationId}] ${isDeposit ? 'DEPOSIT' : 'WITHDRAWAL'} ${signedTotal >= 0 ? '+' : ''}${signedTotal.toFixed(2)} ${accountCurrency}`,
      });
      continue;
    }

    // Preskočiť interné prevody (nie vklad cez „deposit“)
    if (
      (typeStr.includes('transfer') || typePlain.includes('prevod')) &&
      !typeStr.includes('deposit') &&
      !typePlain.includes('vklad')
    ) {
      log.push({
        row: i + 1,
        status: 'skipped',
        message: `Preskočené: ${typeStr}`,
      });
      continue;
    }

    /**
     * XTB: „Close trade“ / Profit of position — samostatný hotovostný riadok pri uzavretí (FX alebo P/L).
     * Samotný predaj/nákup je už v „Stock sale“ / „Stock purchase“ s komentárom CLOSE BUY / OPEN BUY @ …
     * Importovať aj toto by dvojnásobilo platby — explicitne preskočiť so zrozumiteľnou správou.
     */
    const isCloseTradeAccounting =
      typeStr.includes('close trade') ||
      typePlain.includes('close trade') ||
      typeStr.includes('closed trade');
    if (isCloseTradeAccounting) {
      log.push({
        row: i + 1,
        status: 'skipped',
        message: `[${operationId}] Preskočené: ${typeStr.trim()} — účtovný riadok uzavretia (obchod je v Stock sale / purchase)`,
      });
      continue;
    }
    
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
      
      transactions.push({
        date: time,
        ticker,
        type: 'BUY',
        quantity,
        priceEur: pricePerShare,
        totalAmountEur: totalAmount,
        originalComment: comment,
        externalId: operationId,
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
      
      transactions.push({
        date: time,
        ticker,
        type: 'SELL',
        quantity,
        priceEur: pricePerShare,
        totalAmountEur: totalAmount,
        originalComment: comment,
        externalId: operationId,
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
      if (!ticker) {
        log.push({
          row: i + 1,
          status: 'warning',
          message: `Dividenda bez tickera: ${comment}`,
        });
        continue;
      }
      
      transactions.push({
        date: time,
        ticker,
        type: 'DIVIDEND',
        quantity: 0,
        priceEur: 0,
        totalAmountEur: Math.abs(amount),
        originalComment: comment,
        externalId: operationId,
      });
      
      log.push({
        row: i + 1,
        status: 'success',
        message: `[${operationId}] DIVIDEND ${ticker}: +${Math.abs(amount).toFixed(2)} EUR`,
      });
    }
    // TAX
    else if (
      typeStr.includes('withholding tax') ||
      typeStr.includes('tax') ||
      typePlain.includes('withholding') ||
      typePlain.includes('zrazkova')
    ) {
      // TAX - stored as negative
      const taxTicker = ticker || 'TAX';
      
      if (ticker) {
        // Find the most recent DIVIDEND transaction for the same ticker to link
        let linkedDividendId: string | undefined;
        for (let j = transactions.length - 1; j >= 0; j--) {
          const prevTx = transactions[j];
          if (prevTx.type === 'DIVIDEND' && prevTx.ticker === ticker) {
            // Check if timestamps are close (within 1 minute)
            const timeDiff = Math.abs(time.getTime() - prevTx.date.getTime());
            if (timeDiff < 60000) { // 60 seconds
              linkedDividendId = prevTx.externalId;
              break;
            }
          }
        }
        
        transactions.push({
          date: time,
          ticker,
          type: 'TAX',
          quantity: 0,
          priceEur: 0,
          totalAmountEur: -Math.abs(amount), // Negative for tax
          originalComment: comment,
          externalId: operationId,
          linkedDividendId,
        });
        
        const linkInfo = linkedDividendId ? ` (k dividende ${linkedDividendId})` : '';
        log.push({
          row: i + 1,
          status: 'success',
          message: `[${operationId}] TAX ${ticker}: -${Math.abs(amount).toFixed(2)} EUR${linkInfo}`,
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
      // Interest - skip
      log.push({
        row: i + 1,
        status: 'skipped',
        message: `[${operationId}] Úrok: ${comment}`,
      });
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
        (n.includes('cash') && n.includes('oper')) ||
        n.includes('hotovost') ||
        n.includes('penazne oper') ||
        n.includes('penazneoperacie') ||
        n.includes('história hotovost') ||
        n.includes('historia hotovost') ||
        n.includes('history of cash')
      );
    });

    if (cashSheet) {
      const worksheet = workbook.Sheets[cashSheet];
      // raw: true — čísla a dátumy ako hodnoty bunky (nie lokalizovaný text); zníži chyby pri sumách a dátumoch
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true }) as any[][];

      log.push({
        row: 0,
        status: 'success',
        message: `Spracovávam hárok: ${cashSheet}`,
      });

      const cashTransactions = parseCashOperations(data, log);
      transactions.push(...cashTransactions);
    }

    if (!cashSheet) {
      log.push({
        row: 0,
        status: 'warning',
        message: `Nenašiel sa hárok CASH OPERATION HISTORY.`,
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
