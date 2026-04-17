import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Currency } from "@shared/schema";

interface ExchangeRate {
  eurToUsd: number;
  usdToEur: number;
  eurToCzk: number;
  czkToEur: number;
  eurToPln: number;
  plnToEur: number;
  eurToGbp: number;
  gbpToEur: number;
}

interface Settings {
  alphaVantageKey: string | null;
  finnhubKey: string | null;
  preferredCurrency: Currency;
}

const defaultRates: ExchangeRate = {
  eurToUsd: 1.08,
  usdToEur: 0.926,
  eurToCzk: 25.3,
  czkToEur: 0.0395,
  eurToPln: 4.3,
  plnToEur: 0.233,
  eurToGbp: 0.85,
  gbpToEur: 1.18,
};

export function useCurrency() {
  const { data: settings, isLoading: settingsLoading } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const { data: exchangeRate, isLoading: rateLoading } = useQuery<ExchangeRate>({
    queryKey: ["/api/exchange-rate"],
    staleTime: 60 * 60 * 1000, // 1 hour
  });

  const updateCurrencyMutation = useMutation({
    mutationFn: async (currency: Currency) => {
      return await apiRequest("POST", "/api/settings", { preferredCurrency: currency });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
  });

  const currency: Currency = settings?.preferredCurrency || "EUR";
  const rate = exchangeRate || defaultRates;

  // Convert price based on source currency and target currency
  const convertPrice = (price: number, sourceCurrency: "EUR" | "USD" | "GBP" | "CZK" | "PLN"): number => {
    // If same currency, no conversion needed
    if (sourceCurrency === currency) return price;
    
    // First convert source currency to EUR
    let eurPrice = price;
    if (sourceCurrency === "USD") {
      eurPrice = price * rate.usdToEur;
    } else if (sourceCurrency === "GBP") {
      eurPrice = price * rate.gbpToEur;
    } else if (sourceCurrency === "CZK") {
      eurPrice = price * rate.czkToEur;
    } else if (sourceCurrency === "PLN") {
      eurPrice = price * rate.plnToEur;
    }
    
    // Then convert from EUR to target currency
    if (currency === "EUR") {
      return eurPrice;
    } else if (currency === "USD") {
      return eurPrice * rate.eurToUsd;
    }
    
    return eurPrice; // Default to EUR
  };

  // Get currency for a ticker
  const getTickerCurrency = (ticker: string): "EUR" | "USD" | "GBP" | "CZK" | "PLN" => {
    const upperTicker = ticker.toUpperCase();
    // German exchanges (XETRA, Frankfurt, Berlin, Düsseldorf, Hamburg, Stuttgart, Munich)
    if (upperTicker.endsWith(".DE") || upperTicker.endsWith(".F") ||
        upperTicker.endsWith(".BE") || upperTicker.endsWith(".DU") ||
        upperTicker.endsWith(".HM") || upperTicker.endsWith(".SG") ||
        upperTicker.endsWith(".MU")) {
      return "EUR";
    }
    // Other European exchanges (EUR)
    if (upperTicker.endsWith(".PA") || upperTicker.endsWith(".AS") || 
        upperTicker.endsWith(".MI") || upperTicker.endsWith(".VI") ||
        upperTicker.endsWith(".BR") || upperTicker.endsWith(".SW")) {
      return "EUR";
    }
    // Prague Stock Exchange (CZK)
    if (upperTicker.endsWith(".PR")) {
      return "CZK";
    }
    // Warsaw Stock Exchange (PLN)
    if (upperTicker.endsWith(".WA")) {
      return "PLN";
    }
    if (upperTicker.endsWith(".L")) {
      return "GBP";
    }
    return "USD";
  };

  // Format currency with proper symbol
  const formatCurrency = (value: number, showSymbol = true): string => {
    const formatted = new Intl.NumberFormat("sk-SK", {
      style: showSymbol ? "currency" : "decimal",
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
    return formatted;
  };

  // Format with conversion from ticker's native currency
  const formatWithConversion = (price: number, ticker: string): string => {
    const sourceCurrency = getTickerCurrency(ticker);
    const converted = convertPrice(price, sourceCurrency);
    return formatCurrency(converted);
  };

  return {
    currency,
    exchangeRate: rate,
    isLoading: settingsLoading || rateLoading,
    setCurrency: updateCurrencyMutation.mutate,
    isUpdating: updateCurrencyMutation.isPending,
    convertPrice,
    getTickerCurrency,
    formatCurrency,
    formatWithConversion,
  };
}
