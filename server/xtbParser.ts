import * as XLSX from 'xlsx';

/** Odstráni kombinujúce znaky (diakritiku); nepoužívame \p{M} kvôli kompatibilite s runtime/TS. */
function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export interface ParsedTransaction {
  date: Date;
  ticker: string;
  type: 'BUY' | 'SELL' | 'DIVIDEND' | 'TAX';
  quantity: number;
  priceEur: number;
  totalAmountEur: number;
  originalComment?: string;
  externalId?: string; // XTB transaction/position ID
  linkedDividendId?: string; // For TAX entries - links to parent DIVIDEND externalId
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

// Ticker cleaning - remove exchange suffixes for yfinance compatibility
function cleanTicker(ticker: string): string {
  if (!ticker) return '';
  
  let cleaned = ticker.toUpperCase().trim();
  
  // Remove common exchange suffixes
  const suffixesToRemove = [
    '.US', '.UK', '.DE', '.FR', '.NL', '.IT', '.ES', '.PL', '.CZ',
    '.EU', '.L', '.PA', '.AS', '.MI', '.MC', '.WA', '.PR', '.PAR'
  ];
  
  for (const suffix of suffixesToRemove) {
    if (cleaned.endsWith(suffix)) {
      cleaned = cleaned.slice(0, -suffix.length);
      break;
    }
  }
  
  // Handle special ticker mappings for yfinance
  const tickerMappings: Record<string, string> = {
    'BRK.B': 'BRK-B',
    'BRK.A': 'BRK-A',
    'BF.B': 'BF-B',
    'BF.A': 'BF-A',
  };
  
  return tickerMappings[cleaned] || cleaned;
}

// Parse amount string (handle commas, currency symbols, etc.)
function parseAmount(amountStr: string | number): number {
  if (typeof amountStr === 'number') return amountStr;
  if (!amountStr) return 0;
  
  // Remove $ symbol, spaces and replace comma with dot
  const cleaned = amountStr.toString()
    .replace(/[$€£]/g, '')
    .replace(/\s/g, '')
    .replace(',', '.');
  
  return parseFloat(cleaned) || 0;
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

// Parse CASH OPERATION HISTORY sheet
function parseCashOperations(data: any[][], log: ImportLogEntry[]): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  
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
  const symbolCol = getColumnIndex(headers, ['symbol', 'ticker', 'isin']);
  const amountCol = getColumnIndex(headers, [
    'amount',
    'suma',
    'částka',
    'castka',
    'amount (eur)',
    'suma (eur)',
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
    
    // Skip irrelevant types (SK/EN, s/bez diakritiky)
    const skipTypes = ['deposit', 'withdrawal', 'vklad', 'výber', 'transfer', 'prevod'];
    if (
      skipTypes.some((skip) => typeStr.includes(skip)) ||
      typePlain.includes('vyber') ||
      typePlain.includes('vklad')
    ) {
      log.push({
        row: i + 1,
        status: 'skipped',
        message: `Preskočené: ${typeStr}`,
      });
      continue;
    }
    
    // Determine transaction type
    
    // STOCK PURCHASE - BUY
    if (
      typeStr.includes('purchase') ||
      typeStr.includes('nákup') ||
      typePlain.includes('nakup') ||
      typePlain.includes('stock buy')
    ) {
      if (!ticker) {
        log.push({
          row: i + 1,
          status: 'warning',
          message: `Nákup bez tickera: ${comment}`,
        });
        continue;
      }
      
      // Extract quantity from comment (e.g., "CLOSE BUY 5 @ 123.45")
      let quantity = 0;
      const qtyMatch = comment.match(/(\d+(?:\.\d+)?)\s*(?:@|x|ks|pcs)/i) || 
                       comment.match(/(?:BUY|SELL|CLOSE)\s+(?:BUY|SELL)?\s*(\d+(?:\.\d+)?)/i) ||
                       comment.match(/(\d+(?:\.\d+)?)\s*$/);
      if (qtyMatch) {
        quantity = parseFloat(qtyMatch[1]);
      }
      
      const totalAmount = Math.abs(amount);
      const pricePerShare = quantity > 0 ? totalAmount / quantity : 0;
      
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
    // STOCK SALE - SELL
    else if (
      typeStr.includes('sale') ||
      typeStr.includes('predaj') ||
      typePlain.includes('predaj') ||
      typePlain.includes('stock sell')
    ) {
      if (!ticker) {
        log.push({
          row: i + 1,
          status: 'warning',
          message: `Predaj bez tickera: ${comment}`,
        });
        continue;
      }
      
      // Extract quantity from comment
      let quantity = 0;
      const qtyMatch = comment.match(/(\d+(?:\.\d+)?)\s*(?:@|x|ks|pcs)/i) || 
                       comment.match(/(?:BUY|SELL|CLOSE)\s+(?:BUY|SELL)?\s*(\d+(?:\.\d+)?)/i) ||
                       comment.match(/(\d+(?:\.\d+)?)\s*$/);
      if (qtyMatch) {
        quantity = parseFloat(qtyMatch[1]);
      }
      
      const totalAmount = Math.abs(amount);
      const pricePerShare = quantity > 0 ? totalAmount / quantity : 0;
      
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
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false }) as any[][];

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
