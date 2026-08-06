import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabasePublicConfig } from "@/lib/supabase/publicConfig";
import { uncachedFetch } from "@/lib/supabase/uncachedFetch";

// Optional public enhancements must yield quickly to repository-backed
// fallbacks when the managed database is slow or unavailable.
export const PUBLIC_READ_TIMEOUT_MS = 2_500;

export function publicReadAbortSignal(): AbortSignal {
  return AbortSignal.timeout(PUBLIC_READ_TIMEOUT_MS);
}

// Reused across requests, the way `getSupabaseServerClient` already does.
// Rebuilding the client on every public read allocated a fresh auth/realtime
// object graph per call on the hottest read paths in the app.
let cachedClient: { cacheKey: string; client: SupabaseClient } | null = null;

export function getSupabasePublicReadClient(): SupabaseClient | null {
  const config = supabasePublicConfig();
  if (!config) return null;

  const cacheKey = `${config.url}:${config.key}`;
  if (cachedClient?.cacheKey === cacheKey) return cachedClient.client;

  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      // Same reason as the server client, which was missing this. See uncachedFetch.
      fetch: uncachedFetch
    }
  });

  cachedClient = { cacheKey, client };
  return client;
}
