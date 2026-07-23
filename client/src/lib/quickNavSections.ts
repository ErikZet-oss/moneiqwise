/** Sekcie dostupné pre rýchle plávajúce tlačidlo (zodpovedá hlavnému menu). */
export type QuickNavSection = {
  path: string;
  label: string;
};

export const QUICK_NAV_SECTIONS: QuickNavSection[] = [
  { path: "/", label: "Prehľad" },
  { path: "/overview", label: "Všetky portfóliá" },
  { path: "/allocation", label: "Rozloženie" },
  { path: "/grafy", label: "Grafy" },
  { path: "/goal", label: "Môj cieľ" },
  { path: "/history", label: "História" },
  { path: "/profit", label: "Zisk" },
  { path: "/dividends", label: "Dividendy" },
  { path: "/events", label: "Kalendár udalostí" },
  { path: "/watchlist", label: "Watchlist" },
  { path: "/ai-skener", label: "AI Skener" },
  { path: "/tax", label: "Daňový asistent" },
  { path: "/options", label: "Opcie" },
  { path: "/import", label: "Import XTB" },
  { path: "/faq", label: "FAQ" },
];

export const DEFAULT_QUICK_NAV_PATH = "/watchlist";

export function getQuickNavSection(path: string): QuickNavSection | undefined {
  return QUICK_NAV_SECTIONS.find((s) => s.path === path);
}

export function normalizeQuickNavPath(raw: unknown): string {
  const path = typeof raw === "string" ? raw.trim() : "";
  if (QUICK_NAV_SECTIONS.some((s) => s.path === path)) return path;
  return DEFAULT_QUICK_NAV_PATH;
}
