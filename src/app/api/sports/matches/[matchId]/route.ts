import { apiError, apiSuccess, publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
import { getMatchPrediction } from "@/lib/sports/service";

type RouteContext = {
  params: Promise<{ matchId: string }>;
};

export const GET = withApiHandler(async (_request: Request, context: RouteContext) => {
  const { matchId } = await context.params;
  if (!matchId || matchId.length > 80) return apiError("Invalid matchId.");
  const data = await getMatchPrediction(matchId);
  if (!data) return apiError("Match not found.", 404);
  // The match id is already in the path, so the CDN keys on it without a Vary.
  // The matching page route revalidates on 180s; this stayed uncached, so the
  // JSON view re-ran the full prediction pipeline on every single hit.
  return apiSuccess(data, publicCacheInit(180));
});
