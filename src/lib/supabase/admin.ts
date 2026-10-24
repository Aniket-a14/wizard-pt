import type { Database } from "./database.types";
import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. BYPASSES RLS. Use only inside trusted server code, always after the
 * caller has been authenticated/authorised, and always scoped by explicit ids.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not configured");
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
