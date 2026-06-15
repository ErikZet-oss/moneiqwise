export type UsMarketSessionState = "PRE_MARKET" | "LIVE" | "POST_MARKET" | "CLOSED";

/** SEČ okná pre US akcie (letný čas; orientačné). */
export function getUsMarketSessionState(now = new Date()): UsMarketSessionState {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Bratislava",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const isWeekend = weekday.startsWith("Sat") || weekday.startsWith("Sun");
  const minutesFromMidnight = hour * 60 + minute;

  if (isWeekend) return "CLOSED";
  if (minutesFromMidnight >= 10 * 60 && minutesFromMidnight < 15 * 60 + 30) return "PRE_MARKET";
  if (minutesFromMidnight >= 15 * 60 + 30 && minutesFromMidnight < 22 * 60) return "LIVE";
  if (minutesFromMidnight >= 22 * 60 || minutesFromMidnight < 2 * 60) return "POST_MARKET";
  return "CLOSED";
}

export function quoteHasExtendedSession(marketState?: string | null): boolean {
  const s = String(marketState ?? "").toUpperCase();
  return s === "PRE" || s === "PREPRE" || s === "POST" || s === "POSTPOST";
}

export function shouldUseExtendedQuotes(usSession: UsMarketSessionState): boolean {
  return usSession === "PRE_MARKET" || usSession === "POST_MARKET";
}

export function shouldShowExtendedQuote(
  usSession: UsMarketSessionState,
  marketState?: string | null,
  preMarketChangePercent?: number | null,
): boolean {
  if (preMarketChangePercent == null || !Number.isFinite(preMarketChangePercent)) return false;
  if (shouldUseExtendedQuotes(usSession)) return true;
  return quoteHasExtendedSession(marketState);
}
