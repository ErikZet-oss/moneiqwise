export type FinvizCategoryId =
  | "all"
  | "technology"
  | "healthcare"
  | "financial"
  | "energy"
  | "utilities"
  | "consumer_cyclical"
  | "consumer_defensive"
  | "industrials"
  | "basic_materials"
  | "communication"
  | "real_estate";

export type FinvizCategory = {
  id: FinvizCategoryId;
  label: string;
  /** Finviz `f=` sector code, null = všetky sektory */
  filter: string | null;
};

/** Finviz sector filter kódy (sec_*). */
export const FINVIZ_CATEGORIES: FinvizCategory[] = [
  { id: "all", label: "Všetky sektory", filter: null },
  { id: "technology", label: "Technológie", filter: "sec_technology" },
  { id: "healthcare", label: "Zdravotníctvo", filter: "sec_healthcare" },
  { id: "financial", label: "Financie", filter: "sec_financial" },
  { id: "energy", label: "Energetika", filter: "sec_energy" },
  { id: "utilities", label: "Utility", filter: "sec_utilities" },
  { id: "consumer_cyclical", label: "Spotrebný tovar — cyklický", filter: "sec_consumercyclical" },
  { id: "consumer_defensive", label: "Spotrebný tovar — defenzívny", filter: "sec_consumerdefensive" },
  { id: "industrials", label: "Priemysel", filter: "sec_industrials" },
  { id: "basic_materials", label: "Materiály", filter: "sec_basicmaterials" },
  { id: "communication", label: "Komunikácie", filter: "sec_communicationservices" },
  { id: "real_estate", label: "Nehnuteľnosti", filter: "sec_realestate" },
];

export function isFinvizCategoryId(value: string): value is FinvizCategoryId {
  return FINVIZ_CATEGORIES.some((c) => c.id === value);
}

export function stripSectorFilters(filters: string[]): string[] {
  return filters.filter((f) => !f.startsWith("sec_"));
}

export function categoryIdFromFilters(filters: string[]): FinvizCategoryId {
  const sec = filters.find((f) => f.startsWith("sec_"));
  if (!sec) return "all";
  return FINVIZ_CATEGORIES.find((c) => c.filter === sec)?.id ?? "all";
}

export function applyCategoryToFilters(filters: string[], categoryId: string): string[] {
  const base = stripSectorFilters(filters);
  const cat = FINVIZ_CATEGORIES.find((c) => c.id === categoryId);
  if (!cat?.filter) return base;
  return [cat.filter, ...base];
}

export function resolveStrategyFilters(baseFilters: string[], categoryId: string): string[] {
  return applyCategoryToFilters(baseFilters, categoryId);
}
