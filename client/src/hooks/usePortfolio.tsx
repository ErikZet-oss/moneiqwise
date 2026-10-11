import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { BrokerCode, PortfolioCategoryColor } from "@shared/schema";
import {
  encodeCategoryScope,
  parsePortfolioScope,
  type ParsedPortfolioScope,
} from "@shared/portfolioScope";

export interface Portfolio {
  id: string;
  userId: string;
  name: string;
  brokerCode: BrokerCode | null;
  categoryId: string | null;
  isDefault: boolean;
  isHidden: boolean;
  sortOrder: number;
  cashBalance: string;
  cashCurrency: string;
  createdAt: Date;
}

export interface PortfolioCategory {
  id: string;
  userId: string;
  name: string;
  color: string;
  sortOrder: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

interface PortfolioContextType {
  portfolios: Portfolio[];
  allPortfolios: Portfolio[];
  categories: PortfolioCategory[];
  selectedPortfolioId: string | null;
  selectedPortfolio: Portfolio | null;
  selectedCategory: PortfolioCategory | null;
  selectedScope: ParsedPortfolioScope;
  scopeLabel: string;
  setSelectedPortfolioId: (id: string | null) => void;
  isLoading: boolean;
  isAllPortfolios: boolean;
  isCategoryScope: boolean;
  createPortfolio: (
    name: string,
    brokerCode?: BrokerCode,
    categoryId?: string | null,
  ) => Promise<Portfolio>;
  updatePortfolio: (
    id: string,
    name: string,
    brokerCode?: BrokerCode | null,
    categoryId?: string | null,
  ) => Promise<Portfolio>;
  setPortfolioCategory: (id: string, categoryId: string | null) => Promise<Portfolio>;
  deletePortfolio: (id: string) => Promise<void>;
  setPortfolioHidden: (id: string, isHidden: boolean) => Promise<Portfolio>;
  reorderPortfolios: (orderedIds: string[]) => Promise<void>;
  createCategory: (name: string, color: PortfolioCategoryColor) => Promise<PortfolioCategory>;
  updateCategory: (
    id: string,
    name: string,
    color: PortfolioCategoryColor,
  ) => Promise<PortfolioCategory>;
  deleteCategory: (id: string) => Promise<void>;
  reorderCategories: (orderedIds: string[]) => Promise<void>;
  getQueryParam: () => string;
  encodeCategoryScope: typeof encodeCategoryScope;
}

const PortfolioContext = createContext<PortfolioContextType | undefined>(undefined);

const STORAGE_KEY = "portfolioTracker_selectedPortfolio";

function invalidatePortfolioDataQueries() {
  queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
  queryClient.invalidateQueries({ queryKey: ["/api/portfolio-categories"] });
  queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
  queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
  queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
  queryClient.invalidateQueries({ queryKey: ["/api/realized-gains"] });
  queryClient.invalidateQueries({ queryKey: ["/api/pnl-breakdown"] });
  queryClient.invalidateQueries({ queryKey: ["/api/portfolio-history"] });
  queryClient.invalidateQueries({ queryKey: ["/api/portfolio/history"] });
  queryClient.invalidateQueries({ queryKey: ["/api/portfolio-performance"] });
  queryClient.invalidateQueries({ queryKey: ["/api/twr"] });
  queryClient.invalidateQueries({ queryKey: ["/api/dividends"] });
  queryClient.invalidateQueries({ queryKey: ["/api/options"] });
  queryClient.invalidateQueries({ queryKey: ["/api/news"] });
  queryClient.invalidateQueries({ queryKey: ["/api/fees"] });
}

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const [selectedPortfolioId, setSelectedPortfolioIdState] = useState<string | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved || "all";
  });

  const { data: allPortfolios = [], isLoading: portfoliosLoading } = useQuery<Portfolio[]>({
    queryKey: ["/api/portfolios", "all"],
    queryFn: async () => {
      const res = await fetch("/api/portfolios?includeHidden=true", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch portfolios");
      return res.json();
    },
    staleTime: 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const { data: categories = [], isLoading: categoriesLoading } = useQuery<PortfolioCategory[]>({
    queryKey: ["/api/portfolio-categories"],
    queryFn: async () => {
      const res = await fetch("/api/portfolio-categories", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch categories");
      return res.json();
    },
    staleTime: 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const portfolios = useMemo(
    () => allPortfolios.filter((p) => !p.isHidden),
    [allPortfolios],
  );

  const selectedScope = useMemo(
    () => parsePortfolioScope(selectedPortfolioId),
    [selectedPortfolioId],
  );
  const isAllPortfolios = selectedScope.kind === "all";
  const isCategoryScope = selectedScope.kind === "category";
  const selectedCategory =
    selectedScope.kind === "category"
      ? categories.find((c) => c.id === selectedScope.categoryId) ?? null
      : null;
  const selectedPortfolio =
    selectedScope.kind === "single"
      ? portfolios.find((p) => p.id === selectedScope.portfolioId) || null
      : null;
  const scopeLabel = isAllPortfolios
    ? "Všetky portfóliá"
    : selectedCategory?.name ?? selectedPortfolio?.name ?? "Portfólio";

  useEffect(() => {
    if (selectedPortfolioId) {
      localStorage.setItem(STORAGE_KEY, selectedPortfolioId);
    }
  }, [selectedPortfolioId]);

  useEffect(() => {
    if (selectedScope.kind === "single") {
      const exists = portfolios.some((p) => p.id === selectedScope.portfolioId);
      if (!exists && portfolios.length > 0) {
        const defaultPortfolio = portfolios.find((p) => p.isDefault) || portfolios[0];
        setSelectedPortfolioIdState(defaultPortfolio?.id || "all");
      }
      return;
    }
    if (selectedScope.kind === "category") {
      const exists = categories.some((c) => c.id === selectedScope.categoryId);
      if (!exists && !categoriesLoading) {
        setSelectedPortfolioIdState("all");
      }
    }
  }, [portfolios, categories, categoriesLoading, selectedScope]);

  const createMutation = useMutation({
    mutationFn: async ({
      name,
      brokerCode,
      categoryId,
    }: {
      name: string;
      brokerCode?: BrokerCode;
      categoryId?: string | null;
    }) => {
      const response = await apiRequest("POST", "/api/portfolios", {
        name,
        brokerCode,
        categoryId: categoryId ?? null,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      name,
      brokerCode,
      categoryId,
    }: {
      id: string;
      name: string;
      brokerCode?: BrokerCode | null;
      categoryId?: string | null;
    }) => {
      const body: Record<string, unknown> = { name, brokerCode };
      if (categoryId !== undefined) body.categoryId = categoryId;
      const response = await apiRequest("PUT", `/api/portfolios/${id}`, body);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
    },
  });

  const setCategoryMutation = useMutation({
    mutationFn: async ({ id, categoryId }: { id: string; categoryId: string | null }) => {
      const response = await apiRequest("PUT", `/api/portfolios/${id}`, { categoryId });
      return response.json();
    },
    onSuccess: () => {
      invalidatePortfolioDataQueries();
    },
  });

  const setHiddenMutation = useMutation({
    mutationFn: async ({ id, isHidden }: { id: string; isHidden: boolean }) => {
      const response = await apiRequest("PUT", `/api/portfolios/${id}`, { isHidden });
      return response.json();
    },
    onSuccess: () => {
      invalidatePortfolioDataQueries();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/portfolios/${id}`);
    },
    onSuccess: () => {
      invalidatePortfolioDataQueries();
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

  const createCategoryMutation = useMutation({
    mutationFn: async ({ name, color }: { name: string; color: PortfolioCategoryColor }) => {
      const response = await apiRequest("POST", "/api/portfolio-categories", { name, color });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio-categories"] });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({
      id,
      name,
      color,
    }: {
      id: string;
      name: string;
      color: PortfolioCategoryColor;
    }) => {
      const response = await apiRequest("PUT", `/api/portfolio-categories/${id}`, { name, color });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio-categories"] });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/portfolio-categories/${id}`);
    },
    onSuccess: () => {
      invalidatePortfolioDataQueries();
    },
  });

  const reorderCategoriesMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await apiRequest("POST", "/api/portfolio-categories/reorder", { orderedIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio-categories"] });
    },
  });

  const getQueryParam = () => {
    if (isAllPortfolios || !selectedPortfolioId) return "all";
    return selectedPortfolioId;
  };

  const setSelectedPortfolioId = (id: string | null) => {
    setSelectedPortfolioIdState(id || "all");
  };

  const createPortfolio = async (
    name: string,
    brokerCode?: BrokerCode,
    categoryId?: string | null,
  ): Promise<Portfolio> => {
    return createMutation.mutateAsync({ name, brokerCode, categoryId });
  };

  const updatePortfolio = async (
    id: string,
    name: string,
    brokerCode?: BrokerCode | null,
    categoryId?: string | null,
  ): Promise<Portfolio> => {
    return updateMutation.mutateAsync({ id, name, brokerCode, categoryId });
  };

  const setPortfolioCategory = async (
    id: string,
    categoryId: string | null,
  ): Promise<Portfolio> => {
    return setCategoryMutation.mutateAsync({ id, categoryId });
  };

  const deletePortfolio = async (id: string): Promise<void> => {
    await deleteMutation.mutateAsync(id);
    if (selectedScope.kind === "single" && selectedScope.portfolioId === id) {
      const defaultPortfolio = portfolios.find((p) => p.isDefault && p.id !== id);
      setSelectedPortfolioIdState(defaultPortfolio?.id || "all");
    }
  };

  const setPortfolioHidden = async (id: string, isHidden: boolean): Promise<Portfolio> => {
    const result = await setHiddenMutation.mutateAsync({ id, isHidden });
    if (isHidden && selectedScope.kind === "single" && selectedScope.portfolioId === id) {
      const fallback = allPortfolios.find((p) => !p.isHidden && p.id !== id);
      setSelectedPortfolioIdState(fallback?.id || "all");
    }
    return result;
  };

  const reorderPortfolios = async (orderedIds: string[]): Promise<void> => {
    await reorderMutation.mutateAsync(orderedIds);
  };

  const createCategory = async (
    name: string,
    color: PortfolioCategoryColor,
  ): Promise<PortfolioCategory> => {
    return createCategoryMutation.mutateAsync({ name, color });
  };

  const updateCategory = async (
    id: string,
    name: string,
    color: PortfolioCategoryColor,
  ): Promise<PortfolioCategory> => {
    return updateCategoryMutation.mutateAsync({ id, name, color });
  };

  const deleteCategory = async (id: string): Promise<void> => {
    await deleteCategoryMutation.mutateAsync(id);
    if (selectedScope.kind === "category" && selectedScope.categoryId === id) {
      setSelectedPortfolioIdState("all");
    }
  };

  const reorderCategories = async (orderedIds: string[]): Promise<void> => {
    await reorderCategoriesMutation.mutateAsync(orderedIds);
  };

  return (
    <PortfolioContext.Provider
      value={{
        portfolios,
        allPortfolios,
        categories,
        selectedPortfolioId,
        selectedPortfolio,
        selectedCategory,
        selectedScope,
        scopeLabel,
        setSelectedPortfolioId,
        isLoading: portfoliosLoading || categoriesLoading,
        isAllPortfolios,
        isCategoryScope,
        createPortfolio,
        updatePortfolio,
        setPortfolioCategory,
        deletePortfolio,
        setPortfolioHidden,
        reorderPortfolios,
        createCategory,
        updateCategory,
        deleteCategory,
        reorderCategories,
        getQueryParam,
        encodeCategoryScope,
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
