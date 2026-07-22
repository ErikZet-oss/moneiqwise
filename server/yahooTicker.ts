/** Konverzia brokera / app tickera na symbol Yahoo Finance (rovnaká logika ako watchlist quotes). */
export function toYahooTicker(ticker: string): string {
  const upper = ticker.trim().toUpperCase();
  const exchangeMap: Record<string, string> = {
    ".US": "",
    ".FR": ".PA",
    ".DE": ".DE",
    ".DEX": ".DE",
    ".F": ".F",
    ".BE": ".BE",
    ".DU": ".DU",
    ".HM": ".HM",
    ".SG": ".SG",
    ".MU": ".MU",
    ".L": ".L",
    ".PA": ".PA",
    ".PAR": ".PA",
    ".AMS": ".AS",
    ".AS": ".AS",
    ".MI": ".MI",
    ".SW": ".SW",
    ".VI": ".VI",
    ".PR": ".PR",
    ".WA": ".WA",
  };

  for (const [suffix, yahooSuffix] of Object.entries(exchangeMap)) {
    if (upper.endsWith(suffix)) {
      const base = upper.slice(0, -suffix.length);
      return base + yahooSuffix;
    }
  }

  return upper;
}
