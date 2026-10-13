export type AiChatContextFlags = {
  portfolio: boolean;
  dividends: boolean;
  watchlist: boolean;
  news: boolean;
  macroAudit: boolean;
};

export const DEFAULT_CONTEXT_FLAGS: AiChatContextFlags = {
  portfolio: true,
  dividends: true,
  watchlist: true,
  news: true,
  macroAudit: true,
};

export type AiChatGem = {
  id: string;
  userId: string;
  name: string;
  color: string;
  instructions: string;
  contextFlags: AiChatContextFlags;
  starters: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AiChatRow = {
  id: string;
  userId: string;
  title: string;
  gemId: string | null;
  pinned: boolean;
  portfolioScope: string;
  createdAt: string;
  updatedAt: string;
};

export type AiChatMessageMeta = {
  toolSteps?: string[];
  sources?: Array<{ id: string; title: string; url?: string }>;
};

export type AiChatMessageRow = {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  meta: AiChatMessageMeta | null;
  createdAt: string;
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

export const GEM_COLORS = ["#B48CE0", "#6BB0F5", "#2FDAB8", "#F2B84B", "#F0667E"] as const;
