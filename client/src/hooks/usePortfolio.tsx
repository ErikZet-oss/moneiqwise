import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { BrokerCode } from "@shared/schema";

export interface Portfolio {
  id: string;
  userId: string;
  name: string;
  brokerCode: BrokerCode | null;
  isDefault: boolean;
  isHidden: boolean;
  sortOrder: number;
  cashBalance: string;
  cashCurrency: string;
  createdAt: Date;
}

interface PortfolioContextType {
  portfolios: Portfolio[];
  allPortfolios: Portfolio[];
  selectedPortfolioId: string | null;
  selectedPortfolio: Portfolio | null;
  setSelectedPortfolioId: (id: string | null) => void;
  isLoading: boolean;
  isAllPortfolios: boolean;
  createPortfolio: (name: string, brokerCode?: BrokerCode) => Promise<Portfolio>;
  updatePortfolio: (id: string, name: string, brokerCode?: BrokerCode | null) => Promise<Portfolio>;
  deletePortfolio: (id: string) => Promise<void>;
  setPortfolioHidden: (id: string, isHidden: boolean) => Promise<Portfolio>;
  reorderPortfolios: (orderedIds: string[]) => Promise<void>;
  getQueryParam: () => string;
}

const PortfolioContext = createContext<PortfolioContextType | undefined>(undefined);

const STORAGE_KEY = "portfolioTracker_selectedPortfolio";

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const [selectedPortfolioId, setSelectedPortfolioIdState] = useState<string | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved || "all";
  });

  const { data: allPortfolios = [], isLoading } = useQuery<Portfolio[]>({
    queryKey: ["/api/portfolios", "all"],
    queryFn: async () => {
      const res = await fetch("/api/portfolios?includeHidden=true", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch portfolios");
      return res.json();
    },
    // Globálne refetchOnMount: false + persist cache spôsobovalo starý zoznam na mobile (nové portfólio z PC).
    staleTime: 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const portfolios = useMemo(
    () => allPortfolios.filter((p) => !p.isHidden),
    [allPortfolios]
  );

  useEffect(() => {
    if (selectedPortfolioId) {
      localStorage.setItem(STORAGE_KEY, selectedPortfolioId);
    }
  }, [selectedPortfolioId]);

  useEffect(() => {
    if (portfolios.length > 0 && selectedPortfolioId !== "all") {
      const exists = portfolios.some(p => p.id === selectedPortfolioId);
      if (!exists) {
        // Selected portfolio got hidden or removed – fall back to visible default or "all"
        const defaultPortfolio = portfolios.find(p => p.isDefault) || portfolios[0];
        setSelectedPortfolioIdState(defaultPortfolio?.id || "all");
      }
    }
  }, [portfolios, selectedPortfolioId]);

  const createMutation = useMutation({
    mutationFn: async ({ name, brokerCode }: { name: string; brokerCode?: BrokerCode }) => {
      const response = await apiRequest("POST", "/api/portfolios", { name, brokerCode });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name, brokerCode }: { id: string; name: string; brokerCode?: BrokerCode | null }) => {
      const response = await apiRequest("PUT", `/api/portfolios/${id}`, { name, brokerCode });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
    },
  });

  const setHiddenMutation = useMutation({
    mutationFn: async ({ id, isHidden }: { id: string; isHidden: boolean }) => {
      const response = await apiRequest("PUT", `/api/portfolios/${id}`, { isHidden });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
      // Data for hidden portfolio might have been included in "all" aggregations – refresh them too
      queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/realized-gains"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dividends"] });
      queryClient.invalidateQueries({ queryKey: ["/api/options"] });
      queryClient.invalidateQueries({ queryKey: ["/api/news"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fees"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/portfolios/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/realized-gains"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dividends"] });
      queryClient.invalidateQueries({ queryKey: ["/api/options"] });
      queryClient.invalidateQueries({ queryKey: ["/api/news"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fees"] });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await apiRequest("POST", "/api/portfolios/reorder", { orderedIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
    },
  });

  const isAllPortfolios = selectedPortfolioId === "all";
  const selectedPortfolio = isAllPortfolios 
    ? null 
    : portfolios.find(p => p.id === selectedPortfolioId) || null;

  const getQueryParam = () => {
    if (isAllPortfolios || !selectedPortfolioId) {
      return "all";
    }
    return selectedPortfolioId;
  };

  const setSelectedPortfolioId = (id: string | null) => {
    setSelectedPortfolioIdState(id || "all");
  };

  const createPortfolio = async (name: string, brokerCode?: BrokerCode): Promise<Portfolio> => {
    return createMutation.mutateAsync({ name, brokerCode });
  };

  const updatePortfolio = async (id: string, name: string, brokerCode?: BrokerCode | null): Promise<Portfolio> => {
    return updateMutation.mutateAsync({ id, name, brokerCode });
  };

  const deletePortfolio = async (id: string): Promise<void> => {
    await deleteMutation.mutateAsync(id);
    if (selectedPortfolioId === id) {
      const defaultPortfolio = portfolios.find(p => p.isDefault && p.id !== id);
      setSelectedPortfolioIdState(defaultPortfolio?.id || "all");
    }
  };

  const setPortfolioHidden = async (id: string, isHidden: boolean): Promise<Portfolio> => {
    const result = await setHiddenMutation.mutateAsync({ id, isHidden });
    if (isHidden && selectedPortfolioId === id) {
      const fallback = allPortfolios.find((p) => !p.isHidden && p.id !== id);
      setSelectedPortfolioIdState(fallback?.id || "all");
    }
    return result;
  };

  const reorderPortfolios = async (orderedIds: string[]): Promise<void> => {
    await reorderMutation.mutateAsync(orderedIds);
  };

  return (
    <PortfolioContext.Provider
      value={{
        portfolios,
        allPortfolios,
        selectedPortfolioId,
        selectedPortfolio,
        setSelectedPortfolioId,
        isLoading,
        isAllPortfolios,
        createPortfolio,
        updatePortfolio,
        deletePortfolio,
        setPortfolioHidden,
        reorderPortfolios,
        getQueryParam,
      }}
    >
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  const context = useContext(PortfolioContext);
  if (context === undefined) {
    throw new Error("usePortfolio must be used within a PortfolioProvider");
  }
  return context;
}
