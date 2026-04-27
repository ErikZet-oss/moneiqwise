import { useState, useEffect, useCallback } from "react";

/** Počet riadkov v rebríčkoch „Najlepšie / Najhoršie“ na Dashboarde. */
export type DailyMoversDisplayCount = 1 | 3 | 5;

interface ChartSettings {
  showChart: boolean;
  showTooltip: boolean;
  hideAmounts: boolean;
  showNews: boolean;
  /** Najsilnejšie / najslabšie dnes na hlavnom Prehľade (Dashboard `/`), nie na „Všetky portfóliá“. */
  showDailyMovers: boolean;
  /** Koľko pozícií zobraziť v každom z oboch rebríčkov (najlepšie / najhoršie). */
  dailyMoversCount: DailyMoversDisplayCount;
  showAthPopup: boolean;
  showCalendarEventsPopup: boolean;
}

const STORAGE_KEY = "portfolio-chart-settings";

const defaultSettings: ChartSettings = {
  showChart: true,
  showTooltip: false,
  hideAmounts: false,
  showNews: true,
  showDailyMovers: true,
  dailyMoversCount: 5,
  showAthPopup: true,
  showCalendarEventsPopup: true,
};

function normalizeDailyMoversCount(raw: unknown): DailyMoversDisplayCount {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (n === 1 || n === 3 || n === 5) return n;
  return defaultSettings.dailyMoversCount;
}

function loadSettings(): ChartSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ChartSettings>;
      return {
        ...defaultSettings,
        ...parsed,
        dailyMoversCount: normalizeDailyMoversCount(parsed.dailyMoversCount),
      };
    }
  } catch {
    // Ignore errors
  }
  return defaultSettings;
}

function saveSettings(settings: ChartSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    // Dispatch custom event to sync across components
    window.dispatchEvent(new CustomEvent('chartSettingsChanged', { detail: settings }));
  } catch {
    // Ignore errors
  }
}

export function useChartSettings() {
  const [settings, setSettings] = useState<ChartSettings>(loadSettings);

  useEffect(() => {
    // Listen for changes from other components
    const handleChange = (e: CustomEvent<ChartSettings>) => {
      setSettings(e.detail);
    };
    
    window.addEventListener('chartSettingsChanged', handleChange as EventListener);
    return () => {
      window.removeEventListener('chartSettingsChanged', handleChange as EventListener);
    };
  }, []);

  const updateSettings = useCallback((updates: Partial<ChartSettings>) => {
    setSettings(prev => {
      const newSettings = { ...prev, ...updates };
      saveSettings(newSettings);
      return newSettings;
    });
  }, []);

  return {
    showChart: settings.showChart,
    showTooltip: settings.showTooltip,
    hideAmounts: settings.hideAmounts,
    showNews: settings.showNews,
    showDailyMovers: settings.showDailyMovers !== false,
    dailyMoversCount: normalizeDailyMoversCount(settings.dailyMoversCount),
    showAthPopup: settings.showAthPopup !== false,
    showCalendarEventsPopup: settings.showCalendarEventsPopup !== false,
    setShowChart: (value: boolean) => updateSettings({ showChart: value }),
    setShowTooltip: (value: boolean) => updateSettings({ showTooltip: value }),
    setHideAmounts: (value: boolean) => updateSettings({ hideAmounts: value }),
    setShowNews: (value: boolean) => updateSettings({ showNews: value }),
    setShowDailyMovers: (value: boolean) => updateSettings({ showDailyMovers: value }),
    setDailyMoversCount: (value: DailyMoversDisplayCount) =>
      updateSettings({ dailyMoversCount: normalizeDailyMoversCount(value) }),
    setShowAthPopup: (value: boolean) => updateSettings({ showAthPopup: value }),
    setShowCalendarEventsPopup: (value: boolean) =>
      updateSettings({ showCalendarEventsPopup: value }),
    toggleHideAmounts: () => updateSettings({ hideAmounts: !settings.hideAmounts }),
  };
}
