import * as cheerio from "cheerio";
import { buildQuoteUrl, buildScreenerUrl } from "./urlBuilder";
import type { AiScannerStrategy } from "./strategies";

export type FinvizScreenerRow = {
  ticker: string;
  companyName: string;
  sector: string | null;
  industry: string | null;
  marketCap: string | null;
  pe: number | null;
  price: number | null;
  changePercent: number | null;
  volume: string | null;
};

export type FinvizQuoteSnapshot = {
  ticker: string;
  companyName: string | null;
  metrics: Record<string, string>;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function parseNumberLoose(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/,/g, "").replace(/%/g, "");
  if (!s || s === "-" || s === "—") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function fetchFinvizHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://finviz.com/",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Finviz HTTP ${res.status}`);
  }
  const html = await res.text();
  const lower = html.toLowerCase();
  if (
    lower.includes("access denied") ||
    lower.includes("captcha") ||
    lower.includes("cf-challenge") ||
    lower.includes("just a moment") ||
    (html.length < 2000 && !lower.includes("screener"))
  ) {
    throw new Error("Finviz blocked or challenge page");
  }
  return html;
}

/**
 * Parse Finviz screener overview table (v=111).
 * Columns: No. | Ticker | Company | Sector | Industry | Country | Market Cap | P/E | Price | Change | Volume
 */
export function parseScreenerHtml(html: string): FinvizScreenerRow[] {
  const $ = cheerio.load(html);
  const rows: FinvizScreenerRow[] = [];

  $("table.screener_table tr.styled-row, table.screener_table tr[valign=top]").each((_, el) => {
    const cells = $(el).find("td");
    if (cells.length < 10) return;

    const ticker = $(cells[1]).text().trim().toUpperCase();
    if (!ticker || ticker === "TICKER") return;

    rows.push({
      ticker,
      companyName: $(cells[2]).text().trim() || ticker,
      sector: $(cells[3]).text().trim() || null,
      industry: $(cells[4]).text().trim() || null,
      marketCap: $(cells[6]).text().trim() || null,
      pe: parseNumberLoose($(cells[7]).text()),
      price: parseNumberLoose($(cells[8]).text()),
      changePercent: parseNumberLoose($(cells[9]).text()),
      volume: $(cells[10]).text().trim() || null,
    });
  });

  // Fallback: older markup
  if (rows.length === 0) {
    $("table#screener-content tr, table.screener_table tr").each((_, el) => {
      const cells = $(el).find("td");
      if (cells.length < 10) return;
      const tickerLink = $(cells[1]).find("a").first();
      const ticker = (tickerLink.text() || $(cells[1]).text()).trim().toUpperCase();
      if (!ticker || ticker === "TICKER" || !/^[A-Z0-9./-]{1,12}$/.test(ticker)) return;
      if (rows.some((r) => r.ticker === ticker)) return;

      rows.push({
        ticker,
        companyName: $(cells[2]).text().trim() || ticker,
        sector: $(cells[3]).text().trim() || null,
        industry: $(cells[4]).text().trim() || null,
        marketCap: $(cells[6]).text().trim() || null,
        pe: parseNumberLoose($(cells[7]).text()),
        price: parseNumberLoose($(cells[8]).text()),
        changePercent: parseNumberLoose($(cells[9]).text()),
        volume: cells.length > 10 ? $(cells[10]).text().trim() || null : null,
      });
    });
  }

  return rows;
}

export async function fetchScreenerRows(strategy: AiScannerStrategy): Promise<{
  url: string;
  rows: FinvizScreenerRow[];
}> {
  const url = buildScreenerUrl(strategy);
  const html = await fetchFinvizHtml(url);
  const rows = parseScreenerHtml(html);
  return { url, rows };
}

/** Snapshot metrík z Finviz quote page (snapshot-table2). */
export async function fetchQuoteSnapshot(ticker: string): Promise<FinvizQuoteSnapshot> {
  const url = buildQuoteUrl(ticker);
  const html = await fetchFinvizHtml(url);
  const $ = cheerio.load(html);

  const companyName =
    $("h2.quote-header_ticker-wrapper_company a, .quote-header_ticker-wrapper_company").first().text().trim() ||
    $("table.fullview-title b a").first().text().trim() ||
    null;

  const metrics: Record<string, string> = {};
  $("table.snapshot-table2 tr").each((_, tr) => {
    const cells = $(tr).find("td");
    for (let i = 0; i + 1 < cells.length; i += 2) {
      const key = $(cells[i]).text().trim();
      const val = $(cells[i + 1]).text().trim();
      if (key) metrics[key] = val;
    }
  });

  // Fallback older table
  if (Object.keys(metrics).length === 0) {
    $("table.snapshot-table2 td.snapshot-td2-cp, table.snapshot-table2 td").each(() => {
      /* handled above */
    });
  }

  return {
    ticker: ticker.toUpperCase(),
    companyName,
    metrics,
  };
}
