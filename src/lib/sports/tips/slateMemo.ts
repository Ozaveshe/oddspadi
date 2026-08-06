import type { SportsSlate } from "@/lib/sports/intelligence/types";

/**
 * A time-boxed in-process memo for values too large for Next's data cache.
 *
 * `unstable_cache` is the right tool almost everywhere here and is used
 * everywhere else in this module — it survives cold starts and is shared
 * across instances. It cannot hold the tips slates: they measured 36.6MB for a
 * day and 62.5MB for a week against a 2MB ceiling, and it fails open, so those
 * reads were paying a full serialisation per request and caching nothing. See
 * `tipsCacheShape.ts` for the measurements.
 *
 * This trades cross-instance sharing for no serialisation and no ceiling. That
 * is a strict improvement on a cache whose measured hit rate was zero: a warm
 * instance now answers from memory, and a cold one does exactly what every
 * request already did.
 *
 * It is deliberately not a general-purpose cache. Use `unstable_cache` unless
 * you have measured a payload that cannot fit in it.
 */
type Entry<T> = { expiresAt: number; value: Promise<T> };

export function ttlMemo<T>(
  load: () => Promise<T>,
  ttlMs: number,
  /**
   * Whether a resolved value is worth holding. Defaults to holding everything.
   *
   * A cache that keeps failures turns a blip into an outage lasting the whole
   * window, so anything that resolves to "we could not establish the truth"
   * must be allowed to retry on the next request.
   */
  shouldCache: (value: T) => boolean = () => true
): () => Promise<T> {
  let entry: Entry<T> | null = null;
  return () => {
    const now = Date.now();
    if (entry && entry.expiresAt > now) return entry.value;
    const value = load();
    // Hold the promise, not the resolved value, so concurrent callers on a cold
    // instance share one read instead of each starting their own ~14s load.
    const next: Entry<T> = { expiresAt: now + ttlMs, value };
    entry = next;
    // Never let a rejection stick for the whole window. Without this a single
    // transient failure would serve the same error to every request until the
    // TTL expired — the shape of outage this codebase has already had once.
    value.then(
      (resolved) => {
        if (entry === next && !shouldCache(resolved)) entry = null;
      },
      () => {
        if (entry === next) entry = null;
      }
    );
    return value;
  };
}

/**
 * A slate worth holding.
 *
 * `getDailySlate`/`getWeeklySlate` fail soft: a repository error returns a
 * read-only slate with `provider.status: "unavailable"` and the reason
 * attached, rather than throwing. That is the right behaviour for a public page
 * — it says "we could not establish this" instead of rendering zero fixtures as
 * fact — but it means the failure arrives as a resolved value, and memoising it
 * would serve an empty board for the full window.
 *
 * Observed in development, so not hypothetical: "Stored odds read failed:
 * canceling statement due to statement timeout" on a read that succeeds with
 * 227 fixtures moments later.
 */
export function slateIsCacheable(slate: SportsSlate): boolean {
  return slate.provider.status !== "unavailable" && slate.provider.status !== "failed";
}
