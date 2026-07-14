import { apiSuccess, publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
import { getDailySlate } from "@/lib/sports/intelligence/pipeline";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async () => apiSuccess(await getDailySlate(), publicCacheInit(60)));
