import { unstable_cache } from "next/cache";
import { readHomepageMatchdaySummary, readHomepageModelRecordSummary, readHomepageWeeklySummary } from "@/lib/sports/homepageSummary";
import {
  buildDailyTipsProduct,
  buildWeeklyTipsProduct,
  getYesterdayResultsProduct,
  type DailyTipsProduct,
  type WeeklyTipsProduct
} from "@/lib/sports/tips/product";
import { getDailySlate, getWeeklySlate } from "@/lib/sports/intelligence/pipeline";
import { pruneSlateForCache } from "@/lib/sports/tips/tipsCacheShape";
import { slateIsCacheable, ttlMemo, ttlMemoByKey } from "@/lib/sports/tips/slateMemo";
import { DEFAULT_TIMEZONE, dayWindowRange } from "@/lib/time/dayWindow";

// Public surfaces read scheduled engine output only. Provider execution belongs
// to the cron/operator lane, not to an anonymous page request.
/**
 * Revalidation windows are matched to how often the data can actually change,
 * not to how fresh we would like it to look.
 *
 * This read costs ~14s on a cold serverless start, and the homepage abandons it
 * after 2.5s. A 60s window meant the cache expired roughly every minute, so a
 * steady share of visitors paid the cold cost, timed out, and were shown "0
 * fixtures / Feed unavailable" for a board holding ~700 fixtures. The decision
 * sweep runs on a ~30 minute cycle, so a one-minute window bought no freshness
 * whatsoever — it only bought cache misses.
 */
/**
 * Hold the slate, rebuild the product.
 *
 * These used to pass the whole product to `unstable_cache`: 36.6MB for a
 * 227-fixture day and 62.5MB for a 682-fixture week, against a 2MB ceiling.
 * It fails open — computes the value, logs "items over 2MB can not be cached",
 * stores nothing — so the cache never once held a tips product while every
 * request paid to serialise tens of megabytes and discover that.
 *
 * Two changes. Only the slate is held, because `sections`, `groups`,
 * `groupedByDate`, `days` and every summary are pure derivations of
 * `slate.fixtures` that the builders recompute by filtering. And it is held in
 * a TTL memo rather than the data cache, because even deduplicated and stripped
 * of the per-market dossier a week is 3.9MB — fitting today would only mean
 * failing again the first busy Saturday.
 */
/**
 * Keyed by timezone, because "today" is no longer one answer.
 *
 * Not keying at all would serve whichever board loaded first to every
 * subsequent visitor — a Lagos morning reader could get Sydney's day, which
 * would look like a caching flake and be miserable to reproduce.
 *
 * The key carries the window's start instant as well as the zone name, so an
 * entry cannot outlive the day it describes: at the local midnight the key
 * changes and the stale board is simply never looked up again.
 *
 * This does fragment per zone rather than per UTC offset, so two zones sharing
 * an offset hold duplicate slates. That is accepted: entries expire in five
 * minutes and are evicted on access, and collapsing them would mean passing
 * instants through `getDailySlate` instead of a zone, which buys memory this
 * process is not short of at the cost of a less obvious contract.
 */
const cachedDailyTipsSlate = ttlMemoByKey(
  async (key: string) => {
    const [timeZone, offset] = key.split("|");
    return pruneSlateForCache(await getDailySlate({ ensure: false, dayOffset: Number(offset), timeZone }));
  },
  300_000,
  slateIsCacheable
);

function slateKey(timeZone: string, dayOffset: number, now = new Date()): string {
  const window = dayWindowRange(now, timeZone, 1, dayOffset);
  // Two zones sharing an offset share the entry; the name rides along only so
  // the loader can rebuild the same window.
  return `${timeZone}|${dayOffset}|${window.startUtc.getTime()}`;
}

const cachedTodayTipsSlate = (timeZone: string) =>
  cachedDailyTipsSlate(slateKey(timeZone, 0));

const cachedTomorrowTipsSlate = (timeZone: string) =>
  cachedDailyTipsSlate(slateKey(timeZone, 1));

const cachedWeeklyTipsSlate = ttlMemo(
  async () => pruneSlateForCache(await getWeeklySlate({ ensure: false })),
  180_000,
  slateIsCacheable
);

/**
 * The slate is cached; the product is rebuilt per request, and that is
 * deliberate rather than incidental.
 *
 * `buildDailyTipsProduct` takes an `asOf` and uses it to mark tips whose
 * supporting odds have expired. Caching a finished product froze that
 * judgement at write time, so within a five-minute window a pick could keep
 * claiming a live price it no longer had. Rebuilding from the cached slate
 * evaluates expiry against the actual request, which is both cheaper and more
 * honest.
 */
export async function getCachedTodayTipsProduct(timeZone = DEFAULT_TIMEZONE): Promise<DailyTipsProduct> {
  return buildDailyTipsProduct(await cachedTodayTipsSlate(timeZone), { day: "today", asOf: new Date() });
}

export async function getCachedTomorrowTipsProduct(timeZone = DEFAULT_TIMEZONE): Promise<DailyTipsProduct> {
  return buildDailyTipsProduct(await cachedTomorrowTipsSlate(timeZone), { day: "tomorrow", asOf: new Date() });
}

export async function getCachedWeeklyTipsProduct(): Promise<WeeklyTipsProduct> {
  return buildWeeklyTipsProduct(await cachedWeeklyTipsSlate(), new Date());
}

export const getCachedYesterdayResultsProduct = unstable_cache(
  () => getYesterdayResultsProduct(),
  ["public-yesterday-results-v1"],
  { revalidate: 300 }
);

/**
 * Counts-only read for the homepage card. Cheap enough to finish inside the
 * page's render budget, unlike the full tips product it replaced there.
 */
export const getCachedHomepageMatchdaySummary = unstable_cache(
  () => readHomepageMatchdaySummary(),
  ["public-homepage-matchday-summary-v1"],
  { revalidate: 120 }
);

/**
 * Per-day counts for the seven-day board — the same fast-path treatment the
 * matchday card got, because the weekly card was losing the same 2.5s race.
 */
export const getCachedHomepageModelRecordSummary = unstable_cache(
  () => readHomepageModelRecordSummary(),
  ["public-homepage-model-record-v1"],
  { revalidate: 300 }
);

export const getCachedHomepageWeeklySummary = unstable_cache(
  () => readHomepageWeeklySummary(),
  ["public-homepage-weekly-summary-v1"],
  { revalidate: 300 }
);
