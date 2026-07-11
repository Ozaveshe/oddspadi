import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionAgentLoop } from "@/lib/sports/prediction/decisionAgentLoop";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionRepairPlan } from "@/lib/sports/prediction/decisionRepairPlanner";
import { buildDecisionRepairVerification } from "@/lib/sports/prediction/decisionRepairVerifier";
import { buildDecisionSelfAudit } from "@/lib/sports/prediction/decisionSelfAudit";
import { getPredictions } from "@/lib/sports/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const [rows, readiness] = await Promise.all([getPredictions({ date: query.date, sport: query.sport }), verifyDecisionEngineReadiness()]);
  const agentLoop = buildDecisionAgentLoop({ rows, date: query.date, sport: query.sport });
  const selfAudit = buildDecisionSelfAudit({ rows, date: query.date, sport: query.sport, agentLoop });
  const repairPlan = buildDecisionRepairPlan({ rows, date: query.date, sport: query.sport, agentLoop, selfAudit });

  return apiSuccess(buildDecisionRepairVerification({ repairPlan, selfAudit, readiness }));
}
