import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_QUICK_NAV_PATH,
  normalizeQuickNavPath,
} from "@/lib/quickNavSections";

export type QuickNavFabSettings = {
  enabled: boolean;
  path: string;
};

const STORAGE_KEY = "moneiqwise-quick-nav-fab";

const defaultSettings: QuickNavFabSettings = {
  enabled: false,
  path: DEFAULT_QUICK_NAV_PATH,
};

function loadSettings(): QuickNavFabSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<QuickNavFabSettings>;
      return {
        enabled: parsed.enabled === true,
        path: normalizeQuickNavPath(parsed.path),
      };
    }
  } catch {
    // ignore
  }
  return defaultSettings;
}

function saveSettings(settings: QuickNavFabSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent("quickNavFabChanged", { detail: settings }));
  } catch {
    // ignore
  }
}

export function useQuickNavFab() {
  const [settings, setSettings] = useState<QuickNavFabSettings>(loadSettings);

  useEffect(() => {
    const handleChange = (e: CustomEvent<QuickNavFabSettings>) => {
      setSettings(e.detail);
    };
    window.addEventListener("quickNavFabChanged", handleChange as EventListener);
    return () => {
      window.removeEventListener("quickNavFabChanged", handleChange as EventListener);
    };
  }, []);

  const updateSettings = useCallback((updates: Partial<QuickNavFabSettings>) => {
    setSettings((prev) => {
      const next: QuickNavFabSettings = {
        enabled: updates.enabled ?? prev.enabled,
        path: updates.path != null ? normalizeQuickNavPath(updates.path) : prev.path,
      };
      saveSettings(next);
      return next;
    });
  }, []);

  return {
    enabled: settings.enabled,
    path: settings.path,
    setEnabled: (value: boolean) => updateSettings({ enabled: value }),
    setPath: (path: string) => updateSettings({ path }),
  };
}
