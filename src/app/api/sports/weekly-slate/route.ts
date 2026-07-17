import { apiSuccess, publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
import { getWeeklySlate } from "@/lib/sports/intelligence/pipeline";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async () => apiSuccess(await getWeeklySlate({ ensure: false }), publicCacheInit(120)));
