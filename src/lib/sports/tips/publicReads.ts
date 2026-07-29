import { unstable_cache } from "next/cache";
import {
  getDailyTipsProduct,
  getWeeklyTipsProduct,
  getYesterdayResultsProduct
} from "@/lib/sports/tips/product";

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
export const getCachedTodayTipsProduct = unstable_cache(
  () => getDailyTipsProduct({ day: "today", ensure: false }),
  ["public-today-tips-v1"],
  { revalidate: 300 }
);

export const getCachedTomorrowTipsProduct = unstable_cache(
  () => getDailyTipsProduct({ day: "tomorrow", ensure: false }),
  ["public-tomorrow-tips-v1"],
  { revalidate: 90 }
);

export const getCachedWeeklyTipsProduct = unstable_cache(
  () => getWeeklyTipsProduct({ ensure: false }),
  ["public-weekly-tips-v1"],
  { revalidate: 180 }
);

export const getCachedYesterdayResultsProduct = unstable_cache(
  () => getYesterdayResultsProduct(),
  ["public-yesterday-results-v1"],
  { revalidate: 300 }
);
