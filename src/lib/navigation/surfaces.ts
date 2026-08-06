/**
 * Which of the four surfaces owns a route.
 *
 * One map, two readers: the nav uses it to highlight the active destination,
 * and analytics uses it to label a view. They were separate before, which is
 * the setup where a route quietly highlights Explore while reporting itself as
 * Track Record and nobody notices for a quarter.
 *
 * Ownership is not the same as URL nesting. Three `/predictions/*` routes are
 * read as Track Record and one as My Padi, because that is where a reader
 * thinks they live — results and the engine are evidence, a bet slip is
 * personal. Those overrides are checked before the general prefixes.
 */
export const PRIMARY_SURFACES = ["/", "/explore", "/track-record", "/my"] as const;
export type PrimarySurface = (typeof PRIMARY_SURFACES)[number];

/** Human label per surface, for analytics `page_context`. */
export const SURFACE_CONTEXT: Record<PrimarySurface, string> = {
  "/": "today",
  "/explore": "explore",
  "/track-record": "track_record",
  "/my": "my_padi"
};

/**
 * Routes that sit under one surface's URL prefix but belong to another.
 * Checked first, longest-first, so `/predictions/value-picks` never resolves
 * to Explore just because Explore owns `/predictions`.
 */
const OVERRIDES: ReadonlyArray<{ prefix: string; surface: PrimarySurface }> = [
  { prefix: "/predictions/history", surface: "/track-record" },
  { prefix: "/predictions/value-picks", surface: "/track-record" },
  { prefix: "/predictions/decision-engine", surface: "/track-record" },
  { prefix: "/predictions/bet-slip", surface: "/my" }
];

const SURFACE_PREFIXES: Record<PrimarySurface, readonly string[]> = {
  // Today owns the matchday board and the accumulator built from it.
  // `/daily-double` used to match nothing, so the nav highlighted no surface
  // at all on that page.
  "/": ["/daily-double"],
  "/explore": [
    "/explore",
    "/predictions",
    "/live-scores",
    "/news",
    "/season-outlooks",
    "/community",
    "/forums",
    "/tips"
  ],
  "/track-record": ["/track-record", "/engine/performance"],
  "/my": ["/my", "/account"]
};

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The surface that owns `pathname`, or null for routes outside the product
 * shell's four destinations (legal pages, the PWA offline fallback).
 */
export function surfaceForPath(pathname: string): PrimarySurface | null {
  if (pathname === "/") return "/";

  for (const { prefix, surface } of OVERRIDES) {
    if (matches(pathname, prefix)) return surface;
  }

  // Longest prefix wins, so a future `/predictions/x/y` cannot be captured by a
  // shorter unrelated entry.
  let best: { surface: PrimarySurface; length: number } | null = null;
  for (const surface of PRIMARY_SURFACES) {
    for (const prefix of SURFACE_PREFIXES[surface]) {
      if (matches(pathname, prefix) && (!best || prefix.length > best.length)) {
        best = { surface, length: prefix.length };
      }
    }
  }
  return best?.surface ?? null;
}

/** Whether a primary nav item should render as the current page. */
export function isSurfaceActive(pathname: string, href: string): boolean {
  return surfaceForPath(pathname) === href;
}
