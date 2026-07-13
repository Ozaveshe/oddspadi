import { unstable_cache } from "next/cache";
import type { Sport } from "@/lib/sports/types";
import { getMatchPrediction, getPredictions, sportsProvider } from "@/lib/sports/service";
import { getPublicPredictionHistory } from "@/lib/sports/prediction/history";

type MemoryEntry<T> = { expiresAt: number; promise: Promise<T> };
const predictionsPageCache = new Map<string, MemoryEntry<Awaited<ReturnType<typeof readPredictionsPageData>>>>();
const matchPredictionCache = new Map<string, MemoryEntry<Awaited<ReturnType<typeof getMatchPrediction>>>>();

async function readPredictionsPageData(
  date: string,
  sport: Sport,
  league?: string,
  country?: string,
  confidence?: string,
  query?: string
) {
    const [allMatches, rows] = await Promise.all([
      sportsProvider.getFixtures(date, sport),
      getPredictions({ date, sport, league, country, confidence, query, storageMode: "preview" })
    ]);
    return { allMatches, rows };
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

export function getCachedPredictionsPageData(
  date: string,
  sport: Sport,
  league?: string,
  country?: string,
  confidence?: string,
  query?: string
) {
  const key = JSON.stringify([date, sport, league ?? "", country ?? "", confidence ?? "", query ?? ""]);
  return cachePromise(predictionsPageCache, key, 120_000, () => readPredictionsPageData(date, sport, league, country, confidence, query));
}

export function getCachedMatchPrediction(matchId: string) {
  return cachePromise(matchPredictionCache, matchId, 180_000, () => getMatchPrediction(matchId));
}

export const getCachedPublicPredictionHistory = unstable_cache(
  async () => getPublicPredictionHistory(),
  ["public-prediction-history-v1"],
  { revalidate: 900 }
);
