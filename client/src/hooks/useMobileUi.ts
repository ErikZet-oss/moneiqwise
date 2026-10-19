import { useCallback, useLayoutEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTheme } from "@/hooks/useTheme";

export type MobileUiMode = "classic" | "redesign";

/**
 * Classic mobile UI remains in the codebase as backup, but is no longer
 * selectable. Mobile always uses the Figma redesign; desktop stays classic.
 */
const REDESIGN_LOCKED = true;

/** Dark chrome — Figma Dark mode (TabBar / canvas). */
const DARK = { themeColor: "#15181c", baseBg: "#050607", scheme: "only dark" } as const;
/** Light chrome — Figma Light mode (page 05). */
const LIGHT = { themeColor: "#ffffff", baseBg: "#f3f4f6", scheme: "only light" } as const;

function applyDocumentMode(active: boolean, isLight: boolean) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  const schemeMeta = document.querySelector('meta[name="color-scheme"]');
  if (active) {
    const palette = isLight ? LIGHT : DARK;
    root.setAttribute("data-mobile-ui", "redesign");
    root.style.colorScheme = palette.scheme;
    document.body.style.backgroundColor = palette.baseBg;
    document.querySelectorAll('meta[name="theme-color"]').forEach((el) => {
      el.setAttribute("content", palette.themeColor);
    });
    meta.setAttribute("content", palette.themeColor);
    schemeMeta?.setAttribute("content", palette.scheme);
  } else {
    root.removeAttribute("data-mobile-ui");
    root.style.colorScheme = "";
    document.body.style.backgroundColor = "";
    meta.setAttribute("content", "");
    schemeMeta?.setAttribute("content", "dark light");
  }
}

/** Keep <html data-mobile-ui> + chrome colors in sync with redesign + light/dark. */
export function MobileUiDocumentSync() {
  const redesign = useMobileRedesign();
  const { theme } = useTheme();
  useLayoutEffect(() => {
    applyDocumentMode(redesign, theme === "light");
  }, [redesign, theme]);
  return null;
}

/**
 * Storage / toggle API kept for backup (MobileUiToggle). Mode is locked to redesign.
 */
export function useMobileUi() {
  const setMode = useCallback((_next: MobileUiMode) => {
    // Intentionally no-op — classic mobile is retired from the UI.
  }, []);

  return { mode: "redesign" as MobileUiMode, setMode };
}

/**
 * True on mobile viewports when the redesign is the active mobile UI.
 * Desktop always stays on the classic shell / pages.
 */
export function useMobileRedesign() {
  const isMobile = useIsMobile();
  return REDESIGN_LOCKED && isMobile;
}
