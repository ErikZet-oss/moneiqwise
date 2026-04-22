import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  text,
  numeric,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./usersTable";
import { localPasswordResets } from "./localPasswordResetsTable";

export { users } from "./usersTable";
export { localPasswordResets } from "./localPasswordResetsTable";

// Session storage table - required for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

export const localAuthAccounts = pgTable("local_auth_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  email: varchar("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Supported broker codes
export const BROKER_CODES = [
  "xtb",
  "ibkr",
  "degiro",
  "etoro",
  "trading212",
  "revolut",
  "fio",
  "saxo",
  "freedom24",
  "tastyworks",
  "crypto",
  "other"
] as const;

export type BrokerCode = typeof BROKER_CODES[number];

// Portfolios table - allows users to have multiple portfolios
export const portfolios = pgTable("portfolios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  brokerCode: varchar("broker_code", { length: 20 }),
  isDefault: boolean("is_default").default(false),
  isHidden: boolean("is_hidden").default(false),
  /** Lower values appear first in lists (sidebar, settings). */
  sortOrder: integer("sort_order").notNull().default(0),
  // Free-floating cash at the broker, not yet invested. Single currency per
  // portfolio keeps the UI simple; multi-currency cash can come later.
  cashBalance: numeric("cash_balance", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  cashCurrency: varchar("cash_currency", { length: 3 }).notNull().default("EUR"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPortfolioSchema = createInsertSchema(portfolios).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPortfolio = z.infer<typeof insertPortfolioSchema>;
export type Portfolio = typeof portfolios.$inferSelect;

/** Všetky podporované hodnoty `transactions.type` (vrátane hotovostných tokov). */
export const TRANSACTION_TYPES = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "TAX",
  "DEPOSIT",
  "WITHDRAWAL",
] as const;
export type TransactionKind = (typeof TRANSACTION_TYPES)[number];

/**
 * Sentinelský ticker pre riadky DEPOSIT / WITHDRAWAL (nie je burzový symbol).
 * UI a import môžu zobraziť „Vklad“ / „Výber“ z `companyName` alebo `type`.
 */
export const CASH_FLOW_TICKER = "PORTFOLIO_CASH_FLOW" as const;

// Transactions table for tracking buys, sells, dividends, taxes, and cash flows
export const transactions = pgTable(
  "transactions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id),
    portfolioId: varchar("portfolio_id").references(() => portfolios.id),
    type: varchar("type", { length: 12 }).notNull(),
    /** Yahoo / XTB; pre DEPOSIT/WITHDRAWAL použite {@link CASH_FLOW_TICKER}. */
    ticker: varchar("ticker", { length: 32 }).notNull(),
    companyName: text("company_name").notNull(),
    shares: numeric("shares", { precision: 18, scale: 8 }).notNull(),
    pricePerShare: numeric("price_per_share", { precision: 18, scale: 4 }).notNull(),
    commission: numeric("commission", { precision: 18, scale: 4 }).default("0"),
    /** Legacy: meny obchodu; pre nové multi-menové riadky preferujte `originalCurrency`. */
    currency: varchar("currency", { length: 3 }).default("EUR"),
    realizedGain: numeric("realized_gain", { precision: 18, scale: 4 }).default("0"),
    costBasis: numeric("cost_basis", { precision: 18, scale: 4 }).default("0"),
    /** XTB / broker operation id (legacy deduplikácia importu). */
    externalId: varchar("external_id", { length: 50 }),
    /**
     * Unikátny kľúč z brokera pre deduplikáciu importu (odporúčané pre nové integrácie).
     * Pri importe rovnakého `transaction_id` v tom istom portfóliu riadok preskoč / aktualizuj.
     */
    transactionId: varchar("transaction_id", { length: 64 }),
    /** Menová suma v pôvodnej mene (napr. USD pri vklade v dolároch). */
    originalCurrency: varchar("original_currency", { length: 3 }),
    /**
     * Kurz z `originalCurrency` do základnej meny používateľa (EUR) platný pri `transactionDate`.
     * Napr. pri USD vklade: koľko EUR = 1 USD.
     */
    exchangeRateAtTransaction: numeric("exchange_rate_at_transaction", {
      precision: 18,
      scale: 8,
    }),
    /** Suma prepočítaná do EUR (alebo inej `user_settings.preferred_currency`) v čase transakcie. */
    baseCurrencyAmount: numeric("base_currency_amount", { precision: 18, scale: 4 }),
    transactionDate: timestamp("transaction_date").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("transactions_transaction_id_lookup_idx").on(table.transactionId),
    uniqueIndex("transactions_user_portfolio_transaction_id_uidx").on(
      table.userId,
      table.portfolioId,
      table.transactionId,
    ),
  ],
);

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  createdAt: true,
}).extend({
  id: z.string().optional(), // Allow manual ID assignment
});

