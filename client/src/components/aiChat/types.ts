export type AiChatContextFlags = {
  portfolio: boolean;
  dividends: boolean;
  watchlist: boolean;
  news: boolean;
  macroAudit: boolean;
};

export type AiChatGem = {
  id: string;
  name: string;
  color: string;
  instructions: string;
  contextFlags: AiChatContextFlags;
  starters: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AiChatListItem = {
  id: string;
  title: string;
  gemId: string | null;
  gemName: string | null;
  gemColor: string | null;
  pinned: boolean;
  updatedAt: string;
  createdAt: string;
};

export type AiChatRow = {
  id: string;
  title: string;
  gemId: string | null;
  pinned: boolean;
  portfolioScope: string;
  createdAt: string;
  updatedAt: string;
};

export type AiChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: { toolSteps?: string[]; sources?: Array<{ id: string; title: string; url?: string }> } | null;
  createdAt: string;
};

export const SUGGESTED_PROMPTS = [
  { icon: "chart" as const, text: "Ako sa darilo môjmu portfóliu tento týždeň?" },
  { icon: "shield" as const, text: "Ktoré pozície sú najrizikovejšie a prečo?" },
  { icon: "news" as const, text: "Zhrň správy k mojim top 5 pozíciám" },
  { icon: "coin" as const, text: "Aké dividendy ma čakajú do konca roka?" },
];

export const GEM_COLORS = ["#B48CE0", "#6BB0F5", "#2FDAB8", "#F2B84B", "#F0667E"] as const;
