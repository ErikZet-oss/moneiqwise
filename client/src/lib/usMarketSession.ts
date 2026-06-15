export type UsMarketSessionState =
  | "PRE_MARKET"
  | "LIVE"
  | "POST_MARKET"
  | "OVERNIGHT"
  | "CLOSED";

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
  if (minutesFromMidnight >= 2 * 60 && minutesFromMidnight < 10 * 60) return "OVERNIGHT";
  return "CLOSED";
}

export function quoteHasExtendedSession(marketState?: string | null): boolean {
  const s = String(marketState ?? "").toUpperCase();
  return (
    s === "PRE" ||
    s === "PREPRE" ||
    s === "POST" ||
    s === "POSTPOST" ||
    s === "OVERNIGHT"
  );
}

export function shouldUseExtendedQuotes(usSession: UsMarketSessionState): boolean {
  return (
    usSession === "PRE_MARKET" ||
    usSession === "POST_MARKET" ||
    usSession === "OVERNIGHT"
  );
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

/** Auto-refresh kotácií na dashboarde (ms); false = bez pollingu počas RTH. */
export function getQuoteRefreshIntervalMs(now = new Date()): number | false {
  const state = getUsMarketSessionState(now);
  if (state === "LIVE") return false;
  if (shouldUseExtendedQuotes(state)) return 20_000;
  return 60_000;
}

export function getQuoteStaleTimeMs(now = new Date()): number {
  const state = getUsMarketSessionState(now);
  if (shouldUseExtendedQuotes(state)) return 15_000;
  return 60_000;
}

export function getExtendedSessionLabel(usSession: UsMarketSessionState): string {
  switch (usSession) {
    case "POST_MARKET":
      return "Po zatvorení:";
    case "OVERNIGHT":
      return "Overnight:";
    case "PRE_MARKET":
      return "Pred open:";
    default:
      return "Pred open:";
  }
}
