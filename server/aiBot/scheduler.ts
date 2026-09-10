import { listEnabledAiBotUsers, tryAcquireScheduleLock } from "./store";
import { runAiBotForUser } from "./runner";
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

  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: get("weekday"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function detectSlot(et: EtParts): AiBotSlot | null {
  const wd = et.weekday;
  if (wd === "Sat" || wd === "Sun") return null;
  // Pred open: 09:00 ET (RTH open 09:30)
  if (et.hour === 9 && et.minute === 0) return "preopen";
  // 15 min pred close: 15:45 ET (RTH close 16:00)
  if (et.hour === 15 && et.minute === 45) return "preclose";
  return null;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick() {
  if (running) return;
  const et = getEtParts();
  const slot = detectSlot(et);
  if (!slot) return;

  const lockKey = `${et.dateKey}:${slot}`;
  const got = await tryAcquireScheduleLock(lockKey);
  if (!got) return;

  running = true;
  try {
    const users = await listEnabledAiBotUsers();
    console.log(
      `[ai-bot] scheduled ${slot} for ${users.length} user(s) (${lockKey})`,
    );
    for (const u of users) {
      try {
        await runAiBotForUser({
          userId: u.userId,
          portfolioId: u.portfolioId,
          slot,
        });
      } catch (err) {
        console.error(`[ai-bot] run failed for ${u.userId}:`, err);
      }
    }
  } finally {
    running = false;
  }
}

export function startAiBotScheduler() {
  if (timer) return;
  // Každých 30s — trafíme minútu 09:00 / 15:45 ET.
  timer = setInterval(() => {
    void tick();
  }, 30_000);
  console.log(
    "[ai-bot] scheduler started (preopen 09:00 ET, preclose 15:45 ET)",
  );
}
