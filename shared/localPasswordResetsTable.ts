import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { users } from "./usersTable";

/**
 * Bez `uniqueIndex` v Drizzli — `drizzle-kit push` pri UNIQUE na `token_hash` padal (PG 42P16).
 * Jedinečnosť zabezpečte v DB: `scripts/ensure-local-password-resets-unique.sql` (koncom súboru).
 * Tokeny sú cryptograficky unikátne, kolíziu riešia aj tak lookup dotazy.
 */
export const localPasswordResets = pgTable("local_password_resets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  email: varchar("email").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});
