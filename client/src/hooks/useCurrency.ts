import { useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Currency } from "@shared/schema";
import { getTickerCostCurrency, getTickerCurrency } from "@shared/tickerCurrency";
import type { HoldingWithCostCurrency } from "@shared/holdingCostCurrency";
import type { TradeCurrency } from "@shared/transactionEur";

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
  preferredCurrency: Currency;
  /** null / undefined = rovnaká ako mena zobrazenia */
  averageCostDisplayCurrency?: Currency | null;
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

  const averageCostDisplayCurrency: Currency = useMemo(() => {
    const c = settings?.averageCostDisplayCurrency;
    if (c === "EUR" || c === "USD") return c;
    return currency;
  }, [settings?.averageCostDisplayCurrency, currency]);

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

  /** Priemerná nákupná cena: prepočet do `averageCostDisplayCurrency` (EUR/USD alebo mena zobrazenia). */
  const convertAverageCostPrice = useCallback(
    (price: number, sourceCurrency: "EUR" | "USD" | "GBP" | "CZK" | "PLN"): number => {
      const target = averageCostDisplayCurrency;
      if (sourceCurrency === target) return price;

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

      if (target === "EUR") {
        return eurPrice;
      }
      if (target === "USD") {
        return eurPrice * rate.eurToUsd;
      }
      return eurPrice;
    },
    [averageCostDisplayCurrency, rate],
  );

  // Get currency for a ticker's market quote (re-export shared helper)
  // Get cost currency for average cost / invested (re-export shared helper)

  const formatCurrency = (value: number, showSymbol = true): string => {
    return new Intl.NumberFormat("sk-SK", {
      style: showSymbol ? "currency" : "decimal",
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatAverageCostCurrency = useCallback(
    (value: number, showSymbol = true): string => {
      return new Intl.NumberFormat("sk-SK", {
        style: showSymbol ? "currency" : "decimal",
        currency: averageCostDisplayCurrency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    },
    [averageCostDisplayCurrency],
  );

  // Format with conversion from ticker's native quote currency
  const formatWithConversion = (price: number, ticker: string): string => {
    const sourceCurrency = getTickerCurrency(ticker);
    const converted = convertPrice(price, sourceCurrency);
    return formatCurrency(converted);
  };

  const resolveHoldingCostCurrency = useCallback(
    (holding: Pick<HoldingWithCostCurrency, "ticker" | "costCurrency">): TradeCurrency => {
      if (holding.costCurrency) return holding.costCurrency;
      return getTickerCostCurrency(holding.ticker);
    },
    [],
  );

  return {
    currency,
    averageCostDisplayCurrency,
    exchangeRate: rate,
    isLoading: settingsLoading || rateLoading,
    setCurrency: updateCurrencyMutation.mutate,
    isUpdating: updateCurrencyMutation.isPending,
    convertPrice,
    convertAverageCostPrice,
    getTickerCurrency,
    getTickerCostCurrency,
    resolveHoldingCostCurrency,
    formatCurrency,
    formatAverageCostCurrency,
    formatWithConversion,
  };
}
