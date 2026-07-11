import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { getMatchPrediction } from "@/lib/sports/service";

type RouteContext = {
  params: Promise<{ matchId: string }>;
};

export const GET = withApiHandler(async (_request: Request, context: RouteContext) => {
  const { matchId } = await context.params;
  if (!matchId || matchId.length > 80) return apiError("Invalid matchId.");
  const data = await getMatchPrediction(matchId);
  if (!data) return apiError("Match not found.", 404);
  return apiSuccess(data);
});
