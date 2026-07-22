import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  DEFAULT_AI_PROMPTS,
  type AiPromptKey,
  type AiPromptSet,
} from "./defaultPrompts";

export async function ensureAiScannerPromptsTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_scanner_prompts (
      user_id varchar PRIMARY KEY REFERENCES users(id),
      strategy_prompt text,
      ticker_prompt text,
      chat_prompt text,
      updated_at timestamp DEFAULT now()
    );
  `);
}

function coalescePrompt(raw: unknown, fallback: string): string {
  if (typeof raw === "string" && raw.trim().length > 0) return raw;
  return fallback;
}

export async function getPromptsForUser(userId: string): Promise<{
  prompts: AiPromptSet;
  isCustom: Record<AiPromptKey, boolean>;
}> {
  await ensureAiScannerPromptsTable();
  const result = await db.execute(sql`
    SELECT strategy_prompt, ticker_prompt, chat_prompt
    FROM ai_scanner_prompts
    WHERE user_id = ${userId}
    LIMIT 1
  `);
  const row = result.rows[0] as
    | { strategy_prompt?: string | null; ticker_prompt?: string | null; chat_prompt?: string | null }
    | undefined;

  const prompts: AiPromptSet = {
    strategy: coalescePrompt(row?.strategy_prompt, DEFAULT_AI_PROMPTS.strategy),
    ticker: coalescePrompt(row?.ticker_prompt, DEFAULT_AI_PROMPTS.ticker),
    chat: coalescePrompt(row?.chat_prompt, DEFAULT_AI_PROMPTS.chat),
  };

  return {
    prompts,
    isCustom: {
      strategy: Boolean(row?.strategy_prompt?.trim()),
      ticker: Boolean(row?.ticker_prompt?.trim()),
      chat: Boolean(row?.chat_prompt?.trim()),
    },
  };
}

export async function savePromptsForUser(
  userId: string,
  patch: Partial<AiPromptSet>,
): Promise<AiPromptSet> {
  await ensureAiScannerPromptsTable();
  const current = await getPromptsForUser(userId);
  const next: AiPromptSet = {
    strategy: patch.strategy?.trim() ? patch.strategy : current.prompts.strategy,
    ticker: patch.ticker?.trim() ? patch.ticker : current.prompts.ticker,
    chat: patch.chat?.trim() ? patch.chat : current.prompts.chat,
  };

  // Ak používateľ uloží text totožný s defaultom, uložíme ho aj tak (explicitná kópia).
  await db.execute(sql`
    INSERT INTO ai_scanner_prompts (user_id, strategy_prompt, ticker_prompt, chat_prompt, updated_at)
    VALUES (${userId}, ${next.strategy}, ${next.ticker}, ${next.chat}, NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET
      strategy_prompt = EXCLUDED.strategy_prompt,
      ticker_prompt = EXCLUDED.ticker_prompt,
      chat_prompt = EXCLUDED.chat_prompt,
      updated_at = NOW()
  `);

  return next;
}

export async function resetPromptsForUser(
  userId: string,
  keys?: AiPromptKey[],
): Promise<AiPromptSet> {
  await ensureAiScannerPromptsTable();
  const resetAll = !keys || keys.length === 0;
  const current = await getPromptsForUser(userId);

  const next: AiPromptSet = {
    strategy:
      resetAll || keys?.includes("strategy")
        ? DEFAULT_AI_PROMPTS.strategy
        : current.prompts.strategy,
    ticker:
      resetAll || keys?.includes("ticker") ? DEFAULT_AI_PROMPTS.ticker : current.prompts.ticker,
    chat: resetAll || keys?.includes("chat") ? DEFAULT_AI_PROMPTS.chat : current.prompts.chat,
  };

  if (resetAll) {
    await db.execute(sql`DELETE FROM ai_scanner_prompts WHERE user_id = ${userId}`);
    return { ...DEFAULT_AI_PROMPTS };
  }

  await db.execute(sql`
    INSERT INTO ai_scanner_prompts (user_id, strategy_prompt, ticker_prompt, chat_prompt, updated_at)
    VALUES (${userId}, ${next.strategy}, ${next.ticker}, ${next.chat}, NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET
      strategy_prompt = EXCLUDED.strategy_prompt,
      ticker_prompt = EXCLUDED.ticker_prompt,
      chat_prompt = EXCLUDED.chat_prompt,
      updated_at = NOW()
  `);

  return next;
}
