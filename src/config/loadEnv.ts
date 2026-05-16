import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

/** Resolve repo-root `.env` (works when PM2 cwd is not the project folder). */
function resolveEnvFilePath(): string {
  const candidates = [
    path.resolve(__dirname, "../../../.env"),
    path.resolve(process.cwd(), ".env"),
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) return filePath;
  }
  return candidates[0];
}

const envPath = resolveEnvFilePath();
dotenv.config({ path: envPath });
