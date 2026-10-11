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
  const sum = portfolios.reduce((acc, p) => {
    const n = parseFloat(p.cashBalance || "0");
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);
  return new Intl.NumberFormat("sk-SK", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(sum);
}
