import { apiSuccess, publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
import { getWeeklySlate } from "@/lib/sports/intelligence/pipeline";
import { toSlateWirePayload } from "@/lib/sports/intelligence/slateWire";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async (request: Request) => {
  const slate = await getWeeklySlate({ ensure: false });
  // A seven-day window repeats the duplication problem seven times over.
  const summaryOnly = new URL(request.url).searchParams.get("view") === "summary";
  return apiSuccess(toSlateWirePayload(slate, { summaryOnly }), publicCacheInit(120, ["view"]));
});
