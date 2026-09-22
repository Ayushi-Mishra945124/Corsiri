import path from "node:path";
import { fileURLToPath } from "node:url";

// Load from current working directory (.env) if present
try {
  process.loadEnvFile();
} catch {}

// Load from backend folder (.env) if present
try {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  process.loadEnvFile(path.resolve(currentDir, "../.env"));
} catch {}

// Load from project root directory (.env)
try {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  process.loadEnvFile(path.resolve(currentDir, "../../.env"));
} catch {}
