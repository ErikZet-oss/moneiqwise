import { config } from "dotenv";
import { join } from "path";
import fs from "fs";

const envPath = join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  config({ path: envPath });
}
