import YahooFinance from "yahoo-finance2";

let yahooFinance: InstanceType<typeof YahooFinance> | null = null;

function getYahooFinance(): InstanceType<typeof YahooFinance> {
  if (!yahooFinance) {
    yahooFinance = new YahooFinance({
      suppressNotices: ["yahooSurvey"],
    });
  }
  return yahooFinance;
}

const V7_QUOTE_FIELDS = [
  "regularMarketPrice",
  "regularMarketPreviousClose",
  "regularMarketChange",
  "regularMarketChangePercent",
  "regularMarketTime",
  "fiftyTwoWeekHigh",
  "fiftyTwoWeekLow",
  "trailingAnnualDividendRate",
  "dividendRate",
  "marketState",
  "exchangeTimezoneName",
  "overnightMarketPrice",
  "overnightMarketChange",
  "overnightMarketChangePercent",
  "overnightMarketTime",
  "preMarketPrice",
  "preMarketChange",
  "preMarketChangePercent",
  "preMarketTime",
  "postMarketPrice",
  "postMarketChange",
  "postMarketChangePercent",
  "postMarketTime",
  "extendedMarketPrice",
  "extendedMarketChange",
  "extendedMarketChangePercent",
].join(",");

export type YahooV7QuoteRow = Record<string, unknown>;

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** v7/quote with overnightPrice=true (BOATS) — requires Yahoo crumb/cookies. */
export async function fetchYahooV7Quote(yahooTicker: string): Promise<YahooV7QuoteRow | null> {
  try {
    const yf = getYahooFinance();
    const url = "https://query1.finance.yahoo.com/v7/finance/quote";
    const params = {
      symbols: yahooTicker,
      fields: V7_QUOTE_FIELDS,
      formatted: "false",
      enablePrivateCompany: "true",
      overnightPrice: "true",
      lang: "en-US",
      region: "US",
    };
    const data = (await yf._fetch(url, params, {}, "json", true)) as {
      quoteResponse?: { result?: YahooV7QuoteRow[] };
    };
    const row = data?.quoteResponse?.result?.[0];
    if (!row || row.quoteType === "NONE") {
      console.warn(`Yahoo v7 quote empty for ${yahooTicker}`);
      return null;
    }
    const price = num(row.regularMarketPrice);
    if (price == null || price <= 0) return null;
    return row;
  } catch (error) {
    console.warn(`Yahoo v7 quote failed for ${yahooTicker}:`, error);
    return null;
  }
}

export function mapExtendedQuoteFromYahooV7(
  q: YahooV7QuoteRow,
  rthPrice: number,
  previousClose: number,
): {
  preMarketPrice: number | null;
  preMarketChange: number | null;
  preMarketChangePercent: number | null;
  marketState: string | null;
} {
  const marketStateRaw = String(q.marketState ?? "").toUpperCase();
  const marketState = marketStateRaw || null;

  const overnightPrice = num(q.overnightMarketPrice);
  const overnightCh = num(q.overnightMarketChange);
  const overnightChPct = num(q.overnightMarketChangePercent);
  if (overnightPrice != null && overnightPrice > 0) {
    if (
      marketStateRaw === "OVERNIGHT" ||
      marketStateRaw === "PREPRE" ||
      overnightChPct != null ||
      overnightCh != null
    ) {
      return {
        preMarketPrice: overnightPrice,
        preMarketChange: overnightCh ?? (rthPrice > 0 ? overnightPrice - rthPrice : null),
        preMarketChangePercent:
          overnightChPct ?? (rthPrice > 0 ? ((overnightPrice - rthPrice) / rthPrice) * 100 : null),
        marketState:
          marketStateRaw === "PREPRE" || marketStateRaw === "OVERNIGHT"
            ? "OVERNIGHT"
            : marketState,
      };
    }
  }

  const prePrice = num(q.preMarketPrice);
  const preCh = num(q.preMarketChange);
  const preChPct = num(q.preMarketChangePercent);
  if (
    prePrice != null &&
    prePrice > 0 &&
    (marketStateRaw === "PRE" || marketStateRaw === "PREPRE")
  ) {
    return {
      preMarketPrice: prePrice,
      preMarketChange: preCh ?? (previousClose > 0 ? prePrice - previousClose : null),
      preMarketChangePercent:
        preChPct ?? (previousClose > 0 ? ((prePrice - previousClose) / previousClose) * 100 : null),
      marketState,
    };
  }

  const postPrice = num(q.postMarketPrice);
  const postCh = num(q.postMarketChange);
  const postChPct = num(q.postMarketChangePercent);
  if (
    postPrice != null &&
    postPrice > 0 &&
    (marketStateRaw === "POST" || marketStateRaw === "POSTPOST")
  ) {
    return {
      preMarketPrice: postPrice,
      preMarketChange: postCh ?? (rthPrice > 0 ? postPrice - rthPrice : null),
      preMarketChangePercent:
        postChPct ?? (rthPrice > 0 ? ((postPrice - rthPrice) / rthPrice) * 100 : null),
      marketState,
    };
  }

  const extPrice = num(q.extendedMarketPrice);
  const extCh = num(q.extendedMarketChange);
  const extChPct = num(q.extendedMarketChangePercent);
  if (extPrice != null && extPrice > 0) {
    const baseline =
      marketStateRaw === "POST" || marketStateRaw === "POSTPOST" ? rthPrice : previousClose;
    return {
      preMarketPrice: extPrice,
      preMarketChange: extCh ?? (baseline > 0 ? extPrice - baseline : null),
      preMarketChangePercent:
        extChPct ?? (baseline > 0 ? ((extPrice - baseline) / baseline) * 100 : null),
      marketState,
    };
  }

  return {
    preMarketPrice: null,
    preMarketChange: null,
    preMarketChangePercent: null,
    marketState,
  };
}
