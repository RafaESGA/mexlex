import { createClient } from "@supabase/supabase-js";
import { loadEnv, requireEnv } from "../config/env.js";

const env = loadEnv();

export const supabaseAdmin = createClient(
  requireEnv(env.supabaseUrl, "SUPABASE_URL"),
  requireEnv(env.supabaseServiceRoleKey, "SUPABASE_SERVICE_ROLE_KEY"),
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

