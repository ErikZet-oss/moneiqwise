import { sql } from "drizzle-orm";
import { db } from "../db";
import Anthropic from "@anthropic-ai/sdk";
import { formatAnthropicError } from "./claudeEvaluator";

export type ChatKind = "strategy" | "ticker";

export type ChatMessageRow = {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string | Date;
};

export type ChatRow = {
  id: string;
  userId: string;
  title: string;
  kind: ChatKind;
  context: unknown;
  createdAt: string | Date;
  updatedAt: string | Date;
};

const MODEL = process.env.ANTHROPIC_MODEL?.trim().replace(/^["']|["']$/g, "") || "claude-sonnet-5";

export async function ensureAiScannerChatTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_scanner_chats (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id varchar NOT NULL REFERENCES users(id),
      title varchar(255) NOT NULL,
      kind varchar(32) NOT NULL,
      context jsonb NOT NULL,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_scanner_chats_user_updated_idx
    ON ai_scanner_chats (user_id, updated_at DESC);
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_scanner_chat_messages (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      chat_id varchar NOT NULL REFERENCES ai_scanner_chats(id) ON DELETE CASCADE,
      role varchar(20) NOT NULL,
      content text NOT NULL,
      created_at timestamp DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ai_scanner_chat_messages_chat_idx
    ON ai_scanner_chat_messages (chat_id, created_at);
  `);
}

export async function listChatsByUser(userId: string, limit = 30): Promise<
  Array<{ id: string; title: string; kind: ChatKind; updatedAt: string; createdAt: string }>
> {
  const result = await db.execute(sql`
    SELECT id, title, kind, created_at, updated_at
    FROM ai_scanner_chats
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `);
  return (result.rows as any[]).map((r) => ({
    id: String(r.id),
    title: String(r.title),
    kind: r.kind as ChatKind,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
}

export async function getChatForUser(
  userId: string,
  chatId: string,
): Promise<{ chat: ChatRow; messages: ChatMessageRow[] } | null> {
  const chatRes = await db.execute(sql`
    SELECT id, user_id, title, kind, context, created_at, updated_at
    FROM ai_scanner_chats
    WHERE id = ${chatId} AND user_id = ${userId}
    LIMIT 1
  `);
  const row = chatRes.rows[0] as any;
  if (!row) return null;

  const msgRes = await db.execute(sql`
    SELECT id, chat_id, role, content, created_at
    FROM ai_scanner_chat_messages
    WHERE chat_id = ${chatId}
    ORDER BY created_at ASC
  `);

  return {
    chat: {
      id: String(row.id),
      userId: String(row.user_id),
      title: String(row.title),
      kind: row.kind as ChatKind,
      context: row.context,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    messages: (msgRes.rows as any[]).map((m) => ({
      id: String(m.id),
      chatId: String(m.chat_id),
      role: m.role as "user" | "assistant",
      content: String(m.content),
      createdAt: m.created_at,
    })),
  };
}

export async function createChat(input: {
  userId: string;
  title: string;
  kind: ChatKind;
  context: unknown;
}): Promise<ChatRow> {
  const result = await db.execute(sql`
    INSERT INTO ai_scanner_chats (id, user_id, title, kind, context, created_at, updated_at)
    VALUES (gen_random_uuid(), ${input.userId}, ${input.title.slice(0, 255)}, ${input.kind}, ${JSON.stringify(input.context)}::jsonb, NOW(), NOW())
    RETURNING id, user_id, title, kind, context, created_at, updated_at
  `);
  const row = result.rows[0] as any;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    kind: row.kind as ChatKind,
    context: row.context,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function insertMessage(chatId: string, role: "user" | "assistant", content: string): Promise<ChatMessageRow> {
  const result = await db.execute(sql`
    INSERT INTO ai_scanner_chat_messages (id, chat_id, role, content, created_at)
    VALUES (gen_random_uuid(), ${chatId}, ${role}, ${content}, NOW())
    RETURNING id, chat_id, role, content, created_at
  `);
  const m = result.rows[0] as any;
  await db.execute(sql`
    UPDATE ai_scanner_chats SET updated_at = NOW() WHERE id = ${chatId}
  `);
  return {
    id: String(m.id),
    chatId: String(m.chat_id),
    role: m.role as "user" | "assistant",
    content: String(m.content),
    createdAt: m.created_at,
  };
}

function getAnthropicClient(): Anthropic {
  const raw = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  const key = raw.replace(/^["']|["']$/g, "").trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY_MISSING");
  return new Anthropic({ apiKey: key });
}

function buildSystemPrompt(kind: ChatKind, context: unknown): string {
  return `Si investičný asistent v appke Moneiqwise (AI Skener). Odpovedaj PO SLOVENSKY, stručne a prakticky.
Máš kontext z poslednej analýzy (typ: ${kind}):
${JSON.stringify(context, null, 2)}

Odpovedaj na otázky používateľa k tomuto kontextu. Ak niečo nevieš z dát, povedz to otvorene. Nepíš investičné rady ako garanciu výnosu.`;
}

export async function appendUserMessageAndReply(input: {
  userId: string;
  chatId: string;
  content: string;
}): Promise<{ userMessage: ChatMessageRow; assistantMessage: ChatMessageRow }> {
  const loaded = await getChatForUser(input.userId, input.chatId);
  if (!loaded) throw new Error("CHAT_NOT_FOUND");

  const text = input.content.trim();
  if (!text) throw new Error("EMPTY_MESSAGE");
  if (text.length > 4000) throw new Error("MESSAGE_TOO_LONG");

  const userMessage = await insertMessage(input.chatId, "user", text);

  const history = [
    ...loaded.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: text },
  ];

  // Anthropic: only user/assistant in messages; system separate
  const client = getAnthropicClient();
  let assistantText: string;
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system: buildSystemPrompt(loaded.chat.kind, loaded.chat.context),
      messages: history.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });
    const block = msg.content.find((b) => b.type === "text");
    assistantText =
      block && block.type === "text" ? block.text.trim() : "Nepodarilo sa zostaviť odpoveď.";
  } catch (err) {
    // still save user message; surface error to caller
    const detail = formatAnthropicError(err);
    throw new Error(detail);
  }

  const assistantMessage = await insertMessage(input.chatId, "assistant", assistantText);
  return { userMessage, assistantMessage };
}

export async function deleteChatForUser(userId: string, chatId: string): Promise<boolean> {
  const result = await db.execute(sql`
    DELETE FROM ai_scanner_chats
    WHERE id = ${chatId} AND user_id = ${userId}
    RETURNING id
  `);
  return (result.rows?.length ?? 0) > 0;
}
