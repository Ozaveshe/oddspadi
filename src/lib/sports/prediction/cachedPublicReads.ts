import { unstable_cache } from "next/cache";
import type { Sport } from "@/lib/sports/types";
import { getMatchPrediction, getPredictions, uniqueCountries, uniqueLeagues } from "@/lib/sports/service";
import { getPublicPredictionHistory } from "@/lib/sports/prediction/history";
import { toPredictionListRow, type PredictionListRow } from "@/lib/sports/prediction/listRow";

type MemoryEntry<T> = { expiresAt: number; promise: Promise<T> };
const matchPredictionCache = new Map<string, MemoryEntry<Awaited<ReturnType<typeof getMatchPrediction>>>>();

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

export function getCachedMatchPrediction(matchId: string) {
  return cachePromise(matchPredictionCache, matchId, 180_000, () => getMatchPrediction(matchId));
}

export const getCachedPublicPredictionHistory = unstable_cache(
  async () => getPublicPredictionHistory(),
  ["public-prediction-history-v2-public-picks"],
  { revalidate: 900 }
);
