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

/** Filter value on Portfóliá overview: all | categoryId | uncategorized */
export const OVERVIEW_CATEGORY_ALL = "all";
export const OVERVIEW_CATEGORY_UNCATEGORIZED = "uncategorized";

export function filterPortfoliosByOverviewCategory(
  portfolios: Portfolio[],
  filter: string,
): Portfolio[] {
  if (!filter || filter === OVERVIEW_CATEGORY_ALL) return portfolios;
  if (filter === OVERVIEW_CATEGORY_UNCATEGORIZED) {
    return portfolios.filter((p) => !p.categoryId);
  }
  return portfolios.filter((p) => p.categoryId === filter);
}

export function overviewCategoryLabel(
  filter: string,
  categories: PortfolioCategory[],
): string {
  if (!filter || filter === OVERVIEW_CATEGORY_ALL) return "Všetky portfóliá";
  if (filter === OVERVIEW_CATEGORY_UNCATEGORIZED) return "Bez kategórie";
  return categories.find((c) => c.id === filter)?.name ?? "Portfóliá";
}

/** Figma dropdown options: „Všetky kategórie“ + „Názov · N“. */
export function overviewCategorySelectOptions(
  portfolios: Portfolio[],
  categories: PortfolioCategory[],
): Array<{ value: string; label: string }> {
  const uncategorizedCount = portfolios.filter((p) => !p.categoryId).length;
  const options: Array<{ value: string; label: string }> = [
    { value: OVERVIEW_CATEGORY_ALL, label: "Všetky kategórie" },
  ];
  for (const category of categories) {
    const count = portfolios.filter((p) => p.categoryId === category.id).length;
    options.push({
      value: category.id,
      label: `${category.name} · ${count}`,
    });
  }
  options.push({
    value: OVERVIEW_CATEGORY_UNCATEGORIZED,
    label: `Bez kategórie · ${uncategorizedCount}`,
  });
  return options;
}
