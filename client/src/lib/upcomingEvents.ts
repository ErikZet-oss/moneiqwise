/** Shared shape for earnings / dividends / macro upcoming endpoints. */
export type UpcomingEnvelope<T> = {
  next: T | null;
  all: T[];
};

/**
 * API returns `{ next, all }`, but a poisoned React Query cache (or an older
 * buggy queryFn) may store a bare array. Normalize so UI never reads `.all`
 * off the wrong shape.
 */
export function normalizeUpcomingEnvelope<T>(data: unknown): UpcomingEnvelope<T> {
  if (Array.isArray(data)) {
    const all = data as T[];
    return { next: all[0] ?? null, all };
  }
  if (data && typeof data === "object") {
    const row = data as { next?: T | null; all?: unknown };
    const all = Array.isArray(row.all) ? (row.all as T[]) : [];
    const next = (row.next ?? all[0] ?? null) as T | null;
    return { next, all };
  }
  return { next: null, all: [] };
}

export async function fetchUpcomingEnvelope<T>(url: string): Promise<UpcomingEnvelope<T>> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`upcoming ${res.status}`);
  return normalizeUpcomingEnvelope<T>(await res.json());
}
