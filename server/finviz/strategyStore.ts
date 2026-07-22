import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  categoryIdFromFilters,
  isFinvizCategoryId,
  stripSectorFilters,
  type FinvizCategoryId,
} from "./categories";
import {
  AI_SCANNER_STRATEGIES,
  type AiScannerStrategy,
  type AiScannerStrategyId,
  listStrategies,
  normalizeStrategyFilters,
} from "./strategies";

const STRATEGY_IDS: AiScannerStrategyId[] = ["dip_buyer", "garp", "dividend"];

export type StrategyOverride = {
  label?: string;
  shortLabel?: string;
  description?: string;
  category?: FinvizCategoryId;
  filters?: string[];
};

export type StrategyOverrides = Partial<Record<AiScannerStrategyId, StrategyOverride>>;

export async function ensureAiScannerStrategiesTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_scanner_strategies (
      user_id varchar PRIMARY KEY REFERENCES users(id),
      overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamp DEFAULT now()
    );
  `);
}

function parseOverrides(raw: unknown): StrategyOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as StrategyOverrides;
}

function normalizeCategory(raw: unknown, filters: string[]): FinvizCategoryId {
  if (typeof raw === "string" && isFinvizCategoryId(raw)) return raw;
  return categoryIdFromFilters(filters);
}

function mergeStrategy(id: AiScannerStrategyId, override?: StrategyOverride): AiScannerStrategy {
  const base = AI_SCANNER_STRATEGIES[id];
  if (!override) return { ...base };

  const rawFilters = override.filters ? normalizeStrategyFilters(override.filters) : base.filters;
  const filters = stripSectorFilters(rawFilters);
  const category = normalizeCategory(override.category, rawFilters);

  return {
    id,
    label: override.label?.trim() || base.label,
    shortLabel: override.shortLabel?.trim() || base.shortLabel,
    description: override.description?.trim() || base.description,
    category,
    filters: filters.length ? filters : base.filters,
  };
}

export async function getStrategiesForUser(userId: string): Promise<{
  strategies: AiScannerStrategy[];
  isCustom: Record<AiScannerStrategyId, boolean>;
}> {
  await ensureAiScannerStrategiesTable();
  const result = await db.execute(sql`
    SELECT overrides FROM ai_scanner_strategies WHERE user_id = ${userId} LIMIT 1
  `);
  const row = result.rows[0] as { overrides?: unknown } | undefined;
  const overrides = parseOverrides(row?.overrides);

  const strategies = STRATEGY_IDS.map((id) => mergeStrategy(id, overrides[id]));
  const isCustom = STRATEGY_IDS.reduce(
    (acc, id) => {
      acc[id] = Boolean(overrides[id]);
      return acc;
    },
    {} as Record<AiScannerStrategyId, boolean>,
  );

  return { strategies, isCustom };
}

export async function getStrategyForUser(
  userId: string,
  strategyId: string,
): Promise<AiScannerStrategy | null> {
  if (strategyId !== "dip_buyer" && strategyId !== "garp" && strategyId !== "dividend") {
    return null;
  }
  const { strategies } = await getStrategiesForUser(userId);
  return strategies.find((s) => s.id === strategyId) ?? null;
}

export async function saveStrategiesForUser(
  userId: string,
  patch: Partial<Record<AiScannerStrategyId, StrategyOverride>>,
): Promise<AiScannerStrategy[]> {
  await ensureAiScannerStrategiesTable();
  const current = await getStrategiesForUser(userId);
  const currentOverrides: StrategyOverrides = {};

  for (const s of current.strategies) {
    if (current.isCustom[s.id]) {
      currentOverrides[s.id] = {
        label: s.label,
        shortLabel: s.shortLabel,
        description: s.description,
        category: s.category,
        filters: s.filters,
      };
    }
  }

  for (const id of STRATEGY_IDS) {
    const next = patch[id];
    if (!next) continue;
    currentOverrides[id] = {
      label: next.label?.trim(),
      shortLabel: next.shortLabel?.trim(),
      description: next.description?.trim(),
      category: next.category,
      filters: next.filters ? stripSectorFilters(normalizeStrategyFilters(next.filters)) : undefined,
    };
  }

  await db.execute(sql`
    INSERT INTO ai_scanner_strategies (user_id, overrides, updated_at)
    VALUES (${userId}, ${JSON.stringify(currentOverrides)}::jsonb, NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET overrides = EXCLUDED.overrides, updated_at = NOW()
  `);

  const saved = await getStrategiesForUser(userId);
  return saved.strategies;
}

export async function resetStrategiesForUser(
  userId: string,
  keys?: AiScannerStrategyId[],
): Promise<AiScannerStrategy[]> {
  await ensureAiScannerStrategiesTable();
  const resetAll = !keys || keys.length === 0;

  if (resetAll) {
    await db.execute(sql`DELETE FROM ai_scanner_strategies WHERE user_id = ${userId}`);
    return listStrategies();
  }

  const current = await getStrategiesForUser(userId);
  const overrides: StrategyOverrides = {};
  for (const s of current.strategies) {
    if (current.isCustom[s.id] && !keys.includes(s.id)) {
      overrides[s.id] = {
        label: s.label,
        shortLabel: s.shortLabel,
        description: s.description,
        category: s.category,
        filters: s.filters,
      };
    }
  }

  if (Object.keys(overrides).length === 0) {
    await db.execute(sql`DELETE FROM ai_scanner_strategies WHERE user_id = ${userId}`);
  } else {
    await db.execute(sql`
      INSERT INTO ai_scanner_strategies (user_id, overrides, updated_at)
      VALUES (${userId}, ${JSON.stringify(overrides)}::jsonb, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET overrides = EXCLUDED.overrides, updated_at = NOW()
    `);
  }

  const saved = await getStrategiesForUser(userId);
  return saved.strategies;
}
