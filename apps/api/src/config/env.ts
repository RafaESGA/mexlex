import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(currentDir, "../..");
const repoRootDir = path.resolve(apiDir, "../..");

loadDotenv({ path: path.join(repoRootDir, ".env") });
loadDotenv({ path: path.join(repoRootDir, ".env.local"), override: true });
loadDotenv({ path: path.join(apiDir, ".env") , override: true });
loadDotenv({ path: path.join(apiDir, ".env.local"), override: true });

export type AppEnv = {
  nodeEnv: string;
  port: number;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  openAiApiKey: string;
  silRawStorageBucket: string;
  silDiscoveryUrls: string[];
};

export function loadEnv(): AppEnv {
  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: Number(process.env.PORT ?? 4000),
    supabaseUrl: process.env.SUPABASE_URL ?? "",
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    openAiApiKey: process.env.OPENAI_API_KEY ?? "",
    silRawStorageBucket: process.env.SIL_RAW_STORAGE_BUCKET ?? "sil-raw-html",
    silDiscoveryUrls: (process.env.SIL_DISCOVERY_URLS ?? "https://sil.gobernacion.gob.mx/")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  };
}

export function requireEnv(value: string, variableName: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${variableName}`);
  }

  return value;
}
