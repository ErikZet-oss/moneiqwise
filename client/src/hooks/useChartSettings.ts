import { useState, useEffect, useCallback } from "react";

interface ChartSettings {
  showChart: boolean;
  showTooltip: boolean;
  hideAmounts: boolean;
  showNews: boolean;
  /** Najsilnejšie / najslabšie dnes na hlavnom Prehľade (Dashboard `/`), nie na „Všetky portfóliá“. */
  showDailyMovers: boolean;
}

const STORAGE_KEY = "portfolio-chart-settings";

const defaultSettings: ChartSettings = {
  showChart: true,
  showTooltip: false,
  hideAmounts: false,
  showNews: true,
  showDailyMovers: true,
};

function loadSettings(): ChartSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
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
    setShowChart: (value: boolean) => updateSettings({ showChart: value }),
    setShowTooltip: (value: boolean) => updateSettings({ showTooltip: value }),
    setHideAmounts: (value: boolean) => updateSettings({ hideAmounts: value }),
    setShowNews: (value: boolean) => updateSettings({ showNews: value }),
    setShowDailyMovers: (value: boolean) => updateSettings({ showDailyMovers: value }),
    toggleHideAmounts: () => updateSettings({ hideAmounts: !settings.hideAmounts }),
  };
}
