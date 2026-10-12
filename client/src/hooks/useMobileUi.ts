import { useCallback, useLayoutEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

export type MobileUiMode = "classic" | "redesign";

/**
 * Classic mobile UI remains in the codebase as backup, but is no longer
 * selectable. Mobile always uses the Figma redesign; desktop stays classic.
 */
const REDESIGN_LOCKED = true;
/** Align with TabBar surface so Android system nav matches the app chrome. */
const THEME_COLOR = "#15181c";
const BASE_BG = "#050607";

function applyDocumentMode(active: boolean) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  if (active) {
    root.setAttribute("data-mobile-ui", "redesign");
    root.style.colorScheme = "dark";
    document.body.style.backgroundColor = BASE_BG;
    meta.setAttribute("content", THEME_COLOR);
  } else {
    root.removeAttribute("data-mobile-ui");
    root.style.colorScheme = "";
    document.body.style.backgroundColor = "";
    meta.setAttribute("content", "");
  }
}

/** Keep <html data-mobile-ui> in sync for the whole app (one mount is enough). */
export function MobileUiDocumentSync() {
  const redesign = useMobileRedesign();
  useLayoutEffect(() => {
    applyDocumentMode(redesign);
  }, [redesign]);
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
