import { listRunningPaperBots } from "./store";
import { tickPaperBot } from "./engine";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

const TICK_MS = 60_000;

export async function runPaperBotSchedulerTick(): Promise<{
  bots: number;
  ok: number;
  failed: number;
}> {
  if (running) return { bots: 0, ok: 0, failed: 0 };
  running = true;
  try {
    const bots = await listRunningPaperBots();
    let ok = 0;
    let failed = 0;
    for (const bot of bots) {
      try {
        await tickPaperBot(bot.id, bot.userId);
        ok += 1;
      } catch (err) {
        failed += 1;
        console.error(`[paper-bot] tick failed bot=${bot.id}:`, err);
      }
    }
    if (bots.length > 0) {
      console.log(
        `[paper-bot] scheduler tick bots=${bots.length} ok=${ok} failed=${failed}`,
      );
    }
    return { bots: bots.length, ok, failed };
  } finally {
    running = false;
  }
}

export function startPaperBotScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    void runPaperBotSchedulerTick();
  }, TICK_MS);
  void runPaperBotSchedulerTick();
  console.log(
    `[paper-bot] scheduler started (every ${TICK_MS / 1000}s for running paper bots)`,
  );
}
