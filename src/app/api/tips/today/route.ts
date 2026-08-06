import { apiSuccess, publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
import { getCachedTodayTipsProduct } from "@/lib/sports/tips/publicReads";
import { readTimezonePreference } from "@/lib/time/timezoneCookie";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async () => apiSuccess(await getCachedTodayTipsProduct(await readTimezonePreference()), publicCacheInit(60)));
