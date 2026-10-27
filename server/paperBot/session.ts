/** US session helpers for paper-bot scheduler (server-side). */

import {
  getUsMarketSessionState,
  shouldUseExtendedQuotes,
  type UsMarketSessionState,
} from "@shared/usMarketSession";

export type UsSession = "LIVE" | "EXTENDED" | "CLOSED";

function toPaperSession(state: UsMarketSessionState): UsSession {
  if (state === "LIVE") return "LIVE";
  if (shouldUseExtendedQuotes(state)) return "EXTENDED";
  return "CLOSED";
}

export function getUsSession(now = new Date()): UsSession {
  return toPaperSession(getUsMarketSessionState(now));
}

/** Scheduler interval: live 20s, extended 45s, closed/weekend 90s. */
export function getPaperBotTickMs(now = new Date()): number {
  const s = getUsSession(now);
  if (s === "LIVE") return 20_000;
  if (s === "EXTENDED") return 45_000;
  return 90_000;
}
