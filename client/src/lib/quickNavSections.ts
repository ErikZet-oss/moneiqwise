/** Sekcie dostupné pre spodnú rýchlu navigáciu (zodpovedá hlavnému menu). */
export type QuickNavSection = {
  path: string;
  label: string;
  /** Krátky text do spodného baru (max ~10 znakov). */
  shortLabel: string;
};

export const QUICK_NAV_SECTIONS: QuickNavSection[] = [
  { path: "/", label: "Prehľad", shortLabel: "Domov" },
  { path: "/overview", label: "Všetky portfóliá", shortLabel: "Portfóliá" },
  { path: "/allocation", label: "Rozloženie", shortLabel: "Rozloženie" },
  { path: "/grafy", label: "Grafy", shortLabel: "Grafy" },
  { path: "/goal", label: "Môj cieľ", shortLabel: "Cieľ" },
  { path: "/history", label: "História", shortLabel: "História" },
  { path: "/profit", label: "Zisk", shortLabel: "Zisk" },
  { path: "/dividends", label: "Dividendy", shortLabel: "Dividendy" },
  { path: "/events", label: "Kalendár udalostí", shortLabel: "Kalendár" },
  { path: "/watchlist", label: "Watchlist", shortLabel: "Watchlist" },
  { path: "/ai-agent/bot", label: "AI Agent", shortLabel: "AI Agent" },
  { path: "/ai-macro-audit", label: "AI Macro Audit", shortLabel: "Macro AI" },
  { path: "/tax", label: "Daňový asistent", shortLabel: "Dane" },
  { path: "/options", label: "Opcie", shortLabel: "Opcie" },
  { path: "/import", label: "Import brokera", shortLabel: "Import" },
  { path: "/faq", label: "FAQ", shortLabel: "FAQ" },
];

export const DEFAULT_QUICK_NAV_PATH = "/watchlist";

export const DEFAULT_QUICK_NAV_ITEMS = ["/", "/watchlist", "/profit", "/ai-agent/bot"] as const;

export const MAX_QUICK_NAV_ITEMS = 4;

export function getQuickNavSection(path: string): QuickNavSection | undefined {
  return QUICK_NAV_SECTIONS.find((s) => s.path === path);
}

export function normalizeQuickNavPath(raw: unknown): string {
  const path = typeof raw === "string" ? raw.trim() : "";
  if (path === "/ai-skener" || path === "/ai-agent" || path === "/ai-agent/alerty") {
    return "/ai-agent/bot";
  }
  if (QUICK_NAV_SECTIONS.some((s) => s.path === path)) return path;
  return DEFAULT_QUICK_NAV_PATH;
}

export function normalizeQuickNavItems(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const path = normalizeQuickNavPath(item);
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
    if (out.length >= MAX_QUICK_NAV_ITEMS) break;
  }
  if (out.length === 0) out.push(DEFAULT_QUICK_NAV_PATH);
  return out;
}
