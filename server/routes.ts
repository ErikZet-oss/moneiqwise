import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import {
  insertTransactionSchema,
  insertPortfolioSchema,
  insertOptionTradeSchema,
  ASSET_CLASS_VALUES,
  CASH_FLOW_TICKER,
  type AssetClassValue,
  type InsertTransaction,
  transactions,
  users,
  type Transaction,
} from "@shared/schema";
import { sumCloseTradeCashFlowEurFromRows } from "@shared/cashFromTransactions";
import { parseXTBFile, type XTBImportResult } from "./xtbParser";
import {
  computeRealizedGainsFromTransactionsAsync,
  transactionLotKey,
} from "./realizedGainsCompute";
import { computePnlBreakdown } from "./pnlBreakdown";
import { buildEurPerUnitByTxnIdForTransactions } from "./eurAtTransactionDate";
import { computeCashLedgerBreakdownEur } from "./netLedgerCashEur";
import { computeFifoRealizedGainsFromTransactions } from "@shared/fifoRealizedGains";
import { computeGipsTwr } from "./twrGips";
import {
  computePortfolioHistorySeries,
  type PortfolioHistoryRange,
} from "./portfolioHistorySeries";
import { buildOpenFifoLotRowList, loadTradeTransactionsForAssetLots } from "./assetFifoLots";
import { buildTaxSummary } from "./taxSummary";
import { db } from "./db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ];
    if (allowedTypes.includes(file.mimetype) || 
        file.originalname.endsWith('.csv') || 
        file.originalname.endsWith('.xlsx') ||
        file.originalname.endsWith('.xls')) {
      cb(null, true);
    } else {
      cb(new Error('Nepodporovaný formát súboru. Použite CSV alebo XLSX.'));
    }
  }
});

const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY || "";
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || "";

// Cache for stock prices with TTL (30 minutes for quotes, 12 hours for historical)
interface CacheEntry {
  data: any;
  timestamp: number;
}
const priceCache = new Map<string, CacheEntry>();
const symbolCache = new Map<string, CacheEntry>();
const historicalCache = new Map<string, CacheEntry>();
const exchangeRateCache = new Map<string, CacheEntry>();
const newsCache = new Map<string, CacheEntry>();
const CACHE_TTL = 30 * 60 * 1000;
const HISTORICAL_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours for historical data
const EXCHANGE_RATE_CACHE_TTL = 60 * 60 * 1000; // 1 hour for exchange rates
const NEWS_CACHE_TTL = 15 * 60 * 1000; // 15 minutes for news

interface AssetProfileCacheEntry {
  data: { sector: string; country: string; assetType: AssetClassValue };
  timestamp: number;
}
const assetProfileCache = new Map<string, AssetProfileCacheEntry>();
const ASSET_PROFILE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h — sektor/krajina sa mení zriedka

const ASSET_CLASS_SET = new Set<string>(ASSET_CLASS_VALUES);

function normalizeAssetType(v: unknown): AssetClassValue | null {
  if (typeof v !== "string") return null;
  const raw = v.trim();
  if (!raw) return null;
  const x = raw
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const aliases: Record<string, AssetClassValue> = {
    AKCIA: "AKCIA",
    STOCK: "AKCIA",
    ETF: "ETF",
    KRYPTO: "KRYPTO",
    CRYPTO: "KRYPTO",
    DLHOPIS: "DLHOPIS",
    BOND: "DLHOPIS",
    KOMODITA: "KOMODITA",
    COMMODITY: "KOMODITA",
    FOND: "FOND",
    FUND: "FOND",
    HOTOVOST: "HOTOVOST",
    CASH: "HOTOVOST",
    INE: "INE",
    OTHER: "INE",
  };
  const mapped = aliases[x] ?? null;
  if (mapped) return mapped;
  return ASSET_CLASS_SET.has(x) ? (x as AssetClassValue) : null;
}

async function ensureUserAssetMetadataTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_asset_metadata (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id varchar NOT NULL REFERENCES users(id),
      ticker varchar(32) NOT NULL,
      sector varchar(120),
      country varchar(120),
      asset_type varchar(20),
      updated_at timestamp DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS user_asset_metadata_user_ticker_uidx
    ON user_asset_metadata (user_id, ticker);
  `);
}

function mapYahooQuoteTypeToAssetClass(raw: unknown): AssetClassValue {
  const t = typeof raw === "string" ? raw.toUpperCase() : "";
  if (t.includes("ETF")) return "ETF";
  if (t.includes("CRYPTO")) return "KRYPTO";
  if (t.includes("BOND") || t.includes("FIXED_INCOME")) return "DLHOPIS";
  if (t.includes("MUTUALFUND") || t.includes("FUND")) return "FOND";
  if (t.includes("COMMODITY")) return "KOMODITA";
  if (t.includes("CURRENCY") || t.includes("FOREX") || t.includes("CASH")) return "HOTOVOST";
  return "AKCIA";
}

/** Mapuje Postgres 23505 na zrozumiteľnú odpoveď (najmä unikátne transaction_id v portfóliu). */
function responseForDbUniqueViolation(err: unknown): { status: number; message: string } | null {
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e?.code !== "23505") return null;
  const c = (e.constraint || "").toLowerCase();
  const m = (e.message || "").toLowerCase();
  if (
    c.includes("transaction_id") ||
    m.includes("transaction_id") ||
    c.includes("transactions_user_portfolio_transaction_id")
  ) {
    return {
      status: 409,
      message:
        "V tomto portfóliu už existuje transakcia s rovnakým ID z brokera. Pole nechajte prázdne, alebo zadajte iné jedinečné ID (nie to isté ako pri už naimportovanej transakcii).",
    };
  }
  if (c.includes("pkey") || m.includes("transactions_pkey")) {
    return {
      status: 409,
      message:
        "Transakcia s týmto interným ID už existuje. Ak nechcete nahradiť záznam, nezadávajte vlastné ID pri ukladaní.",
    };
  }
  return {
    status: 409,
    message:
      "Duplicitný záznam. Skontrolujte unikátnosť polí (najmä ID z brokera v rámci jedného portfólia).",
  };
}

/** Burzové symboly pre fetch kurzov/histórie (nie CASH, cash-flow bucket, úrok z hotovosti). */
function isMarketDataTicker(u: string): boolean {
  if (!u) return false;
  if (u === "CASH") return false;
  if (u === CASH_FLOW_TICKER) return false;
  if (u === "CASH_INTEREST") return false;
  return true;
}

// -----------------------------------------------------------------------------
// Persistent disk cache
// -----------------------------------------------------------------------------
// The in-memory Maps above are wiped on every server restart, which means every
// restart re-fetches 5 years of historical data for every ticker from Yahoo.
// We serialise the caches to a JSON file on disk so they survive restarts.
// TTL is still respected on read via the per-entry timestamp.
const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "prices.json");

function loadCacheFromDisk(): void {
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const raw = fs.readFileSync(CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as {
      quotes?: Record<string, CacheEntry>;
      historical?: Record<string, CacheEntry>;
      exchangeRates?: Record<string, CacheEntry>;
      symbols?: Record<string, CacheEntry>;
    };
    for (const [k, v] of Object.entries(parsed.quotes || {})) priceCache.set(k, v);
    for (const [k, v] of Object.entries(parsed.historical || {})) historicalCache.set(k, v);
    for (const [k, v] of Object.entries(parsed.exchangeRates || {})) exchangeRateCache.set(k, v);
    for (const [k, v] of Object.entries(parsed.symbols || {})) symbolCache.set(k, v);
    console.log(
      `Disk cache loaded: ${priceCache.size} quotes, ${historicalCache.size} histories, ${exchangeRateCache.size} fx, ${symbolCache.size} symbols`,
    );
  } catch (err) {
    console.warn("Failed to load disk cache (ignoring):", err);
  }
}

let cacheSaveTimer: NodeJS.Timeout | null = null;
function scheduleCacheSave(): void {
  if (cacheSaveTimer) clearTimeout(cacheSaveTimer);
  // Debounce writes — many cache entries get set in quick succession during a
  // batch fetch; we only want one disk write after the storm settles.
  cacheSaveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const payload = {
        savedAt: Date.now(),
        quotes: Object.fromEntries(priceCache),
        historical: Object.fromEntries(historicalCache),
        exchangeRates: Object.fromEntries(exchangeRateCache),
        symbols: Object.fromEntries(symbolCache),
      };
      fs.writeFileSync(CACHE_FILE, JSON.stringify(payload));
    } catch (err) {
      console.warn("Failed to persist price cache to disk:", err);
    }
  }, 5000);
}

// Load immediately on module init so the first request after restart is fast.
loadCacheFromDisk();

// Exchange rates interface
interface AllExchangeRates {
  eurToUsd: number;
  usdToEur: number;
  eurToCzk: number;
  czkToEur: number;
  eurToPln: number;
  plnToEur: number;
  eurToGbp: number;
  gbpToEur: number;
}

// Fetch all exchange rates from EUR
async function fetchAllExchangeRates(): Promise<AllExchangeRates> {
  const cached = exchangeRateCache.get("ALL_RATES");
  if (cached && Date.now() - cached.timestamp < EXCHANGE_RATE_CACHE_TTL) {
    return cached.data;
  }

  // Try Frankfurter API first (free, reliable, ECB rates)
  try {
    const response = await fetch("https://api.frankfurter.app/latest?from=EUR&to=USD,CZK,PLN,GBP");
    if (response.ok) {
      const data = await response.json();
      if (data.rates?.USD && data.rates?.CZK) {
        const result: AllExchangeRates = {
          eurToUsd: data.rates.USD,
          usdToEur: 1 / data.rates.USD,
          eurToCzk: data.rates.CZK,
          czkToEur: 1 / data.rates.CZK,
          eurToPln: data.rates.PLN || 4.3,
          plnToEur: 1 / (data.rates.PLN || 4.3),
          eurToGbp: data.rates.GBP || 0.85,
          gbpToEur: 1 / (data.rates.GBP || 0.85),
        };
        exchangeRateCache.set("ALL_RATES", { data: result, timestamp: Date.now() });
        scheduleCacheSave();
        console.log(`Exchange rates fetched: 1 EUR = ${result.eurToUsd} USD, ${result.eurToCzk} CZK, ${result.eurToPln} PLN`);
        return result;
      }
    }
  } catch (error) {
    console.warn("Frankfurter API failed, trying fallback...");
  }

  // Fallback: ExchangeRate-API
  try {
    const response = await fetch("https://open.er-api.com/v6/latest/EUR");
    if (response.ok) {
      const data = await response.json();
      if (data.rates?.USD) {
        const result: AllExchangeRates = {
          eurToUsd: data.rates.USD,
          usdToEur: 1 / data.rates.USD,
          eurToCzk: data.rates.CZK || 25.3,
          czkToEur: 1 / (data.rates.CZK || 25.3),
          eurToPln: data.rates.PLN || 4.3,
          plnToEur: 1 / (data.rates.PLN || 4.3),
          eurToGbp: data.rates.GBP || 0.85,
          gbpToEur: 1 / (data.rates.GBP || 0.85),
        };
        exchangeRateCache.set("ALL_RATES", { data: result, timestamp: Date.now() });
        scheduleCacheSave();
        return result;
      }
    }
  } catch (error) {
    console.warn("ExchangeRate-API failed...");
  }

  // Use cached value if available
  if (cached) {
    return cached.data;
  }

  // Fallback to approximate rates
  return { 
    eurToUsd: 1.08, 
    usdToEur: 0.926,
    eurToCzk: 25.3,
    czkToEur: 0.0395,
    eurToPln: 4.3,
    plnToEur: 0.233,
    eurToGbp: 0.85,
    gbpToEur: 1.18,
  };
}

// Legacy function for backward compatibility
async function fetchExchangeRate(): Promise<{ eurToUsd: number; usdToEur: number }> {
  const allRates = await fetchAllExchangeRates();
  return { eurToUsd: allRates.eurToUsd, usdToEur: allRates.usdToEur };
}

// Determine currency for a ticker
function getTickerCurrency(ticker: string): "EUR" | "USD" | "GBP" | "CZK" | "PLN" {
  const upperTicker = ticker.toUpperCase();
  // German exchanges (XETRA, Frankfurt, Berlin, Düsseldorf, Hamburg, Stuttgart, Munich)
  if (upperTicker.endsWith(".DE") || upperTicker.endsWith(".F") ||
      upperTicker.endsWith(".BE") || upperTicker.endsWith(".DU") ||
      upperTicker.endsWith(".HM") || upperTicker.endsWith(".SG") ||
      upperTicker.endsWith(".MU")) {
    return "EUR";
  }
  // Other European exchanges (EUR) — .FR = Euronext Fr (XTB); Yahoo = .PA
  if (upperTicker.endsWith(".PA") || upperTicker.endsWith(".AS") || 
      upperTicker.endsWith(".MI") || upperTicker.endsWith(".VI") || 
      upperTicker.endsWith(".BR") || upperTicker.endsWith(".SW") || upperTicker.endsWith(".FR")) {
    return "EUR";
  }
  // Prague Stock Exchange (CZK)
  if (upperTicker.endsWith(".PR")) {
    return "CZK";
  }
  // Warsaw Stock Exchange (PLN)
  if (upperTicker.endsWith(".WA")) {
    return "PLN";
  }
  if (upperTicker.endsWith(".L")) {
    return "GBP";
  }
  // US stocks (no suffix or common US exchanges)
  return "USD";
}

// Convert ticker to Yahoo Finance format
function toYahooTicker(ticker: string): string {
  // European exchanges mapping
  const exchangeMap: Record<string, string> = {
    ".US": "",         // US suffix from broker feed -> plain Yahoo ticker (AAPL.US -> AAPL)
    // Musí byť pred kratším ".F" — inak neplatí, MC.FR končí .FR, nie .F
    ".FR": ".PA",      // Euronext Paris (XTB „.FR“) → Yahoo uvádja MC.PA, MC.FR 404
    ".DE": ".DE",      // XETRA Germany
    ".DEX": ".DE",     // XETRA alternate
    ".F": ".F",        // Frankfurt
    ".BE": ".BE",      // Berlin
    ".DU": ".DU",      // Düsseldorf
    ".HM": ".HM",      // Hamburg
    ".SG": ".SG",      // Stuttgart
    ".MU": ".MU",      // Munich
    ".L": ".L",        // London
    ".PA": ".PA",      // Paris (Euronext)
    ".PAR": ".PA",     // Paris alternate
    ".AMS": ".AS",     // Amsterdam (Euronext)
    ".AS": ".AS",      // Amsterdam
    ".MI": ".MI",      // Milan
    ".SW": ".SW",      // Swiss
    ".VI": ".VI",      // Vienna
    ".PR": ".PR",      // Prague Stock Exchange
    ".WA": ".WA",      // Warsaw Stock Exchange
  };
  
  for (const [suffix, yahooSuffix] of Object.entries(exchangeMap)) {
    if (ticker.toUpperCase().endsWith(suffix)) {
      const base = ticker.slice(0, -suffix.length);
      return base + yahooSuffix;
    }
  }
  
  return ticker;
}

async function fetchYahooExtendedSessionPrice(
  yahooTicker: string,
  regularPrice: number,
): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1m&range=1d&includePrePost=true`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (!response.ok) return null;

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    const pre = Number(meta?.preMarketPrice);
    if (Number.isFinite(pre) && pre > 0) return pre;
    const post = Number(meta?.postMarketPrice);
    if (Number.isFinite(post) && post > 0) return post;

    const closes: unknown[] = result?.indicators?.quote?.[0]?.close ?? [];
    for (let i = closes.length - 1; i >= 0; i--) {
      const v = Number(closes[i]);
      if (Number.isFinite(v) && v > 0 && Math.abs(v - regularPrice) > 1e-9) {
        return v;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function quoteDateFromEpoch(
  epochSeconds: number | null | undefined,
  timeZone?: string | null,
): string | null {
  if (!Number.isFinite(epochSeconds) || !epochSeconds || epochSeconds <= 0) {
    return null;
  }

  const dt = new Date(Number(epochSeconds) * 1000);
  if (Number.isNaN(dt.getTime())) return null;

  try {
    if (timeZone && timeZone.trim()) {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(dt);
    }
  } catch {
    // Fallback below if timezone is invalid/unsupported.
  }

  return dt.toISOString().split("T")[0];
}

async function fetchYahooAssetProfile(
  ticker: string,
): Promise<{ sector: string; country: string; assetType: AssetClassValue }> {
  const key = ticker.toUpperCase();
  if (key === "CASH") {
    return { sector: "Hotovosť", country: "—", assetType: "HOTOVOST" };
  }

  const cached = assetProfileCache.get(key);
  if (cached && Date.now() - cached.timestamp < ASSET_PROFILE_CACHE_TTL) {
    return cached.data;
  }

  const fallback = { sector: "Neznáme", country: "Neznáme", assetType: "AKCIA" as const };

  try {
    const yahooTicker = toYahooTicker(key);
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooTicker)}?modules=assetProfile,summaryProfile,price`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      assetProfileCache.set(key, { data: fallback, timestamp: Date.now() });
      return fallback;
    }

    const data = await response.json();
    const result = data?.quoteSummary?.result?.[0];
    const ap = result?.assetProfile;
    const sp = result?.summaryProfile;
    const price = result?.price;

    const sectorRaw =
      (typeof ap?.sector === "string" && ap.sector.trim()) ||
      (typeof sp?.sector === "string" && sp.sector.trim()) ||
      (typeof ap?.industry === "string" && ap.industry.trim()) ||
      (typeof sp?.industry === "string" && sp.industry.trim()) ||
      "";

    const countryRaw =
      (typeof ap?.country === "string" && ap.country.trim()) ||
      (typeof sp?.country === "string" && sp.country.trim()) ||
      "";

    const row = {
      sector: sectorRaw || "Nezaradené",
      country: countryRaw || "Neznáme",
      assetType: mapYahooQuoteTypeToAssetClass(price?.quoteType),
    };

    assetProfileCache.set(key, { data: row, timestamp: Date.now() });
    return row;
  } catch (e) {
    console.warn(`Asset profile failed for ${key}:`, e);
    assetProfileCache.set(key, { data: fallback, timestamp: Date.now() });
    return fallback;
  }
}

/** Yahoo: najbližší ex-dividend / výplatný dátum z quoteSummary (cache). */
interface UpcomingDividendYahooParsed {
  eventMs: number;
  kind: "ex_dividend" | "payout";
  lastDividendPerShare: number | null;
}

const upcomingDividendYahooCache = new Map<
  string,
  { t: number; v: UpcomingDividendYahooParsed[] | null }
>();
const UPCOMING_DIV_YAHOO_TTL_MS = 45 * 60 * 1000;

function yahooRawTsToMs(raw: number): number {
  if (!Number.isFinite(raw)) return NaN;
  return raw > 1e12 ? raw : raw * 1000;
}

/**
 * Všetky budúce ex-dividend / výplatné dátumy z Yahoo pre jeden ticker (0–2 položky).
 * Pre kalendár očakávaných výplat v aplikácii.
 */
async function fetchYahooUpcomingDividendEvents(
  ticker: string,
): Promise<UpcomingDividendYahooParsed[] | null> {
  const key = ticker.toUpperCase();
  const cached = upcomingDividendYahooCache.get(key);
  if (cached && Date.now() - cached.t < UPCOMING_DIV_YAHOO_TTL_MS) {
    return cached.v;
  }

  try {
    const yahooTicker = toYahooTicker(key);
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooTicker)}?modules=calendarEvents,defaultKeyStatistics`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      upcomingDividendYahooCache.set(key, { t: Date.now(), v: null });
      return null;
    }

    const data = await response.json();
    const cr = data?.quoteSummary;
    if (cr?.error || !Array.isArray(cr?.result) || cr.result.length === 0) {
      upcomingDividendYahooCache.set(key, { t: Date.now(), v: null });
      return null;
    }

    const result = cr.result[0];
    const ce = result?.calendarEvents;
    const dks = result?.defaultKeyStatistics;

    const exRaw = ce?.exDividendDate?.raw;
    const payRaw = ce?.dividendDate?.raw;
    const lastDivRaw = dks?.lastDividendValue?.raw;

    const exMs = typeof exRaw === "number" ? yahooRawTsToMs(exRaw) : NaN;
    const payMs = typeof payRaw === "number" ? yahooRawTsToMs(payRaw) : NaN;
    const lastDividendPerShare =
      typeof lastDivRaw === "number" && Number.isFinite(lastDivRaw)
        ? lastDivRaw
        : null;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const t0 = todayStart.getTime();

    const events: UpcomingDividendYahooParsed[] = [];
    const exOk = Number.isFinite(exMs) && exMs >= t0;
    const payOk = Number.isFinite(payMs) && payMs >= t0;
    if (exOk && payOk) {
      const exDay = new Date(exMs).toISOString().slice(0, 10);
      const payDay = new Date(payMs).toISOString().slice(0, 10);
      if (exDay === payDay) {
        events.push({ eventMs: payMs, kind: "payout", lastDividendPerShare });
      } else {
        events.push({ eventMs: exMs, kind: "ex_dividend", lastDividendPerShare });
        events.push({ eventMs: payMs, kind: "payout", lastDividendPerShare });
      }
    } else {
      if (exOk) {
        events.push({ eventMs: exMs, kind: "ex_dividend", lastDividendPerShare });
      }
      if (payOk) {
        events.push({ eventMs: payMs, kind: "payout", lastDividendPerShare });
      }
    }

    if (events.length === 0) {
      upcomingDividendYahooCache.set(key, { t: Date.now(), v: null });
      return null;
    }

    events.sort((a, b) => a.eventMs - b.eventMs);
    upcomingDividendYahooCache.set(key, { t: Date.now(), v: events });
    return events;
  } catch {
    upcomingDividendYahooCache.set(key, { t: Date.now(), v: null });
    return null;
  }
}

/** Najbližší earnings: Yahoo calendarEvents (ak odpovie), inak Finnhub calendar (vyžaduje FINNHUB_API_KEY). */
const nextEarningsAssetCache = new Map<string, { t: number; v: { date: string } | null }>();
const NEXT_EARNINGS_ASSET_TTL_MS = 45 * 60 * 1000;

function calendarDateStringFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Yahoo quoteSummary — často blokuje bez crumbu; pri úspechu vráti dátum. */
async function tryYahooNextEarningsDate(tickerUpper: string): Promise<{ date: string } | null> {
  try {
    const yahooTicker = toYahooTicker(tickerUpper);
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooTicker)}?modules=calendarEvents`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    const cr = data?.quoteSummary;
    if (cr?.error || !Array.isArray(cr?.result) || cr.result.length === 0) {
      return null;
    }

    const result = cr.result[0];
    const earnings = result?.calendarEvents?.earnings;
    const ed = earnings?.earningsDate;

    type EdItem = { raw?: number; fmt?: string };
    const items: EdItem[] = Array.isArray(ed)
      ? ed
      : ed && typeof ed === "object"
        ? [ed as EdItem]
        : [];

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const t0 = todayStart.getTime();

    let bestMs = Infinity;

    for (const item of items) {
      const raw = item?.raw;
      const fmt = typeof item?.fmt === "string" ? item.fmt.trim() : "";
      let ms = typeof raw === "number" ? yahooRawTsToMs(raw) : NaN;
      if (!Number.isFinite(ms) && fmt.length > 0) {
        const parsed = Date.parse(fmt);
        if (Number.isFinite(parsed)) ms = parsed;
      }
      if (!Number.isFinite(ms) || ms < t0) continue;
      if (ms < bestMs) bestMs = ms;
    }

    if (!Number.isFinite(bestMs) || bestMs === Infinity) return null;

    return { date: calendarDateStringFromMs(bestMs) };
  } catch {
    return null;
  }
}

/** Finnhub earnings calendar — spoľahlivejší, ak je nastavený API kľúč. */
async function tryFinnhubNextEarningsDate(tickerUpper: string): Promise<{ date: string } | null> {
  if (!FINNHUB_API_KEY) return null;

  try {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 200);

    const pad = (n: number) => String(n).padStart(2, "0");
    const fromStr = `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`;
    const toStr = `${to.getFullYear()}-${pad(to.getMonth() + 1)}-${pad(to.getDate())}`;

    const url =
      `https://finnhub.io/api/v1/calendar/earnings?from=${fromStr}&to=${toStr}` +
      `&symbol=${encodeURIComponent(tickerUpper)}&token=${FINNHUB_API_KEY}`;

    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const rows = data?.earningsCalendar;
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const t0 = from.getTime();
    let best: string | null = null;
    let bestMs = Infinity;

    for (const row of rows) {
      const d = row?.date;
      if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const ms = new Date(`${d}T12:00:00`).getTime();
      if (!Number.isFinite(ms) || ms < t0) continue;
      if (ms < bestMs) {
        bestMs = ms;
        best = d;
      }
    }

    return best ? { date: best } : null;
  } catch {
    return null;
  }
}

