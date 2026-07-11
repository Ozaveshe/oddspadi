import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { buildDecisionBrain } from "@/lib/sports/prediction/decisionBrain";
import { getMatchPrediction } from "@/lib/sports/service";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ matchId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { matchId: rawMatchId } = await context.params;
  let matchId = rawMatchId;
  try {
    matchId = decodeURIComponent(rawMatchId);
  } catch {
    // Retain the raw route segment when it was not URI encoded.
  }
  if (!matchId || matchId.length > 80) return apiError("Invalid matchId.");

  const row = await getMatchPrediction(matchId);
  if (!row) return apiError("Match not found.", 404);

  return apiSuccess(buildDecisionBrain(row));
}
