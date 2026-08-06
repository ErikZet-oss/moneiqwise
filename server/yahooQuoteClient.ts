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
  "trailingPE",
  "forwardPE",
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
  const baselineClose =
    Number.isFinite(previousClose) && previousClose > 0
      ? previousClose
      : Number.isFinite(rthPrice) && rthPrice > 0
        ? rthPrice
        : 0;

  const withChange = (
    price: number,
    providedCh: number | null,
    providedPct: number | null,
    baseline: number,
  ) => {
    if (providedCh != null && providedPct != null) {
      return { preMarketChange: providedCh, preMarketChangePercent: providedPct };
    }
    if (baseline > 0) {
      const ch = price - baseline;
      return { preMarketChange: ch, preMarketChangePercent: (ch / baseline) * 100 };
    }
    return { preMarketChange: providedCh, preMarketChangePercent: providedPct };
  };

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
      ...withChange(prePrice, preCh, preChPct, baselineClose),
      marketState: marketStateRaw === "PREPRE" ? "PRE" : marketState,
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
    const postBaseline = rthPrice > 0 ? rthPrice : baselineClose;
    return {
      preMarketPrice: postPrice,
      ...withChange(postPrice, postCh, postChPct, postBaseline),
      marketState,
    };
  }

  const overnightPrice = num(q.overnightMarketPrice);
  const overnightCh = num(q.overnightMarketChange);
  const overnightChPct = num(q.overnightMarketChangePercent);
  /**
   * Yahoo často drží počas PRE len overnight/BOATS cenu a `preMarketPrice` ešte nie je.
   * Starší fix overnight v PRE úplne vynechal → žiadne predobchodné % na dashboarde.
   * Preferuj skutočný preMarket; inak použi overnight ako extended počas PRE.
   */
  if (
    overnightPrice != null &&
    overnightPrice > 0 &&
    marketStateRaw !== "POST" &&
    marketStateRaw !== "POSTPOST" &&
    marketStateRaw !== "REGULAR"
  ) {
    const keepPreLabel = marketStateRaw === "PRE" || marketStateRaw === "PREPRE";
    return {
      preMarketPrice: overnightPrice,
      ...withChange(overnightPrice, overnightCh, overnightChPct, baselineClose),
      marketState: keepPreLabel
        ? "PRE"
        : marketStateRaw === "OVERNIGHT" || marketStateRaw === "PREPRE"
          ? "OVERNIGHT"
          : marketState,
    };
  }

  const extPrice = num(q.extendedMarketPrice);
  const extCh = num(q.extendedMarketChange);
  const extChPct = num(q.extendedMarketChangePercent);
  if (extPrice != null && extPrice > 0) {
    const baseline =
      marketStateRaw === "POST" || marketStateRaw === "POSTPOST" ? rthPrice : baselineClose;
    return {
      preMarketPrice: extPrice,
      ...withChange(extPrice, extCh, extChPct, baseline > 0 ? baseline : baselineClose),
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
