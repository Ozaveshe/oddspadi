import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { buildDecisionAgentLoop } from "@/lib/sports/prediction/decisionAgentLoop";
import { buildDecisionAICouncil, runOpenAIDecisionCouncilReview } from "@/lib/sports/prediction/decisionAICouncil";
import { buildDecisionBrainSlate } from "@/lib/sports/prediction/decisionBrain";
import { buildDecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionSelfAudit } from "@/lib/sports/prediction/decisionSelfAudit";
import { buildDecisionSupervisorQueue } from "@/lib/sports/prediction/decisionSupervisor";
import { getPredictions } from "@/lib/sports/service";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 20) : 5;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const shouldReview = url.searchParams.get("review") === "1" || url.searchParams.get("ai") === "1";
  if (shouldReview && !isDecisionAdminAuthorized(request)) {
    return apiError("OpenAI council review requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  const [rows, readiness] = await Promise.all([
    getPredictions({ date: query.date, sport: query.sport }),
    verifyDecisionEngineReadiness()
  ]);
  const brainSlate = buildDecisionBrainSlate({ rows, date: query.date, sport: query.sport, limit: 6 });
  const supervisorQueue = buildDecisionSupervisorQueue({ rows, date: query.date, sport: query.sport, limit: 8 });
  const agentLoop = buildDecisionAgentLoop({ rows, date: query.date, sport: query.sport, limit: 6, brainSlate, supervisorQueue });
  const selfAudit = buildDecisionSelfAudit({ rows, date: query.date, sport: query.sport, agentLoop });
  const dataIntake = buildDecisionDataIntakeQueue({ rows, date: query.date, sport: query.sport, readiness, limit: 8 });
  const council = buildDecisionAICouncil({
    rows,
    date: query.date,
    sport: query.sport,
    readiness,
    brainSlate,
    selfAudit,
    agentLoop,
    dataIntake,
    limit: parseLimit(url.searchParams.get("limit"))
  });

  return apiSuccess(shouldReview ? await runOpenAIDecisionCouncilReview({ council }) : council);
}
