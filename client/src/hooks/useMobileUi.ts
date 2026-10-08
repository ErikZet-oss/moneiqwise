import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export type MobileUiMode = "classic" | "redesign";

const STORAGE_KEY = "moneiqwise-mobile-ui";
const CHANGE_EVENT = "mobileUiChanged";

function loadMode(): MobileUiMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "redesign" || stored === "classic") return stored;
  } catch {
    // ignore
  }
  return "classic";
}

function saveMode(mode: MobileUiMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: mode }));
  } catch {
    // ignore
  }
}

/** How many mounted callers currently want the redesign attribute. */
let redesignAttributeUsers = 0;

export function useMobileUi() {
  const [mode, setModeState] = useState<MobileUiMode>(loadMode);

  useEffect(() => {
    const handleChange = (event: Event) => {
      const detail = (event as CustomEvent<MobileUiMode>).detail;
      if (detail === "classic" || detail === "redesign") setModeState(detail);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      if (event.newValue === "classic" || event.newValue === "redesign") {
        setModeState(event.newValue);
      }
    };
    window.addEventListener(CHANGE_EVENT, handleChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handleChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const setMode = useCallback((next: MobileUiMode) => {
    setModeState(next);
    saveMode(next);
  }, []);

  return { mode, setMode };
}

/**
 * True when the user selected Nový on the login / Viac toggle.
 * Applies the redesign shell + page UIs on any viewport so desktop testing
 * matches the toggle (Figma redesign is mobile-first, but the preference
 * must not silently fall back to classic above 768px).
 */
export function useMobileRedesign() {
  const { mode } = useMobileUi();
  const active = mode === "redesign";

  useLayoutEffect(() => {
    if (!active) return;
    redesignAttributeUsers += 1;
    document.documentElement.setAttribute("data-mobile-ui", "redesign");
    return () => {
      redesignAttributeUsers -= 1;
      if (redesignAttributeUsers <= 0) {
        redesignAttributeUsers = 0;
        document.documentElement.removeAttribute("data-mobile-ui");
      }
    };
  }, [active]);

  return active;
}
