import { cookies } from "next/headers";

import { DEFAULT_TIMEZONE, normalizeTimeZone } from "./dayWindow";

/**
 * The visitor's timezone, on the server.
 *
 * It was stored only in `localStorage`, which the server cannot see, so every
 * server-rendered board picked its day in UTC and the picker did nothing but
 * re-format times that had already been selected for the wrong day. A cookie
 * is the smallest thing that crosses that boundary.
 *
 * Deliberately not `httpOnly`: the client half in `LocalTime.tsx` writes it,
 * and it carries no secret — it is a display preference, and the same value is
 * already readable via `Intl.DateTimeFormat().resolvedOptions().timeZone`.
 * `SameSite=Lax` keeps it off cross-site requests; `Secure` is set outside
 * development so it never travels in the clear.
 *
 * Reading a cookie opts a route out of static rendering. Every surface that
 * calls this is already `force-dynamic` for freshness reasons, so nothing
 * regresses — but a static page must not start calling it casually.
 */
export const TIMEZONE_COOKIE = "oddspadi-tz";

/** One year: a timezone preference is stable, and re-asking is noise. */
export const TIMEZONE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export async function readTimezonePreference(): Promise<string> {
  try {
    const store = await cookies();
    return normalizeTimeZone(store.get(TIMEZONE_COOKIE)?.value);
  } catch {
    // Called outside a request scope (a script, a unit test). The default is
    // the honest answer there — there is no visitor to have a timezone.
    return DEFAULT_TIMEZONE;
  }
}

/**
 * The attribute string the client uses to write the cookie.
 *
 * Kept here rather than in the component so the read and the write cannot
 * drift apart on name, path or lifetime.
 */
export function timezoneCookieValue(timeZone: string, secure: boolean): string {
  const zone = normalizeTimeZone(timeZone);
  const attributes = [
    `${TIMEZONE_COOKIE}=${encodeURIComponent(zone)}`,
    "path=/",
    `max-age=${TIMEZONE_COOKIE_MAX_AGE}`,
    "samesite=lax"
  ];
  if (secure) attributes.push("secure");
  return attributes.join("; ");
}
