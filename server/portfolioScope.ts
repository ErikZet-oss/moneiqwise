import {
  encodeCategoryScope,
  parsePortfolioScope,
  type ParsedPortfolioScope,
} from "@shared/portfolioScope";
import { storage } from "./storage";

export { encodeCategoryScope, parsePortfolioScope };
export type { ParsedPortfolioScope };

/**
 * Normalize `?portfolio=` for storage/API layers that already understand:
 * - `"all"`
 * - single portfolio uuid
 * - comma-separated portfolio ids (multi aggregate)
 *
 * Category scopes (`cat:<id>`) expand to visible portfolio ids in that category.
 * Empty category → `"__empty__"` (no rows).
 */
export async function normalizePortfolioParam(
  userId: string,
  raw: string | null | undefined,
): Promise<string> {
  const scope = parsePortfolioScope(raw);
  if (scope.kind === "all") return "all";
  if (scope.kind === "single") return scope.portfolioId;

  const ids = await storage.getVisiblePortfolioIdsInCategory(userId, scope.categoryId);
  if (ids.length === 0) return "__empty__";
  if (ids.length === 1) return ids[0]!;
  return ids.join(",");
}

export async function resolveCategoryLabel(
  userId: string,
  categoryId: string,
): Promise<string | null> {
  const cat = await storage.getPortfolioCategoryById(categoryId, userId);
  return cat?.name ?? null;
}
