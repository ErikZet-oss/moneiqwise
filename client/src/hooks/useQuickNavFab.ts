import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_QUICK_NAV_ITEMS,
  DEFAULT_QUICK_NAV_PATH,
  MAX_QUICK_NAV_ITEMS,
  QUICK_NAV_SECTIONS,
  normalizeQuickNavItems,
  normalizeQuickNavPath,
} from "@/lib/quickNavSections";

export type QuickNavFabSettings = {
  enabled: boolean;
  /** @deprecated legacy single path — migruje sa do `items` */
  path?: string;
  items: string[];
};

const STORAGE_KEY = "moneiqwise-quick-nav-fab";

const defaultSettings: QuickNavFabSettings = {
  enabled: false,
  items: [...DEFAULT_QUICK_NAV_ITEMS],
};

function loadSettings(): QuickNavFabSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<QuickNavFabSettings>;
      const fromItems = Array.isArray(parsed.items) ? parsed.items : null;
      const legacyPath =
        typeof parsed.path === "string" ? normalizeQuickNavPath(parsed.path) : null;
      const items = normalizeQuickNavItems(
        fromItems && fromItems.length > 0
          ? fromItems
          : legacyPath
            ? [legacyPath]
            : DEFAULT_QUICK_NAV_ITEMS,
      );
      return {
        enabled: parsed.enabled === true,
        items,
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
      const nextItems =
        updates.items != null
          ? normalizeQuickNavItems(updates.items)
          : prev.items;
      const next: QuickNavFabSettings = {
        enabled: updates.enabled ?? prev.enabled,
        items: nextItems,
        path: nextItems[0] ?? DEFAULT_QUICK_NAV_PATH,
      };
      saveSettings(next);
      return next;
    });
  }, []);

  const setItemPath = useCallback((index: number, path: string) => {
    setSettings((prev) => {
      const items = [...prev.items];
      if (index < 0 || index >= items.length) return prev;
      const normalized = normalizeQuickNavPath(path);
      const dup = items.findIndex((p, i) => i !== index && p === normalized);
      if (dup >= 0) items[dup] = items[index]!;
      items[index] = normalized;
      const nextItems = normalizeQuickNavItems(items);
      const next: QuickNavFabSettings = {
        ...prev,
        items: nextItems,
        path: nextItems[0],
      };
      saveSettings(next);
      return next;
    });
  }, []);

  const addItem = useCallback(() => {
    setSettings((prev) => {
      if (prev.items.length >= MAX_QUICK_NAV_ITEMS) return prev;
      const used = new Set(prev.items);
      const free =
        QUICK_NAV_SECTIONS.find((s) => !used.has(s.path))?.path ??
        DEFAULT_QUICK_NAV_ITEMS.find((p) => !used.has(p)) ??
        DEFAULT_QUICK_NAV_PATH;
      const items = normalizeQuickNavItems([...prev.items, free]);
      const next: QuickNavFabSettings = { ...prev, items, path: items[0] };
      saveSettings(next);
      return next;
    });
  }, []);

  const removeItem = useCallback((index: number) => {
    setSettings((prev) => {
      if (prev.items.length <= 1) return prev;
      const items = normalizeQuickNavItems(prev.items.filter((_, i) => i !== index));
      const next: QuickNavFabSettings = { ...prev, items, path: items[0] };
      saveSettings(next);
      return next;
    });
  }, []);

  return {
    enabled: settings.enabled,
    items: settings.items,
    path: settings.items[0] ?? DEFAULT_QUICK_NAV_PATH,
    setEnabled: (value: boolean) => updateSettings({ enabled: value }),
    setItems: (items: string[]) => updateSettings({ items }),
    setItemPath,
    addItem,
    removeItem,
    setPath: (path: string) => setItemPath(0, path),
    maxItems: MAX_QUICK_NAV_ITEMS,
  };
}
