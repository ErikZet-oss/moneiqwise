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

function applyDocumentMode(mode: MobileUiMode) {
  if (typeof document === "undefined") return;
  if (mode === "redesign") {
    document.documentElement.setAttribute("data-mobile-ui", "redesign");
  } else {
    // Classic must never keep redesign color/font overrides on <html>.
    document.documentElement.removeAttribute("data-mobile-ui");
  }
}

function saveMode(mode: MobileUiMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
    applyDocumentMode(mode);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: mode }));
  } catch {
    // ignore
  }
}

/** Keep <html data-mobile-ui> in sync for the whole app (one mount is enough). */
export function MobileUiDocumentSync() {
  const { mode } = useMobileUi();
  useLayoutEffect(() => {
    applyDocumentMode(mode);
  }, [mode]);
  return null;
}

export function useMobileUi() {
  const [mode, setModeState] = useState<MobileUiMode>(loadMode);

  useEffect(() => {
    const handleChange = (event: Event) => {
      const detail = (event as CustomEvent<MobileUiMode>).detail;
      if (detail === "classic" || detail === "redesign") setModeState(detail);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      if (event.newValue === "redesign" || event.newValue === "classic") {
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
 * True when the user selected Nový on the login / settings toggle.
 * Classic mode must render the pre-redesign shell and pages unchanged.
 */
export function useMobileRedesign() {
  const { mode } = useMobileUi();
  return mode === "redesign";
}
