import { unstable_cache } from "next/cache";
import type { Sport } from "@/lib/sports/types";
import { getMatchPrediction, getPredictions, uniqueCountries, uniqueLeagues } from "@/lib/sports/service";
import { getPublicPredictionHistory } from "@/lib/sports/prediction/history";
import { toPredictionListRow, type PredictionListRow } from "@/lib/sports/prediction/listRow";
import { readStoredFixtureAnalysis } from "@/lib/sports/intelligence/storedFixture";

type MemoryEntry<T> = { expiresAt: number; promise: Promise<T> };
const matchPredictionCache = new Map<string, MemoryEntry<Awaited<ReturnType<typeof getMatchPrediction>>>>();
const storedFixtureCache = new Map<string, MemoryEntry<Awaited<ReturnType<typeof readStoredFixtureAnalysis>>>>();

export type PredictionsPageData = { leagues: string[]; countries: string[]; rows: PredictionListRow[] };

/**
 * One durable snapshot per (date, sport). unstable_cache persists in Next's
 * Data Cache (blob-backed on Netlify), so it survives serverless cold starts —
 * unlike the module-scope Maps this file used before, which forced a full
 * ~130-request provider fan-out on nearly every invocation. Filters are
 * applied in-process on the slim rows, so every filter combination shares the
 * same cached provider read.
 */
const readPredictionsPageSnapshot = unstable_cache(
  async (date: string, sport: Sport): Promise<PredictionsPageData> => {
    const rows = await getPredictions({ date, sport, providerMode: "live", storageMode: "preview" });
    const allMatches = rows.map((row) => row.match);
    return {
      leagues: uniqueLeagues(allMatches),
      countries: uniqueCountries(allMatches),
      rows: rows.map(toPredictionListRow)
    };
  },
  ["predictions-page-snapshot-v2-canonical-decision"],
  { revalidate: 120 }
);

export async function getCachedPredictionsPageData(
  date: string,
  sport: Sport,
  league?: string,
  country?: string,
  confidence?: string,
  query?: string
): Promise<PredictionsPageData> {
  const snapshot = await readPredictionsPageSnapshot(date, sport);
  const q = query?.trim().toLowerCase();
  const rows = snapshot.rows.filter(({ match, prediction }) => {
    const matchesSearch =
      !q ||
      match.homeTeam.name.toLowerCase().includes(q) ||
      match.awayTeam.name.toLowerCase().includes(q) ||
      match.league.name.toLowerCase().includes(q);
    return (
      (!league || match.league.name === league) &&
      (!country || match.league.country === country) &&
      (!confidence || prediction.confidence === confidence) &&
      matchesSearch
    );
  });
  return { ...snapshot, rows };
}

function cachePromise<T>(cache: Map<string, MemoryEntry<T>>, key: string, ttl: number, read: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) return existing.promise;
  if (existing) cache.delete(key);
  const promise = read();
  const entry = { expiresAt: now + ttl, promise };
  cache.set(key, entry);
  promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
  if (cache.size > 32) cache.delete(cache.keys().next().value as string);
  return promise;
}

/**
 * Durable per-match snapshots, for the same reason the predictions page has
 * one: `getMatchPrediction` re-runs a provider fan-out (match, head-to-head,
 * league table, learning profile, case memory, odds history) on every miss, and
 * a module-scope Map misses on every serverless cold start. That showed up as a
 * ~5s time-to-first-byte on the match page for ~49KB of HTML.
 *
 * The in-memory Map stays in front as an L1 so repeated reads within a single
 * invocation — the page body and its opengraph-image both ask for this — don't
 * each pay a Data Cache round trip.
 */
const readMatchPrediction = unstable_cache(
  async (matchId: string) => getMatchPrediction(matchId),
  ["match-prediction-v1"],
  { revalidate: 180 }
);

const readStoredFixture = unstable_cache(
  async (matchId: string) => readStoredFixtureAnalysis(matchId),
  ["stored-fixture-analysis-v1"],
  { revalidate: 180 }
);

export function getCachedMatchPrediction(matchId: string) {
  return cachePromise(matchPredictionCache, matchId, 180_000, () => readMatchPrediction(matchId));
}

export function getCachedStoredFixtureAnalysis(matchId: string) {
  return cachePromise(storedFixtureCache, matchId, 180_000, () => readStoredFixture(matchId));
}

export const getCachedPublicPredictionHistory = unstable_cache(
  async () => getPublicPredictionHistory(),
  ["public-prediction-history-v2-public-picks"],
  { revalidate: 900 }
);
