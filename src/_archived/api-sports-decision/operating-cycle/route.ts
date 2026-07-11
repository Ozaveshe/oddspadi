import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionAgentLoop } from "@/lib/sports/prediction/decisionAgentLoop";
import { buildDecisionBrainSlate } from "@/lib/sports/prediction/decisionBrain";
import { buildDecisionOperatingCycle } from "@/lib/sports/prediction/decisionOperatingCycle";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionRepairPlan } from "@/lib/sports/prediction/decisionRepairPlanner";
import { buildDecisionRepairVerification } from "@/lib/sports/prediction/decisionRepairVerifier";
import { buildDecisionSelfAudit } from "@/lib/sports/prediction/decisionSelfAudit";
import { buildDecisionSupervisorQueue } from "@/lib/sports/prediction/decisionSupervisor";
import { getPredictions } from "@/lib/sports/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const [rows, readiness] = await Promise.all([getPredictions({ date: query.date, sport: query.sport }), verifyDecisionEngineReadiness()]);
  const brainSlate = buildDecisionBrainSlate({ rows, date: query.date, sport: query.sport, limit: 6 });
  const supervisorQueue = buildDecisionSupervisorQueue({ rows, date: query.date, sport: query.sport, limit: 8 });
  const agentLoop = buildDecisionAgentLoop({ rows, date: query.date, sport: query.sport, limit: 6, brainSlate, supervisorQueue });
  const selfAudit = buildDecisionSelfAudit({ rows, date: query.date, sport: query.sport, agentLoop });
  const repairPlan = buildDecisionRepairPlan({ rows, date: query.date, sport: query.sport, agentLoop, selfAudit });
  const repairVerification = buildDecisionRepairVerification({ repairPlan, selfAudit, readiness });

  return apiSuccess(
    buildDecisionOperatingCycle({
      rows,
      date: query.date,
      sport: query.sport,
      readiness,
      brainSlate,
      supervisorQueue,
      agentLoop,
      selfAudit,
      repairPlan,
      repairVerification
    })
  );
}
