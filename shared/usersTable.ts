import { sql } from "drizzle-orm";
import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

/** Lokálna registrácia: schválený môže do appky; pending čaká na admina; blocked je zamietnutý/zablokovaný. */
export const REGISTRATION_STATUSES = ["approved", "pending", "blocked"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

// Samostatný súbor kvôli referenciám a aby `localPasswordResets` nemal cyklický import so `schema.ts`
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  registrationStatus: varchar("registration_status", { length: 20 })
    .notNull()
    .default("approved"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