async function fetchNextEarningsDateForAsset(ticker: string): Promise<{ date: string } | null> {
  const key = ticker.toUpperCase();
  const cached = nextEarningsAssetCache.get(key);
  if (cached && Date.now() - cached.t < NEXT_EARNINGS_ASSET_TTL_MS) {
    return cached.v;
  }

  let v: { date: string } | null = await tryYahooNextEarningsDate(key);
  if (!v) {
    v = await tryFinnhubNextEarningsDate(key);
  }

  nextEarningsAssetCache.set(key, { t: Date.now(), v });
  return v;
}

interface NewsArticle {
  ticker: string;
  title: string;
  link: string;
  publisher: string;
  publishedAt: number;
  summary?: string;
  thumbnail?: string;
}

// Fetch news from Yahoo Finance for a ticker
async function fetchYahooNews(ticker: string): Promise<NewsArticle[]> {
  try {
    const yahooTicker = toYahooTicker(ticker);
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(yahooTicker)}&quotesCount=0&newsCount=5&enableFuzzyQuery=false&quotesQueryId=tss_match_phrase_query&multiQuoteQueryId=multi_quote_single_token_query&newsQueryId=news_cie_vespa&enableCb=false&enableNavLinks=false`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      console.error(`Yahoo News returned ${response.status} for ${ticker}`);
      return [];
    }
    
    const data = await response.json();
    
    if (data.news && Array.isArray(data.news)) {
      return data.news.map((article: any) => ({
        ticker,
        title: article.title || "",
        link: article.link || "",
        publisher: article.publisher || "Yahoo Finance",
        publishedAt: article.providerPublishTime || Math.floor(Date.now() / 1000),
        summary: article.summary || "",
        thumbnail: article.thumbnail?.resolutions?.[0]?.url || null,
      }));
    }
    
    return [];
  } catch (error) {
    console.error(`Error fetching news for ${ticker}:`, error);
    return [];
  }
}

// Fetch company name from Yahoo Finance
async function fetchYahooCompanyName(ticker: string): Promise<string | null> {
  try {
    const yahooTicker = toYahooTicker(ticker);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=1d`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    
    if (data.chart?.result?.[0]?.meta) {
      const meta = data.chart.result[0].meta;
      return meta.shortName || meta.longName || null;
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching company name for ${ticker}:`, error);
    return null;
  }
}

// Fetch quote from Yahoo Finance (free, no API key needed)
async function fetchYahooQuote(ticker: string): Promise<any> {
  try {
    const yahooTicker = toYahooTicker(ticker);
    const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(yahooTicker)}`;

    // Prefer v7/quote: it reliably carries pre/post-market fields.
    const quoteResponse = await fetch(quoteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (quoteResponse.ok) {
      const quoteData = await quoteResponse.json();
      const q = quoteData?.quoteResponse?.result?.[0];
      const regularMarketPriceRaw = Number(q?.regularMarketPrice);
      const regularMarketPrice =
        Number.isFinite(regularMarketPriceRaw) && regularMarketPriceRaw > 0
          ? regularMarketPriceRaw
          : null;
      const previousCloseRaw = Number(q?.regularMarketPreviousClose);
      const previousClose =
        Number.isFinite(previousCloseRaw) && previousCloseRaw > 0
          ? previousCloseRaw
          : regularMarketPrice;

      if (regularMarketPrice != null) {
        const marketStateRaw = String(q?.marketState ?? "").toUpperCase();
        const marketState = marketStateRaw || null;
        const isMarketOpen =
          marketStateRaw === "REGULAR"
            ? true
            : marketStateRaw
              ? false
              : null;
        const change = previousClose != null ? regularMarketPrice - previousClose : 0;
        const changePercent =
          previousClose != null && previousClose > 0 ? (change / previousClose) * 100 : 0;

        const preMarketPriceRaw = Number(q?.preMarketPrice);
        const postMarketPriceRaw = Number(q?.postMarketPrice);
        const preOrPostMarketPrice =
          Number.isFinite(preMarketPriceRaw) && preMarketPriceRaw > 0
            ? preMarketPriceRaw
            : Number.isFinite(postMarketPriceRaw) && postMarketPriceRaw > 0
              ? postMarketPriceRaw
              : null;
        let preMarketPrice = preOrPostMarketPrice;
        if (preMarketPrice == null) {
          preMarketPrice = await fetchYahooExtendedSessionPrice(yahooTicker, regularMarketPrice);
        }
        const preMarketChange = preMarketPrice != null ? preMarketPrice - regularMarketPrice : null;
        const preMarketChangePercent =
          preMarketPrice != null && regularMarketPrice > 0
            ? (preMarketChange! / regularMarketPrice) * 100
            : null;

        const regularMarketTimeRaw = Number(q?.regularMarketTime);
        const quoteDate = quoteDateFromEpoch(
          regularMarketTimeRaw,
          typeof q?.exchangeTimezoneName === "string" ? q.exchangeTimezoneName : null,
        );

        return {
          ticker,
          price: regularMarketPrice,
          change,
          changePercent,
          quoteDate,
          marketState,
          isMarketOpen,
          preMarketPrice,
          preMarketChange,
          preMarketChangePercent,
          high52: Number(q?.fiftyTwoWeekHigh) || 0,
          low52: Number(q?.fiftyTwoWeekLow) || 0,
        };
      }
    }

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=1d`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Yahoo Finance returned ${response.status}`);
    }

    const data = await response.json();

    if (data.chart?.result?.[0]) {
      const result = data.chart.result[0];
      const meta = result.meta;
      const quote = result.indicators?.quote?.[0];
      
      const currentPrice = meta.regularMarketPrice || (quote?.close?.[quote.close.length - 1]) || 0;
      const previousClose = meta.previousClose || meta.chartPreviousClose || currentPrice;
      const change = currentPrice - previousClose;
      const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;
      
      if (currentPrice > 0) {
        const preMarketPriceRaw = Number(meta?.preMarketPrice);
        const postMarketPriceRaw = Number(meta?.postMarketPrice);
        const preOrPostMarketPrice =
          Number.isFinite(preMarketPriceRaw) && preMarketPriceRaw > 0
            ? preMarketPriceRaw
            : Number.isFinite(postMarketPriceRaw) && postMarketPriceRaw > 0
              ? postMarketPriceRaw
              : null;
        let preMarketPrice = preOrPostMarketPrice;
        if (preMarketPrice == null) {
          preMarketPrice = await fetchYahooExtendedSessionPrice(yahooTicker, currentPrice);
        }
        const preMarketChange = preMarketPrice != null ? preMarketPrice - currentPrice : null;
        const preMarketChangePercent =
          preMarketPrice != null && currentPrice > 0
            ? (preMarketChange! / currentPrice) * 100
            : null;

        const regularMarketTimeRaw = Number(meta?.regularMarketTime);
        const quoteDate = quoteDateFromEpoch(
          regularMarketTimeRaw,
          typeof meta?.exchangeTimezoneName === "string" ? meta.exchangeTimezoneName : null,
        );

        return {
          ticker,
          price: currentPrice,
          change,
          changePercent,
          quoteDate,
          marketState: String(meta?.marketState ?? "").toUpperCase() || null,
          isMarketOpen:
            String(meta?.marketState ?? "").toUpperCase() === "REGULAR"
              ? true
              : String(meta?.marketState ?? "").toUpperCase()
                ? false
                : null,
          preMarketPrice,
          preMarketChange,
          preMarketChangePercent,
          high52: meta.fiftyTwoWeekHigh || 0,
          low52: meta.fiftyTwoWeekLow || 0,
        };
      }
    }
    
    throw new Error("Invalid response from Yahoo Finance");
  } catch (error) {
    console.error(`Error fetching Yahoo Finance quote for ${ticker}:`, error);
    throw error;
  }
}

// Fetch historical prices from Yahoo Finance
async function fetchYahooHistoricalPrices(ticker: string): Promise<Record<string, number>> {
  try {
    const yahooTicker = toYahooTicker(ticker);
    const now = Math.floor(Date.now() / 1000);
    const fiveYearsAgo = now - (5 * 365 * 24 * 60 * 60);
    
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?period1=${fiveYearsAgo}&period2=${now}&interval=1d`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Yahoo Finance returned ${response.status}`);
    }
    
    const data = await response.json();
    const prices: Record<string, number> = {};
    
    if (data.chart?.result?.[0]) {
      const result = data.chart.result[0];
      const timestamps = result.timestamp || [];
      const closes = result.indicators?.quote?.[0]?.close || [];
      
      for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] !== null && closes[i] !== undefined) {
          const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
          prices[date] = closes[i];
        }
      }
    }
    
    return prices;
  } catch (error) {
    console.error(`Error fetching Yahoo Finance historical for ${ticker}:`, error);
    return {};
  }
}

// Fetch quote from Finnhub (backup API)
async function fetchFinnhubQuote(ticker: string): Promise<any> {
  if (!FINNHUB_API_KEY) {
    throw new Error("Finnhub API key not configured");
  }

  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data && data.c && data.c > 0) {
      return {
        ticker,
        price: data.c, // current price
        change: data.d || 0, // change
        changePercent: data.dp || 0, // change percent
        quoteDate: null,
        marketState: null,
        isMarketOpen: null,
        preMarketPrice: null,
        preMarketChange: null,
        preMarketChangePercent: null,
        high52: data.h || 0, // high of day (not 52w)
        low52: data.l || 0, // low of day (not 52w)
      };
    }

    throw new Error("Invalid response from Finnhub");
  } catch (error) {
    console.error(`Error fetching Finnhub quote for ${ticker}:`, error);
    throw error;
  }
}

async function fetchStockQuote(ticker: string, skipCache = false): Promise<any> {
  // Check cache first (unless user explicitly refreshes quotes)
  const cached = priceCache.get(ticker);
  if (!skipCache && cached && Date.now() - cached.timestamp < CACHE_TTL) {
    // Backward compatibility: older cache entries may miss preMarket fields.
    if (cached.data && Object.prototype.hasOwnProperty.call(cached.data, "preMarketPrice")) {
      return cached.data;
    }
  }

  // Try Yahoo Finance first (works best for European stocks, no API key needed)
  try {
    const result = await fetchYahooQuote(ticker);
    priceCache.set(ticker, { data: result, timestamp: Date.now() });
    scheduleCacheSave();
    console.log(`Yahoo Finance success for ${ticker}: ${result.price}`);
    return result;
  } catch (error) {
    console.warn(`Yahoo Finance failed for ${ticker}, trying Alpha Vantage...`);
  }

  // Try Alpha Vantage second
  if (ALPHA_VANTAGE_API_KEY) {
    try {
      const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${ALPHA_VANTAGE_API_KEY}`;
      const response = await fetch(url);
      const data = await response.json();

      // Check for rate limit or error messages
      if (data["Note"] || data["Information"]) {
        console.warn(`Alpha Vantage rate limit for ${ticker}, trying Finnhub...`);
        // Fall through to Finnhub
      } else if (data["Global Quote"] && Object.keys(data["Global Quote"]).length > 0) {
        const quote = data["Global Quote"];
        const result = {
          ticker,
          price: parseFloat(quote["05. price"]) || 0,
          change: parseFloat(quote["09. change"]) || 0,
          changePercent: parseFloat(quote["10. change percent"]?.replace("%", "")) || 0,
          quoteDate: null,
          marketState: null,
          isMarketOpen: null,
          preMarketPrice: null,
          preMarketChange: null,
          preMarketChangePercent: null,
          high52: parseFloat(quote["52w High"]) || 0,
          low52: parseFloat(quote["52w Low"]) || 0,
        };
        
        // Cache the result
        priceCache.set(ticker, { data: result, timestamp: Date.now() });
        scheduleCacheSave();
        return result;
      }
    } catch (error) {
      console.error(`Alpha Vantage error for ${ticker}:`, error);
    }
  }

  // Try Finnhub as last resort (only works for US stocks)
  if (FINNHUB_API_KEY) {
    try {
      const result = await fetchFinnhubQuote(ticker);
      // Cache the result
      priceCache.set(ticker, { data: result, timestamp: Date.now() });
      scheduleCacheSave();
      return result;
    } catch (error) {
      console.error(`Finnhub error for ${ticker}:`, error);
    }
  }

  // Return cached data if available, even if expired
  if (cached) {
    console.log(`Using expired cache for ${ticker}`);
    return cached.data;
  }

  throw new Error("No API available to fetch stock quote");
}

// Fetch historical candles from Finnhub
async function fetchFinnhubCandles(ticker: string): Promise<Record<string, number>> {
  if (!FINNHUB_API_KEY) {
    return {};
  }

  try {
    // Get last 365 days of daily candles
    const now = Math.floor(Date.now() / 1000);
    const oneYearAgo = now - (365 * 24 * 60 * 60);
    const url = `https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=D&from=${oneYearAgo}&to=${now}&token=${FINNHUB_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data && data.s === "ok" && data.c && data.t) {
      const prices: Record<string, number> = {};
      for (let i = 0; i < data.t.length; i++) {
        const date = new Date(data.t[i] * 1000).toISOString().split('T')[0];
        prices[date] = data.c[i]; // closing price
      }
      return prices;
    }

    return {};
  } catch (error) {
    console.error(`Error fetching Finnhub candles for ${ticker}:`, error);
    return {};
  }
}

// Fetch historical daily prices - Yahoo Finance first, then Alpha Vantage, then Finnhub
async function fetchHistoricalPrices(ticker: string): Promise<Record<string, number>> {
  // Check cache
  const cached = historicalCache.get(ticker);
  if (cached && Date.now() - cached.timestamp < HISTORICAL_CACHE_TTL) {
    return cached.data;
  }

  let prices: Record<string, number> = {};

  // Try Yahoo Finance first (best for European stocks, no API key needed)
  try {
    prices = await fetchYahooHistoricalPrices(ticker);
    if (Object.keys(prices).length > 0) {
      console.log(`Yahoo Finance historical success for ${ticker}: ${Object.keys(prices).length} days`);
      historicalCache.set(ticker, { data: prices, timestamp: Date.now() });
      scheduleCacheSave();
      return prices;
    }
  } catch (error) {
    console.warn(`Yahoo Finance historical failed for ${ticker}, trying Alpha Vantage...`);
  }

  // Try Alpha Vantage second
  if (ALPHA_VANTAGE_API_KEY) {
    try {
      const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&apikey=${ALPHA_VANTAGE_API_KEY}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data["Time Series (Daily)"]) {
        const timeSeries = data["Time Series (Daily)"];
        for (const [date, values] of Object.entries(timeSeries)) {
          prices[date] = parseFloat((values as any)["4. close"]) || 0;
        }
        
        if (Object.keys(prices).length > 0) {
          historicalCache.set(ticker, { data: prices, timestamp: Date.now() });
          scheduleCacheSave();
          return prices;
        }
      }

      if (data["Note"] || data["Information"]) {
        console.warn(`Alpha Vantage limit for ${ticker}, trying Finnhub...`);
      }
    } catch (error) {
      console.error(`Alpha Vantage historical error for ${ticker}:`, error);
    }
  }

  // Try Finnhub as last resort
  if (FINNHUB_API_KEY) {
    try {
      prices = await fetchFinnhubCandles(ticker);
      if (Object.keys(prices).length > 0) {
        historicalCache.set(ticker, { data: prices, timestamp: Date.now() });
        scheduleCacheSave();
        return prices;
      }
    } catch (error) {
      console.error(`Finnhub historical error for ${ticker}:`, error);
    }
  }

  // Return cached data if available, even if expired
  if (cached) {
    console.log(`Using expired historical cache for ${ticker}`);
    return cached.data;
  }

  return {}; // Return empty on error, don't break the app
}

