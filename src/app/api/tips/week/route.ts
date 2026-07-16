import { apiSuccess, publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
import { getCachedWeeklyTipsProduct } from "@/lib/sports/tips/publicReads";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async () => apiSuccess(await getCachedWeeklyTipsProduct(), publicCacheInit(180)));
