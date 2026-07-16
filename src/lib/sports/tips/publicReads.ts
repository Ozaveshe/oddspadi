import { unstable_cache } from "next/cache";
import {
  getDailyTipsProduct,
  getWeeklyTipsProduct,
  getYesterdayResultsProduct
} from "@/lib/sports/tips/product";

// Public surfaces read scheduled engine output only. Provider execution belongs
// to the cron/operator lane, not to an anonymous page request.
export const getCachedTodayTipsProduct = unstable_cache(
  () => getDailyTipsProduct({ day: "today", ensure: false }),
  ["public-today-tips-v1"],
  { revalidate: 60 }
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
