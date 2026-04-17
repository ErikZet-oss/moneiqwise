import { config } from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "drizzle-kit";

const projectRoot = dirname(fileURLToPath(import.meta.url));
config({ path: join(projectRoot, ".env") });

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is missing. Copy .env.example to .env and set DATABASE_URL (PostgreSQL connection string)."
  );
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
