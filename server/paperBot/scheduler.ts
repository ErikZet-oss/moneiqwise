import { listRunningPaperBots } from "./store";
import { tickPaperBot } from "./engine";
import { getPaperBotTickMs, getUsSession } from "./session";

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let started = false;

export async function runPaperBotSchedulerTick(): Promise<{
  bots: number;
  ok: number;
  failed: number;
  session: string;
  nextMs: number;
}> {
  const session = getUsSession();
  const nextMs = getPaperBotTickMs();
  if (running) {
    return { bots: 0, ok: 0, failed: 0, session, nextMs };
  }
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
        `[paper-bot] tick session=${session} bots=${bots.length} ok=${ok} failed=${failed} next=${nextMs}ms`,
      );
    }
    return { bots: bots.length, ok, failed, session, nextMs };
  } finally {
    running = false;
  }
}

function scheduleNext() {
  const ms = getPaperBotTickMs();
  timer = setTimeout(() => {
    void runPaperBotSchedulerTick().finally(() => scheduleNext());
  }, ms);
}

export function startPaperBotScheduler() {
  if (started) return;
  started = true;
  void runPaperBotSchedulerTick().finally(() => scheduleNext());
  console.log(
    "[paper-bot] scheduler started (LIVE 20s / EXTENDED 45s / CLOSED 90s)",
  );
}
