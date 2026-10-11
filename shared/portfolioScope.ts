import { PORTFOLIO_CATEGORY_SCOPE_PREFIX } from "./schema";

export type PortfolioScopeKind = "all" | "single" | "category";

export type ParsedPortfolioScope =
  | { kind: "all" }
  | { kind: "single"; portfolioId: string }
  | { kind: "category"; categoryId: string };

/** Encode category selection for `?portfolio=` query param. */
export function encodeCategoryScope(categoryId: string): string {
  return `${PORTFOLIO_CATEGORY_SCOPE_PREFIX}${categoryId}`;
}

export function parsePortfolioScope(raw: string | null | undefined): ParsedPortfolioScope {
  const value = (raw ?? "all").trim() || "all";
  if (value === "all") return { kind: "all" };
  if (value.startsWith(PORTFOLIO_CATEGORY_SCOPE_PREFIX)) {
    const categoryId = value.slice(PORTFOLIO_CATEGORY_SCOPE_PREFIX.length).trim();
    if (!categoryId) return { kind: "all" };
    return { kind: "category", categoryId };
  }
  return { kind: "single", portfolioId: value };
}

export function isCategoryScopeParam(raw: string | null | undefined): boolean {
  return parsePortfolioScope(raw).kind === "category";
}
