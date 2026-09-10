import { listEnabledAiBotUsers, tryAcquireScheduleLock } from "./store";
import { runAiBotScheduledForUser } from "./runner";
import { runAlertRadar } from "./alertRadar";
import type { AiBotSlot } from "./types";

type EtParts = {
  dateKey: string;
  weekday: string;
  hour: number;
  minute: number;
};

function getEtParts(now = new Date()): EtParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  // Niektoré runtime vracajú "24" o polnoci.
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;

  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: get("weekday"),
    hour,
    minute: Number(get("minute")),
  };
}

/**
 * Široké okná — stačí, aby server bežal niekedy v okne (nie len v :00).
 * Lock (dateKey:slot) zabezpečí max 1 beh / slot / deň.
 */
export function detectSlot(et: EtParts): Exclude<AiBotSlot, "manual"> | null {
  const wd = et.weekday;
  if (wd === "Sat" || wd === "Sun") return null;
  // Pred open: 09:00–09:29 ET (do RTH open 09:30) ≈ 15:00–15:29 SEČ/SELČ
  if (et.hour === 9 && et.minute >= 0 && et.minute <= 29) return "preopen";
  // Pred close: 15:45–15:59 ET ≈ 21:45–21:59 SEČ/SELČ
  if (et.hour === 15 && et.minute >= 45 && et.minute <= 59) return "preclose";
  return null;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let lastRadarAt = 0;
const RADAR_INTERVAL_MS = 5 * 60_000;

export async function runDueAiBotSchedule(
  now = new Date(),
  opts?: { force?: boolean },
): Promise<{
  slot: Exclude<AiBotSlot, "manual"> | null;
  ran: boolean;
  reason?: string;
  users?: number;
}> {
  const et = getEtParts(now);
  const slot = detectSlot(et);
  if (!slot) {
    return { slot: null, ran: false, reason: "not_in_window" };
  }

  if (running) {
    return { slot, ran: false, reason: "already_running" };
  }

  running = true;
  try {
    const users = await listEnabledAiBotUsers();
    if (users.length === 0) {
      console.warn(
        "[ai-bot] no enabled users in ai_bot_settings — open AI Bot page once (Zapnuté) to create settings",
      );
      return { slot, ran: false, reason: "no_users", users: 0 };
    }

    const lockKey = `${et.dateKey}:${slot}`;
    if (!opts?.force) {
      const got = await tryAcquireScheduleLock(lockKey);
      if (!got) {
        return {
          slot,
          ran: false,
          reason: "already_ran_today",
          users: users.length,
        };
      }
    }

    console.log(
      `[ai-bot] scheduled ${slot} for ${users.length} user(s) (${lockKey}${opts?.force ? ", force" : ""}) — each PTF + all`,
    );
    for (const u of users) {
      try {
        const stats = await runAiBotScheduledForUser({
          userId: u.userId,
          slot,
        });
        console.log(
          `[ai-bot] user=${u.userId} ran=${stats.ran} skippedEmpty=${stats.skippedEmpty} failed=${stats.failed}`,
        );
      } catch (err) {
        console.error(`[ai-bot] schedule batch failed for ${u.userId}:`, err);
      }
    }
    return { slot, ran: true, users: users.length };
  } finally {
    running = false;
  }
}

async function tickRadar() {
  const now = Date.now();
  if (now - lastRadarAt < RADAR_INTERVAL_MS) return;
  lastRadarAt = now;
  try {
    const result = await runAlertRadar();
    if (result.ran) {
      console.log(
        `[ai-alerts] radar users=${result.users} created=${result.created}`,
      );
    }
  } catch (err) {
    console.error("[ai-alerts] radar tick error:", err);
  }
}

async function tick() {
  try {
    const result = await runDueAiBotSchedule();
    if (result.ran) {
      console.log(`[ai-bot] tick completed slot=${result.slot} users=${result.users}`);
    } else if (result.slot && result.reason !== "already_ran_today") {
      console.log(`[ai-bot] tick skipped: ${result.reason} slot=${result.slot}`);
    }
  } catch (err) {
    console.error("[ai-bot] tick error:", err);
  }
  void tickRadar();
}

export function startAiBotScheduler() {
  if (timer) return;
  // Každých 30s — v okne 09:00–09:29 / 15:45–15:59 ET to určite trafí.
  // Radar beží max raz za ~5 min (RTH), cez ten istý timer.
  timer = setInterval(() => {
    void tick();
  }, 30_000);
  // Catch-up hneď po štarte (nasadenie / restart uprostred okna).
  void tick();
  console.log(
    "[ai-bot] scheduler started (preopen 09:00–09:29 ET ≈ 15:00–15:29 local, preclose 15:45–15:59 ET; alerts radar ~5 min RTH)",
  );
}
