import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublicConfig } from "@/lib/supabase/publicConfig";

/**
 * Refreshes the Supabase auth session cookie on navigation. Deliberately
 * defensive: if auth env is absent or anything throws, it passes the request
 * through unchanged so a Supabase hiccup can never break page loads.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const config = supabasePublicConfig();
  if (!config) return response;

  try {
    const supabase = createServerClient(config.url, config.key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    });
    await supabase.auth.getUser();
  } catch {
    // Never let session refresh break the request.
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, fonts, images, and the API (routes handle
    // their own auth). Keeps middleware cheap.
    "/((?!_next/static|_next/image|favicon.svg|apple-icon|fonts/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)"
  ]
};
