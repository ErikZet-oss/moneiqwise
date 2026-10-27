/**
 * Path segment for GET /api/portfolios/:id/asset-lots.
 *
 * Aggregated holdings (all / category / multi) wipe `holding.portfolioId` to null.
 * That must NOT be treated as "unassigned" — use the current dashboard scope instead.
 */
export function assetLotsPortfolioPath(
  holdingPortfolioId: string | null | undefined,
  portfolioParam: string,
): string {
  if (holdingPortfolioId != null && holdingPortfolioId !== "" && holdingPortfolioId !== "all") {
    return holdingPortfolioId;
  }
  const scope = (portfolioParam || "all").trim() || "all";
  if (scope === "all" || scope.startsWith("cat:") || scope.includes(",")) {
    return scope;
  }
  return "unassigned";
}
