import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { localAuthAccounts } from "@shared/schema";
import { toYahooTicker } from "../yahooTicker";
import { fetchYahooV7Quote } from "../yahooQuoteClient";
import { collectAiBotNewsContext } from "./newsContext";
import {
  countAlertsToday,
  insertAiBotAlert,
  listEnabledAlertUsers,
  MAX_ALERTS_PER_DAY,
  touchAiAlertLastScan,
  updateAlertEmailStatus,
  type AiAlertSettings,
} from "./alertsStore";
import { isSmtpConfigured, sendAlertEmail } from "./mailer";

type EtParts = {
  weekday: string;
  hour: number;
  minute: number;
};

function getEtParts(now = new Date()): EtParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;

  return {
    weekday: get("weekday"),
    hour,
    minute: Number(get("minute")),
  };
}

/** US regular trading hours: Mon–Fri 09:30–16:00 ET */
export function isUsRth(now = new Date()): boolean {
  const et = getEtParts(now);
  if (et.weekday === "Sat" || et.weekday === "Sun") return false;
  const mins = et.hour * 60 + et.minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function resolveUserEmail(userId: string): Promise<string | null> {
  const user = await storage.getUser(userId);
  const fromUser = user?.email?.trim();
  if (fromUser && fromUser.includes("@")) return fromUser;

  const [local] = await db
    .select({ email: localAuthAccounts.email })
    .from(localAuthAccounts)
    .where(eq(localAuthAccounts.userId, userId))
    .limit(1);
  const fromLocal = local?.email?.trim();
  return fromLocal && fromLocal.includes("@") ? fromLocal : null;
}

async function collectUserTickers(userId: string): Promise<string[]> {
  const [holdings, watchlist] = await Promise.all([
    storage.getHoldingsByUser(userId),
    storage.getWatchlistByUser(userId),
  ]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of holdings) {
    const t = String(h.ticker || "").trim().toUpperCase();
    if (!t || t === "CASH" || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  for (const w of watchlist) {
    const t = String(w.ticker || "").trim().toUpperCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, 40);
}

async function quoteChangePct(ticker: string): Promise<number | null> {
  try {
    const row = await fetchYahooV7Quote(toYahooTicker(ticker));
    if (!row) return null;
    return num(row.regularMarketChangePercent);
  } catch {
    return null;
  }
}

type MaterialCandidate = {
  ticker: string;
  title: string;
  link: string;
  publisher: string;
  summary: string;
};

async function filterMaterialNews(
  candidates: MaterialCandidate[],
): Promise<MaterialCandidate[]> {
  if (candidates.length === 0) return [];
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    // Bez Claude: konzervatívny keyword filter
    const keys = [
      /earnings/i,
      /guidance/i,
      /acquire|acquisition|merger|m&a/i,
      /sec\b|regulator|lawsuit|probe/i,
      /sanction|tariff|geopolit/i,
      /ceo\b|cfo\b|resign/i,
      /downgrade|upgrade|price target/i,
    ];
    return candidates.filter((c) => keys.some((re) => re.test(`${c.title} ${c.summary}`)));
  }

  try {
    const rawKey = process.env.ANTHROPIC_API_KEY.trim().replace(/^["']|["']$/g, "");
    const model =
      process.env.ANTHROPIC_MODEL?.trim().replace(/^["']|["']$/g, "") ||
      "claude-sonnet-5";
    const client = new Anthropic({ apiKey: rawKey });
    const list = candidates
      .slice(0, 12)
      .map(
        (c, i) =>
          `${i + 1}. [${c.ticker}] ${c.title}${c.summary ? ` — ${c.summary.slice(0, 120)}` : ""}`,
      )
      .join("\n");

    const msg = await client.messages.create({
      model,
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: `You filter stock headlines for material market impact.
Material = earnings, guidance, M&A, regulation/lawsuit, major geopolitics on the name, executive change, rating change with clear impact.
Not material = generic market color, soft opinion, routine product fluff.

Return ONLY JSON: {"material":[1,3,...]} with 1-based indices of material headlines.

Headlines:
${list}`,
        },
      ],
    });

    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return [];
    const parsed = JSON.parse(text.slice(start, end + 1)) as { material?: unknown };
    const idxs = Array.isArray(parsed.material)
      ? parsed.material.map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : [];
    return idxs
      .map((i) => candidates[i - 1])
      .filter((c): c is MaterialCandidate => !!c);
  } catch (err) {
    console.warn("[ai-alerts] material filter failed:", err);
    return [];
  }
}

async function deliverAlertEmail(
  settings: AiAlertSettings,
  alert: NonNullable<Awaited<ReturnType<typeof insertAiBotAlert>>>,
): Promise<void> {
  if (!settings.emailEnabled) {
    await updateAlertEmailStatus(alert.id, "skipped_disabled");
    return;
  }
  if (!isSmtpConfigured()) {
    await updateAlertEmailStatus(alert.id, "skipped_no_smtp");
    return;
  }
  const to = await resolveUserEmail(settings.userId);
  if (!to) {
    await updateAlertEmailStatus(alert.id, "failed");
    return;
  }
  const status = await sendAlertEmail({ to, alert });
  await updateAlertEmailStatus(alert.id, status);
}

async function scanUser(settings: AiAlertSettings): Promise<number> {
  let created = 0;
  const tickers = await collectUserTickers(settings.userId);
  if (tickers.length === 0) {
    await touchAiAlertLastScan(settings.userId);
    return 0;
  }

  const threshold = settings.priceThresholdPct;
  let todayLeft = MAX_ALERTS_PER_DAY - (await countAlertsToday(settings.userId));
  if (todayLeft <= 0) {
    await touchAiAlertLastScan(settings.userId);
    return 0;
  }

  // Price movers
  for (const ticker of tickers.slice(0, 25)) {
    if (todayLeft <= 0) break;
    const changePct = await quoteChangePct(ticker);
    if (changePct == null) continue;
    if (Math.abs(changePct) < threshold) continue;

    const sign = changePct > 0 ? "+" : "";
    const title = `${ticker} ${sign}${changePct.toFixed(1)} %`;
    const body =
      changePct > 0
        ? `Intraday rast o ${changePct.toFixed(1)} % (prah ${threshold} %).`
        : `Intraday pokles o ${Math.abs(changePct).toFixed(1)} % (prah ${threshold} %).`;

    const alert = await insertAiBotAlert({
      userId: settings.userId,
      ticker,
      kind: "price",
      title,
      body,
      changePct,
    });
    if (alert) {
      created += 1;
      todayLeft -= 1;
      await deliverAlertEmail(settings, alert);
    }
  }

  // News — holding/watchlist headlines + Claude material filter
  if (todayLeft > 0) {
    try {
      const { news } = await collectAiBotNewsContext({
        holdingTickers: tickers.slice(0, 10),
      });
      const candidates: MaterialCandidate[] = news
        .filter((n) => n.ticker)
        .map((n) => ({
          ticker: String(n.ticker).toUpperCase(),
          title: n.title,
          link: n.link,
          publisher: n.publisher,
          summary: n.summary,
        }));

      const material = await filterMaterialNews(candidates);
      for (const item of material) {
        if (todayLeft <= 0) break;
        const alert = await insertAiBotAlert({
          userId: settings.userId,
          ticker: item.ticker,
          kind: "news",
          title: `${item.ticker}: ${item.title.slice(0, 80)}`,
          body: item.summary
            ? item.summary.slice(0, 280)
            : `Material novinka (${item.publisher || "Yahoo"}).`,
          newsTitle: item.title,
          newsLink: item.link || null,
        });
        if (alert) {
          created += 1;
          todayLeft -= 1;
          await deliverAlertEmail(settings, alert);
        }
      }
    } catch (err) {
      console.warn(`[ai-alerts] news scan failed for ${settings.userId}:`, err);
    }
  }

  await touchAiAlertLastScan(settings.userId);
  return created;
}

let radarRunning = false;

export async function runAlertRadar(
  now = new Date(),
  opts?: { force?: boolean },
): Promise<{ ran: boolean; reason?: string; users?: number; created?: number }> {
  if (!opts?.force && !isUsRth(now)) {
    return { ran: false, reason: "outside_rth" };
  }
  if (radarRunning) {
    return { ran: false, reason: "already_running" };
  }

  radarRunning = true;
  try {
    const users = await listEnabledAlertUsers();
    if (users.length === 0) {
      return { ran: false, reason: "no_users", users: 0, created: 0 };
    }

    let created = 0;
    for (const u of users) {
      try {
        created += await scanUser(u);
      } catch (err) {
        console.error(`[ai-alerts] radar failed for ${u.userId}:`, err);
      }
    }
    return { ran: true, users: users.length, created };
  } finally {
    radarRunning = false;
  }
}