// Comprehensive stock database (US + European ETFs)
const STOCK_DATABASE = [
  // US Stocks
  { ticker: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", currency: "USD" },
  { ticker: "MSFT", name: "Microsoft Corporation", exchange: "NASDAQ", currency: "USD" },
  { ticker: "GOOGL", name: "Alphabet Inc.", exchange: "NASDAQ", currency: "USD" },
  { ticker: "GOOG", name: "Alphabet Inc. (Class C)", exchange: "NASDAQ", currency: "USD" },
  { ticker: "AMZN", name: "Amazon.com Inc.", exchange: "NASDAQ", currency: "USD" },
  { ticker: "NVDA", name: "NVIDIA Corporation", exchange: "NASDAQ", currency: "USD" },
  { ticker: "TSLA", name: "Tesla Inc.", exchange: "NASDAQ", currency: "USD" },
  { ticker: "META", name: "Meta Platforms Inc.", exchange: "NASDAQ", currency: "USD" },
  { ticker: "BRK.B", name: "Berkshire Hathaway Inc. (Class B)", exchange: "NYSE", currency: "USD" },
  { ticker: "JPM", name: "JPMorgan Chase & Co.", exchange: "NYSE", currency: "USD" },
  { ticker: "V", name: "Visa Inc.", exchange: "NYSE", currency: "USD" },
  { ticker: "UNH", name: "UnitedHealth Group Inc.", exchange: "NYSE", currency: "USD" },
  { ticker: "HD", name: "The Home Depot Inc.", exchange: "NYSE", currency: "USD" },
  { ticker: "PG", name: "Procter & Gamble Co.", exchange: "NYSE", currency: "USD" },
  { ticker: "MA", name: "Mastercard Inc.", exchange: "NYSE", currency: "USD" },
  { ticker: "DIS", name: "The Walt Disney Company", exchange: "NYSE", currency: "USD" },
  { ticker: "NFLX", name: "Netflix Inc.", exchange: "NASDAQ", currency: "USD" },
  { ticker: "ADBE", name: "Adobe Inc.", exchange: "NASDAQ", currency: "USD" },
  { ticker: "CRM", name: "Salesforce Inc.", exchange: "NYSE", currency: "USD" },
  { ticker: "INTC", name: "Intel Corporation", exchange: "NASDAQ", currency: "USD" },
  { ticker: "AMD", name: "Advanced Micro Devices Inc.", exchange: "NASDAQ", currency: "USD" },
  { ticker: "PYPL", name: "PayPal Holdings Inc.", exchange: "NASDAQ", currency: "USD" },
  { ticker: "SOFI", name: "SoFi Technologies Inc.", exchange: "NASDAQ", currency: "USD" },
  { ticker: "CSCO", name: "Cisco Systems Inc.", exchange: "NASDAQ", currency: "USD" },
  { ticker: "ORCL", name: "Oracle Corporation", exchange: "NYSE", currency: "USD" },
  { ticker: "IBM", name: "IBM Corporation", exchange: "NYSE", currency: "USD" },
  { ticker: "QCOM", name: "Qualcomm Inc.", exchange: "NASDAQ", currency: "USD" },
  { ticker: "BA", name: "The Boeing Company", exchange: "NYSE", currency: "USD" },
  { ticker: "GE", name: "General Electric Company", exchange: "NYSE", currency: "USD" },
  { ticker: "F", name: "Ford Motor Company", exchange: "NYSE", currency: "USD" },
  { ticker: "GM", name: "General Motors Company", exchange: "NYSE", currency: "USD" },
  { ticker: "T", name: "AT&T Inc.", exchange: "NYSE", currency: "USD" },
  { ticker: "VZ", name: "Verizon Communications Inc.", exchange: "NYSE", currency: "USD" },
  { ticker: "XOM", name: "Exxon Mobil Corporation", exchange: "NYSE", currency: "USD" },
  { ticker: "CVX", name: "Chevron Corporation", exchange: "NYSE", currency: "USD" },
  { ticker: "KO", name: "The Coca-Cola Company", exchange: "NYSE", currency: "USD" },
  { ticker: "MCD", name: "McDonald's Corporation", exchange: "NYSE", currency: "USD" },
  { ticker: "NKE", name: "NIKE Inc.", exchange: "NYSE", currency: "USD" },
  { ticker: "COST", name: "Costco Wholesale Corporation", exchange: "NASDAQ", currency: "USD" },
  { ticker: "WMT", name: "Walmart Inc.", exchange: "NYSE", currency: "USD" },
  { ticker: "AMEX", name: "American Express Company", exchange: "NYSE", currency: "USD" },
  { ticker: "CAT", name: "Caterpillar Inc.", exchange: "NYSE", currency: "USD" },
  { ticker: "MMM", name: "3M Company", exchange: "NYSE", currency: "USD" },
  { ticker: "AXP", name: "American Express Company", exchange: "NYSE", currency: "USD" },
  { ticker: "PEP", name: "PepsiCo Inc.", exchange: "NASDAQ", currency: "USD" },
  // Popular European ETFs (XETRA - Germany)
  { ticker: "VWCE.DE", name: "Vanguard FTSE All-World UCITS ETF (Acc)", exchange: "XETRA", currency: "EUR" },
  { ticker: "VWRL.DE", name: "Vanguard FTSE All-World UCITS ETF (Dist)", exchange: "XETRA", currency: "EUR" },
  { ticker: "EUNL.DE", name: "iShares Core MSCI World UCITS ETF", exchange: "XETRA", currency: "EUR" },
  { ticker: "IWDA.DE", name: "iShares Core MSCI World UCITS ETF (Acc)", exchange: "XETRA", currency: "EUR" },
  { ticker: "IUSQ.DE", name: "iShares MSCI ACWI UCITS ETF", exchange: "XETRA", currency: "USD" },
  { ticker: "CSPX.DE", name: "iShares Core S&P 500 UCITS ETF", exchange: "XETRA", currency: "USD" },
  { ticker: "SXR8.DE", name: "iShares Core S&P 500 UCITS ETF (EUR)", exchange: "XETRA", currency: "EUR" },
  { ticker: "VUSA.DE", name: "Vanguard S&P 500 UCITS ETF", exchange: "XETRA", currency: "USD" },
  { ticker: "VUAA.DE", name: "Vanguard S&P 500 UCITS ETF (Acc)", exchange: "XETRA", currency: "USD" },
  { ticker: "ISAC.DE", name: "iShares MSCI ACWI UCITS ETF (Acc)", exchange: "XETRA", currency: "USD" },
  { ticker: "SXRV.DE", name: "iShares Core MSCI EM IMI UCITS ETF", exchange: "XETRA", currency: "USD" },
  { ticker: "IS3N.DE", name: "iShares Core MSCI EM IMI UCITS ETF (Acc)", exchange: "XETRA", currency: "EUR" },
  { ticker: "VFEM.DE", name: "Vanguard FTSE Emerging Markets UCITS ETF", exchange: "XETRA", currency: "USD" },
  { ticker: "VGWL.DE", name: "Vanguard FTSE All-World High Dividend UCITS ETF", exchange: "XETRA", currency: "USD" },
  // London Stock Exchange
  { ticker: "VWRL.L", name: "Vanguard FTSE All-World UCITS ETF", exchange: "LSE", currency: "GBP" },
  { ticker: "VWRP.L", name: "Vanguard FTSE All-World UCITS ETF (Acc)", exchange: "LSE", currency: "GBP" },
  { ticker: "SWDA.L", name: "iShares Core MSCI World UCITS ETF", exchange: "LSE", currency: "USD" },
  { ticker: "EIMI.L", name: "iShares Core MSCI EM IMI UCITS ETF", exchange: "LSE", currency: "USD" },
  { ticker: "VUSA.L", name: "Vanguard S&P 500 UCITS ETF", exchange: "LSE", currency: "GBP" },
  { ticker: "CSPX.L", name: "iShares Core S&P 500 UCITS ETF", exchange: "LSE", currency: "USD" },
  // Euronext Amsterdam
  { ticker: "VWRL.AS", name: "Vanguard FTSE All-World UCITS ETF", exchange: "AMS", currency: "EUR" },
  { ticker: "IWDA.AS", name: "iShares Core MSCI World UCITS ETF", exchange: "AMS", currency: "EUR" },
  // Popular European stocks
  { ticker: "SAP.DE", name: "SAP SE", exchange: "XETRA", currency: "EUR" },
  { ticker: "SIE.DE", name: "Siemens AG", exchange: "XETRA", currency: "EUR" },
  { ticker: "ALV.DE", name: "Allianz SE", exchange: "XETRA", currency: "EUR" },
  { ticker: "BAS.DE", name: "BASF SE", exchange: "XETRA", currency: "EUR" },
  { ticker: "BMW.DE", name: "BMW AG", exchange: "XETRA", currency: "EUR" },
  { ticker: "VOW3.DE", name: "Volkswagen AG", exchange: "XETRA", currency: "EUR" },
  { ticker: "DTE.DE", name: "Deutsche Telekom AG", exchange: "XETRA", currency: "EUR" },
  { ticker: "ASML.AS", name: "ASML Holding NV", exchange: "AMS", currency: "EUR" },
  { ticker: "MC.PA", name: "LVMH Moet Hennessy Louis Vuitton", exchange: "PAR", currency: "EUR" },
  { ticker: "OR.PA", name: "L'Oreal SA", exchange: "PAR", currency: "EUR" },
  { ticker: "NESN.SW", name: "Nestle SA", exchange: "SWX", currency: "CHF" },
  { ticker: "NOVN.SW", name: "Novartis AG", exchange: "SWX", currency: "CHF" },
  { ticker: "ROG.SW", name: "Roche Holding AG", exchange: "SWX", currency: "CHF" },
  // Cryptocurrencies (Yahoo Finance format: SYMBOL-USD)
  { ticker: "BTC-USD", name: "Bitcoin", exchange: "CRYPTO", currency: "USD" },
  { ticker: "ETH-USD", name: "Ethereum", exchange: "CRYPTO", currency: "USD" },
  { ticker: "SOL-USD", name: "Solana", exchange: "CRYPTO", currency: "USD" },
  { ticker: "XRP-USD", name: "XRP (Ripple)", exchange: "CRYPTO", currency: "USD" },
  { ticker: "DOGE-USD", name: "Dogecoin", exchange: "CRYPTO", currency: "USD" },
  { ticker: "ADA-USD", name: "Cardano", exchange: "CRYPTO", currency: "USD" },
  { ticker: "AVAX-USD", name: "Avalanche", exchange: "CRYPTO", currency: "USD" },
  { ticker: "DOT-USD", name: "Polkadot", exchange: "CRYPTO", currency: "USD" },
  { ticker: "MATIC-USD", name: "Polygon (MATIC)", exchange: "CRYPTO", currency: "USD" },
  { ticker: "LINK-USD", name: "Chainlink", exchange: "CRYPTO", currency: "USD" },
  { ticker: "LTC-USD", name: "Litecoin", exchange: "CRYPTO", currency: "USD" },
  { ticker: "UNI-USD", name: "Uniswap", exchange: "CRYPTO", currency: "USD" },
  { ticker: "ATOM-USD", name: "Cosmos", exchange: "CRYPTO", currency: "USD" },
  { ticker: "XLM-USD", name: "Stellar", exchange: "CRYPTO", currency: "USD" },
  { ticker: "ALGO-USD", name: "Algorand", exchange: "CRYPTO", currency: "USD" },
  { ticker: "NEAR-USD", name: "NEAR Protocol", exchange: "CRYPTO", currency: "USD" },
  { ticker: "APT-USD", name: "Aptos", exchange: "CRYPTO", currency: "USD" },
  { ticker: "ARB-USD", name: "Arbitrum", exchange: "CRYPTO", currency: "USD" },
  { ticker: "OP-USD", name: "Optimism", exchange: "CRYPTO", currency: "USD" },
  { ticker: "PEPE-USD", name: "Pepe", exchange: "CRYPTO", currency: "USD" },
  // Prague Stock Exchange (Czech Republic)
  { ticker: "CEZ.PR", name: "ČEZ, a. s.", exchange: "PSE", currency: "CZK" },
  { ticker: "KOMB.PR", name: "Komerční banka", exchange: "PSE", currency: "CZK" },
  { ticker: "BAAVAST.PR", name: "Erste Group Bank AG", exchange: "PSE", currency: "CZK" },
  { ticker: "MONET.PR", name: "MONETA Money Bank", exchange: "PSE", currency: "CZK" },
  { ticker: "STOCK.PR", name: "Stock Spirits Group", exchange: "PSE", currency: "CZK" },
  { ticker: "TABAK.PR", name: "Philip Morris ČR", exchange: "PSE", currency: "CZK" },
  { ticker: "VIG.PR", name: "Vienna Insurance Group", exchange: "PSE", currency: "CZK" },
  { ticker: "AVAST.PR", name: "Avast Software", exchange: "PSE", currency: "CZK" },
  // Warsaw Stock Exchange (Poland)
  { ticker: "PKO.WA", name: "PKO Bank Polski", exchange: "WSE", currency: "PLN" },
  { ticker: "PZU.WA", name: "PZU SA", exchange: "WSE", currency: "PLN" },
  { ticker: "PKN.WA", name: "PKN Orlen", exchange: "WSE", currency: "PLN" },
  { ticker: "PEO.WA", name: "Bank Pekao", exchange: "WSE", currency: "PLN" },
  { ticker: "KGH.WA", name: "KGHM Polska Miedź", exchange: "WSE", currency: "PLN" },
  { ticker: "CDR.WA", name: "CD Projekt", exchange: "WSE", currency: "PLN" },
  { ticker: "ALE.WA", name: "Allegro", exchange: "WSE", currency: "PLN" },
];

// Search stocks using Alpha Vantage SYMBOL_SEARCH API (supports global exchanges)
async function searchStocksAPI(query: string): Promise<any[]> {
  if (!ALPHA_VANTAGE_API_KEY) {
    return [];
  }

  try {
    const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(query)}&apikey=${ALPHA_VANTAGE_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data["bestMatches"]) {
      return data["bestMatches"].map((match: any) => ({
        ticker: match["1. symbol"],
        name: match["2. name"],
        exchange: match["4. region"],
        currency: match["8. currency"],
        type: match["3. type"],
      }));
    }

    // Check for rate limit
    if (data["Note"] || data["Information"]) {
      console.warn("Alpha Vantage search rate limit reached");
      return [];
    }

    return [];
  } catch (error) {
    console.error("Error in Alpha Vantage symbol search:", error);
    return [];
  }
}

// Search stocks using Finnhub API (supports global exchanges)
async function searchStocksFinnhub(query: string): Promise<any[]> {
  if (!FINNHUB_API_KEY) {
    return [];
  }

  try {
    const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${FINNHUB_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data && data.result) {
      return data.result.map((match: any) => ({
        ticker: match.symbol,
        name: match.description,
        exchange: match.displaySymbol?.includes('.') ? match.displaySymbol.split('.').pop() : 'US',
        currency: 'USD',
        type: match.type,
      }));
    }

    return [];
  } catch (error) {
    console.error("Error in Finnhub symbol search:", error);
    return [];
  }
}

async function searchStocks(query: string): Promise<any[]> {
  // Check cache
  const cacheKey = `search_${query.toUpperCase()}`;
  const cached = symbolCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const queryUpper = query.toUpperCase();
    
    // First search in local database for quick results
    const localResults = STOCK_DATABASE.filter(
      (stock) =>
        stock.ticker.includes(queryUpper) ||
        stock.name.toUpperCase().includes(queryUpper)
    ).slice(0, 10);

    // Try Alpha Vantage SYMBOL_SEARCH for global stocks/ETFs
    let apiResults: any[] = [];
    
    // Use Alpha Vantage for global search (supports .DE, .L, etc.)
    apiResults = await searchStocksAPI(query);
    
    // If no results from Alpha Vantage, try Finnhub
    if (apiResults.length === 0) {
      apiResults = await searchStocksFinnhub(query);
    }

    // Combine results, prioritizing local database, then API results
    const seenTickers = new Set(localResults.map(r => r.ticker));
    const combinedResults = [...localResults];
    
    for (const result of apiResults) {
      if (!seenTickers.has(result.ticker)) {
        seenTickers.add(result.ticker);
        combinedResults.push(result);
      }
    }

    const finalResults = combinedResults.slice(0, 20);

    // Cache the result
    symbolCache.set(cacheKey, { data: finalResults, timestamp: Date.now() });
    scheduleCacheSave();
    return finalResults;
  } catch (error) {
    console.error(`Error searching stocks:`, error);
    return [];
  }
}

// -----------------------------------------------------------------------------
// Portfolio performance (by year / month) — server-side aggregation
// -----------------------------------------------------------------------------
// Previously the client replayed every transaction for every trading day in
// the browser to build the year/month performance table. For any portfolio
// with a year+ of history that meant a visible stall on every page open.
// Here we do it once on the server, memoise the result per (user, portfolio)
// and bust the cache whenever transactions change.

interface PerformancePeriodStats {
  label: string;
  startDate: string;
  endDate: string;
  startValue: number;
  endValue: number;
  netInflow: number;
  profit: number;
  percentReturn: number;
  realizedGain: number;
  dividends: number;
  transactionCount: number;
}

interface YearPerformance extends PerformancePeriodStats {
  year: number;
  months: PerformancePeriodStats[];
}

interface PerformanceResponse {
  currency: string;
  years: YearPerformance[];
  totals: PerformancePeriodStats | null;
  computedAt: number;
}

const performanceCache = new Map<
  string,
  { data: PerformanceResponse; timestamp: number }
>();
// Long TTL is fine because we explicitly bust the cache on every write that
// could move the numbers (transactions, imports, migrations, data wipe).
const PERFORMANCE_CACHE_TTL = 30 * 60 * 1000;

function perfCacheKey(userId: string, portfolioParam: string): string {
  return `${userId}:${portfolioParam || "all"}`;
}

function invalidatePerformanceCache(userId: string): void {
  const prefix = `${userId}:`;
  for (const key of Array.from(performanceCache.keys())) {
    if (key.startsWith(prefix)) performanceCache.delete(key);
  }
}

function isNonHoldingTransactionType(t: string): boolean {
  return t === "DIVIDEND" || t === "TAX" || t === "DEPOSIT" || t === "WITHDRAWAL";
}

type SupportedCcy = "EUR" | "USD" | "CZK" | "PLN" | "GBP";

function convertAmountBetween(
  amount: number,
  from: SupportedCcy,
  to: string,
  rates: AllExchangeRates,
): number {
  if (from === to) return amount;
  let eur: number;
  switch (from) {
    case "EUR": eur = amount; break;
    case "USD": eur = amount * rates.usdToEur; break;
    case "CZK": eur = amount * rates.czkToEur; break;
    case "PLN": eur = amount * rates.plnToEur; break;
    case "GBP": eur = amount * rates.gbpToEur; break;
    default: eur = amount;
  }
  switch (to.toUpperCase()) {
    case "EUR": return eur;
    case "USD": return eur * rates.eurToUsd;
    case "CZK": return eur * rates.eurToCzk;
    case "PLN": return eur * rates.eurToPln;
    case "GBP": return eur * rates.eurToGbp;
    default: return eur;
  }
}

function priceOnOrBefore(
  history: Record<string, number> | undefined,
  targetIso: string,
  maxBackDays = 14,
): number | null {
  if (!history) return null;
  if (history[targetIso] != null) return history[targetIso];
  const d = new Date(`${targetIso}T00:00:00Z`);
  for (let i = 1; i <= maxBackDays; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const key = d.toISOString().slice(0, 10);
    if (history[key] != null) return history[key];
  }
  return null;
}

async function computePortfolioPerformance(
  userId: string,
  portfolioParam: string,
): Promise<PerformanceResponse> {
  const userSettings = await storage.getUserSettings(userId);
  const userCurrency = (userSettings?.preferredCurrency || "EUR").toUpperCase();

  const txns = await storage.getTransactionsByUser(
    userId,
    portfolioParam === "all" ? null : portfolioParam,
  );
  if (txns.length === 0) {
    return { currency: userCurrency, years: [], totals: null, computedAt: Date.now() };
  }

  const sorted = [...txns].sort((a, b) => {
    const da = new Date(a.transactionDate as unknown as string).getTime();
    const db = new Date(b.transactionDate as unknown as string).getTime();
    return da - db;
  });

  const firstTxnDate = new Date(sorted[0].transactionDate as unknown as string);
  const now = new Date();

  // Fetch historical prices + current quotes for every ticker the user
  // touched. Both routes hit the existing cached helpers so this is nearly
  // free after the first request.
  const tickerSet = new Set<string>();
  for (const t of sorted) {
    const u = t.ticker?.toUpperCase() ?? "";
    if (isMarketDataTicker(u)) {
      tickerSet.add(u);
    }
  }
  const tickers = Array.from(tickerSet);

  const historicalPrices: Record<string, Record<string, number>> = {};
  const currentPrices: Record<string, number> = {};
  await Promise.all(
    tickers.map(async (ticker) => {
      try {
        historicalPrices[ticker] = (await fetchHistoricalPrices(ticker)) || {};
      } catch {
        historicalPrices[ticker] = {};
      }
      try {
        const q = await fetchStockQuote(ticker);
        if (q && typeof q.price === "number") currentPrices[ticker] = q.price;
      } catch {
        // swallow – forward-fill will cover it
      }
    }),
  );

  const rates = await fetchAllExchangeRates();
  const todayIso = now.toISOString().slice(0, 10);

  const eurM = await buildEurPerUnitByTxnIdForTransactions(sorted);
  const fifoPerformance = computeFifoRealizedGainsFromTransactions(
    sorted,
    eurM,
    now,
  );
  const eurToUserCcy = (amountEur: number) =>
    convertAmountBetween(amountEur, "EUR", userCurrency, rates);

  const priceInUserCcy = (ticker: string, iso: string): number | null => {
    const upper = ticker.toUpperCase();
    const history = historicalPrices[upper];
    let raw = priceOnOrBefore(history, iso);
    if (raw == null && iso >= todayIso && currentPrices[upper] != null) {
      raw = currentPrices[upper];
    }
    if (raw == null) return null;
    return convertAmountBetween(raw, getTickerCurrency(upper), userCurrency, rates);
  };

  // Replay-holdings helper: walks sorted txns up to `iso` (inclusive) and
  // returns current shares + total cost per ticker. O(T) per call; P×T total
  // where P is number of boundaries (≤ 2 per month + 2 per year, <300 for
  // 10y of history). Fine for realistic portfolios.
  function holdingsAtIso(iso: string): Map<string, { shares: number; totalCost: number; avgCost: number }> {
    const state = new Map<string, { shares: number; totalCost: number; avgCost: number }>();
    for (const t of sorted) {
      const d = new Date(t.transactionDate as unknown as string).toISOString().slice(0, 10);
      if (d > iso) break;
      if (t.type !== "BUY" && t.type !== "SELL") continue;
      const shares = parseFloat(t.shares);
      const price = parseFloat(t.pricePerShare);
      const commission = parseFloat(t.commission || "0");
      const key = t.ticker.toUpperCase();
      let entry = state.get(key);
      if (!entry) {
        entry = { shares: 0, totalCost: 0, avgCost: 0 };
        state.set(key, entry);
      }
      if (t.type === "BUY") {
        entry.totalCost += shares * price + commission;
        entry.shares += shares;
        entry.avgCost = entry.shares > 0 ? entry.totalCost / entry.shares : 0;
      } else {
        entry.totalCost = Math.max(0, entry.totalCost - shares * entry.avgCost);
        entry.shares = Math.max(0, entry.shares - shares);
      }
    }
    return state;
  }

  function valueAt(iso: string): number {
    const state = holdingsAtIso(iso);
    let sum = 0;
    state.forEach((h, ticker) => {
      if (h.shares <= 0) return;
      const price = priceInUserCcy(ticker, iso);
      // Cost basis fallback avoids "vanishing" value when history is missing.
      // Transaction cost is already stored in user currency at broker-level
      // which for most users matches preferredCurrency; good enough.
      sum += price != null ? h.shares * price : h.totalCost;
    });
    return sum;
  }

  const addDays = (iso: string, delta: number): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  };

  // Per-txn aggregation: one forward pass computes netInflow / realized /
  // dividends / count per year and month. Holdings state is tracked so we
  // can compute realized gain correctly using avg cost at time of sale.
  const perYear = new Map<
    number,
    {
      netInflow: number;
      realized: number;
      dividends: number;
      count: number;
      months: Record<number, { netInflow: number; realized: number; dividends: number; count: number }>;
    }
  >();
  const bucketFor = (year: number, month: number) => {
    let y = perYear.get(year);
    if (!y) {
      y = { netInflow: 0, realized: 0, dividends: 0, count: 0, months: {} };
      perYear.set(year, y);
    }
    if (!y.months[month]) {
      y.months[month] = { netInflow: 0, realized: 0, dividends: 0, count: 0 };
    }
    return { y, m: y.months[month] };
  };

  const replayState = new Map<string, { shares: number; totalCost: number; avgCost: number }>();
  for (const t of sorted) {
    const d = new Date(t.transactionDate as unknown as string);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const { y, m } = bucketFor(year, month);
    y.count++;
    m.count++;

    if (t.type === "BUY" || t.type === "SELL") {
      const shares = parseFloat(t.shares);
      const price = parseFloat(t.pricePerShare);
      const commission = parseFloat(t.commission || "0");
      const key = t.ticker.toUpperCase();
      let entry = replayState.get(key);
      if (!entry) {
        entry = { shares: 0, totalCost: 0, avgCost: 0 };
        replayState.set(key, entry);
      }
      if (t.type === "BUY") {
        const gross = shares * price;
        const inflow = gross + commission;
        entry.totalCost += inflow;
        entry.shares += shares;
        entry.avgCost = entry.shares > 0 ? entry.totalCost / entry.shares : 0;
        y.netInflow += inflow;
        m.netInflow += inflow;
      } else {
        // netInflow convention: BUY cost adds, SELL proceeds (after commission) subtract.
        // Matches the chart formula so the numbers line up.
        const gross = shares * price;
        const netProceeds = gross - commission;
        const costBasis = shares * entry.avgCost;
        entry.totalCost = Math.max(0, entry.totalCost - costBasis);
        entry.shares = Math.max(0, entry.shares - shares);
        y.netInflow -= netProceeds;
        m.netInflow -= netProceeds;
      }
    } else if (t.type === "DIVIDEND") {
      const shares = parseFloat(t.shares || "0");
      const price = parseFloat(t.pricePerShare || "0");
      const tickerCcy = getTickerCurrency(t.ticker);
      const amount = convertAmountBetween(shares * price, tickerCcy, userCurrency, rates);
      y.dividends += amount;
      m.dividends += amount;
    }
  }

  // Build output
  const firstYear = firstTxnDate.getUTCFullYear();
  const lastYear = now.getUTCFullYear();
  const years: YearPerformance[] = [];

  for (let yr = firstYear; yr <= lastYear; yr++) {
    const yearStartIso = `${yr}-01-01`;
    const yearEndIso =
      yr === lastYear ? todayIso : `${yr}-12-31`;
    const yearStartVal = valueAt(addDays(yearStartIso, -1));
    const yearEndVal = valueAt(yearEndIso);
    const agg = perYear.get(yr) ?? {
      netInflow: 0,
      realized: 0,
      dividends: 0,
      count: 0,
      months: {} as Record<number, { netInflow: number; realized: number; dividends: number; count: number }>,
    };
    const yearRealizedGain = eurToUserCcy(
      fifoPerformance.realizedEurByCalendarYear[yr] ?? 0,
    );
    const yearProfit = yearEndVal - yearStartVal - agg.netInflow;
    const yearBaseline = yearStartVal + Math.max(agg.netInflow, 0);
    const yearPct = yearBaseline > 0 ? (yearProfit / yearBaseline) * 100 : 0;

    const monthsOut: PerformancePeriodStats[] = [];
    for (let m = 0; m < 12; m++) {
      const monthStartIso = `${yr}-${String(m + 1).padStart(2, "0")}-01`;
      if (monthStartIso > todayIso) continue;
      // last day of month, capped at today
      const monthEndDate = new Date(Date.UTC(yr, m + 1, 0));
      const monthEndIso = monthEndDate.toISOString().slice(0, 10);
      const boundedMonthEnd = monthEndIso > todayIso ? todayIso : monthEndIso;

      const mStart = valueAt(addDays(monthStartIso, -1));
      const mEnd = valueAt(boundedMonthEnd);
      const mAgg = agg.months[m] ?? { netInflow: 0, realized: 0, dividends: 0, count: 0 };
      const mKey = `${yr}-${String(m + 1).padStart(2, "0")}`;
      const mRealizedGain = eurToUserCcy(
        fifoPerformance.realizedEurByYearMonth[mKey] ?? 0,
      );
      const mProfit = mEnd - mStart - mAgg.netInflow;
      const mBaseline = mStart + Math.max(mAgg.netInflow, 0);
      const mPct = mBaseline > 0 ? (mProfit / mBaseline) * 100 : 0;

      monthsOut.push({
        label: `${String(m + 1).padStart(2, "0")}/${yr}`,
        startDate: monthStartIso,
        endDate: boundedMonthEnd,
        startValue: mStart,
        endValue: mEnd,
        netInflow: mAgg.netInflow,
        profit: mProfit,
        percentReturn: mPct,
        realizedGain: mRealizedGain,
        dividends: mAgg.dividends,
        transactionCount: mAgg.count,
      });
    }

    years.push({
      year: yr,
      label: String(yr),
      startDate: yearStartIso,
      endDate: yearEndIso,
      startValue: yearStartVal,
      endValue: yearEndVal,
      netInflow: agg.netInflow,
      profit: yearProfit,
      percentReturn: yearPct,
      realizedGain: yearRealizedGain,
      dividends: agg.dividends,
      transactionCount: agg.count,
      months: monthsOut,
    });
  }

  // Totals across the full lifetime
  const firstIso = firstTxnDate.toISOString().slice(0, 10);
  const openingValue = valueAt(addDays(firstIso, -1));
  const nowValue = valueAt(todayIso);
  const allNetInflow = years.reduce((s, y) => s + y.netInflow, 0);
  const allRealized = eurToUserCcy(fifoPerformance.summary.totalRealized);
  const allDividends = years.reduce((s, y) => s + y.dividends, 0);
  const allCount = years.reduce((s, y) => s + y.transactionCount, 0);
  const allProfit = nowValue - openingValue - allNetInflow;
  const allBaseline = openingValue + Math.max(allNetInflow, 0);
  const totals: PerformancePeriodStats = {
    label: "Celkovo",
    startDate: firstIso,
    endDate: todayIso,
    startValue: openingValue,
    endValue: nowValue,
    netInflow: allNetInflow,
    profit: allProfit,
    percentReturn: allBaseline > 0 ? (allProfit / allBaseline) * 100 : 0,
    realizedGain: allRealized,
    dividends: allDividends,
    transactionCount: allCount,
  };

  return {
    currency: userCurrency,
    years: years.sort((a, b) => b.year - a.year),
    totals,
    computedAt: Date.now(),
  };
}

