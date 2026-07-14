import { apiSuccess, publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
import { getEnginePerformanceReport } from "@/lib/sports/performance/report";

export const GET = withApiHandler(async () => apiSuccess(await getEnginePerformanceReport(), publicCacheInit(300)));
