/** US session helpers for paper-bot scheduler (server-side). */

export type UsSession = "LIVE" | "EXTENDED" | "CLOSED";

export function getUsSession(now = new Date()): UsSession {
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
  const m = hour * 60 + minute;

  if (isWeekend) return "CLOSED";
  // RTH ≈ 15:30–22:00 SEČ
  if (m >= 15 * 60 + 30 && m < 22 * 60) return "LIVE";
  // Pre/post
  if (
    (m >= 10 * 60 && m < 15 * 60 + 30) ||
    m >= 22 * 60 ||
    m < 2 * 60
  ) {
    return "EXTENDED";
  }
  return "CLOSED";
}

/** Scheduler interval: live 20s, extended 45s, closed/weekend 90s. */
export function getPaperBotTickMs(now = new Date()): number {
  const s = getUsSession(now);
  if (s === "LIVE") return 20_000;
  if (s === "EXTENDED") return 45_000;
  return 90_000;
}
