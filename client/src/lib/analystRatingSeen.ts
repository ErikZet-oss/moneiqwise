/** Last-seen analyst rating fingerprints (per browser) for dashboard popup. */

export type AnalystLatestChange = {
  date: string | null;
  firm: string;
  action: string | null;
  fromGrade: string | null;
  toGrade: string | null;
  priceTarget: number | null;
  priorPriceTarget: number | null;
};

export type AnalystRatingUpdateRow = {
  ticker: string;
  companyName: string;
  currency?: string | null;
  recommendationKey: string | null;
  latestChange: AnalystLatestChange | null;
};

const STORAGE_KEY = "mw-analyst-rating-seen-v1";
/** Popup only for changes within this many days (avoid resurfacing old history). */
const RECENT_DAYS = 45;

export function fingerprintAnalystChange(change: AnalystLatestChange | null): string | null {
  if (!change) return null;
  const parts = [
    change.date ?? "",
    change.firm ?? "",
    change.action ?? "",
    change.fromGrade ?? "",
    change.toGrade ?? "",
    change.priceTarget != null ? String(change.priceTarget) : "",
    change.priorPriceTarget != null ? String(change.priorPriceTarget) : "",
  ];
  const fp = parts.join("|");
  return fp.replace(/\|/g, "").length === 0 ? null : fp;
}

function loadSeen(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > 0) out[k.toUpperCase()] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveSeen(seen: Record<string, string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
  } catch {
    /* ignore */
  }
}

function isRecentChange(dateIso: string | null): boolean {
  if (!dateIso) return true;
  const ms = new Date(`${dateIso}T12:00:00`).getTime();
  if (!Number.isFinite(ms)) return true;
  const ageDays = (Date.now() - ms) / (24 * 60 * 60 * 1000);
  return ageDays >= 0 && ageDays <= RECENT_DAYS;
}

/**
 * Compare live updates to last-seen fingerprints.
 * First sighting of a ticker seeds storage without a popup.
 * Returns rows that are new/changed and recent enough to notify.
 */
export function detectAnalystRatingPopupChanges(
  updates: AnalystRatingUpdateRow[],
): AnalystRatingUpdateRow[] {
  const seen = loadSeen();
  const changed: AnalystRatingUpdateRow[] = [];
  let dirty = false;

  for (const row of updates) {
    const ticker = row.ticker.toUpperCase();
    const fp = fingerprintAnalystChange(row.latestChange);
    if (!fp) continue;

    const prev = seen[ticker];
    if (prev === undefined) {
      seen[ticker] = fp;
      dirty = true;
      continue;
    }
    if (prev === fp) continue;

    seen[ticker] = fp;
    dirty = true;
    if (isRecentChange(row.latestChange?.date ?? null)) {
      changed.push({ ...row, ticker });
    }
  }

  if (dirty) saveSeen(seen);
  return changed;
}
