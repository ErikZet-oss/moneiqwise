/**
 * US equity session windows in America/New_York (handles DST + EU/US mismatch weeks).
 *
 * PRE  04:00–09:30 ET
 * LIVE 09:30–16:00 ET
 * POST 16:00–20:00 ET
 * OVERNIGHT 20:00–04:00 ET (weeknights)
 * CLOSED weekends
 */

export type UsMarketSessionState =
  | "PRE_MARKET"
  | "LIVE"
  | "POST_MARKET"
  | "OVERNIGHT"
  | "CLOSED";

const NY_TZ = "America/New_York";

function zonedClock(now: Date, timeZone: string): {
  minutes: number;
  weekday: string;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  return { hour, minute, minutes: hour * 60 + minute, weekday };
}

/** Minutes-from-midnight offset: localZone − America/New_York (−12h…+12h). */
export function etToLocalMinutesDelta(
  now = new Date(),
  localTimeZone = "Europe/Bratislava",
): number {
  const ny = zonedClock(now, NY_TZ).minutes;
  const local = zonedClock(now, localTimeZone).minutes;
  let delta = local - ny;
  if (delta > 12 * 60) delta -= 24 * 60;
  if (delta < -12 * 60) delta += 24 * 60;
  return delta;
}

/** Format an Eastern wall-clock time in a local zone (e.g. 9:30 ET → "14:30" this DST week). */
export function formatEtClockInZone(
  etHour: number,
  etMinute: number,
  now = new Date(),
  localTimeZone = "Europe/Bratislava",
): string {
  const delta = etToLocalMinutesDelta(now, localTimeZone);
  let local = etHour * 60 + etMinute + delta;
  local = ((local % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(local / 60);
  const m = local % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Regular-hours window labels in Bratislava (updates across DST mismatch weeks). */
export function getUsRthBratislavaLabels(now = new Date()): {
  open: string;
  close: string;
  range: string;
} {
  const open = formatEtClockInZone(9, 30, now);
  const close = formatEtClockInZone(16, 0, now);
  return { open, close, range: `${open}–${close}` };
}

export function getUsMarketSessionState(now = new Date()): UsMarketSessionState {
  const { minutes, weekday } = zonedClock(now, NY_TZ);
  const isWeekend = weekday.startsWith("Sat") || weekday.startsWith("Sun");
  if (isWeekend) return "CLOSED";

  // 04:00–09:30 pre-market
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "PRE_MARKET";
  // 09:30–16:00 RTH
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "LIVE";
  // 16:00–20:00 post-market
  if (minutes >= 16 * 60 && minutes < 20 * 60) return "POST_MARKET";
  // 20:00–04:00 overnight (crosses midnight)
  if (minutes >= 20 * 60 || minutes < 4 * 60) return "OVERNIGHT";
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

export function getDisplayDayChange(
  usSession: UsMarketSessionState,
  quote:
    | {
        change?: number | null;
        changePercent?: number | null;
        preMarketChange?: number | null;
        preMarketChangePercent?: number | null;
        marketState?: string | null;
      }
    | null
    | undefined,
): {
  change: number;
  changePercent: number | null;
  showMoon: boolean;
} {
  if (!quote) return { change: 0, changePercent: null, showMoon: false };
  const showMoon = shouldShowExtendedQuote(
    usSession,
    quote.marketState,
    quote.preMarketChangePercent,
  );
  if (usSession === "LIVE") {
    return {
      change: Number(quote.change) || 0,
      changePercent:
        quote.changePercent != null && Number.isFinite(quote.changePercent)
          ? quote.changePercent
          : null,
      showMoon: false,
    };
  }
  if (showMoon) {
    return {
      change: Number(quote.preMarketChange) || 0,
      changePercent:
        quote.preMarketChangePercent != null && Number.isFinite(quote.preMarketChangePercent)
          ? quote.preMarketChangePercent
          : null,
      showMoon: true,
    };
  }
  return {
    change: Number(quote.change) || 0,
    changePercent:
      quote.changePercent != null && Number.isFinite(quote.changePercent)
        ? quote.changePercent
        : null,
    showMoon: false,
  };
}
