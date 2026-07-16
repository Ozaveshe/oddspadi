import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabasePublicConfig } from "@/lib/supabase/publicConfig";

// Optional public enhancements must yield quickly to repository-backed
// fallbacks when the managed database is slow or unavailable.
export const PUBLIC_READ_TIMEOUT_MS = 2_500;

export function publicReadAbortSignal(): AbortSignal {
  return AbortSignal.timeout(PUBLIC_READ_TIMEOUT_MS);
}

export function getSupabasePublicReadClient(): SupabaseClient | null {
  const config = supabasePublicConfig();
  if (!config) return null;
  return createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" })
    }
  });
}
