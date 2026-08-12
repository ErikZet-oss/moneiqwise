import * as XLSX from 'xlsx';
import {
  parseXTBFileLegacy,
  type XTBImportResult,
} from './xtbParser.legacy';
import { parseXTBFileV2 } from './xtbParser.v2';

export type {
  ParsedTransaction,
  ImportLogEntry,
  XTBImportResult,
  XTBExportFormat,
  XTBOpenPositionLot,
  XTBOpenPositionsSnapshot,
} from './xtbParser.legacy';

/**
 * Detect XTB XLSX export format from sheet names.
 * New export uses exact-ish "Cash Operations" / "Open Positions" (plural).
 * Legacy uses "CASH OPERATION HISTORY" / "OPEN POSITION <date>" (singular).
 */
export function detectXtBExportFormat(workbook: XLSX.WorkBook): 'legacy' | 'v2' {
  for (const name of workbook.SheetNames) {
    const n = name.toLowerCase().trim();
    if (n.includes('cash operations') || n.includes('open positions')) {
      return 'v2';
    }
  }
  return 'legacy';
}

/**
 * Parse XTB export — routes to legacy or v2 based on sheet names.
 */
export async function parseXTBFile(
  fileBuffer: Buffer,
  fileName: string,
): Promise<XTBImportResult> {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
  const format = detectXtBExportFormat(workbook);
  if (format === 'v2') {
    return parseXTBFileV2(fileBuffer, fileName);
  }
  return parseXTBFileLegacy(fileBuffer, fileName);
}
