import { config } from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: join(projectRoot, ".env") });
