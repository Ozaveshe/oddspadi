import type { SlateFixture, SportsSlate } from "@/lib/sports/intelligence/types";

/**
 * How the tips slates are held between requests, and why not in Next's data
 * cache.
 *
 * `unstable_cache` writes through `JSON.stringify` and refuses anything over
 * 2MB — and it **fails open**: the value is computed, the write is rejected
 * with a log line, nothing is stored, and the next request starts again. So an
 * oversized entry is not a slow cache, it is no cache at all, while still
 * charging a full serialisation of the payload to every request that passes
 * through it.
 *
 * Measured 2026-08-03 on a 227-fixture day and a 682-fixture week:
 *
 *                          daily     weekly
 *   whole product          36.56MB   62.51MB   <- what was being cached
 *   slate alone            21.03MB   49.72MB
 *   sections / days        15.53MB   12.79MB
 *   unique fixtures         5.50MB   ~16MB
 *   deduped, no dossier     1.43MB    3.90MB
 *
 * Two multipliers stack. The product holds the slate *and* six `sections`
 * arrays of the same objects, and the slate internally holds `fixtures`,
 * `groupedByDate` and `groups` — all shared references, free in memory, each
 * expanded in full by `JSON.stringify`. One fixture appeared roughly seven
 * times.
 *
 * Removing the duplication is necessary and not sufficient. Even pruned to a
 * single deduplicated copy, a week of 682 fixtures is 3.9MB, and a busy
 * Saturday would put the daily slate over too. Contorting the payload to sit
 * just under 2MB would buy a cache that silently stops working the first time
 * the board grows — the exact failure being fixed. So these do not use the
 * data cache at all; see `ttlMemo` in `publicReads.ts`.
 */

/** Next's data cache ceiling. Entries above it are silently not written. */
export const DATA_CACHE_LIMIT_BYTES = 2 * 1024 * 1024;

/**
 * Drop the per-market dossier.
 *
 * `row.decisions` measured 2.76MB across a 227-fixture day and up to ~347KB on
 * a single heavily-analysed fixture, and no component reads it — list surfaces
 * render `bestDecision`, the summary verdict, and `allMarketAnalyses`. The
 * match page loads its own fixture and is not served from here.
 *
 * `allMarketAnalyses` is deliberately kept whole: `noPickExplanation` sorts it
 * by edge to surface the engine's actual blocker text ("best-price comparison
 * needs at least 3 independent bookmakers"), which is the transparency the
 * cards exist to show. Trimming it to save bytes would replace a specific
 * reason with a generic one.
 */
export function pruneFixtureForCache(row: SlateFixture): SlateFixture {
  return { ...row, decisions: [] };
}

/**
 * Slate reduced to the one thing that is not derivable: its fixtures.
 *
 * `groupedByDate` and `groups` are emptied rather than carried — the product
 * builders rebuild both from `fixtures`, so holding them only duplicates the
 * same objects.
 */
export function pruneSlateForCache(slate: SportsSlate): SportsSlate {
  return {
    ...slate,
    fixtures: (slate.fixtures ?? []).map(pruneFixtureForCache),
    groupedByDate: [],
    groups: { valuePicks: [], leans: [], watchlist: [], allAnalysed: [], noPicks: [] }
  };
}

export function cacheEntryBytes(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0;
}

export function fitsDataCache(value: unknown): boolean {
  return cacheEntryBytes(value) <= DATA_CACHE_LIMIT_BYTES;
}
