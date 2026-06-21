/** Virtuálny ticker pre fyzické striebro (1 ks = 1 trójska unca). */
export const PHYSICAL_SILVER_TICKER = "PM:XAG" as const;

export const PHYSICAL_SILVER_DISPLAY_NAME = "Striebro 1 oz";

/** brokerCode portfólia pre fyzické strieborné mince. */
export const SILVER_PORTFOLIO_BROKER = "silver" as const;

export function isPhysicalSilverTicker(ticker: string | null | undefined): boolean {
  return (ticker ?? "").trim().toUpperCase() === PHYSICAL_SILVER_TICKER;
}

export function isPhysicalMetalTicker(ticker: string | null | undefined): boolean {
  const u = (ticker ?? "").trim().toUpperCase();
  return u.startsWith("PM:");
}

export function isSilverPortfolio(brokerCode: string | null | undefined): boolean {
  return brokerCode === SILVER_PORTFOLIO_BROKER;
}