/**
 * Rebuilds a single holding from all BUY/SELL rows in DB, chronologically.
 * Fixes XTB import when a SELL was stored but incremental update skipped
 * (e.g. SELL before holding existed, or out-of-order application).
 */
async function syncHoldingFromTradeTransactions(
  userId: string,
  portfolioId: string,
  tickerUpper: string,
  companyName: string,
): Promise<void> {
  const all = await storage.getTransactionsByUserAndTicker(
    userId,
    tickerUpper,
    portfolioId,
  );
  const trades = all
    .filter((t) => t.type === "BUY" || t.type === "SELL")
    .sort(
      (a, b) =>
        new Date(a.transactionDate as unknown as string).getTime() -
        new Date(b.transactionDate as unknown as string).getTime(),
    );

  let shares = 0;
  let totalCostBasis = 0;

  for (const txn of trades) {
    const s = parseFloat(txn.shares);
    const p = parseFloat(txn.pricePerShare);
    const c = parseFloat(txn.commission || "0");
    if (!(s > 0) || !Number.isFinite(p)) continue;

    if (txn.type === "BUY") {
      totalCostBasis += s * p + c;
      shares += s;
    } else {
      const avgCost = shares > 0 ? totalCostBasis / shares : 0;
      const soldCost = s * avgCost;
      shares = Math.max(0, shares - s);
      totalCostBasis = Math.max(0, totalCostBasis - soldCost);
    }
  }

  if (shares > 0.00000001) {
    const avgCost = totalCostBasis / shares;
    await storage.upsertHolding(
      userId,
      tickerUpper,
      companyName,
      shares.toFixed(8),
      avgCost.toFixed(4),
      totalCostBasis.toFixed(4),
      portfolioId,
    );
  } else {
    await storage.deleteHolding(userId, tickerUpper, portfolioId);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const { ensurePortfolioSortOrderColumn, ensureTransactionImportColumns, ensureExchangeRatesTable } =
    await import("./schemaEnsure");
  await ensurePortfolioSortOrderColumn();
  await ensureTransactionImportColumns();
  await ensureExchangeRatesTable();

  // Setup auth middleware
  await setupAuth(app);

  // Auth routes
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Portfolio routes
  app.get("/api/portfolios", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      // Ensure user has at least one portfolio
      await storage.ensureDefaultPortfolio(userId);
      const allPortfolios = await storage.getPortfoliosByUser(userId);
      const includeHidden = req.query.includeHidden === "true" || req.query.includeHidden === "1";
      const result = includeHidden
        ? allPortfolios
        : allPortfolios.filter((p) => !p.isHidden);
      const ids = result.map((p) => p.id);
      const rates = await fetchAllExchangeRates();
      const cashEurByPid = await storage.getComputedCashEurByPortfolioIds(userId, ids, rates);
      const withCash = result.map((p) => {
        const e = cashEurByPid[p.id] ?? 0;
        return {
          ...p,
          cashBalance: e.toFixed(2),
          cashCurrency: "EUR",
        };
      });
      res.json(withCash);
    } catch (error) {
      console.error("Error fetching portfolios:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať portfóliá." });
    }
  });

  // Overview page: holdings + realizovaný zisk + dividendy naraz na portfólio,
  // namiesto 3×N samostatných HTTP dotazov z klienta (veľké zrýchlenie Pri prehľade).
  app.get("/api/overview", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const rates = await fetchAllExchangeRates();
      const bundle = await storage.getOverviewBundle(userId, rates);
      res.json(bundle);
    } catch (error) {
      console.error("Error fetching overview bundle:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať prehľad." });
    }
  });

  /**
   * Diagnostika: čiastkové súčty denníka hotovosti (súlad s `cashBalance` / prehľadom).
   * `portfolio=all` | ID; pri predvolenom portfóliu sa zahrnú aj transakcie s `portfolio_id` NULL.
   */
  app.get("/api/cash-ledger-breakdown", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolio = (req.query.portfolio as string | undefined) ?? "all";
      const rates = await fetchAllExchangeRates();
      const list = await storage.getTransactionsForCashBreakdown(userId, portfolio);
      const breakdown = await computeCashLedgerBreakdownEur(list, rates);
      res.json({
        portfolio,
        transactionCount: list.length,
        ...breakdown,
      });
    } catch (error) {
      console.error("Error computing cash ledger breakdown:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať rozpad hotovosti." });
    }
  });

  // Destructive endpoint: wipes every transaction, holding and option trade
  // for the authenticated user across ALL portfolios (including any rows with
  // portfolio_id = NULL). Portfolios themselves and API keys remain intact so
  // the user can re-import from scratch. Requires the caller to send
  // { confirm: "VYMAZAT VSETKO" } as a guard against accidental calls.
  app.delete("/api/user/transactions/all", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const confirm = (req.body?.confirm as string | undefined)?.trim();

      if (confirm !== "VYMAZAT VSETKO") {
        return res.status(400).json({
          message:
            'Pre potvrdenie musíte poslať { "confirm": "VYMAZAT VSETKO" }.',
        });
      }

      const result = await storage.deleteAllTransactionData(userId);
      invalidatePerformanceCache(userId);
      res.json({
        message: "Všetky transakcie a holdingy boli vymazané.",
        ...result,
      });
    } catch (error) {
      console.error("Error deleting all transaction data:", error);
      res.status(500).json({ message: "Nepodarilo sa vymazať dáta." });
    }
  });

  // One-shot migration: move any transactions / holdings that were saved with
  // portfolio_id = NULL (e.g. from an earlier XTB import bug) to the user's
  // default portfolio. Optionally the caller can pass targetPortfolioId in the
  // body to move them somewhere other than the default.
  app.post("/api/portfolios/migrate-unassigned", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const requestedTarget = (req.body?.targetPortfolioId as string | undefined) || undefined;

      let targetPortfolioId: string;
      if (requestedTarget) {
        const target = await storage.getPortfolioById(requestedTarget, userId);
        if (!target) {
          return res.status(404).json({ message: "Cieľové portfólio neexistuje." });
        }
        targetPortfolioId = target.id;
      } else {
        const defaultPortfolio = await storage.ensureDefaultPortfolio(userId);
        targetPortfolioId = defaultPortfolio.id;
      }

      const result = await storage.migrateUnassignedToPortfolio(userId, targetPortfolioId);
      invalidatePerformanceCache(userId);
      res.json({ targetPortfolioId, ...result });
    } catch (error) {
      console.error("Error migrating unassigned records:", error);
      res.status(500).json({ message: "Nepodarilo sa presunúť priradenia." });
    }
  });

  app.post("/api/portfolios/cleanup-orphans", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const result = await storage.deleteOrphanPortfolioReferences(userId);
      invalidatePerformanceCache(userId);
      res.json({
        ...result,
        message: `Vymazané: ${result.transactionsDeleted} transakcií, ${result.holdingsDeleted} holdingov, ${result.optionTradesDeleted} opčných obchodov (záznamy bez portfólia alebo s neplatným portfóliom).`,
      });
    } catch (error) {
      console.error("Error cleaning orphan portfolio references:", error);
      res.status(500).json({ message: "Nepodarilo sa vyčistiť osireté záznamy." });
    }
  });

  /** Oprava pozícií po starom XTB importe: prepočet z všetkých BUY/SELL v portfóliu */
  app.post(
    "/api/portfolios/:portfolioId/recalculate-holdings",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = req.user.claims.sub;
        const portfolioId = req.params.portfolioId as string;
        const portfolio = await storage.getPortfolioById(portfolioId, userId);
        if (!portfolio) {
          return res.status(404).json({ message: "Portfólio neexistuje." });
        }
        const txs = await storage.getTransactionsByUser(userId, portfolioId);
        const tickerToCompany = new Map<string, string>();
        for (const t of txs) {
          if (t.type !== "BUY" && t.type !== "SELL") continue;
          const u = t.ticker.toUpperCase();
          if (!tickerToCompany.has(u)) {
            tickerToCompany.set(u, (t.companyName || u).trim() || u);
          }
        }
        for (const [tickerU, cn] of Array.from(tickerToCompany.entries())) {
          await syncHoldingFromTradeTransactions(userId, portfolioId, tickerU, cn);
        }
        invalidatePerformanceCache(userId);
        res.json({ synced: tickerToCompany.size });
      } catch (error: any) {
        console.error("Error recalculating holdings:", error);
        res.status(500).json({
          message:
            error?.message && typeof error.message === "string"
              ? error.message
              : "Nepodarilo sa prepočítať pozície.",
        });
      }
    },
  );

  app.post("/api/portfolios", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { name, description, brokerCode } = req.body;

      if (!name || name.trim().length === 0) {
        return res.status(400).json({ message: "Názov portfólia je povinný." });
      }

      const sortOrder = await storage.getNextPortfolioSortOrder(userId);

      const portfolio = await storage.createPortfolio({
        userId,
        name: name.trim(),
        description: description?.trim() || null,
        brokerCode: brokerCode || null,
        isDefault: false,
        sortOrder,
      });

      res.json(portfolio);
    } catch (error: any) {
      const code = error?.code as string | undefined;
      if (code === "42703") {
        return res.status(503).json({
          message:
            "V databáze chýba potrebný stĺpec (sort_order). Skúste reštart servera alebo npm run db:push.",
        });
      }
      console.error("Error creating portfolio:", error);
      res.status(500).json({
        message:
          error?.message && typeof error.message === "string"
            ? error.message
            : "Nepodarilo sa vytvoriť portfólio.",
      });
    }
  });

  const handlePortfolioReorder = async (req: any, res: any) => {
    try {
      const userId = req.user.claims.sub;
      const orderedIds = req.body?.orderedIds;
      if (!Array.isArray(orderedIds) || orderedIds.some((id: unknown) => typeof id !== "string")) {
        return res.status(400).json({
          message: "Očakávané pole orderedIds (pole ID portfólií v novom poradí).",
        });
      }
      await storage.reorderPortfolios(userId, orderedIds as string[]);
      const allPortfolios = await storage.getPortfoliosByUser(userId);
      res.json(allPortfolios);
    } catch (error: any) {
      const code = error?.code as string | undefined;
      if (code === "42703") {
        return res.status(503).json({
          message:
            "V databáze chýba stĺpec sort_order. Spustite migráciu (npm run db:push).",
        });
      }
      console.error("Error reordering portfolios:", error);
      res.status(500).json({
        message:
          error?.message && typeof error.message === "string"
            ? error.message
            : "Nepodarilo sa uložiť poradie portfólií.",
      });
    }
  };

  app.put("/api/portfolios/reorder", isAuthenticated, handlePortfolioReorder);
  app.post("/api/portfolios/reorder", isAuthenticated, handlePortfolioReorder);

  app.put("/api/portfolios/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioId = req.params.id;
      const { name, description, isDefault, brokerCode, isHidden } = req.body;

      const existing = await storage.getPortfolioById(portfolioId, userId);
      if (!existing) {
        return res.status(404).json({ message: "Portfólio nenájdené." });
      }

      // If setting this as default, unset others
      if (isDefault) {
        const allPortfolios = await storage.getPortfoliosByUser(userId);
        for (const p of allPortfolios) {
          if (p.isDefault && p.id !== portfolioId) {
            await storage.updatePortfolio(p.id, userId, { isDefault: false });
          }
        }
      }

      const updated = await storage.updatePortfolio(portfolioId, userId, {
        name: name?.trim() || existing.name,
        description: description?.trim() || null,
        brokerCode: brokerCode !== undefined ? brokerCode : existing.brokerCode,
        isDefault: isDefault !== undefined ? isDefault : existing.isDefault,
        isHidden: isHidden !== undefined ? !!isHidden : existing.isHidden,
      });

      res.json(updated);
    } catch (error) {
      console.error("Error updating portfolio:", error);
      res.status(500).json({ message: "Nepodarilo sa aktualizovať portfólio." });
    }
  });

  // Manuálna hotovosť sa už neukladá — v GET /api/portfolios je hotovosť prepočítaná
  // z transakcií vklad/ výber (na úrovni EUR, cashCurrency = EUR).
  app.patch("/api/portfolios/:id/cash", isAuthenticated, async (req: any, res) => {
    return res.status(400).json({
      message:
        "Hotovosť sa nemení manuálne. Pridaj vklady a výbery (DEPOSIT / WITHDRAWAL); celková hotovosť v EUR sa dopočíta z nich.",
    });
  });

  app.delete("/api/portfolios/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioId = req.params.id;

      const existing = await storage.getPortfolioById(portfolioId, userId);
      if (!existing) {
        return res.status(404).json({ message: "Portfólio nenájdené." });
      }

      // Check if this is the last portfolio – we always need at least one
      const allPortfolios = await storage.getPortfoliosByUser(userId);
      if (allPortfolios.length <= 1) {
        return res.status(400).json({ message: "Nemôžete vymazať posledné portfólio." });
      }

      // Cascade delete all data belonging to this portfolio, then the portfolio itself
      await storage.deletePortfolioCascade(portfolioId, userId);

      // If deleted was default, promote another (prefer a visible one) as the new default
      if (existing.isDefault) {
        const remaining = await storage.getPortfoliosByUser(userId);
        if (remaining.length > 0) {
          const promote = remaining.find((p) => !p.isHidden) || remaining[0];
          await storage.updatePortfolio(promote.id, userId, { isDefault: true });
        }
      }

      res.json({ message: "Portfólio bolo vymazané." });
    } catch (error) {
      console.error("Error deleting portfolio:", error);
      res.status(500).json({ message: "Nepodarilo sa vymazať portfólio." });
    }
  });

  // Get user holdings (portfolio)
  app.get("/api/holdings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioId = req.query.portfolio as string | undefined;
      const userHoldings = await storage.getHoldingsByUser(userId, portfolioId);
      res.json(userHoldings);
    } catch (error) {
      console.error("Error fetching holdings:", error);
      res.status(500).json({ message: "Failed to fetch holdings" });
    }
  });

  /**
   * Najbližší earnings dátum medzi držanými titulmi (Yahoo / Finnhub, cache ako pri detaile aktíva).
   * Query `portfolio` rovnako ako pri GET /api/holdings.
   */
  app.get("/api/holdings/next-earnings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioId = req.query.portfolio as string | undefined;
      const userHoldings = await storage.getHoldingsByUser(userId, portfolioId);

      const seen = new Set<string>();
      const unique: { ticker: string; companyName: string }[] = [];
      for (const h of userHoldings) {
        const sh = parseFloat(h.shares);
        if (!(sh > 1e-9)) continue;
        const t = h.ticker.toUpperCase();
        if (t === "CASH" || t === CASH_FLOW_TICKER) continue;
        if (seen.has(t)) continue;
        seen.add(t);
        unique.push({ ticker: t, companyName: h.companyName || t });
      }

      if (unique.length === 0) {
        return res.json({ next: null, all: [] });
      }

      const CONCURRENCY = 4;
      type WithDate = { ticker: string; companyName: string; date: string; ms: number };
      const withDates: WithDate[] = [];

      for (let i = 0; i < unique.length; i += CONCURRENCY) {
        const chunk = unique.slice(i, i + CONCURRENCY);
        const chunkResults = await Promise.all(
          chunk.map(async (row) => {
            try {
              const next = await fetchNextEarningsDateForAsset(row.ticker);
              if (!next?.date) return null;
              const ms = new Date(`${next.date}T12:00:00`).getTime();
              if (!Number.isFinite(ms)) return null;
              return { ...row, date: next.date, ms };
            } catch {
              return null;
            }
          }),
        );
        for (const r of chunkResults) {
          if (r) withDates.push(r);
        }
      }

      if (withDates.length === 0) {
        return res.json({ next: null, all: [] });
      }

      withDates.sort((a, b) => a.ms - b.ms);
      const best = withDates[0];
      res.json({
        next: {
          ticker: best.ticker,
          companyName: best.companyName,
          date: best.date,
        },
        all: withDates.map((e) => ({
          ticker: e.ticker,
          companyName: e.companyName,
          date: e.date,
        })),
      });
    } catch (error) {
      console.error("Error fetching next earnings for holdings:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať earnings." });
    }
  });

  // Single-asset detail: holdings per portfolio, transactions, dividends, quote & historical prices
  app.get("/api/assets/:ticker", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      let rawTicker = req.params.ticker as string;
      try {
        rawTicker = decodeURIComponent(rawTicker);
      } catch {
        // keep raw
      }

      const holdingRows = await storage.getHoldingsForTickerAcrossPortfolios(userId, rawTicker);
      const txRows = await storage.getTransactionsForTickerAcrossPortfolios(userId, rawTicker);

      if (holdingRows.length === 0 && txRows.length === 0) {
        return res.status(404).json({ message: "Pre toto aktívum nemáte žiadne dáta." });
      }

      const displayTicker = holdingRows[0]?.ticker ?? txRows[0]?.ticker ?? rawTicker;
      const upperTicker = displayTicker.toUpperCase();

      const allPortfolios = await storage.getPortfoliosByUser(userId);
      const portfolioMap = new Map(allPortfolios.map((p) => [p.id, p]));

      const positions = holdingRows
        .filter((h) => parseFloat(h.shares) > 0)
        .map((h) => {
          const pid = h.portfolioId;
          const p = pid ? portfolioMap.get(pid) : undefined;
          return {
            portfolioId: h.portfolioId,
            portfolioName: p?.name ?? (pid ? "Neznáme portfólio" : "Bez portfólia"),
            brokerCode: p?.brokerCode ?? null,
            shares: parseFloat(h.shares),
            averageCost: parseFloat(h.averageCost),
            totalInvested: parseFloat(h.totalInvested),
          };
        });

      const totalShares = positions.reduce((s, p) => s + p.shares, 0);
      const totalInvestedSum = positions.reduce((s, p) => s + p.totalInvested, 0);
      const weightedAvgCost = totalShares > 0 ? totalInvestedSum / totalShares : 0;

      const companyName =
        holdingRows[0]?.companyName ??
        txRows.find((t) => t.companyName)?.companyName ??
        displayTicker;

      const dividendTransactions = txRows.filter((t) => t.type === "DIVIDEND");
      const taxTransactions = txRows.filter((t) => t.type === "TAX");

      let dividendTotalGross = 0;
      let dividendTaxTotal = 0;
      let dividendNetTotal = 0;

      for (const txn of dividendTransactions) {
        const shares = parseFloat(txn.shares);
        const dividendPerShare = parseFloat(txn.pricePerShare);
        const tax = parseFloat(txn.commission || "0");
        const gross = shares * dividendPerShare;
        const net = gross - tax;
        dividendTotalGross += gross;
        dividendTaxTotal += tax;
        dividendNetTotal += net;
      }

      for (const txn of taxTransactions) {
        const shares = parseFloat(txn.shares);
        const pricePerShare = parseFloat(txn.pricePerShare);
        const taxAmount = shares * pricePerShare;
        dividendTaxTotal += Math.abs(taxAmount);
        dividendNetTotal += taxAmount;
      }

      const dividendPayments = dividendTransactions
        .map((txn) => {
          const shares = parseFloat(txn.shares);
          const dividendPerShare = parseFloat(txn.pricePerShare);
          const tax = parseFloat(txn.commission || "0");
          const gross = shares * dividendPerShare;
          const net = gross - tax;
          const pid = txn.portfolioId;
          return {
            id: txn.id,
            date: txn.transactionDate,
            portfolioId: txn.portfolioId,
            portfolioName: pid ? portfolioMap.get(pid)?.name ?? "—" : "Bez portfólia",
            gross,
            tax,
            net,
            currency: txn.currency || "EUR",
          };
        })
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      let quote: Record<string, unknown> | null = null;
      let prices: Record<string, number> = {};

      if (upperTicker === "CASH") {
        quote = {
          ticker: "CASH",
          price: 1.0,
          change: 0,
          changePercent: 0,
          high52: 1.0,
          low52: 1.0,
        };
        prices = {};
      } else {
        try {
          quote = await fetchStockQuote(upperTicker);
        } catch {
          quote = null;
        }
        try {
          prices = await fetchHistoricalPrices(upperTicker);
        } catch {
          prices = {};
        }
      }

      let nextEarnings: { date: string } | null = null;
      if (upperTicker !== "CASH") {
        try {
          nextEarnings = await fetchNextEarningsDateForAsset(upperTicker);
        } catch {
          nextEarnings = null;
        }
      }

      const marketTransactions = txRows.filter((t) => t.type === "BUY" || t.type === "SELL");

      res.json({
        ticker: displayTicker,
        companyName,
        positions,
        portfolios: allPortfolios.map((p) => ({ id: p.id, name: p.name })),
        totals: {
          shares: totalShares,
          totalInvested: totalInvestedSum,
          averageCost: weightedAvgCost,
        },
        dividends: {
          totalGross: dividendTotalGross,
          totalTax: dividendTaxTotal,
          totalNet: dividendNetTotal,
          paymentCount: dividendTransactions.length,
        },
        dividendPayments,
        marketTransactions,
        transactions: txRows,
        quote,
        prices,
        nextEarnings,
      });
    } catch (error) {
      console.error("Error fetching asset detail:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať detail aktíva." });
    }
  });

  /** Otvorené FIFO loty v jednom portfóli (alebo unassigned) pre daný ticker. */
  app.get(
    "/api/portfolios/:portfolioId/asset-lots",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = req.user.claims.sub;
        const rawPid = String(req.params.portfolioId ?? "");
        const tickerQ = (req.query.ticker as string | undefined)?.trim();
        if (!tickerQ) {
          return res.status(400).json({ message: "Chýba query parameter ticker." });
        }
        const upper = tickerQ.toUpperCase();
        const userSettings = await storage.getUserSettings(userId);
        const userCcy = (userSettings?.preferredCurrency || "EUR").toUpperCase();
        if (upper === "CASH" || upper === CASH_FLOW_TICKER) {
          return res.json({ currency: userCcy, lots: [] });
        }

        const rates = await fetchAllExchangeRates();
        const now = new Date();
        let allTx: Transaction[] = [];

        if (rawPid === "unassigned") {
          allTx = await db
            .select()
            .from(transactions)
            .where(
              and(
                eq(transactions.userId, userId),
                isNull(transactions.portfolioId),
              ),
            )
            .orderBy(desc(transactions.transactionDate));
        } else {
          const p = await storage.getPortfolioById(rawPid, userId);
          if (!p) {
            return res.status(404).json({ message: "Portfólio sa nenašlo." });
          }
          allTx = await storage.getTransactionsByUser(userId, rawPid);
        }

        const { eurM, forFifo } = await loadTradeTransactionsForAssetLots(allTx, upper);
        let pNow: number | null = null;
        const q = await fetchStockQuote(upper);
        if (q && typeof (q as { price?: number }).price === "number" && Number.isFinite((q as { price: number }).price)) {
          pNow = (q as { price: number }).price;
        }

        const lots = buildOpenFifoLotRowList(forFifo, eurM, now, rates, userCcy, pNow);
        return res.json({ currency: userCcy, lots });
      } catch (error) {
        console.error("Error building asset lots:", error);
        res
          .status(500)
          .json({ message: "Nepodarilo sa načítať otvorené loty (FIFO)." });
      }
    },
  );

  // Get user transactions
  app.get("/api/transactions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioId = req.query.portfolio as string | undefined;
      const userTransactions = await storage.getTransactionsByUser(userId, portfolioId);
      res.json(userTransactions);
    } catch (error) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  /** EUR za 1 jednotku cudzej meny pri obchode (doplnok Frankfurter) — graf hodnoty na dashboarde. */
  app.get("/api/txn-eur-per-unit", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioId = req.query.portfolio as string | undefined;
      const list = await storage.getTransactionsByUser(userId, portfolioId);
      const m = await buildEurPerUnitByTxnIdForTransactions(list);
      const out: Record<string, number | null> = {};
      m.forEach((v, id) => {
        out[id] = v;
      });
      res.json(out);
    } catch (error) {
      console.error("Error building txn EUR map:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať kurzy pre graf." });
    }
  });

  // Create a new transaction (BUY, SELL, DIVIDEND, DEPOSIT, WITHDRAWAL, …)
  app.post("/api/transactions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { id: clientId, ...bodyRest } = req.body;

      const transactionDate = new Date(req.body?.transactionDate);
      if (Number.isNaN(transactionDate.getTime())) {
        return res.status(400).json({ message: "Neplatný dátum transakcie." });
      }

      // Ensure user has a default portfolio
      const defaultPortfolio = await storage.ensureDefaultPortfolio(userId);
      const portfolioId = req.body.portfolioId || defaultPortfolio.id;

      const bodyType = String(req.body.type || "").toUpperCase();
      
      // For DIVIDEND, DEPOSIT, WITHDRAWAL: shares = "1" as placeholder
      const shares =
        (bodyType === "DIVIDEND" || bodyType === "DEPOSIT" || bodyType === "WITHDRAWAL") &&
        (!req.body.shares || req.body.shares === "")
          ? "1"
          : req.body.shares;
      
      const bodyWithoutId = bodyRest;
      
      const transactionData = {
        ...bodyWithoutId,
        shares,
        userId,
        portfolioId,
        transactionDate,
      };

      // Vklad / výber: vždy interný ticker, neovplyvňujú podiely
      if (bodyType === "DEPOSIT" || bodyType === "WITHDRAWAL") {
        const amt = Math.abs(parseFloat(String(req.body.pricePerShare || "0")));
        if (!Number.isFinite(amt) || !(amt > 0)) {
          return res.status(400).json({ message: "Zadajte nenulovú sumu (kladne číslo)." });
        }
        const signed = bodyType === "WITHDRAWAL" ? -amt : amt;
        const nameIn =
          typeof req.body.companyName === "string" && req.body.companyName.trim() !== ""
            ? req.body.companyName.trim()
            : bodyType === "DEPOSIT"
              ? "Vklad"
              : "Výber";
        const orig =
          typeof req.body.originalCurrency === "string" && req.body.originalCurrency.length === 3
            ? req.body.originalCurrency.trim().toUpperCase()
            : "EUR";
        const exRate =
          orig === "EUR"
            ? 1
            : parseFloat(String(req.body.exchangeRateAtTransaction ?? "1"));
        const exOk = Number.isFinite(exRate) && exRate > 0 ? exRate : 1;
        const baseAmt = orig === "EUR" ? signed : parseFloat(String(req.body.baseCurrencyAmount ?? signed));
        const baseOk = Number.isFinite(baseAmt) ? baseAmt : signed;

        const tIdIn =
          typeof req.body.transactionId === "string"
            ? req.body.transactionId.trim() || null
            : null;

        const row: Record<string, unknown> = {
          type: bodyType,
          userId,
          portfolioId,
          ticker: CASH_FLOW_TICKER,
          companyName: nameIn,
          shares: "1",
          pricePerShare: signed.toFixed(4),
          commission: "0",
          currency: orig,
          originalCurrency: orig,
          transactionDate,
          externalId: req.body.externalId || null,
          transactionId: tIdIn,
          exchangeRateAtTransaction: orig === "EUR" ? "1" : exOk.toFixed(8),
          baseCurrencyAmount: (orig === "EUR" ? signed : baseOk).toFixed(4),
          realizedGain: "0",
          costBasis: "0",
        };
        if (clientId && String(clientId).trim() !== "") {
          row.id = String(clientId).trim();
        }

        const cashParsed = insertTransactionSchema.safeParse(row);
        if (!cashParsed.success) {
          return res.status(400).json({
            message: "Invalid transaction data",
            errors: cashParsed.error.issues,
          });
        }
        const transaction = await storage.createTransaction(cashParsed.data);
        invalidatePerformanceCache(userId);
        return res.json(transaction);
      }

      // Validate the transaction data
      const parsed = insertTransactionSchema.safeParse(transactionData);
      if (!parsed.success) {
        return res.status(400).json({ 
          message: "Invalid transaction data", 
          errors: parsed.error.errors 
        });
      }

      const { type, ticker, companyName, shares: parsedShares, pricePerShare, commission } = parsed.data;
      const sharesNum = parseFloat(parsedShares);
      const priceNum = parseFloat(pricePerShare);
      const commissionNum = parseFloat(commission || "0");

      // Get current holding for this stock in this portfolio
      const currentHolding = await storage.getHoldingByUserAndTicker(userId, ticker, portfolioId);

      if (type === "SELL") {
        // Validate that user has enough shares to sell
        const currentShares = currentHolding ? parseFloat(currentHolding.shares) : 0;
        if (currentShares < sharesNum) {
          return res.status(400).json({ 
            message: `Nemáte dostatok akcií na predaj. Aktuálny počet: ${currentShares.toFixed(4)}` 
          });
        }
      }

      // Calculate realized gain for SELL transactions
      let realizedGain = "0";
      let costBasis = "0";
      
      if (type === "SELL" && currentHolding) {
        const avgCost = parseFloat(currentHolding.averageCost);
        costBasis = avgCost.toFixed(4);
        // Realized gain = (sell price - average cost) * shares - commission
        const gain = (priceNum - avgCost) * sharesNum - commissionNum;
        realizedGain = gain.toFixed(4);
      }

      // Create the transaction with realized gain data
      const transaction = await storage.createTransaction({
        ...parsed.data,
        realizedGain,
        costBasis,
      });

      // Update holdings based on transaction type (DIVIDEND does not affect holdings)
      if (type === "BUY") {
        const totalCost = sharesNum * priceNum + commissionNum;
        
        if (currentHolding) {
          // Update existing holding with new average cost (Average Cost Basis)
          const currentShares = parseFloat(currentHolding.shares);
          const currentTotalInvested = parseFloat(currentHolding.totalInvested);
          const newShares = currentShares + sharesNum;
          const newTotalInvested = currentTotalInvested + totalCost;
          const newAverageCost = newTotalInvested / newShares;

          await storage.upsertHolding(
            userId,
            ticker,
            companyName,
            newShares.toFixed(8),
            newAverageCost.toFixed(4),
            newTotalInvested.toFixed(4),
            portfolioId
          );
        } else {
          // Create new holding
          const avgCost = totalCost / sharesNum;
          await storage.upsertHolding(
            userId,
            ticker,
            companyName,
            sharesNum.toFixed(8),
            avgCost.toFixed(4),
            totalCost.toFixed(4),
            portfolioId
          );
        }
      } else if (type === "SELL" && currentHolding) {
        const currentShares = parseFloat(currentHolding.shares);
        const currentAvgCost = parseFloat(currentHolding.averageCost);
        const newShares = currentShares - sharesNum;

        if (newShares <= 0.00000001) {
          // Delete the holding if all shares are sold (with small epsilon for floating point)
          await storage.deleteHolding(userId, ticker, portfolioId);
        } else {
          // Update holding with reduced shares (average cost stays the same per FIFO/Average Cost method)
          const newTotalInvested = newShares * currentAvgCost;
          await storage.upsertHolding(
            userId,
            ticker,
            companyName,
            newShares.toFixed(8),
            currentAvgCost.toFixed(4),
            newTotalInvested.toFixed(4),
            portfolioId
          );
        }
      }
      // Note: DIVIDEND transactions don't affect holdings - they are just recorded for income tracking

      invalidatePerformanceCache(userId);
      res.json(transaction);
    } catch (error) {
      const mapped = responseForDbUniqueViolation(error);
      if (mapped) {
        return res.status(mapped.status).json({ message: mapped.message });
      }
      console.error("Error creating transaction:", error);
      res.status(500).json({ message: "Failed to create transaction" });
    }
  });

  // Stock search endpoint
  app.get("/api/stocks/search", isAuthenticated, async (req: any, res) => {
    try {
      const query = (req.query.q as string || "").trim().toLowerCase();
      
      if (!query || query.length < 1) {
        res.json([]);
        return;
      }

      // Special handling for CASH search
      const cashTerms = ["cash", "hotovosť", "hotovost", "peniaze", "money"];
      const isCashSearch = cashTerms.some(term => query.includes(term) || term.includes(query));
      
      const results = await searchStocks(query);
      
      // Add CASH as first result if searching for cash-related terms
      if (isCashSearch) {
        const cashResult = {
          ticker: "CASH",
          name: "Hotovosť (Cash Reserve)",
          exchange: "Portfolio",
          currency: "USD",
          type: "Cash"
        };
        // Remove any conflicting CASH ticker from API results
        const filteredResults = results.filter((r: any) => r.ticker !== "CASH");
        res.json([cashResult, ...filteredResults]);
        return;
      }
      
      res.json(results);
    } catch (error) {
      console.error("Error searching stocks:", error);
      res.status(500).json({ message: "Failed to search stocks" });
    }
  });

  // Get stock quote with real-time prices (Yahoo Finance primary, Alpha Vantage/Finnhub backup)
  app.get("/api/stocks/quote/:ticker", isAuthenticated, async (req: any, res) => {
    try {
      const ticker = req.params.ticker.toUpperCase();
      
      // Special handling for CASH - returns fixed price of 1.00
      if (ticker === "CASH") {
        res.json({
          ticker: "CASH",
          price: 1.00,
          change: 0,
          changePercent: 0,
          quoteDate: null,
          marketState: "CLOSED",
          isMarketOpen: false,
          preMarketPrice: null,
          preMarketChange: null,
          preMarketChangePercent: null,
          high52: 1.00,
          low52: 1.00,
        });
        return;
      }
      
      const quote = await fetchStockQuote(ticker);
      res.json(quote);
    } catch (error) {
      console.error("Error fetching quote:", error);
      res.status(500).json({ message: `Nepodarilo sa načítať cenu pre ${req.params.ticker}` });
    }
  });

  // Batch get stock quotes - fetches multiple tickers in parallel for better performance
  app.post("/api/stocks/quotes/batch", isAuthenticated, async (req: any, res) => {
    try {
      const { tickers, refresh } = req.body;
      
      if (!tickers || !Array.isArray(tickers)) {
        return res.status(400).json({ message: "Tickers array required" });
      }

      const tickerSet = new Set<string>(tickers.map((t: string) => t.toUpperCase()));
      const uniqueTickers = Array.from(tickerSet);
      
      const result: Record<string, any> = {};
      const errors: Record<string, string> = {};
      
      // Process tickers in parallel with concurrency limit of 5 to respect API rate limits
      const CONCURRENCY_LIMIT = 5;
      
      for (let i = 0; i < uniqueTickers.length; i += CONCURRENCY_LIMIT) {
        const batch = uniqueTickers.slice(i, i + CONCURRENCY_LIMIT);
        
        const batchPromises = batch.map(async (ticker) => {
          try {
            // Special handling for CASH
            if (ticker === "CASH") {
              return {
                ticker: "CASH",
                data: {
                  ticker: "CASH",
                  price: 1.00,
                  change: 0,
                  changePercent: 0,
                  quoteDate: null,
                  marketState: "CLOSED",
                  isMarketOpen: false,
                  preMarketPrice: null,
                  preMarketChange: null,
                  preMarketChangePercent: null,
                  high52: 1.00,
                  low52: 1.00,
                }
              };
            }
            
            const quote = await fetchStockQuote(ticker, !!refresh);
            return { ticker, data: quote };
          } catch (error: any) {
            return { ticker, error: error.message || "Failed to fetch quote" };
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        
        for (const item of batchResults) {
          if ('data' in item) {
            result[item.ticker] = item.data;
          } else if ('error' in item) {
            errors[item.ticker] = item.error;
          }
        }
      }
      
      res.json({ quotes: result, errors: Object.keys(errors).length > 0 ? errors : undefined });
    } catch (error) {
      console.error("Error fetching batch quotes:", error);
      res.status(500).json({ message: "Failed to fetch batch quotes" });
    }
  });

  // Yahoo quoteSummary — sektor a krajina pre koláčové rozloženie portfólia
  app.get("/api/stocks/metadata", isAuthenticated, async (req: any, res) => {
    try {
      await ensureUserAssetMetadataTable();
      const userId = req.user.claims.sub;
      const tickersRaw = typeof req.query.tickers === "string" ? req.query.tickers : "";
      const tickers = tickersRaw
        .split(",")
        .map((t: string) => t.trim().toUpperCase())
        .filter(Boolean);
      const metadata = await storage.getUserAssetMetadataMap(userId, tickers.length ? tickers : undefined);
      res.json({ metadata });
    } catch (error) {
      console.error("Error fetching user asset metadata:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať metadáta aktív." });
    }
  });

  app.put("/api/stocks/metadata/:ticker", isAuthenticated, async (req: any, res) => {
    try {
      await ensureUserAssetMetadataTable();
      const userId = req.user.claims.sub;
      const ticker = String(req.params.ticker || "").trim().toUpperCase();
      if (!ticker) return res.status(400).json({ message: "Ticker je povinný." });

      const sector = typeof req.body?.sector === "string" ? req.body.sector.trim() : "";
      const country = typeof req.body?.country === "string" ? req.body.country.trim() : "";
      const assetType = normalizeAssetType(req.body?.assetType);
      if (req.body?.assetType != null && !assetType) {
        return res.status(400).json({ message: "Neplatný typ aktíva." });
      }

      const row = await storage.upsertUserAssetMetadata(userId, ticker, {
        sector: sector || null,
        country: country || null,
        assetType,
      });
      res.json({ metadata: row });
    } catch (error) {
      console.error("Error upserting user asset metadata:", error);
      const msg = error instanceof Error && error.message ? error.message : "Nepodarilo sa uložiť metadáta aktíva.";
      res.status(500).json({ message: msg });
    }
  });

  app.post("/api/stocks/asset-profiles/batch", isAuthenticated, async (req: any, res) => {
    try {
      await ensureUserAssetMetadataTable();
      const userId = req.user.claims.sub;
      const { tickers } = req.body;
      if (!tickers || !Array.isArray(tickers)) {
        return res.status(400).json({ message: "Pole tickerov je povinné." });
      }

      const unique = Array.from(new Set<string>(tickers.map((t: string) => String(t).toUpperCase())));
      const profiles: Record<string, { sector: string; country: string; assetType: AssetClassValue }> = {};
      const overrides = await storage.getUserAssetMetadataMap(userId, unique);

      const CONCURRENCY = 4;
      for (let i = 0; i < unique.length; i += CONCURRENCY) {
        const batch = unique.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (ticker) => {
            const fetched = await fetchYahooAssetProfile(ticker);
            const o = overrides[ticker];
            profiles[ticker] = {
              sector: o?.sector?.trim() ? o.sector : fetched.sector,
              country: o?.country?.trim() ? o.country : fetched.country,
              assetType: o?.assetType ?? fetched.assetType,
            };
          })
        );
      }

      res.json({ profiles });
    } catch (error) {
      console.error("Error fetching asset profiles batch:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať profily aktív." });
    }
  });

  // Get historical prices for a ticker
  app.get("/api/stocks/history/:ticker", isAuthenticated, async (req: any, res) => {
    try {
      const ticker = req.params.ticker.toUpperCase();
      
      // Special handling for CASH - always returns price of 1.00
      if (ticker === "CASH") {
        res.json({ ticker: "CASH", prices: {} });
        return;
      }
      
      const prices = await fetchHistoricalPrices(ticker);
      res.json({ ticker, prices });
    } catch (error) {
      console.error("Error fetching historical prices:", error);
      res.status(500).json({ message: `Nepodarilo sa načítať historické ceny pre ${req.params.ticker}` });
    }
  });

  // Get historical prices for multiple tickers (batch)
  app.post("/api/stocks/history/batch", isAuthenticated, async (req: any, res) => {
    try {
      const { tickers } = req.body;
      
      if (!tickers || !Array.isArray(tickers)) {
        return res.status(400).json({ message: "Tickers array required" });
      }

      const result: Record<string, Record<string, number>> = {};
      const errors: Record<string, string> = {};
      const tickerSet = new Set<string>(tickers.map((t: string) => t.toUpperCase()));
      const uniqueTickers = Array.from(tickerSet);
      
      // Process all tickers - cache will prevent repeated API calls
      // fetchHistoricalPrices already handles caching (12 hours) and rate limit errors gracefully
      for (const ticker of uniqueTickers) {
        // Skip CASH - it doesn't have historical prices
        if (ticker === "CASH") {
          continue;
        }
        
        try {
          const prices = await fetchHistoricalPrices(ticker);
          if (Object.keys(prices).length > 0) {
            result[ticker] = prices;
          } else {
            errors[ticker] = "Historické dáta nie sú k dispozícii";
          }
        } catch (e) {
          errors[ticker] = "Nepodarilo sa načítať historické ceny";
        }
      }

      res.json({ prices: result, errors, fetchedCount: Object.keys(result).length, totalRequested: uniqueTickers.length });
    } catch (error) {
      console.error("Error fetching batch historical prices:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať historické ceny" });
    }
  });

  // Get news for held assets
  app.get("/api/news", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioParam = req.query.portfolio as string || "all";
      
      // Get holdings based on portfolio filter
      let holdings;
      if (portfolioParam === "all") {
        holdings = await storage.getHoldingsByUser(userId);
      } else {
        holdings = await storage.getHoldingsByUser(userId, portfolioParam);
      }
      
      if (!holdings || holdings.length === 0) {
        return res.json([]);
      }
      
      // Get unique tickers from holdings
      const tickers = Array.from(new Set(holdings.map(h => h.ticker)));
      
      // Check cache
      const cacheKey = `news_${tickers.sort().join("_")}`;
      const cached = newsCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < NEWS_CACHE_TTL) {
        return res.json(cached.data);
      }
      
      // Fetch news for each ticker (limit to first 8 tickers to avoid too many requests)
      const tickersToFetch = tickers.slice(0, 8);
      const allNews: NewsArticle[] = [];
      
      for (const ticker of tickersToFetch) {
        try {
          const news = await fetchYahooNews(ticker);
          allNews.push(...news);
        } catch (e) {
          console.error(`Failed to fetch news for ${ticker}:`, e);
        }
      }
      
      // Sort by publishedAt (newest first) and deduplicate by title
      const seenTitles = new Set<string>();
      const uniqueNews = allNews
        .filter(article => {
          if (seenTitles.has(article.title)) return false;
          seenTitles.add(article.title);
          return true;
        })
        .sort((a, b) => b.publishedAt - a.publishedAt)
        .slice(0, 12); // Return max 12 articles
      
      // Cache the result
      newsCache.set(cacheKey, { data: uniqueNews, timestamp: Date.now() });
      
      res.json(uniqueNews);
    } catch (error) {
      console.error("Error fetching news:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať novinky" });
    }
  });

  // Update a transaction
  app.put("/api/transactions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const transactionId = req.params.id;
      const {
        type: typeRaw,
        ticker,
        companyName,
        shares: sharesIn,
        pricePerShare: priceIn,
        commission,
        transactionDate,
        portfolioId,
        transactionId: extBrokerId,
        originalCurrency: origCur,
        exchangeRateAtTransaction: exIn,
        baseCurrencyAmount: baseIn,
      } = req.body;

      const type = String(typeRaw || "").toUpperCase();

      // Get the transaction to verify it exists and belongs to the user
      const existingTransaction = await storage.getTransactionById(transactionId, userId);

      if (!existingTransaction) {
        return res.status(404).json({ message: "Transakcia nenájdená." });
      }

      const oldTicker = existingTransaction.ticker;
      const oldPortfolioId = existingTransaction.portfolioId;

      let newTicker = String(ticker || "").toUpperCase();
      const newPortfolioId = portfolioId || oldPortfolioId;

      let sharesNum = parseFloat(String(sharesIn));
      let priceNum = parseFloat(String(priceIn));
      if (type === "DEPOSIT" || type === "WITHDRAWAL") {
        newTicker = CASH_FLOW_TICKER;
        sharesNum = 1;
        const a = Math.abs(priceNum);
        if (!Number.isFinite(a) || !(a > 0)) {
          return res.status(400).json({ message: "Neplatná suma pre vklad/výber." });
        }
        priceNum = type === "WITHDRAWAL" ? -a : a;
      }

      const tIdUpd =
        extBrokerId === undefined
          ? undefined
          : typeof extBrokerId === "string" && extBrokerId.trim() !== ""
            ? extBrokerId.trim()
            : null;

      // Update the transaction
      await storage.updateTransaction(transactionId, userId, {
        type,
        ticker: newTicker,
        companyName,
        shares: sharesNum.toFixed(8),
        pricePerShare: priceNum.toFixed(4),
        commission: parseFloat(commission || 0).toFixed(4),
        transactionDate: new Date(transactionDate),
        portfolioId: newPortfolioId,
        ...(tIdUpd !== undefined ? { transactionId: tIdUpd } : {}),
        ...(origCur && String(origCur).length === 3
          ? {
              originalCurrency: String(origCur).toUpperCase(),
              currency: String(origCur).toUpperCase(),
            }
          : {}),
        ...(exIn !== undefined && exIn !== null && String(exIn) !== ""
          ? { exchangeRateAtTransaction: parseFloat(String(exIn)).toFixed(8) }
          : {}),
        ...(baseIn !== undefined && baseIn !== null && String(baseIn) !== ""
          ? { baseCurrencyAmount: parseFloat(String(baseIn)).toFixed(4) }
          : {}),
      });

      // Recalculate holdings for old ticker in old portfolio
      const oldTickerTransactions = await storage.getTransactionsByUserAndTicker(userId, oldTicker, oldPortfolioId);
      if (oldTickerTransactions.length === 0) {
        await storage.deleteHolding(userId, oldTicker, oldPortfolioId);
      } else {
        let totalShares = 0;
        let totalInvested = 0;
        for (const txn of oldTickerTransactions) {
          if (isNonHoldingTransactionType(txn.type)) continue;
          const s = parseFloat(txn.shares);
          const p = parseFloat(txn.pricePerShare);
          const c = parseFloat(txn.commission || "0");
          if (txn.type === "BUY") {
            totalShares += s;
            totalInvested += s * p + c;
          } else if (txn.type === "SELL") {
            totalShares -= s;
            totalInvested -= s * p + c;
          }
        }
        if (totalShares > 0.00000001) {
          const avgCost = totalInvested / totalShares;
          await storage.upsertHolding(userId, oldTicker, oldTickerTransactions[0].companyName, totalShares.toFixed(8), avgCost.toFixed(4), totalInvested.toFixed(4), oldPortfolioId);
        } else {
          await storage.deleteHolding(userId, oldTicker, oldPortfolioId);
        }
      }

      // Recalculate holdings for new ticker in new portfolio (if different)
      if (newTicker !== oldTicker || newPortfolioId !== oldPortfolioId) {
        const newTickerTransactions = await storage.getTransactionsByUserAndTicker(userId, newTicker, newPortfolioId);
        let totalShares = 0;
        let totalInvested = 0;
        for (const txn of newTickerTransactions) {
          if (isNonHoldingTransactionType(txn.type)) continue;
          const s = parseFloat(txn.shares);
          const p = parseFloat(txn.pricePerShare);
          const c = parseFloat(txn.commission || "0");
          if (txn.type === "BUY") {
            totalShares += s;
            totalInvested += s * p + c;
          } else if (txn.type === "SELL") {
            totalShares -= s;
            totalInvested -= s * p + c;
          }
        }
        if (totalShares > 0.00000001) {
          const avgCost = totalInvested / totalShares;
          await storage.upsertHolding(userId, newTicker, companyName, totalShares.toFixed(8), avgCost.toFixed(4), totalInvested.toFixed(4), newPortfolioId);
        }
      }

      invalidatePerformanceCache(userId);
      res.json({ message: "Transakcia bola aktualizovaná." });
    } catch (error) {
      const mapped = responseForDbUniqueViolation(error);
      if (mapped) {
        return res.status(mapped.status).json({ message: mapped.message });
      }
      console.error("Error updating transaction:", error);
      res.status(500).json({ message: "Nepodarilo sa aktualizovať transakciu." });
    }
  });

  // Delete a transaction
  app.delete("/api/transactions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const transactionId = req.params.id;

      // Get the transaction to verify it exists and belongs to the user
      const transaction = await storage.getTransactionById(transactionId, userId);

      if (!transaction) {
        return res.status(404).json({ message: "Transakcia nenájdená." });
      }

      const portfolioId = transaction.portfolioId;

      // Delete the transaction
      await storage.deleteTransaction(transactionId, userId);

      // Recalculate holdings for this ticker in this portfolio
      const remainingTransactions = await storage.getTransactionsByUserAndTicker(userId, transaction.ticker, portfolioId);
      
      if (remainingTransactions.length === 0) {
        await storage.deleteHolding(userId, transaction.ticker, portfolioId);
      } else {
        let totalShares = 0;
        let totalInvested = 0;

        for (const txn of remainingTransactions) {
          if (isNonHoldingTransactionType(txn.type)) continue;
          const shares = parseFloat(txn.shares);
          const price = parseFloat(txn.pricePerShare);
          const commission = parseFloat(txn.commission || "0");

          if (txn.type === "BUY") {
            totalShares += shares;
            totalInvested += shares * price + commission;
          } else if (txn.type === "SELL") {
            totalShares -= shares;
            totalInvested -= shares * price + commission;
          }
        }

        if (totalShares > 0.00000001) {
          const avgCost = totalInvested / totalShares;
          await storage.upsertHolding(
            userId,
            transaction.ticker,
            transaction.companyName,
            totalShares.toFixed(8),
            avgCost.toFixed(4),
            totalInvested.toFixed(4),
            portfolioId
          );
        } else {
          await storage.deleteHolding(userId, transaction.ticker, portfolioId);
        }
      }

      invalidatePerformanceCache(userId);
      res.json({ message: "Transakcia bola vymazaná." });
    } catch (error) {
      console.error("Error deleting transaction:", error);
      res.status(500).json({ message: "Nepodarilo sa vymazať transakciu." });
    }
  });

  // Get exchange rate (returns all rates including CZK, PLN, GBP)
  app.get("/api/exchange-rate", isAuthenticated, async (req: any, res) => {
    try {
      const rates = await fetchAllExchangeRates();
      res.json(rates);
    } catch (error) {
      console.error("Error fetching exchange rate:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať kurz." });
    }
  });

  // Portfolio performance broken down by year + month. Server-side computed
  // and cached per (user, portfolio) so the Profit page doesn't have to
  // replay years of transactions in the browser on every open. Cache is
  // invalidated on every write path that touches transactions.
  app.get("/api/portfolio-performance", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioParam = (req.query.portfolio as string) || "all";
      const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";

      const cacheKey = perfCacheKey(userId, portfolioParam);
      const cached = performanceCache.get(cacheKey);
      if (!forceRefresh && cached && Date.now() - cached.timestamp < PERFORMANCE_CACHE_TTL) {
        res.setHeader("X-Performance-Cache", "hit");
        return res.json(cached.data);
      }

      const data = await computePortfolioPerformance(userId, portfolioParam);
      performanceCache.set(cacheKey, { data, timestamp: Date.now() });
      res.setHeader("X-Performance-Cache", cached ? "refresh" : "miss");
      res.json(data);
    } catch (error) {
      console.error("Error computing portfolio performance:", error);
      res.status(500).json({ message: "Nepodarilo sa vypočítať výkonnosť portfólia." });
    }
  });

  // Get realized gains summary
  app.get("/api/realized-gains", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioId = req.query.portfolio as string | undefined;
      const userTransactions = await storage.getTransactionsByUser(userId, portfolioId);

      const computed = await computeRealizedGainsFromTransactionsAsync(
        userTransactions,
      );
      const closeTradeNetEur = sumCloseTradeCashFlowEurFromRows(userTransactions);
      const realizedGainTotal = computed.totalRealized + closeTradeNetEur;

      res.json({
        /** FIFO z akcií (BUY/SELL) v EUR. */
        totalRealized: computed.totalRealized,
        /** Súčet hotov. riadkov XTB close trade; nie je v FIFO. */
        closeTradeNetEur,
        /** Celý „realizovaný zisk“ v UI: akcie (FIFO) + close trade. */
        realizedGainTotal,
        realizedYTD: computed.realizedYTD,
        realizedThisMonth: computed.realizedThisMonth,
        realizedToday: computed.realizedToday,
        byTicker: computed.byTicker,
        transactionCount: computed.transactionCount,
      });
    } catch (error) {
      console.error("Error fetching realized gains:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať realizované zisky." });
    }
  });

  /**
   * Daňový prehľad (marec / ročné zúčtovanie) – FIFO alokácia, &lt;365 dní zdaniteľné, dividendy, orient. 19/25 %.
   * GET /api/tax-summary?year=2025&portfolio=all|&lt;id&gt;
   */
  app.get("/api/tax-summary", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const qy = req.query.year as string | undefined;
      const y = qy != null && String(qy).trim() !== "" ? parseInt(String(qy), 10) : NaN;
      const year = Number.isFinite(y) && y >= 2000 && y <= 2100 ? y : new Date().getUTCFullYear();
      const portfolioParam = (req.query.portfolio as string | undefined) || "all";
      const rates = await fetchAllExchangeRates();
      const tx = await storage.getTransactionsByUser(
        userId,
        portfolioParam === "all" ? null : portfolioParam,
      );
      const out = await buildTaxSummary(year, tx, rates);
      const availableYears = Array.from(
        new Set(
          tx
            .map((t) => new Date(t.transactionDate as unknown as string).getUTCFullYear())
            .filter((yy) => Number.isFinite(yy) && yy >= 2000 && yy <= 2100),
        ),
      ).sort((a, b) => b - a);
      res.json({
        ...out,
        portfolio: portfolioParam,
        availableYears,
        generatedAt: Date.now(),
        /** Rovnaké dáta v tvare vhodnom na CSV (jeden header + riadky). */
        exportCsv: {
          disposals: {
            header: [
              "sellTransactionId",
              "ticker",
              "acquiredAt",
              "sellDate",
              "shares",
              "costEur",
              "proceedsEur",
              "gainEur",
              "holdingAtLeast365Days",
            ] as const,
            rows: out.disposalPortions.map((p) => [
              p.sellTransactionId,
              p.ticker,
              p.acquiredAt,
              p.sellDate,
              p.shares,
              p.costEur,
              p.proceedsEur,
              p.gainEur,
              p.holdingAtLeast365Days,
            ]),
          },
          dividends: {
            header: [
              "transactionId",
              "date",
              "ticker",
              "grossEur",
              "withholdingEur",
              "netEur",
            ] as const,
            rows: out.dividends.items.map((d) => [
              d.transactionId,
              d.date,
              d.ticker,
              d.grossEur,
              d.withholdingEur,
              d.netEur,
            ]),
          },
        },
      });
    } catch (error) {
      console.error("Error building tax summary:", error);
      res.status(500).json({ message: "Nepodarilo sa vypočítať daňový prehľad." });
    }
  });

  // Rozdelenie P&L: kapitálový (FIFO + cena), FX, dividendy (v preferovanej mene)
  app.get("/api/pnl-breakdown", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioId = req.query.portfolio as string | undefined;
      const userSettings = await storage.getUserSettings(userId);
      const userCcy = (userSettings?.preferredCurrency || "EUR").toUpperCase();
      const rates = await fetchAllExchangeRates();
      const tx = await storage.getTransactionsByUser(userId, portfolioId);
      const tickers = new Set<string>();
      for (const t of tx) {
        if (t.type === "BUY" || t.type === "SELL") {
          const u = t.ticker.toUpperCase();
          if (isMarketDataTicker(u)) tickers.add(u);
        }
      }
      const tickerArr = Array.from(tickers);
      const quotePairs = await Promise.all(
        tickerArr.map(async (t) => {
          try {
            const q = await fetchStockQuote(t);
            if (q && typeof q.price === "number" && Number.isFinite(q.price)) {
              return [t, q.price] as const;
            }
          } catch {
            /* quote unavailable */
          }
          return [t, undefined] as const;
        }),
      );
      const currentPriceByTicker: Record<string, number> = {};
      for (const [t, p] of quotePairs) {
        if (p !== undefined) currentPriceByTicker[t] = p;
      }
      const out = await computePnlBreakdown(tx, userCcy, rates, currentPriceByTicker);
      res.json(out);
    } catch (error) {
      console.error("Error computing PnL breakdown:", error);
      res.status(500).json({ message: "Nepodarilo sa vypočítať rozdelenie zisku." });
    }
  });

  /** Najbližšia ohlásená dividenda v držaných tituloch (Yahoo kalendár). */
  app.get("/api/dividends/upcoming", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioParam = (req.query.portfolio as string) || "all";
      const pf = portfolioParam === "all" ? undefined : portfolioParam;
      const userSettings = await storage.getUserSettings(userId);
      const userCcy = (userSettings?.preferredCurrency || "EUR").toUpperCase();
      const rates = await fetchAllExchangeRates();

      const holdings = await storage.getHoldingsByUser(userId, pf);

      const byTicker = new Map<string, { shares: number; companyName: string }>();
      for (const h of holdings) {
        const t = h.ticker.toUpperCase();
        if (!isMarketDataTicker(t)) continue;
        const sh = parseFloat(h.shares);
        if (!Number.isFinite(sh) || sh <= 0) continue;
        const prev = byTicker.get(t);
        const name = (h.companyName || t).trim() || t;
        byTicker.set(t, {
          shares: (prev?.shares ?? 0) + sh,
          companyName: prev?.companyName || name,
        });
      }

      const tickers = Array.from(byTicker.keys());

      type Best = {
        ticker: string;
        companyName: string;
        date: string;
        kind: "ex_dividend" | "payout";
        estimatedGrossInUserCcy: number | null;
        eventMs: number;
      };
      const all: Best[] = [];

      const CONCURRENCY = 4;
      for (let i = 0; i < tickers.length; i += CONCURRENCY) {
        const chunk = tickers.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          chunk.map(async (ticker) => {
            const events = await fetchYahooUpcomingDividendEvents(ticker);
            return { ticker, events };
          }),
        );
        for (const { ticker, events } of results) {
          if (!events?.length) continue;
          const row = byTicker.get(ticker)!;
          for (const hint of events) {
            let est: number | null = null;
            if (
              hint.lastDividendPerShare != null &&
              Number.isFinite(hint.lastDividendPerShare)
            ) {
              const gross = row.shares * hint.lastDividendPerShare;
              est = convertAmountBetween(
                gross,
                getTickerCurrency(ticker),
                userCcy,
                rates,
              );
            }
            all.push({
              ticker,
              companyName: row.companyName,
              date: new Date(hint.eventMs).toISOString().slice(0, 10),
              kind: hint.kind,
              estimatedGrossInUserCcy: est,
              eventMs: hint.eventMs,
            });
          }
        }
      }

      all.sort((a, b) => a.eventMs - b.eventMs);
      const next = all.length > 0 ? all[0] : null;

      res.json({ next, all });
    } catch (error) {
      console.error("Error fetching upcoming dividend:", error);
      res
        .status(500)
        .json({ message: "Nepodarilo sa načítať najbližšiu dividendu." });
    }
  });

  /** Denné body: celková MTM + čisté vklady/výbery, kum. % (segment TWR) vs. S&amp;P 500. */
  function parsePortfolioHistoryRange(q: string | undefined): PortfolioHistoryRange {
    const u = (q || "1y").trim().toLowerCase();
    if (u === "1m") return "1m";
    if (u === "6m") return "6m";
    if (u === "ytd") return "ytd";
    if (u === "1y" || u === "12m") return "1y";
    if (u === "all" || u === "max") return "all";
    return "1y";
  }

  function parseSnapshotRange(
    q: string | undefined,
  ): "1m" | "3m" | "6m" | "ytd" | "1y" | "all" {
    const u = (q || "1y").trim().toLowerCase();
    if (u === "1m") return "1m";
    if (u === "3m") return "3m";
    if (u === "6m") return "6m";
    if (u === "ytd") return "ytd";
    if (u === "1y" || u === "12m") return "1y";
    if (u === "all" || u === "max") return "all";
    return "1y";
  }

  function rangeStartIsoFromEnd(
    range: "1m" | "3m" | "6m" | "ytd" | "1y" | "all",
    endIso: string,
    firstIso: string,
  ): string {
    if (range === "all") return firstIso;
    const end = new Date(`${endIso}T12:00:00.000Z`);
    const start = new Date(end);
    if (range === "1m") start.setUTCMonth(start.getUTCMonth() - 1);
    else if (range === "3m") start.setUTCMonth(start.getUTCMonth() - 3);
    else if (range === "6m") start.setUTCMonth(start.getUTCMonth() - 6);
    else if (range === "1y") start.setUTCFullYear(start.getUTCFullYear() - 1);
    else if (range === "ytd") return `${end.getUTCFullYear()}-01-01`;
    const iso = start.toISOString().slice(0, 10);
    return iso < firstIso ? firstIso : iso;
  }

  async function backfillPortfolioSnapshotsForScope(
    userId: string,
    portfolioParam: string,
  ): Promise<number> {
    const out = await computeSnapshotSeriesForScope(userId, portfolioParam);
    if (out.points.length === 0) return 0;
    const scopeKey = portfolioParam === "all" ? "all" : portfolioParam;
    let prevTotal = 0;
    let written = 0;
    for (let i = 0; i < out.points.length; i++) {
      const p = out.points[i]!;
      const daily = i === 0 ? 0 : p.totalValue - prevTotal;
      await storage.upsertPortfolioSnapshot({
        userId,
        scopeKey,
        date: p.date,
        totalValueEur: p.totalValue,
        investedAmountEur: p.netInvested,
        dailyProfitEur: daily,
      });
      prevTotal = p.totalValue;
      written++;
    }
    return written;
  }

  async function computeSnapshotSeriesForScope(
    userId: string,
    portfolioParam: string,
  ) {
    const tx = await storage.getTransactionsByUser(
      userId,
      portfolioParam === "all" ? null : portfolioParam,
    );
    if (tx.length === 0) {
      return {
        points: [] as Array<{ date: string; totalValue: number; netInvested: number }>,
        endIso: new Date().toISOString().slice(0, 10),
      };
    }

    const sorted = [...tx].sort(
      (a, b) =>
        new Date(a.transactionDate as unknown as string).getTime() -
        new Date(b.transactionDate as unknown as string).getTime(),
    );
    const tickers = new Set<string>();
    for (const t of sorted) {
      const u = t.ticker?.toUpperCase() ?? "";
      if (isMarketDataTicker(u)) tickers.add(u);
    }
    const tickerArr = Array.from(tickers);
    const rates = await fetchAllExchangeRates();
    const todayIso = new Date().toISOString().slice(0, 10);
    const [quotePairs, histPairs, spHist] = await Promise.all([
      Promise.all(
        tickerArr.map(async (t) => {
          try {
            const q = await fetchStockQuote(t);
            if (q && typeof q.price === "number" && Number.isFinite(q.price)) {
              return [t, q.price] as const;
            }
          } catch {
            // ignore quote failures during backfill
          }
          return [t, undefined] as const;
        }),
      ),
      Promise.all(
        tickerArr.map(async (t) => {
          try {
            return [t, (await fetchHistoricalPrices(t)) || {}] as const;
          } catch {
            return [t, {}] as const;
          }
        }),
      ),
      fetchHistoricalPrices("^GSPC")
        .then((h) => h || {})
        .catch(() => ({})),
    ]);
    const currentPrices: Record<string, number> = {};
    for (const [t, p] of quotePairs) {
      if (p !== undefined) currentPrices[t] = p;
    }
    const historicalByTicker: Record<string, Record<string, number>> = {};
    for (const [t, h] of histPairs) historicalByTicker[t] = h;

    const out = computePortfolioHistorySeries(
      sorted,
      spHist,
      historicalByTicker,
      currentPrices,
      rates,
      "EUR",
      todayIso,
      "all",
      12000,
    );
    return out;
  }

  app.get("/api/portfolio/history", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioParam = (req.query.portfolio as string) || "all";
      const scopeKey = portfolioParam === "all" ? "all" : portfolioParam;
      const range = parseSnapshotRange(req.query.range as string | undefined);
      const todayIso = new Date().toISOString().slice(0, 10);

      let last = await storage.getLastPortfolioSnapshot(userId, scopeKey);
      if (!last) {
        try {
          await backfillPortfolioSnapshotsForScope(userId, portfolioParam);
          last = await storage.getLastPortfolioSnapshot(userId, scopeKey);
        } catch (err) {
          // Fallback: when snapshot table is missing/not migrated yet, serve on-the-fly series.
          const out = await computeSnapshotSeriesForScope(userId, portfolioParam);
          const firstIso = out.points[0]?.date ?? todayIso;
          const startIso = rangeStartIsoFromEnd(range, todayIso, firstIso);
          const liveRows = out.points.filter((p) => p.date >= startIso && p.date <= todayIso);
          return res.json({
            points: liveRows.map((p, i) => ({
              date: p.date,
              totalValueEur: Number(p.totalValue),
              investedAmountEur: Number(p.netInvested),
              dailyProfitEur:
                i === 0 ? 0 : Number(p.totalValue) - Number(liveRows[i - 1]!.totalValue),
            })),
            range,
            portfolio: portfolioParam,
            currency: "EUR",
            source: "live-fallback",
            startIso,
            endIso: todayIso,
          });
        }
      }
      if (!last) {
        return res.json({
          points: [],
          range,
          portfolio: portfolioParam,
          currency: "EUR",
          source: "snapshots",
        });
      }

      const allRows = await storage.getPortfolioSnapshots(userId, scopeKey);
      const firstIso = allRows[0]?.date ?? last.date;
      const startIso = rangeStartIsoFromEnd(range, todayIso, firstIso);
      const rows = await storage.getPortfolioSnapshots(userId, scopeKey, startIso, todayIso);

      res.json({
        points: rows.map((r) => ({
          date: r.date,
          totalValueEur: Number(r.totalValueEur),
          investedAmountEur: Number(r.investedAmountEur),
          dailyProfitEur: Number(r.dailyProfitEur),
        })),
        range,
        portfolio: portfolioParam,
        currency: "EUR",
        source: "snapshots",
        startIso,
        endIso: todayIso,
      });
    } catch (error) {
      console.error("Error reading portfolio snapshots:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať históriu zo snapshotov." });
    }
  });

  app.post("/api/portfolio/history/backfill", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioParam = ((req.body?.portfolio as string) || "all").trim() || "all";
      const written = await backfillPortfolioSnapshotsForScope(userId, portfolioParam);
      res.json({ ok: true, portfolio: portfolioParam, written });
    } catch (error) {
      console.error("Error backfilling portfolio snapshots:", error);
      res.status(500).json({ message: "Nepodarilo sa spraviť backfill snapshotov." });
    }
  });

  app.get("/api/portfolio-history", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioParam = (req.query.portfolio as string) || "all";
      const userSettings = await storage.getUserSettings(userId);
      const userCcy = (userSettings?.preferredCurrency || "EUR").toUpperCase();
      const rates = await fetchAllExchangeRates();
      const todayIso = new Date().toISOString().slice(0, 10);
      const range = parsePortfolioHistoryRange(req.query.range as string | undefined);

      const tx = await storage.getTransactionsByUser(
        userId,
        portfolioParam === "all" ? null : portfolioParam,
      );
      const sorted = [...tx].sort(
        (a, b) =>
          new Date(a.transactionDate as unknown as string).getTime() -
          new Date(b.transactionDate as unknown as string).getTime(),
      );

      const tickers = new Set<string>();
      for (const t of tx) {
        const u = t.ticker?.toUpperCase() ?? "";
        if (isMarketDataTicker(u)) tickers.add(u);
      }

      const tickerArr = Array.from(tickers);
      const [quotePairs, histPairs, spHist] = await Promise.all([
        Promise.all(
          tickerArr.map(async (t) => {
            try {
              const q = await fetchStockQuote(t);
              if (q && typeof q.price === "number" && Number.isFinite(q.price)) {
                return [t, q.price] as const;
              }
            } catch {
              /* quote unavailable */
            }
            return [t, undefined] as const;
          }),
        ),
        Promise.all(
          tickerArr.map(async (t) => {
            try {
              return [t, (await fetchHistoricalPrices(t)) || {}] as const;
            } catch {
              return [t, {}] as const;
            }
          }),
        ),
        fetchHistoricalPrices("^GSPC")
          .then((h) => h || {})
          .catch(() => ({})),
      ]);

      const currentPrices: Record<string, number> = {};
      for (const [t, p] of quotePairs) {
        if (p !== undefined) currentPrices[t] = p;
      }

      const historicalByTicker: Record<string, Record<string, number>> = {};
      for (const [t, h] of histPairs) {
        historicalByTicker[t] = h;
      }

      const out = computePortfolioHistorySeries(
        sorted,
        spHist,
        historicalByTicker,
        currentPrices,
        rates,
        userCcy,
        todayIso,
        range,
        150,
      );
      res.json({
        ...out,
        range,
        portfolio: portfolioParam,
        benchmark: "^GSPC",
      });
    } catch (error) {
      console.error("Error computing portfolio history:", error);
      res.status(500).json({ message: "Nepodarilo sa vypočítať históriu portfólia." });
    }
  });

  // TWR (GIPS reťazenie) vs. S&P 500 v rovnakých dátumoch
  app.get("/api/twr", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioId = (req.query.portfolio as string) || "all";
      const userSettings = await storage.getUserSettings(userId);
      const userCcy = (userSettings?.preferredCurrency || "EUR").toUpperCase();
      const rates = await fetchAllExchangeRates();
      const todayIso = new Date().toISOString().slice(0, 10);
      const tx = await storage.getTransactionsByUser(
        userId,
        portfolioId === "all" ? null : portfolioId,
      );
      const tickers = new Set<string>();
      for (const t of tx) {
        const u = t.ticker?.toUpperCase() ?? "";
        if (isMarketDataTicker(u)) tickers.add(u);
      }
      const tickerArr = Array.from(tickers);
      const twrQuotePairs = await Promise.all(
        tickerArr.map(async (t) => {
          try {
            const q = await fetchStockQuote(t);
            if (q && typeof q.price === "number" && Number.isFinite(q.price)) {
              return [t, q.price] as const;
            }
          } catch {
            /* quote unavailable */
          }
          return [t, undefined] as const;
        }),
      );
      const currentPrices: Record<string, number> = {};
      for (const [t, p] of twrQuotePairs) {
        if (p !== undefined) currentPrices[t] = p;
      }
      const out = await computeGipsTwr(
        userId,
        portfolioId,
        userCcy,
        rates,
        todayIso,
        fetchHistoricalPrices,
        currentPrices,
      );
      res.json(out);
    } catch (error) {
      console.error("Error computing TWR:", error);
      res.status(500).json({ message: "Nepodarilo sa vypočítať TWR." });
    }
  });

  // Get total fees/commissions
  app.get("/api/fees", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioId = req.query.portfolio as string | undefined;
      
      // Get stock transaction fees
      const userTransactions = await storage.getTransactionsByUser(userId, portfolioId);
      let stockFees = 0;
      for (const txn of userTransactions) {
        if (txn.type === "BUY" || txn.type === "SELL") {
          stockFees += parseFloat(txn.commission || "0");
        }
      }
      
      // Get option fees (both open and close commissions)
      const optionTrades = await storage.getOptionTradesByUser(userId);
      let optionFees = 0;
      for (const trade of optionTrades) {
        optionFees += parseFloat(trade.commission || "0");
        if (trade.closeCommission) {
          optionFees += parseFloat(trade.closeCommission);
        }
      }
      
      res.json({
        stockFees,
        optionFees,
        totalFees: stockFees + optionFees,
      });
    } catch (error) {
      console.error("Error fetching fees:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať poplatky." });
    }
  });

  // Recalculate realized gains for all existing SELL transactions
  app.post("/api/realized-gains/recalculate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioId = req.query.portfolio as string | undefined;
      const userTransactions = await storage.getTransactionsByUser(userId, portfolioId);
      
      // Sort transactions by date (oldest first) to calculate holdings at each point
      const sortedTransactions = [...userTransactions].sort((a, b) => 
        new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime()
      );
      
      // Track holdings state as we process transactions chronologically
      const holdingsState: Record<string, { shares: number; avgCost: number; totalCost: number }> = {};
      
      let updatedCount = 0;
      
      for (const txn of sortedTransactions) {
        const shares = Math.abs(parseFloat(String(txn.shares)));
        const price = parseFloat(txn.pricePerShare);
        const commission = parseFloat(txn.commission || "0");
        const lotKey = transactionLotKey(txn);

        if (txn.type === "BUY") {
          // Update holdings state with BUY
          if (!holdingsState[lotKey]) {
            holdingsState[lotKey] = { shares: 0, avgCost: 0, totalCost: 0 };
          }
          const h = holdingsState[lotKey];
          const totalCost = shares * price + commission;
          const newShares = h.shares + shares;
          h.totalCost += totalCost;
          h.avgCost = h.totalCost / newShares;
          h.shares = newShares;
        } else if (txn.type === "SELL") {
          // Calculate realized gain based on current holdings state
          const h = holdingsState[lotKey];
          if (h && h.shares > 0) {
            const costBasis = h.avgCost;
            // Realized gain = (sell price - avg cost) * shares - commission
            const realizedGain = (price - costBasis) * shares - commission;
            
            // Update the transaction with calculated realized gain
            await storage.updateTransaction(txn.id, userId, {
              realizedGain: realizedGain.toFixed(4),
              costBasis: costBasis.toFixed(4),
            });
            updatedCount++;
            
            // Update holdings state after sell
            const soldCost = shares * h.avgCost;
            h.shares = Math.max(0, h.shares - shares);
            h.totalCost = Math.max(0, h.totalCost - soldCost);
          }
        }
      }
      
      res.json({ 
        message: `Prepočítaných ${updatedCount} SELL transakcií.`,
        updatedCount 
      });
    } catch (error) {
      console.error("Error recalculating realized gains:", error);
      res.status(500).json({ message: "Nepodarilo sa prepočítať realizované zisky." });
    }
  });

  // Get dividends summary
  app.get("/api/dividends", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioId = req.query.portfolio as string | undefined;
      const userTransactions = await storage.getTransactionsByUser(userId, portfolioId);
      
      // Filter DIVIDEND and TAX transactions
      const dividendTransactions = userTransactions.filter(t => t.type === "DIVIDEND");
      const taxTransactions = userTransactions.filter(t => t.type === "TAX");
      
      // Group by ticker
      const byTicker: Record<string, { 
        ticker: string; 
        companyName: string; 
        totalGross: number;
        totalTax: number;
        totalNet: number;
        transactions: number;
      }> = {};
      
      // Calculate totals for different periods
      const now = new Date();
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      let totalGross = 0;
      let totalTax = 0;
      let totalNet = 0;
      let grossYTD = 0;
      let netYTD = 0;
      let grossThisMonth = 0;
      let netThisMonth = 0;
      let grossToday = 0;
      let netToday = 0;
      
      // Process DIVIDEND transactions (positive amounts)
      for (const txn of dividendTransactions) {
        const shares = parseFloat(txn.shares);
        const dividendPerShare = parseFloat(txn.pricePerShare);
        const tax = parseFloat(txn.commission || "0");
        const gross = shares * dividendPerShare;
        const net = gross - tax;
        const txnDate = new Date(txn.transactionDate);
        
        totalGross += gross;
        totalTax += tax;
        totalNet += net;
        
        if (txnDate >= startOfYear) {
          grossYTD += gross;
          netYTD += net;
        }
        if (txnDate >= startOfMonth) {
          grossThisMonth += gross;
          netThisMonth += net;
        }
        if (txnDate >= today) {
          grossToday += gross;
          netToday += net;
        }
        
        // Group by ticker
        if (!byTicker[txn.ticker]) {
          byTicker[txn.ticker] = {
            ticker: txn.ticker,
            companyName: txn.companyName,
            totalGross: 0,
            totalTax: 0,
            totalNet: 0,
            transactions: 0,
          };
        }
        byTicker[txn.ticker].totalGross += gross;
        byTicker[txn.ticker].totalTax += tax;
        byTicker[txn.ticker].totalNet += net;
        byTicker[txn.ticker].transactions += 1;
      }
      
      // Process TAX transactions (negative amounts - withholding tax)
      // TAX transactions are stored with shares=1 and pricePerShare=negative amount
      for (const txn of taxTransactions) {
        const shares = parseFloat(txn.shares);
        const pricePerShare = parseFloat(txn.pricePerShare);
        // taxAmount will be negative (e.g., 1 * -5.67 = -5.67)
        const taxAmount = shares * pricePerShare;
        const txnDate = new Date(txn.transactionDate);
        
        // Add to total tax (as positive value) and subtract from net
        totalTax += Math.abs(taxAmount);
        totalNet += taxAmount; // Adding negative = subtracting
        
        if (txnDate >= startOfYear) {
          netYTD += taxAmount;
        }
        if (txnDate >= startOfMonth) {
          netThisMonth += taxAmount;
        }
        if (txnDate >= today) {
          netToday += taxAmount;
        }
        
        // Group by ticker
        if (byTicker[txn.ticker]) {
          byTicker[txn.ticker].totalTax += Math.abs(taxAmount);
          byTicker[txn.ticker].totalNet += taxAmount;
        } else if (txn.ticker && txn.ticker !== 'TAX') {
          byTicker[txn.ticker] = {
            ticker: txn.ticker,
            companyName: txn.companyName,
            totalGross: 0,
            totalTax: Math.abs(taxAmount),
            totalNet: taxAmount,
            transactions: 0,
          };
        }
      }
      
      // Sort by total net dividend (highest first)
      const tickerSummary = Object.values(byTicker).sort((a, b) => b.totalNet - a.totalNet);
      
      res.json({
        totalGross,
        totalTax,
        totalNet,
        grossYTD,
        netYTD,
        grossThisMonth,
        netThisMonth,
        grossToday,
        netToday,
        byTicker: tickerSummary,
        transactionCount: dividendTransactions.length + taxTransactions.length,
      });
    } catch (error) {
      console.error("Error fetching dividends:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať dividendy." });
    }
  });

  // Get user settings
  app.get("/api/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const settings = await storage.getUserSettings(userId);
      
      res.json({
        preferredCurrency: settings?.preferredCurrency || "EUR",
      });
    } catch (error) {
      console.error("Error fetching user settings:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať nastavenia." });
    }
  });

  // Update user settings
  app.post("/api/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { preferredCurrency } = req.body ?? {};

      const settings = await storage.upsertUserSettings(userId, {
        preferredCurrency: preferredCurrency || "EUR",
      });

      res.json({
        preferredCurrency: settings.preferredCurrency || "EUR",
      });
    } catch (error) {
      console.error("Error updating user settings:", error);
      res.status(500).json({ message: "Nepodarilo sa uložiť nastavenia." });
    }
  });

  // Export transactions as CSV
  app.get("/api/transactions/export", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioId = req.query.portfolio as string | undefined;
      const transactions = await storage.getTransactionsByUser(userId, portfolioId);
      const portfolios = await storage.getPortfoliosByUser(userId);
      
      // Create portfolio ID to name map
      const portfolioMap = new Map(portfolios.map(p => [p.id, p.name]));
      
      // CSV header - includes ID, currency and portfolio columns
      const header = "id,typ,ticker,nazov,pocet,cena,mena,poplatok,datum,portfolio";
      
      // CSV rows
      const rows = transactions.map(t => {
        const date = new Date(t.transactionDate);
        const formattedDate = date.toISOString().slice(0, 16).replace("T", " ");
        const companyName = t.companyName.includes(",") ? `"${t.companyName}"` : t.companyName;
        const portfolioName = portfolioMap.get(t.portfolioId || "") || "Hlavné portfólio";
        const portfolioNameCsv = portfolioName.includes(",") ? `"${portfolioName}"` : portfolioName;
        const currency = t.currency || "EUR";
        return `${t.id},${t.type},${t.ticker},${companyName},${t.shares},${t.pricePerShare},${currency},${t.commission || "0"},${formattedDate},${portfolioNameCsv}`;
      });
      
      const csv = [header, ...rows].join("\n");
      
      const today = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="transakcie-${today}.csv"`);
      res.send("\uFEFF" + csv); // BOM for Excel UTF-8
    } catch (error) {
      console.error("Error exporting transactions:", error);
      res.status(500).json({ message: "Nepodarilo sa exportovať transakcie." });
    }
  });

  // Download import template
  app.get("/api/transactions/import-template", (req, res) => {
    const header = "id,typ,ticker,nazov,pocet,cena,mena,poplatok,datum,portfolio";
    const sampleRows = [
      'TXN-001,BUY,VWCE.DE,Vanguard FTSE All-World UCITS ETF,10,120.50,EUR,1.50,2024-01-15 10:30,Hlavné portfólio',
      'TXN-002,BUY,AAPL,Apple Inc.,5,175.25,USD,0,2024-02-20 14:00,Investičné',
      ',SELL,MSFT,Microsoft Corporation,3,410.00,USD,2.00,2024-03-10 09:15,Hlavné portfólio',
    ];
    
    const csv = [header, ...sampleRows].join("\n");
    
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="vzor-import.csv"');
    res.send("\uFEFF" + csv);
  });

  // Import transactions from CSV
  app.post("/api/transactions/import", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { csvData, portfolioId: defaultPortfolioId } = req.body;
      
      console.log(`[CSV Import] User: ${userId}, Portfolio: ${defaultPortfolioId}`);
      console.log(`[CSV Import] CSV data length: ${csvData?.length || 0} chars`);
      
      if (!csvData || typeof csvData !== "string") {
        console.log(`[CSV Import] ERROR: Missing CSV data`);
        return res.status(400).json({ message: "Chýbajú CSV dáta." });
      }
      
      const lines = csvData.trim().split("\n");
      if (lines.length < 2) {
        return res.status(400).json({ message: "CSV súbor je prázdny alebo chýba hlavička." });
      }
      
      // Get or create default portfolio
      const defaultPortfolio = await storage.ensureDefaultPortfolio(userId);
      const targetPortfolioId = defaultPortfolioId || defaultPortfolio.id;
      const portfolios = await storage.getPortfoliosByUser(userId);
      
      // Create a map of portfolio names to IDs (case-insensitive)
      const portfolioNameToId = new Map(portfolios.map(p => [p.name.toLowerCase(), p.id]));
      
      // Auto-detect delimiter from header line (comma or semicolon)
      const headerLine = lines[0];
      const semicolonCount = (headerLine.match(/;/g) || []).length;
      const commaCount = (headerLine.match(/,/g) || []).length;
      const delimiter = semicolonCount > commaCount ? ";" : ",";
      console.log(`CSV import: detected delimiter "${delimiter}" (semicolons: ${semicolonCount}, commas: ${commaCount})`);
      
      // Check if header contains ID, currency and portfolio columns
      const headerParts = headerLine.toLowerCase().split(delimiter).map(h => h.trim());
      const hasIdColumn = headerParts.includes("id");
      const hasCurrencyColumn = headerParts.includes("mena") || headerParts.includes("currency");
      const hasPortfolioColumn = headerParts.includes("portfolio") || headerParts.includes("portfólio");

      console.log(`[CSV Import] Header: ${headerLine}`);
      console.log(`[CSV Import] hasIdColumn=${hasIdColumn} hasCurrencyColumn=${hasCurrencyColumn} hasPortfolioColumn=${hasPortfolioColumn}`);

      // Skip header
      const dataLines = lines.slice(1);

      const imported: string[] = [];
      const errors: Array<{ row: number; ticker: string; reason: string }> = [];
      const createdPortfolios: string[] = [];
      let alreadyExisting = 0;

      // Build a per-portfolio index of existing transaction IDs so we can skip
      // true duplicates silently (same id re-imported into the same portfolio),
      // while still allowing the same id to exist in a different portfolio
      // (two separate brokerage accounts may accidentally share numeric IDs).
      // Globally-seen IDs are tracked separately so we can drop the customId on
      // cross-portfolio collisions and let the DB generate a fresh UUID instead
      // of raising a 23505 unique-key error.
      const existingIdsByPortfolio = new Map<string, Set<string>>();
      const globallyUsedIds = new Set<string>();
      if (hasIdColumn) {
        const existingTxns = await storage.getTransactionsByUser(userId);
        for (const t of existingTxns) {
          globallyUsedIds.add(t.id);
          const key = t.portfolioId ?? "__none__";
          let bucket = existingIdsByPortfolio.get(key);
          if (!bucket) {
            bucket = new Set<string>();
            existingIdsByPortfolio.set(key, bucket);
          }
          bucket.add(t.id);
        }
        console.log(
          `[CSV Import] Preloaded ${globallyUsedIds.size} existing transaction IDs across ${existingIdsByPortfolio.size} portfolios`
        );
      }
      
      for (let i = 0; i < dataLines.length; i++) {
        const line = dataLines[i].trim();
        if (!line) continue;
        
        try {
          // Parse CSV line (handle quoted values)
          const values: string[] = [];
          let current = "";
          let inQuotes = false;
          
          for (const char of line) {
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === delimiter && !inQuotes) {
              values.push(current.trim());
              current = "";
            } else {
              current += char;
            }
          }
          values.push(current.trim());
          
          // Calculate minimum columns based on which optional columns are present
          // Base: typ, ticker, nazov, pocet, cena, poplatok, datum = 7
          // +1 for ID, +1 for currency
          let minColumns = 7;
          if (hasIdColumn) minColumns++;
          if (hasCurrencyColumn) minColumns++;
          
          if (values.length < minColumns) {
            errors.push({ row: i + 2, ticker: values[hasIdColumn ? 2 : 1] || "?", reason: `Nedostatok stĺpcov (očakáva sa ${minColumns})` });
            continue;
          }
          
          // Extract fields based on which columns are present
          let idx = 0;
          const customId = hasIdColumn && values[idx].trim() ? values[idx].trim() : undefined;
          if (hasIdColumn) idx++;
          
          const type = values[idx++];
          const ticker = values[idx++];
          const companyName = values[idx++];
          const sharesStr = values[idx++];
          const priceStr = values[idx++];
          
          // Currency is optional - default to EUR if not present
          let currency = "EUR";
          if (hasCurrencyColumn) {
            const currencyVal = values[idx++]?.trim().toUpperCase();
            if (currencyVal && currencyVal.length === 3) {
              currency = currencyVal;
            }
          }
          
          const commissionStr = values[idx++];
          const dateStr = values[idx++];
          const portfolioNameFromCsv = values.length > idx ? values[idx] : null;
          
          // Validate type
          const upperType = type.toUpperCase();
          if (upperType !== "BUY" && upperType !== "SELL" && upperType !== "DIVIDEND") {
            errors.push({ row: i + 2, ticker, reason: `Neplatný typ transakcie: ${type} (povolené: BUY, SELL, DIVIDEND)` });
            continue;
          }
          
          // Validate ticker
          if (!ticker || ticker.length < 1) {
            errors.push({ row: i + 2, ticker: "?", reason: "Chýba ticker" });
            continue;
          }
          
          // Auto-fetch company name from Yahoo Finance if not provided
          let finalCompanyName = companyName;
          if (!finalCompanyName || finalCompanyName.trim() === "") {
            console.log(`Fetching company name from Yahoo Finance for ${ticker}...`);
            const yahooName = await fetchYahooCompanyName(ticker);
            if (yahooName) {
              console.log(`Got company name: ${yahooName}`);
              finalCompanyName = yahooName;
            } else {
              console.log(`Could not fetch company name for ${ticker}, leaving empty`);
              finalCompanyName = "";
            }
          }
          
          // Parse numbers (handle both comma and dot as decimal separator)
          const shares = parseFloat(sharesStr.replace(",", "."));
          const price = parseFloat(priceStr.replace(",", "."));
          const commission = parseFloat(commissionStr.replace(",", ".")) || 0;
          
          if (isNaN(shares) || shares <= 0) {
            errors.push({ row: i + 2, ticker, reason: `Neplatný počet akcií: ${sharesStr}` });
            continue;
          }
          
          // For DIVIDEND allow negative prices (withholding tax entries from brokers like XTB)
          if (isNaN(price) || price === 0 || (price < 0 && upperType !== "DIVIDEND")) {
            errors.push({ row: i + 2, ticker, reason: `Neplatná cena: ${priceStr}` });
            continue;
          }
          
          // Parse date - support multiple formats
          let transactionDate: Date;
          const trimmedDate = dateStr.trim();
          
          // Try European format first: DD.MM.YYYY HH:mm or DD.MM.YYYY
          const euDateMatch = trimmedDate.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
          if (euDateMatch) {
            const [, day, month, year, hour = "12", minute = "0"] = euDateMatch;
            transactionDate = new Date(
              parseInt(year), 
              parseInt(month) - 1, 
              parseInt(day), 
              parseInt(hour), 
              parseInt(minute)
            );
          } else {
            // Try ISO format: YYYY-MM-DD HH:mm or YYYY-MM-DD
            transactionDate = new Date(trimmedDate.replace(" ", "T"));
          }
          
          if (isNaN(transactionDate.getTime())) {
            errors.push({ row: i + 2, ticker, reason: `Neplatný dátum: ${dateStr} (použite formát DD.MM.YYYY alebo YYYY-MM-DD)` });
            continue;
          }
          
          // Determine portfolio ID for this transaction
          let txnPortfolioId = targetPortfolioId;
          if (portfolioNameFromCsv && portfolioNameFromCsv.trim()) {
            const lookupName = portfolioNameFromCsv.trim().toLowerCase();
            if (portfolioNameToId.has(lookupName)) {
              txnPortfolioId = portfolioNameToId.get(lookupName)!;
            } else {
              // Create new portfolio if it doesn't exist
              const newPortfolio = await storage.createPortfolio({
                userId,
                name: portfolioNameFromCsv.trim(),
                isDefault: false,
              });
              portfolioNameToId.set(lookupName, newPortfolio.id);
              txnPortfolioId = newPortfolio.id;
              createdPortfolios.push(newPortfolio.name);
            }
          }
          
          // Create transaction with custom ID if provided
          const transactionData: any = {
            userId,
            portfolioId: txnPortfolioId,
            type: upperType,
            ticker: ticker.toUpperCase(),
            companyName: finalCompanyName,
            shares: shares.toFixed(8),
            pricePerShare: price.toFixed(4),
            commission: commission.toFixed(4),
            currency: currency,
            transactionDate,
          };
          
          // Duplicate detection is scoped to the TARGET portfolio only: if the
          // same id is already present in this portfolio we treat it as a true
          // re-import and skip it silently. If the id exists in a different
          // portfolio (e.g. two brokers handing out the same numeric position
          // IDs), we drop the customId and let the DB generate a fresh UUID so
          // the row still lands – this is what the user almost always wants
          // when they explicitly pick a new portfolio as the import target.
          if (customId) {
            const portfolioKey = txnPortfolioId ?? "__none__";
            const portfolioBucket = existingIdsByPortfolio.get(portfolioKey);
            if (portfolioBucket?.has(customId)) {
              alreadyExisting++;
              continue;
            }
            if (globallyUsedIds.has(customId)) {
              // Another portfolio already owns this id; import anyway with a
              // generated UUID to avoid a 23505 unique-key rejection.
            } else {
              transactionData.id = customId;
            }
          }

          let transaction;
          try {
            transaction = await storage.createTransaction(transactionData);
          } catch (insertErr: any) {
            const msg = String(insertErr?.message || "");
            if (msg.includes("duplicate key") || insertErr?.code === "23505") {
              // Shouldn't normally happen thanks to the checks above, but keep
              // the safety net: retry once with a DB-generated id.
              try {
                delete transactionData.id;
                transaction = await storage.createTransaction(transactionData);
              } catch (retryErr) {
                alreadyExisting++;
                continue;
              }
            } else {
              throw insertErr;
            }
          }
          // Track the id we just wrote so subsequent rows in this batch see it.
          if (transaction?.id) {
            globallyUsedIds.add(transaction.id);
            const portfolioKey = txnPortfolioId ?? "__none__";
            let bucket = existingIdsByPortfolio.get(portfolioKey);
            if (!bucket) {
              bucket = new Set<string>();
              existingIdsByPortfolio.set(portfolioKey, bucket);
            }
            bucket.add(transaction.id);
          }
          
          // Update holdings (skip if this is a DIVIDEND transaction)
          if (upperType !== "DIVIDEND") {
            const allTransactions = await storage.getTransactionsByUserAndTicker(userId, ticker.toUpperCase(), txnPortfolioId);
            let totalShares = 0;
            let totalInvested = 0;
            
            for (const txn of allTransactions) {
              if (txn.type === "DIVIDEND") continue;
              const s = parseFloat(txn.shares);
              const p = parseFloat(txn.pricePerShare);
              const c = parseFloat(txn.commission || "0");
              
              if (txn.type === "BUY") {
                totalShares += s;
                totalInvested += s * p + c;
              } else if (txn.type === "SELL") {
                totalShares -= s;
                totalInvested -= s * p + c;
              }
            }
          
            if (totalShares > 0.00000001) {
              const avgCost = totalInvested / totalShares;
              await storage.upsertHolding(
                userId,
                ticker.toUpperCase(),
                finalCompanyName,
                totalShares.toFixed(8),
                avgCost.toFixed(4),
                totalInvested.toFixed(4),
                txnPortfolioId
              );
            } else {
              await storage.deleteHolding(userId, ticker.toUpperCase(), txnPortfolioId);
            }
          }
          
          imported.push(ticker.toUpperCase());
        } catch (err: any) {
          errors.push({ row: i + 2, ticker: "?", reason: err.message || "Neznáma chyba" });
        }
      }
      
      console.log(`[CSV Import] FINISHED: Imported ${imported.length}, Already existing ${alreadyExisting}, Errors ${errors.length}`);
      if (errors.length > 0) {
        console.log(`[CSV Import] Errors:`, JSON.stringify(errors));
      }

      if (imported.length > 0) {
        invalidatePerformanceCache(userId);
      }

      res.json({
        imported: imported.length,
        skipped: errors.length,
        alreadyExisting,
        importedTickers: Array.from(new Set(imported)),
        createdPortfolios: Array.from(new Set(createdPortfolios)),
        errors,
      });
    } catch (error) {
      console.error("[CSV Import] CRITICAL ERROR:", error);
      res.status(500).json({ message: "Nepodarilo sa importovať transakcie." });
    }
  });

  // ============== OPTION TRADES API ==============
  
  // Get all option trades
  app.get("/api/options", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioId = req.query.portfolio as string | undefined;
      const trades = await storage.getOptionTradesByUser(userId, portfolioId);
      res.json(trades);
    } catch (error) {
      console.error("Error fetching option trades:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať opčné obchody." });
    }
  });

  // Get options statistics - MUST be before /:id route
  app.get("/api/options/stats/summary", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioId = req.query.portfolio as string | undefined;
      const trades = await storage.getOptionTradesByUser(userId, portfolioId);
      
      const openTrades = trades.filter(t => t.status === "OPEN");
      const closedTrades = trades.filter(t => t.status !== "OPEN");
      
      const winningTrades = closedTrades.filter(t => parseFloat(t.realizedGain || "0") > 0);
      const losingTrades = closedTrades.filter(t => parseFloat(t.realizedGain || "0") < 0);
      
      const totalRealizedGain = closedTrades.reduce((sum, t) => sum + parseFloat(t.realizedGain || "0"), 0);
      const totalWins = winningTrades.reduce((sum, t) => sum + parseFloat(t.realizedGain || "0"), 0);
      const totalLosses = losingTrades.reduce((sum, t) => sum + parseFloat(t.realizedGain || "0"), 0);
      
      const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;
      const avgWin = winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
      const avgLoss = losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;
      
      res.json({
        totalTrades: trades.length,
        openTrades: openTrades.length,
        closedTrades: closedTrades.length,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        winRate: winRate.toFixed(1),
        totalRealizedGain: totalRealizedGain.toFixed(2),
        totalWins: totalWins.toFixed(2),
        totalLosses: totalLosses.toFixed(2),
        avgWin: avgWin.toFixed(2),
        avgLoss: avgLoss.toFixed(2),
      });
    } catch (error) {
      console.error("Error fetching options stats:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať štatistiky opcií." });
    }
  });

  // Get option trade by ID
  app.get("/api/options/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const trade = await storage.getOptionTradeById(req.params.id, userId);
      if (!trade) {
        return res.status(404).json({ message: "Opčný obchod nebol nájdený." });
      }
      res.json(trade);
    } catch (error) {
      console.error("Error fetching option trade:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať opčný obchod." });
    }
  });

  // Create new option trade
  app.post("/api/options", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const parseResult = insertOptionTradeSchema.safeParse({
        ...req.body,
        userId,
      });

      if (!parseResult.success) {
        return res.status(400).json({ 
          message: "Neplatné údaje.", 
          errors: parseResult.error.flatten() 
        });
      }

      // Calculate initial realized gain for SELL options (premium received)
      let realizedGain = "0";
      const { direction, premium, contracts, commission } = parseResult.data;
      const premiumNum = parseFloat(premium);
      const contractsNum = parseFloat(contracts);
      const commissionNum = parseFloat(commission || "0");
      
      // For SELL (writing options), premium is income
      // For BUY, premium is cost (negative impact on P/L)
      if (direction === "SELL") {
        // Premium received per share * 100 shares per contract * number of contracts - commission
        realizedGain = ((premiumNum * 100 * contractsNum) - commissionNum).toFixed(4);
      }

      const trade = await storage.createOptionTrade({
        ...parseResult.data,
        realizedGain,
      });

      res.status(201).json(trade);
    } catch (error) {
      console.error("Error creating option trade:", error);
      res.status(500).json({ message: "Nepodarilo sa vytvoriť opčný obchod." });
    }
  });

  // Update option trade (close position)
  app.patch("/api/options/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const tradeId = req.params.id;
      
      const existingTrade = await storage.getOptionTradeById(tradeId, userId);
      if (!existingTrade) {
        return res.status(404).json({ message: "Opčný obchod nebol nájdený." });
      }

      const rawData = req.body;
      
      // Clean update data - remove empty strings
      const updateData: any = {};
      for (const key of Object.keys(rawData)) {
        if (rawData[key] !== "" && rawData[key] !== undefined) {
          updateData[key] = rawData[key];
        }
      }
      
      // Convert date string fields to Date objects
      const dateFields = ['openDate', 'expirationDate', 'closeDate'];
      for (const field of dateFields) {
        if (updateData[field] && typeof updateData[field] === 'string') {
          updateData[field] = new Date(updateData[field]);
        }
      }
      
      // If closing the trade, calculate final realized gain
      if (updateData.status && updateData.status !== "OPEN" && existingTrade.status === "OPEN") {
        const openPremium = parseFloat(existingTrade.premium);
        const contracts = parseFloat(existingTrade.contracts);
        const openCommission = parseFloat(existingTrade.commission || "0");
        const closePremium = parseFloat(updateData.closePremium || "0");
        const closeCommission = parseFloat(updateData.closeCommission || "0");
        const direction = existingTrade.direction;
        
        let realizedGain = 0;
        
        if (updateData.status === "EXPIRED") {
          // Option expired worthless - no close premium/commission needed
          delete updateData.closePremium;
          delete updateData.closeCommission;
          if (direction === "SELL") {
            // Seller keeps the full premium
            realizedGain = (openPremium * 100 * contracts) - openCommission;
          } else {
            // Buyer loses the full premium
            realizedGain = -(openPremium * 100 * contracts) - openCommission;
          }
        } else if (updateData.status === "CLOSED") {
          // Option was closed before expiration
          if (direction === "SELL") {
            // Seller: received open premium, paid close premium
            realizedGain = ((openPremium - closePremium) * 100 * contracts) - openCommission - closeCommission;
          } else {
            // Buyer: paid open premium, received close premium
            realizedGain = ((closePremium - openPremium) * 100 * contracts) - openCommission - closeCommission;
          }
        } else if (updateData.status === "ASSIGNED") {
          // Option was assigned - this would typically create a stock transaction
          // For now, just calculate premium P/L
          delete updateData.closePremium;
          delete updateData.closeCommission;
          if (direction === "SELL") {
            realizedGain = (openPremium * 100 * contracts) - openCommission;
          } else {
            realizedGain = -(openPremium * 100 * contracts) - openCommission;
          }
        }
        
        updateData.realizedGain = realizedGain.toFixed(4);
        // Set closeDate if not provided
        if (!updateData.closeDate) {
          updateData.closeDate = new Date();
        }
      }

      const trade = await storage.updateOptionTrade(tradeId, userId, updateData);
      res.json(trade);
    } catch (error) {
      console.error("Error updating option trade:", error);
      res.status(500).json({ message: "Nepodarilo sa aktualizovať opčný obchod." });
    }
  });

  // Delete option trade
  app.delete("/api/options/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const tradeId = req.params.id;
      
      const existingTrade = await storage.getOptionTradeById(tradeId, userId);
      if (!existingTrade) {
        return res.status(404).json({ message: "Opčný obchod nebol nájdený." });
      }

      await storage.deleteOptionTrade(tradeId, userId);
      res.json({ message: "Opčný obchod bol vymazaný." });
    } catch (error) {
      console.error("Error deleting option trade:", error);
      res.status(500).json({ message: "Nepodarilo sa vymazať opčný obchod." });
    }
  });

  // Export options to CSV
  app.get("/api/options/export", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolioId = req.query.portfolio as string | undefined;
      
      const trades = await storage.getOptionTradesByUser(userId, portfolioId);
      
      const csvHeader = "underlying,optionType,direction,strikePrice,expirationDate,contracts,premium,commission,status,openDate,closeDate,closePremium,closeCommission,realizedGain,notes";
      const csvRows = trades.map(trade => {
        const formatDate = (date: Date | null) => date ? new Date(date).toISOString().split('T')[0] : "";
        return [
          trade.underlying,
          trade.optionType,
          trade.direction,
          trade.strikePrice,
          formatDate(trade.expirationDate),
          trade.contracts,
          trade.premium,
          trade.commission || "0",
          trade.status,
          formatDate(trade.openDate),
          formatDate(trade.closeDate),
          trade.closePremium || "",
          trade.closeCommission || "",
          trade.realizedGain || "0",
          (trade.notes || "").replace(/,/g, ";").replace(/\n/g, " "),
        ].join(",");
      });
      
      const csv = [csvHeader, ...csvRows].join("\n");
      
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=options-export.csv");
      res.send(csv);
    } catch (error) {
      console.error("Error exporting options:", error);
      res.status(500).json({ message: "Nepodarilo sa exportovať opčné obchody." });
    }
  });

  // Get sample CSV template
  app.get("/api/options/template", (req, res) => {
    const csvHeader = "underlying,optionType,direction,strikePrice,expirationDate,contracts,premium,commission,status,openDate,closeDate,closePremium,closeCommission,realizedGain,notes";
    const sampleRows = [
      "SOFI,CALL,SELL,10,2025-04-17,1,0.50,1.30,CLOSED,2024-10-15,2025-01-15,0.10,1.30,38.40,Uzatvorene pred expiraciou",
      "SOFI,PUT,BUY,11,2025-06-20,2,1.20,2.60,OPEN,2025-01-10,,,,,Ochranna put opcia",
      "NU,PUT,SELL,13.5,2025-08-29,1,0.85,1.30,OPEN,2024-11-01,,,,,Cash secured put",
      "PYPL,CALL,BUY,105,2026-06-18,1,3.50,1.30,OPEN,2025-01-05,,,,,LEAPS call",
      "WBD,CALL,SELL,10,2026-03-20,3,0.75,3.90,CLOSED,2024-06-01,2025-01-10,0.20,3.90,161.20,Covered call",
    ];
    
    const csv = [csvHeader, ...sampleRows].join("\n");
    
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=options-template.csv");
    res.send(csv);
  });

  // Import options from CSV
  app.post("/api/options/import", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { trades, portfolioId } = req.body;
      
      if (!Array.isArray(trades) || trades.length === 0) {
        return res.status(400).json({ message: "Neplatné dáta pre import." });
      }

      const imported: any[] = [];
      const errors: string[] = [];

      for (let i = 0; i < trades.length; i++) {
        const row = trades[i];
        try {
          const tradeData = {
            userId,
            portfolioId: portfolioId || null,
            underlying: row.underlying?.toUpperCase() || "",
            optionType: row.optionType?.toUpperCase() || "CALL",
            direction: row.direction?.toUpperCase() || "SELL",
            strikePrice: row.strikePrice?.toString() || "0",
            expirationDate: new Date(row.expirationDate),
            contracts: row.contracts?.toString() || "1",
            premium: row.premium?.toString() || "0",
            commission: row.commission?.toString() || "0",
            status: row.status?.toUpperCase() || "OPEN",
            openDate: row.openDate ? new Date(row.openDate) : new Date(),
            closeDate: row.closeDate ? new Date(row.closeDate) : null,
            closePremium: row.closePremium?.toString() || null,
            closeCommission: row.closeCommission?.toString() || null,
            realizedGain: row.realizedGain?.toString() || "0",
            notes: row.notes || null,
          };

          const parseResult = insertOptionTradeSchema.safeParse(tradeData);
          if (!parseResult.success) {
            errors.push(`Riadok ${i + 1}: ${parseResult.error.message}`);
            continue;
          }

          const trade = await storage.createOptionTrade(parseResult.data);
          imported.push(trade);
        } catch (err: any) {
          errors.push(`Riadok ${i + 1}: ${err.message}`);
        }
      }

      res.json({
        imported: imported.length,
        errors: errors.length > 0 ? errors : undefined,
        message: `Importovaných ${imported.length} z ${trades.length} obchodov.`,
      });
    } catch (error) {
      console.error("Error importing options:", error);
      res.status(500).json({ message: "Nepodarilo sa importovať opčné obchody." });
    }
  });

  // ============================================
  // XTB IMPORT ENDPOINTS
  // ============================================

  // Parse XTB file (preview without saving)
  app.post("/api/import/xtb/parse", isAuthenticated, upload.single('file'), async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "Nebol nahraný žiadny súbor." });
      }

      const result = await parseXTBFile(req.file.buffer, req.file.originalname);
      res.json(result);
    } catch (error) {
      console.error("Error parsing XTB file:", error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : "Nepodarilo sa spracovať súbor." 
      });
    }
  });

  // Import parsed XTB transactions to database
  app.post("/api/import/xtb/save", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { transactions, portfolioId } = req.body;
      
      if (!Array.isArray(transactions) || transactions.length === 0) {
        return res.status(400).json({ message: "Žiadne transakcie na uloženie." });
      }

      // Always resolve to a real portfolio ID. If the client sent null (the
      // "default" option in the import UI), use the user's default portfolio.
      // Without this, transactions/holdings land with portfolio_id = NULL and
      // are only visible under "All portfolios" — never under a specific one.
      const defaultPortfolio = await storage.ensureDefaultPortfolio(userId);
      const targetPortfolioId: string = portfolioId || defaultPortfolio.id;

      const imported: any[] = [];
      const errors: string[] = [];
      let skippedDuplicates = 0;

      const existingInPortfolio = await storage.getTransactionsByUser(
        userId,
        targetPortfolioId
      );
      const existingExternalIds = new Set(
        existingInPortfolio
          .map((t) => t.externalId)
          .filter((id): id is string => typeof id === "string" && id.trim() !== ""),
      );
      const existingTransactionIds = new Set(
        existingInPortfolio
          .map((t) => t.transactionId)
          .filter((id): id is string => typeof id === "string" && id.trim() !== ""),
      );

      // Cache company names to avoid repeated API calls
      const companyNameCache: Record<string, string> = {};

      const sortedTransactions = [...transactions].sort(
        (a: { date: string | Date }, b: { date: string | Date }) =>
          new Date(a.date).getTime() - new Date(b.date).getTime(),
      );

      /** Upper ticker → company name — full holding replay after batch */
      const tickersNeedingHoldingsSync = new Map<string, string>();

      for (let i = 0; i < sortedTransactions.length; i++) {
        const tx = sortedTransactions[i];
        try {
          // Skip TAX entries without a proper ticker
          if (tx.type === 'TAX' && (!tx.ticker || tx.ticker === 'TAX')) {
            continue;
          }

          const isCashFlow = tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL";
          const rawTicker =
            typeof tx.ticker === "string" ? tx.ticker.trim() : "";
          const effectiveTicker = rawTicker
            ? rawTicker
            : isCashFlow
              ? CASH_FLOW_TICKER
              : "";

          if (!effectiveTicker) {
            errors.push(
              `Riadok ${i + 1} (ID: ${tx.externalId || "N/A"}): Chýba ticker`,
            );
            continue;
          }

          const extId =
            typeof tx.externalId === "string" ? tx.externalId.trim() : "";
          const txIdRaw =
            typeof tx.transactionId === "string"
              ? tx.transactionId.trim()
              : "";
          const txId = txIdRaw || extId;
          if (txId && existingTransactionIds.has(txId)) {
            skippedDuplicates++;
            continue;
          }
          if (extId && existingExternalIds.has(extId)) {
            skippedDuplicates++;
            continue;
          }

          const tickerUpper = effectiveTicker.toUpperCase();
          const cashCustomName =
            isCashFlow && typeof (tx as { companyName?: string }).companyName === "string"
              ? (tx as { companyName?: string }).companyName!.trim()
              : "";

          let companyName: string;
          if (tickerUpper === CASH_FLOW_TICKER && cashCustomName !== "") {
            companyName = cashCustomName;
          } else {
            let resolved = companyNameCache[tickerUpper] ?? "";
            if (!resolved) {
              if (tickerUpper === CASH_FLOW_TICKER) {
                resolved =
                  tx.type === "DEPOSIT"
                    ? "Vklad"
                    : tx.type === "WITHDRAWAL"
                      ? "Výber"
                      : CASH_FLOW_TICKER;
              } else if (tickerUpper === "CASH_INTEREST") {
                resolved =
                  tx.type === "TAX"
                    ? "Daň z úroku voľných prostriedkov"
                    : "Úrok z voľných prostriedkov";
              } else {
                resolved = effectiveTicker;
                try {
                  const searchResponse = await fetch(
                    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(effectiveTicker)}&quotesCount=1`,
                  );
                  if (searchResponse.ok) {
                    const searchData = await searchResponse.json();
                    if (searchData.quotes && searchData.quotes.length > 0) {
                      resolved =
                        searchData.quotes[0].shortname ||
                        searchData.quotes[0].longname ||
                        effectiveTicker;
                    }
                  }
                } catch {
                  /* keep ticker */
                }
              }
              companyNameCache[tickerUpper] = resolved;
            }
            companyName = resolved;
          }

          // Calculate shares and price based on transaction type
          let shares: string;
          let pricePerShare: string;

          if (tx.type === "BUY" || tx.type === "SELL") {
            shares = tx.quantity.toString();
            pricePerShare = tx.priceEur.toString();
          } else {
            // DIVIDEND / TAX / DEPOSIT / WITHDRAWAL: shares=1, pricePerShare = hotovostná suma (môže byť záporná)
            shares = "1";
            pricePerShare = tx.totalAmountEur.toString();
          }

          const ptx = tx as {
            originalCurrency?: string;
            exchangeRateAtTransaction?: number;
            baseCurrencyAmount?: number;
            quantity?: number;
            priceEur?: number;
            totalAmountEur?: number;
          };
          const origCur =
            typeof ptx.originalCurrency === "string" &&
            ptx.originalCurrency.trim() !== ""
              ? ptx.originalCurrency.trim().toUpperCase()
              : "EUR";

          const exNum = ptx.exchangeRateAtTransaction;
          const exRate =
            typeof exNum === "number" && Number.isFinite(exNum) && exNum > 0
              ? exNum
              : 1;

          let baseNum = ptx.baseCurrencyAmount;
          if (typeof baseNum !== "number" || !Number.isFinite(baseNum)) {
            if (tx.type === "BUY" || tx.type === "SELL") {
              const q = Number(tx.quantity);
              const p = Number((tx as { priceEur?: number }).priceEur);
              baseNum = Number.isFinite(q) && Number.isFinite(p) ? q * p : 0;
            } else {
              const t = Number((tx as { totalAmountEur?: number }).totalAmountEur);
              baseNum = Number.isFinite(t) ? t : 0;
            }
          }

          const payload: InsertTransaction = {
            userId,
            portfolioId: targetPortfolioId,
            type: tx.type,
            ticker: tickerUpper,
            companyName,
            shares,
            pricePerShare,
            commission: "0",
            externalId: extId || null,
            transactionDate: new Date(tx.date),
            originalCurrency: origCur,
            currency: origCur,
            exchangeRateAtTransaction: exRate.toFixed(8),
            baseCurrencyAmount: baseNum.toFixed(4),
            ...(txId ? { transactionId: txId } : {}),
          };

          const parseResult = insertTransactionSchema.safeParse(payload);
          if (!parseResult.success) {
            const issue = parseResult.error.issues[0];
            const detail = issue
              ? `${issue.path.join(".")}: ${issue.message}`
              : parseResult.error.message;
            errors.push(
              `${tickerUpper} (${tx.type}) [ID: ${tx.externalId || "N/A"}]: ${detail}`,
            );
            continue;
          }

          const transaction = await storage.createTransaction(parseResult.data);
          imported.push(transaction);
          if (extId) existingExternalIds.add(extId);
          if (txId) existingTransactionIds.add(txId);

          if (tx.type === "BUY" || tx.type === "SELL") {
            tickersNeedingHoldingsSync.set(tickerUpper, companyName);
          }
        } catch (err: unknown) {
          const mapped = responseForDbUniqueViolation(err);
          const msg = mapped
            ? mapped.message
            : err instanceof Error
              ? err.message
              : String(err);
          errors.push(
            `${(typeof tx.ticker === "string" && tx.ticker.trim()) || "?"} [ID: ${tx.externalId || "N/A"}]: ${msg}`,
          );
        }
      }

      const syncErrors: string[] = [];
      for (const [tickerU, cn] of Array.from(
        tickersNeedingHoldingsSync.entries(),
      )) {
        try {
          await syncHoldingFromTradeTransactions(
            userId,
            targetPortfolioId,
            tickerU,
            cn,
          );
        } catch (syncErr: unknown) {
          const msg =
            syncErr instanceof Error
              ? syncErr.message
              : typeof syncErr === "string"
                ? syncErr
                : "Neznáma chyba";
          console.error(
            "Error syncing holding after XTB import",
            { userId, ticker: tickerU },
            syncErr,
          );
          syncErrors.push(`${tickerU}: ${msg}`);
        }
      }

      const allErrors = [...errors, ...syncErrors];

      if (imported.length > 0) {
        invalidatePerformanceCache(userId);
      }

      const dupMsg =
        skippedDuplicates > 0
          ? ` Preskočených ${skippedDuplicates} už importovaných riadkov (rovnaké XTB ID v tomto portfóliu).`
          : "";
      const syncWarn =
        syncErrors.length > 0
          ? ` Upozornenie: ${syncErrors.length} chýb pri prepočte podielov.`
          : "";

      res.json({
        imported: imported.length,
        skippedDuplicates,
        errors: allErrors.length > 0 ? allErrors : undefined,
        message: `Importovaných ${imported.length} transakcií.${dupMsg}${syncWarn}`,
      });
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Neznáma chyba";
      const safeDetail =
        detail.length > 1200 ? `${detail.slice(0, 1200)}…` : detail;
      console.error("Error saving XTB transactions:", error);
      const columnHint = /column|does not exist|42703|42P01/i.test(safeDetail)
        ? " Skontroluj, či na serveri s databázou beží `npm run db:push` (schéma musí zodpovedať kódu)."
        : "";
      res.status(500).json({
        message: `Nepodarilo sa uložiť transakcie. ${safeDetail}${columnHint}`.trim(),
      });
    }
  });

  // Nočný snapshot job (pracovné dni po close USA).
  const snapshotCronEnabled = process.env.SNAPSHOT_CRON_ENABLED !== "false";
  const snapshotCronMinute = Number.parseInt(process.env.SNAPSHOT_CRON_MINUTE || "0", 10);
  let snapshotCronLastRunIso: string | null = null;

  async function runNightlySnapshotBackfillForAllUsers(): Promise<void> {
    const userRows = await db.select({ id: users.id }).from(users);
    for (const u of userRows) {
      try {
        await backfillPortfolioSnapshotsForScope(u.id, "all");
      } catch (err) {
        console.error("Nightly snapshot backfill failed for user", u.id, err);
      }
    }
  }

  if (snapshotCronEnabled) {
    setInterval(() => {
      const now = new Date();
      const day = now.getDay(); // 0 Sun, 6 Sat
      if (day === 0 || day === 6) return;
      const h = now.getHours();
      const m = now.getMinutes();
      const todayIso = now.toISOString().slice(0, 10);
      if (h !== 23 || m < snapshotCronMinute || m >= snapshotCronMinute + 10) return;
      if (snapshotCronLastRunIso === todayIso) return;
      snapshotCronLastRunIso = todayIso;
      runNightlySnapshotBackfillForAllUsers().catch((err) => {
        console.error("Nightly snapshot backfill failed:", err);
      });
    }, 5 * 60 * 1000);
  }

  return httpServer;
}
