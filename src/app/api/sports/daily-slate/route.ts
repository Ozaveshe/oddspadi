import { apiSuccess, publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
import { getDailySlate } from "@/lib/sports/intelligence/pipeline";
import { toSlateWirePayload } from "@/lib/sports/intelligence/slateWire";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async (request: Request) => {
  const slate = await getDailySlate({ ensure: false });
  // view=summary additionally drops the per-market dossier from each fixture.
  const summaryOnly = new URL(request.url).searchParams.get("view") === "summary";
  return apiSuccess(toSlateWirePayload(slate, { summaryOnly }), publicCacheInit(60, ["view"]));
});
