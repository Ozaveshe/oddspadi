"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabasePublicConfig } from "./publicConfig";

/** Browser Supabase client for auth + reads from client components.
 *  Returns null when the community/auth env isn't configured. */
export function createSupabaseBrowserClient() {
  const config = supabasePublicConfig();
  if (!config) return null;
  return createBrowserClient(config.url, config.key);
}
