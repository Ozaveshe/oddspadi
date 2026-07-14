import { apiSuccess, publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
import { getWeeklyTipsProduct } from "@/lib/sports/tips/product";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async () => apiSuccess(await getWeeklyTipsProduct(), publicCacheInit(120)));
