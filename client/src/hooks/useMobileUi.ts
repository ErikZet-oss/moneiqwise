import { useCallback, useLayoutEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

export type MobileUiMode = "classic" | "redesign";

/**
 * Classic mobile UI remains in the codebase as backup, but is no longer
 * selectable. Mobile always uses the Figma redesign; desktop stays classic.
 */
const REDESIGN_LOCKED = true;

function applyDocumentMode(active: boolean) {
  if (typeof document === "undefined") return;
  if (active) {
    document.documentElement.setAttribute("data-mobile-ui", "redesign");
  } else {
    document.documentElement.removeAttribute("data-mobile-ui");
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
