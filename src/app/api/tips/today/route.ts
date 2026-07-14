import { apiSuccess, publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
import { getDailyTipsProduct } from "@/lib/sports/tips/product";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async () => apiSuccess(await getDailyTipsProduct({ day: "today" }), publicCacheInit(60)));
