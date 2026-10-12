import { PORTFOLIO_CATEGORY_COLORS, type PortfolioCategoryColor } from "@shared/schema";
import type { Portfolio, PortfolioCategory } from "@/hooks/usePortfolio";

export { PORTFOLIO_CATEGORY_COLORS };
export type { PortfolioCategoryColor };

export type CategoryGroup = {
  category: PortfolioCategory | null;
  portfolios: Portfolio[];
};

/** Categories in sort order, then uncategorized last (only if non-empty or always for settings). */
export function groupPortfoliosByCategory(
  portfolios: Portfolio[],
  categories: PortfolioCategory[],
  opts?: { includeEmptyCategories?: boolean; includeEmptyUncategorized?: boolean },
): CategoryGroup[] {
  const includeEmpty = opts?.includeEmptyCategories ?? true;
  const includeEmptyUncat = opts?.includeEmptyUncategorized ?? true;
  const groups: CategoryGroup[] = [];
  for (const category of categories) {
    const list = portfolios.filter((p) => p.categoryId === category.id);
    if (list.length > 0 || includeEmpty) {
      groups.push({ category, portfolios: list });
    }
  }
  const uncategorized = portfolios.filter((p) => !p.categoryId);
  if (uncategorized.length > 0 || includeEmptyUncat) {
    groups.push({ category: null, portfolios: uncategorized });
  }
  return groups;
}

export function formatCategoryCashSum(portfolios: Portfolio[]): string {
  const sum = sumPortfolioCashEur(portfolios);
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(sum);
}

/** Sum `cashBalance` (EUR ledger) for the given portfolios. */
export function sumPortfolioCashEur(portfolios: Portfolio[]): number {
  return portfolios.reduce((acc, p) => {
    const n = parseFloat(p.cashBalance || "0");
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);
}

/**
 * Visible portfolios that belong to the current dashboard scope
 * (all / one portfolio / one category).
 */
export function portfoliosForScope(
  portfolios: Portfolio[],
  opts: {
    isAllPortfolios: boolean;
    isCategoryScope: boolean;
    selectedCategoryId: string | null | undefined;
    selectedPortfolioId: string | null | undefined;
  },
): Portfolio[] {
  if (opts.isAllPortfolios) return portfolios;
  if (opts.isCategoryScope && opts.selectedCategoryId) {
    return portfolios.filter((p) => p.categoryId === opts.selectedCategoryId);
  }
  if (opts.selectedPortfolioId) {
    const one = portfolios.find((p) => p.id === opts.selectedPortfolioId);
    return one ? [one] : [];
  }
  return [];
}
