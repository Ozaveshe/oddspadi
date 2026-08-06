/**
 * A `fetch` that keeps database reads out of Next's Data Cache.
 *
 * Next patches the global `fetch` in the server runtime and, by default, writes
 * every response into the Data Cache. Supabase-js has no HTTP client of its
 * own — it uses that patched global — so every PostgREST request a page makes
 * is treated as a cacheable resource.
 *
 * Two consequences, both observed here on 2026-08-03:
 *
 * 1. A response over the 2MB ceiling throws. The stored-slate read returns
 *    ~2.27MB, and the failure surfaced as an *unhandled rejection* attributed
 *    to whatever happened to await it:
 *
 *      Failed to set Next.js data cache for unstable_cache /predictions,
 *      items over 2MB can not be cached (2273091 bytes)
 *
 *    Nothing in that path calls `unstable_cache`; the write came from the
 *    patched fetch, which is why the error kept appearing after the wrappers
 *    it named had been removed.
 *
 * 2. The quieter one. A response *under* the ceiling is cached, so a database
 *    read is served from a blob on a schedule nobody chose, underneath every
 *    deliberate `unstable_cache` window in this codebase. Freshness decisions
 *    made one layer up stop meaning anything.
 *
 * Caching belongs where it is declared — `unstable_cache`, the projection
 * store, or an explicit memo — not implicitly under every query.
 */
export const uncachedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });
