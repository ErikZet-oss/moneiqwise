import "./loadEnv";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. In the project folder run: copy .env.example .env  then edit .env and set DATABASE_URL to your PostgreSQL URL."
  );
}

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle({ client: pool, schema });
