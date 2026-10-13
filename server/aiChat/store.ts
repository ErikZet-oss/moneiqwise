import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  DEFAULT_CONTEXT_FLAGS,
  type AiChatContextFlags,
  type AiChatGem,
  type AiChatListItem,
  type AiChatMessageMeta,
  type AiChatMessageRow,
  type AiChatRow,
} from "./types";

function parseFlags(raw: unknown): AiChatContextFlags {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    portfolio: o.portfolio !== false,
    dividends: o.dividends !== false,
    watchlist: o.watchlist !== false,
    news: o.news !== false,
    macroAudit: o.macroAudit !== false,
  };
}

function parseStarters(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim().slice(0, 200))
    .slice(0, 8);
}

function mapGem(row: any): AiChatGem {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    color: String(row.color || "#B48CE0"),
    description: String(row.description || ""),
    instructions: String(row.instructions || ""),
    contextFlags: parseFlags(row.context_flags),
    starters: parseStarters(row.starters),
    isDefault: Boolean(row.is_default),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapChat(row: any): AiChatRow {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    gemId: row.gem_id ? String(row.gem_id) : null,
    pinned: Boolean(row.pinned),
    portfolioScope: String(row.portfolio_scope || "all"),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapMessage(row: any): AiChatMessageRow {
  let meta: AiChatMessageMeta | null = null;
  if (row.meta && typeof row.meta === "object") {
    meta = row.meta as AiChatMessageMeta;
  }
  return {
    id: String(row.id),
    chatId: String(row.chat_id),
    role: row.role as "user" | "assistant",
    content: String(row.content),
    meta,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function ensureAiChatTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_chat_gems (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id varchar NOT NULL REFERENCES users(id),
      name varchar(120) NOT NULL,
      color varchar(32) NOT NULL DEFAULT '#B48CE0',
      description varchar(160) NOT NULL DEFAULT '',
      instructions text NOT NULL DEFAULT '',
      context_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
      starters jsonb NOT NULL DEFAULT '[]'::jsonb,
      is_default boolean NOT NULL DEFAULT false,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    );
  `);
  await db.execute(sql`
    ALTER TABLE ai_chat_gems
    ADD COLUMN IF NOT EXISTS description varchar(160) NOT NULL DEFAULT '';
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_chat_gems_user_idx
    ON ai_chat_gems (user_id, updated_at DESC);
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_chats (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id varchar NOT NULL REFERENCES users(id),
      title varchar(255) NOT NULL,
      gem_id varchar REFERENCES ai_chat_gems(id) ON DELETE SET NULL,
      pinned boolean NOT NULL DEFAULT false,
      portfolio_scope varchar(64) NOT NULL DEFAULT 'all',
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_chats_user_updated_idx
    ON ai_chats (user_id, pinned DESC, updated_at DESC);
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_chat_messages (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      chat_id varchar NOT NULL REFERENCES ai_chats(id) ON DELETE CASCADE,
      role varchar(20) NOT NULL,
      content text NOT NULL,
      meta jsonb,
      created_at timestamp DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_chat_messages_chat_idx
    ON ai_chat_messages (chat_id, created_at);
  `);
}

const DEFAULT_GEMS: Array<{
  name: string;
  color: string;
  description: string;
  instructions: string;
  starters: string[];
  contextFlags: AiChatContextFlags;
}> = [
  {
    name: "Dividendový analytik",
    color: "#B48CE0",
    description: "Výnosy, payout, kalendár výplat",
    instructions:
      "Si dividendový analytik MoneIQWise. Hovor po slovensky. Pri každej odpovedi:\n" +
      "1) Zhrň očakávaný dividendový príjem z portfólia (mesačne / do konca roka).\n" +
      "2) Uveď yield, payout ratio a najbližší ex-dividend dátum, ak sú známe.\n" +
      "3) Výsledky daj do tabuľky ai-table (Ticker, Yield, Ex-date, Odhad €).\n" +
      "4) Odporuč HOLD/TRIM podľa príjmu, nie špekulácie. Používaj callout.info pre dátumy výplat.",
    starters: [
      "Aké dividendy ma čakajú tento mesiac?",
      "Ktoré pozície majú najvyšší dividendový výnos?",
      "Koľko hrubých dividend môžem čakať do konca roka?",
      "Ktoré holdingy majú najbližší ex-dividend dátum?",
    ],
    contextFlags: {
      portfolio: true,
      dividends: true,
      watchlist: false,
      news: true,
      macroAudit: false,
    },
  },
  {
    name: "Rizikový manažér",
    color: "#F0667E",
    description: "Koncentrácia, drawdown, riziká",
    instructions:
      "Si rizikový manažér portfólia. Hovor po slovensky. Sleduj:\n" +
      "- koncentráciu (top pozície, sektory),\n" +
      "- drawdown a volatilitu veľkých holdingov,\n" +
      "- koreláciu / klastre (napr. AI, fintech),\n" +
      "- varovania z posledného makro auditu.\n" +
      "Odporúčania formuluj ako TRIM / HOLD / ADD s dôvodom. Použi kpi-grid, ai-table a callout.warning / callout.loss.",
    starters: [
      "Ktoré pozície sú najrizikovejšie a prečo?",
      "Kde mám najväčšiu koncentráciu v portfóliu?",
      "Aké riziká vyplývajú z posledného makro auditu?",
      "Ktorý sektor alebo klaster ma najviac ohrozuje?",
    ],
    contextFlags: {
      portfolio: true,
      dividends: false,
      watchlist: true,
      news: true,
      macroAudit: true,
    },
  },
  {
    name: "Earnings briefing",
    color: "#6BB0F5",
    description: "Pred a po výsledkoch firiem",
    instructions:
      "Pripravuješ earnings briefing pred a po výsledkoch. Hovor po slovensky.\n" +
      "Pre relevantné holdingy zhrň: dátum výsledkov, očakávania, kľúčové metriky (EPS, revenue), sentiment správ a dopad na váhu v portfóliu.\n" +
      "Použi callout.info pre dátumy, callout.warning pre riziká gapu, tabuľku ai-table pre prehľad.",
    starters: [
      "Aké earnings ma čakajú tento mesiac?",
      "Ktoré holdingy majú najbližšie výsledky?",
      "Zhrň čo sledovať pri najbližších earnings v portfóliu",
      "Ktoré výsledky môžu najviac hýbať mojím portfóliom?",
    ],
    contextFlags: {
      portfolio: true,
      dividends: false,
      watchlist: true,
      news: true,
      macroAudit: false,
    },
  },
];

export async function ensureDefaultGems(userId: string): Promise<void> {
  const existing = await db.execute(sql`
    SELECT id, name FROM ai_chat_gems
    WHERE user_id = ${userId} AND is_default = true
  `);
  const byName = new Map(
    (existing.rows as any[]).map((r) => [String(r.name), String(r.id)]),
  );

  for (const gem of DEFAULT_GEMS) {
    const id = byName.get(gem.name);
    if (!id) {
      await db.execute(sql`
        INSERT INTO ai_chat_gems (
          id, user_id, name, color, description, instructions, context_flags, starters, is_default, created_at, updated_at
        ) VALUES (
          gen_random_uuid(),
          ${userId},
          ${gem.name},
          ${gem.color},
          ${gem.description},
          ${gem.instructions},
          ${JSON.stringify(gem.contextFlags)}::jsonb,
          ${JSON.stringify(gem.starters)}::jsonb,
          true,
          NOW(),
          NOW()
        )
      `);
      continue;
    }
    // Doplň preddefinovaný text len ak ešte chýba popis (neruší ručné úpravy).
    await db.execute(sql`
      UPDATE ai_chat_gems SET
        color = ${gem.color},
        description = ${gem.description},
        instructions = ${gem.instructions},
        context_flags = ${JSON.stringify(gem.contextFlags)}::jsonb,
        starters = ${JSON.stringify(gem.starters)}::jsonb,
        updated_at = NOW()
      WHERE id = ${id}
        AND user_id = ${userId}
        AND is_default = true
        AND COALESCE(description, '') = ''
    `);
  }
}

export async function listGemsForUser(userId: string): Promise<AiChatGem[]> {
  await ensureDefaultGems(userId);
  const result = await db.execute(sql`
    SELECT * FROM ai_chat_gems
    WHERE user_id = ${userId}
    ORDER BY is_default DESC, updated_at DESC
  `);
  return (result.rows as any[]).map(mapGem);
}

export async function getGemForUser(userId: string, gemId: string): Promise<AiChatGem | null> {
  const result = await db.execute(sql`
    SELECT * FROM ai_chat_gems
    WHERE id = ${gemId} AND user_id = ${userId}
    LIMIT 1
  `);
  const row = result.rows[0];
  return row ? mapGem(row) : null;
}

export async function createGem(input: {
  userId: string;
  name: string;
  color?: string;
  description?: string;
  instructions?: string;
  contextFlags?: Partial<AiChatContextFlags>;
  starters?: string[];
}): Promise<AiChatGem> {
  const flags = { ...DEFAULT_CONTEXT_FLAGS, ...input.contextFlags };
  const starters = parseStarters(input.starters ?? []);
  const result = await db.execute(sql`
    INSERT INTO ai_chat_gems (
      id, user_id, name, color, description, instructions, context_flags, starters, is_default, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      ${input.userId},
      ${input.name.trim().slice(0, 120)},
      ${(input.color || "#B48CE0").slice(0, 32)},
      ${(input.description || "").trim().slice(0, 160)},
      ${(input.instructions || "").slice(0, 2000)},
      ${JSON.stringify(flags)}::jsonb,
      ${JSON.stringify(starters)}::jsonb,
      false,
      NOW(),
      NOW()
    )
    RETURNING *
  `);
  return mapGem(result.rows[0]);
}

export async function updateGem(
  userId: string,
  gemId: string,
  patch: {
    name?: string;
    color?: string;
    description?: string;
    instructions?: string;
    contextFlags?: Partial<AiChatContextFlags>;
    starters?: string[];
  },
): Promise<AiChatGem | null> {
  const existing = await getGemForUser(userId, gemId);
  if (!existing) return null;
  const name = patch.name != null ? patch.name.trim().slice(0, 120) : existing.name;
  const color = patch.color != null ? patch.color.slice(0, 32) : existing.color;
  const description =
    patch.description != null
      ? patch.description.trim().slice(0, 160)
      : existing.description;
  const instructions =
    patch.instructions != null ? patch.instructions.slice(0, 2000) : existing.instructions;
  const flags = patch.contextFlags
    ? { ...existing.contextFlags, ...patch.contextFlags }
    : existing.contextFlags;
  const starters = patch.starters != null ? parseStarters(patch.starters) : existing.starters;
  const result = await db.execute(sql`
    UPDATE ai_chat_gems SET
      name = ${name},
      color = ${color},
      description = ${description},
      instructions = ${instructions},
      context_flags = ${JSON.stringify(flags)}::jsonb,
      starters = ${JSON.stringify(starters)}::jsonb,
      updated_at = NOW()
    WHERE id = ${gemId} AND user_id = ${userId}
    RETURNING *
  `);
  return result.rows[0] ? mapGem(result.rows[0]) : null;
}

export async function deleteGemForUser(userId: string, gemId: string): Promise<boolean> {
  const result = await db.execute(sql`
    DELETE FROM ai_chat_gems
    WHERE id = ${gemId} AND user_id = ${userId}
    RETURNING id
  `);
  return (result.rows?.length ?? 0) > 0;
}

export async function listChatsForUser(
  userId: string,
  opts?: { q?: string; limit?: number },
): Promise<AiChatListItem[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
  const q = opts?.q?.trim();
  const result = q
    ? await db.execute(sql`
        SELECT c.id, c.title, c.gem_id, c.pinned, c.created_at, c.updated_at,
               g.name AS gem_name, g.color AS gem_color
        FROM ai_chats c
        LEFT JOIN ai_chat_gems g ON g.id = c.gem_id
        WHERE c.user_id = ${userId}
          AND (c.title ILIKE ${"%" + q + "%"})
        ORDER BY c.pinned DESC, c.updated_at DESC
        LIMIT ${limit}
      `)
    : await db.execute(sql`
        SELECT c.id, c.title, c.gem_id, c.pinned, c.created_at, c.updated_at,
               g.name AS gem_name, g.color AS gem_color
        FROM ai_chats c
        LEFT JOIN ai_chat_gems g ON g.id = c.gem_id
        WHERE c.user_id = ${userId}
        ORDER BY c.pinned DESC, c.updated_at DESC
        LIMIT ${limit}
      `);

  return (result.rows as any[]).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    gemId: r.gem_id ? String(r.gem_id) : null,
    gemName: r.gem_name ? String(r.gem_name) : null,
    gemColor: r.gem_color ? String(r.gem_color) : null,
    pinned: Boolean(r.pinned),
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
}

export async function getChatForUser(
  userId: string,
  chatId: string,
): Promise<{ chat: AiChatRow; messages: AiChatMessageRow[]; gem: AiChatGem | null } | null> {
  const chatRes = await db.execute(sql`
    SELECT * FROM ai_chats
    WHERE id = ${chatId} AND user_id = ${userId}
    LIMIT 1
  `);
  const row = chatRes.rows[0] as any;
  if (!row) return null;
  const chat = mapChat(row);
  const msgRes = await db.execute(sql`
    SELECT * FROM ai_chat_messages
    WHERE chat_id = ${chatId}
    ORDER BY created_at ASC
  `);
  const gem = chat.gemId ? await getGemForUser(userId, chat.gemId) : null;
  return {
    chat,
    messages: (msgRes.rows as any[]).map(mapMessage),
    gem,
  };
}

export async function createChat(input: {
  userId: string;
  title?: string;
  gemId?: string | null;
  portfolioScope?: string;
}): Promise<AiChatRow> {
  let gemId: string | null = null;
  if (input.gemId) {
    const gem = await getGemForUser(input.userId, input.gemId);
    if (gem) gemId = gem.id;
  }
  const title = (input.title?.trim() || "Nový chat").slice(0, 255);
  const scope = (input.portfolioScope || "all").slice(0, 64);
  const result = await db.execute(sql`
    INSERT INTO ai_chats (id, user_id, title, gem_id, pinned, portfolio_scope, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      ${input.userId},
      ${title},
      ${gemId},
      false,
      ${scope},
      NOW(),
      NOW()
    )
    RETURNING *
  `);
  return mapChat(result.rows[0]);
}

export async function updateChat(
  userId: string,
  chatId: string,
  patch: {
    title?: string;
    pinned?: boolean;
    gemId?: string | null;
  },
): Promise<AiChatRow | null> {
  const loaded = await getChatForUser(userId, chatId);
  if (!loaded) return null;
  const title =
    patch.title != null ? patch.title.trim().slice(0, 255) || loaded.chat.title : loaded.chat.title;
  const pinned = patch.pinned != null ? Boolean(patch.pinned) : loaded.chat.pinned;
  let gemId = loaded.chat.gemId;
  if (patch.gemId !== undefined) {
    if (patch.gemId === null) gemId = null;
    else {
      const gem = await getGemForUser(userId, patch.gemId);
      gemId = gem ? gem.id : loaded.chat.gemId;
    }
  }
  const result = await db.execute(sql`
    UPDATE ai_chats SET
      title = ${title},
      pinned = ${pinned},
      gem_id = ${gemId},
      updated_at = NOW()
    WHERE id = ${chatId} AND user_id = ${userId}
    RETURNING *
  `);
  return result.rows[0] ? mapChat(result.rows[0]) : null;
}

export async function deleteChatForUser(userId: string, chatId: string): Promise<boolean> {
  const result = await db.execute(sql`
    DELETE FROM ai_chats
    WHERE id = ${chatId} AND user_id = ${userId}
    RETURNING id
  `);
  return (result.rows?.length ?? 0) > 0;
}

export async function insertMessage(input: {
  chatId: string;
  role: "user" | "assistant";
  content: string;
  meta?: AiChatMessageMeta | null;
}): Promise<AiChatMessageRow> {
  const metaJson = input.meta ? JSON.stringify(input.meta) : null;
  const result = await db.execute(sql`
    INSERT INTO ai_chat_messages (id, chat_id, role, content, meta, created_at)
    VALUES (
      gen_random_uuid(),
      ${input.chatId},
      ${input.role},
      ${input.content},
      ${metaJson}::jsonb,
      NOW()
    )
    RETURNING *
  `);
  await db.execute(sql`
    UPDATE ai_chats SET updated_at = NOW() WHERE id = ${input.chatId}
  `);
  return mapMessage(result.rows[0]);
}
