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

export type YahooChartIntraday = {
  meta: Record<string, unknown>;
  closes: unknown[];
  timestamps: unknown[];
};

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

/**
 * 1m chart s pre/post — cez crumb (rovnaký klient ako v7).
 * Plain fetch bez cookies často vráti prázdne bary počas PRE.
 */
export async function fetchYahooChartIntraday(yahooTicker: string): Promise<YahooChartIntraday | null> {
  try {
    const yf = getYahooFinance();
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}`;
    const nowSec = Math.floor(Date.now() / 1000);
    const attempts: Array<Record<string, string>> = [
      { interval: "1m", range: "1d", includePrePost: "true" },
      {
        interval: "1m",
        period1: String(nowSec - 8 * 60 * 60),
        period2: String(nowSec),
        includePrePost: "true",
      },
    ];

    for (const params of attempts) {
      const data = (await yf._fetch(url, params, {}, "json", true)) as {
        chart?: {
          result?: Array<{
            meta?: Record<string, unknown>;
            timestamp?: unknown[];
            indicators?: { quote?: Array<{ close?: unknown[] }> };
          }>;
        };
      };
      const result = data?.chart?.result?.[0];
      if (!result) continue;
      const closes = result.indicators?.quote?.[0]?.close ?? [];
      const timestamps = result.timestamp ?? [];
      const hasBar = closes.some((c) => {
        const n = Number(c);
        return Number.isFinite(n) && n > 0;
      });
      if (!hasBar) continue;
      return {
        meta: (result.meta ?? {}) as Record<string, unknown>,
        closes,
        timestamps,
      };
    }
    return null;
  } catch (error) {
    console.warn(`Yahoo chart intraday failed for ${yahooTicker}:`, error);
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
  /**
   * Počas PRE/OVERNIGHT je `regularMarketPrice` posledný RTH close.
   * `regularMarketPreviousClose` vie zaostávať o deň (NBIS: prevClose ešte T-2),
   * preto pre extended % používame RTH close; previousClose len ako fallback.
   */
  const extendedBaseline =
    Number.isFinite(rthPrice) && rthPrice > 0
      ? rthPrice
      : Number.isFinite(previousClose) && previousClose > 0
        ? previousClose
        : 0;

  const recomputeVsBaseline = (price: number, baseline: number) => {
    if (!(baseline > 0)) {
      return { preMarketChange: null as number | null, preMarketChangePercent: null as number | null };
    }
    const ch = price - baseline;
    return { preMarketChange: ch, preMarketChangePercent: (ch / baseline) * 100 };
  };

  const prePrice = num(q.preMarketPrice);
  if (
    prePrice != null &&
    prePrice > 0 &&
    (marketStateRaw === "PRE" || marketStateRaw === "PREPRE")
  ) {
    // Oficiálne Yahoo pre % je voči last close; prepočítame sami kvôli konzistencii.
    return {
      preMarketPrice: prePrice,
      ...recomputeVsBaseline(prePrice, extendedBaseline),
      marketState: marketStateRaw === "PREPRE" ? "PRE" : marketState,
    };
  }

  const postPrice = num(q.postMarketPrice);
  if (
    postPrice != null &&
    postPrice > 0 &&
    (marketStateRaw === "POST" || marketStateRaw === "POSTPOST")
  ) {
    const postBaseline = rthPrice > 0 ? rthPrice : extendedBaseline;
    return {
      preMarketPrice: postPrice,
      ...recomputeVsBaseline(postPrice, postBaseline),
      marketState,
    };
  }

  const overnightPrice = num(q.overnightMarketPrice);
  /**
   * Yahoo overnightChangePercent je často voči inej báze / BOATS a nesedí s broker UI.
   * Vždy prepočítaj voči last RTH close. Preferuj skutočný preMarket, inak overnight.
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
      ...recomputeVsBaseline(overnightPrice, extendedBaseline),
      marketState: keepPreLabel
        ? "PRE"
        : marketStateRaw === "OVERNIGHT" || marketStateRaw === "PREPRE"
          ? "OVERNIGHT"
          : marketState,
    };
  }

  const extPrice = num(q.extendedMarketPrice);
  if (extPrice != null && extPrice > 0) {
    const baseline =
      marketStateRaw === "POST" || marketStateRaw === "POSTPOST" ? rthPrice : extendedBaseline;
    return {
      preMarketPrice: extPrice,
      ...recomputeVsBaseline(extPrice, baseline > 0 ? baseline : extendedBaseline),
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