export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

// Portfolio holdings - computed from transactions
export const holdings = pgTable(
  "holdings",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id),
    portfolioId: varchar("portfolio_id").references(() => portfolios.id),
    ticker: varchar("ticker", { length: 32 }).notNull(),
    companyName: text("company_name").notNull(),
    shares: numeric("shares", { precision: 18, scale: 8 }).notNull(),
    averageCost: numeric("average_cost", { precision: 18, scale: 4 }).notNull(),
    totalInvested: numeric("total_invested", { precision: 18, scale: 4 }).notNull(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [uniqueIndex("holdings_user_portfolio_ticker_idx").on(table.userId, table.portfolioId, table.ticker)]
);

export type Holding = typeof holdings.$inferSelect;
export type InsertHolding = typeof holdings.$inferInsert;

// User settings for API keys and preferences
export const userSettings = pgTable("user_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  alphaVantageKey: text("alpha_vantage_key"),
  finnhubKey: text("finnhub_key"),
  preferredCurrency: varchar("preferred_currency", { length: 3 }).default("EUR"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = typeof userSettings.$inferInsert;

// Currency type
export type Currency = "EUR" | "USD";

// Option types
export const OPTION_TYPES = ["CALL", "PUT"] as const;
export type OptionType = typeof OPTION_TYPES[number];

export const OPTION_DIRECTIONS = ["BUY", "SELL"] as const;
export type OptionDirection = typeof OPTION_DIRECTIONS[number];

export const OPTION_STATUSES = ["OPEN", "CLOSED", "EXPIRED", "ASSIGNED"] as const;
export type OptionStatus = typeof OPTION_STATUSES[number];

// Options trades table
export const optionTrades = pgTable("option_trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  portfolioId: varchar("portfolio_id").references(() => portfolios.id),
  underlying: varchar("underlying", { length: 20 }).notNull(), // Ticker of underlying asset
  optionType: varchar("option_type", { length: 4 }).notNull(), // CALL or PUT
  direction: varchar("direction", { length: 4 }).notNull(), // BUY or SELL
  strikePrice: numeric("strike_price", { precision: 18, scale: 4 }).notNull(),
  expirationDate: timestamp("expiration_date").notNull(),
  contracts: numeric("contracts", { precision: 10, scale: 0 }).notNull(), // Number of contracts
  premium: numeric("premium", { precision: 18, scale: 4 }).notNull(), // Premium per share
  commission: numeric("commission", { precision: 18, scale: 4 }).default("0"),
  status: varchar("status", { length: 10 }).notNull().default("OPEN"), // OPEN, CLOSED, EXPIRED, ASSIGNED
  openDate: timestamp("open_date").notNull(),
  closeDate: timestamp("close_date"),
  closePremium: numeric("close_premium", { precision: 18, scale: 4 }), // Premium when closing
  closeCommission: numeric("close_commission", { precision: 18, scale: 4 }),
  realizedGain: numeric("realized_gain", { precision: 18, scale: 4 }).default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Custom schema with date string coercion for API
export const insertOptionTradeSchema = createInsertSchema(optionTrades, {
  expirationDate: z.coerce.date(),
  openDate: z.coerce.date(),
  closeDate: z.coerce.date().optional().nullable(),
}).omit({
  id: true,
  createdAt: true,
});

export type InsertOptionTrade = z.infer<typeof insertOptionTradeSchema>;
export type OptionTrade = typeof optionTrades.$inferSelect;

