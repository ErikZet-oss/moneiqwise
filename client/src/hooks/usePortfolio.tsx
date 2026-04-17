import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { BrokerCode } from "@shared/schema";

export interface Portfolio {
  id: string;
  userId: string;
  name: string;
  brokerCode: BrokerCode | null;
  isDefault: boolean;
  createdAt: Date;
}

interface PortfolioContextType {
  portfolios: Portfolio[];
  selectedPortfolioId: string | null;
  selectedPortfolio: Portfolio | null;
  setSelectedPortfolioId: (id: string | null) => void;
  isLoading: boolean;
  isAllPortfolios: boolean;
  createPortfolio: (name: string, brokerCode?: BrokerCode) => Promise<Portfolio>;
  updatePortfolio: (id: string, name: string, brokerCode?: BrokerCode | null) => Promise<Portfolio>;
  deletePortfolio: (id: string) => Promise<void>;
  getQueryParam: () => string;
}

const PortfolioContext = createContext<PortfolioContextType | undefined>(undefined);

const STORAGE_KEY = "portfolioTracker_selectedPortfolio";

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const [selectedPortfolioId, setSelectedPortfolioIdState] = useState<string | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved || "all";
  });

  const { data: portfolios = [], isLoading } = useQuery<Portfolio[]>({
    queryKey: ["/api/portfolios"],
  });

  useEffect(() => {
    if (selectedPortfolioId) {
      localStorage.setItem(STORAGE_KEY, selectedPortfolioId);
    }
  }, [selectedPortfolioId]);

  useEffect(() => {
    if (portfolios.length > 0 && selectedPortfolioId !== "all") {
      const exists = portfolios.some(p => p.id === selectedPortfolioId);
      if (!exists) {
        const defaultPortfolio = portfolios.find(p => p.isDefault) || portfolios[0];
        if (defaultPortfolio) {
          setSelectedPortfolioIdState(defaultPortfolio.id);
        }
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
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name, brokerCode }: { id: string; name: string; brokerCode?: BrokerCode | null }) => {
      const response = await apiRequest("PUT", `/api/portfolios/${id}`, { name, brokerCode });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/portfolios/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
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

  return (
    <PortfolioContext.Provider
      value={{
        portfolios,
        selectedPortfolioId,
        selectedPortfolio,
        setSelectedPortfolioId,
        isLoading,
        isAllPortfolios,
        createPortfolio,
        updatePortfolio,
        deletePortfolio,
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
