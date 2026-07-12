import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabasePublicConfig } from "./publicConfig";

/** Cookie-bound Supabase client for server components + route handlers.
 *  Uses the publishable/anon key so RLS applies as the signed-in user.
 *  Returns null when auth env isn't configured. */
export async function createSupabaseServerClient() {
  const config = supabasePublicConfig();
  if (!config) return null;
  const cookieStore = await cookies();

  return createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component where cookies are read-only; the
          // middleware handles session refresh, so this is safe to ignore.
        }
      }
    }
  });
}

/** Convenience: the current signed-in user (or null). */
export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user;
}
