import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionActionSandbox } from "@/lib/sports/prediction/decisionActionSandbox";
import { buildDecisionAgentLoop } from "@/lib/sports/prediction/decisionAgentLoop";
import { buildDecisionAICouncil } from "@/lib/sports/prediction/decisionAICouncil";
import { buildDecisionAutopilot } from "@/lib/sports/prediction/decisionAutopilot";
import { buildDecisionBrainSlate } from "@/lib/sports/prediction/decisionBrain";
import { getCalibrationSnapshot } from "@/lib/sports/prediction/decisionCalibration";
import { buildDecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import { buildDecisionFeatureMatrix } from "@/lib/sports/prediction/decisionFeatureMatrix";
import { buildDecisionInvalidationMonitor } from "@/lib/sports/prediction/decisionInvalidationMonitor";
import { buildDecisionLearningQueue } from "@/lib/sports/prediction/decisionLearningQueue";
import { getDecisionMemorySnapshot } from "@/lib/sports/prediction/decisionMemory";
import { buildDecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { buildDecisionOperatingCycle } from "@/lib/sports/prediction/decisionOperatingCycle";
import { buildDecisionRepairPlan } from "@/lib/sports/prediction/decisionRepairPlanner";
import { buildDecisionRepairVerification } from "@/lib/sports/prediction/decisionRepairVerifier";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionSelfAudit } from "@/lib/sports/prediction/decisionSelfAudit";
import { buildDecisionSupervisorQueue } from "@/lib/sports/prediction/decisionSupervisor";
import { getPredictions } from "@/lib/sports/service";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const [rows, readiness, memory, calibration, training] = await Promise.all([
    getPredictions({ date: query.date, sport: query.sport }),
    verifyDecisionEngineReadiness(),
    getDecisionMemorySnapshot({ limit: 8 }),
    getCalibrationSnapshot(query.sport),
    getTrainingDataSnapshot(query.sport)
  ]);
  const brainSlate = buildDecisionBrainSlate({ rows, date: query.date, sport: query.sport, limit: 6 });
  const supervisorQueue = buildDecisionSupervisorQueue({ rows, date: query.date, sport: query.sport, limit: 8 });
  const agentLoop = buildDecisionAgentLoop({ rows, date: query.date, sport: query.sport, limit: 6, brainSlate, supervisorQueue });
  const selfAudit = buildDecisionSelfAudit({ rows, date: query.date, sport: query.sport, agentLoop });
  const repairPlan = buildDecisionRepairPlan({ rows, date: query.date, sport: query.sport, agentLoop, selfAudit });
  const repairVerification = buildDecisionRepairVerification({ repairPlan, selfAudit, readiness });
  const operatingCycle = buildDecisionOperatingCycle({
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
  });
  const actionSandbox = buildDecisionActionSandbox({
    rows,
    date: query.date,
    sport: query.sport,
    readiness,
    brainSlate,
    supervisorQueue,
    agentLoop,
    selfAudit,
    repairPlan,
    repairVerification,
    operatingCycle
  });
  const learningQueue = buildDecisionLearningQueue({
    rows,
    date: query.date,
    sport: query.sport,
    readiness,
    memory,
    calibration,
    training
  });
  const dataIntake = buildDecisionDataIntakeQueue({ rows, date: query.date, sport: query.sport, readiness, limit: 8 });
  const aiCouncil = buildDecisionAICouncil({
    rows,
    date: query.date,
    sport: query.sport,
    readiness,
    brainSlate,
    selfAudit,
    agentLoop,
    dataIntake,
    limit: 5
  });
  const featureMatrix = buildDecisionFeatureMatrix({ rows, date: query.date, sport: query.sport, limit: 8 });
  const governance = buildDecisionModelGovernance({ matrix: featureMatrix, training, date: query.date, sport: query.sport });
  const invalidationMonitor = buildDecisionInvalidationMonitor({
    rows,
    date: query.date,
    sport: query.sport,
    dataIntake,
    governance,
    limit: 12
  });

  return apiSuccess(
    buildDecisionAutopilot({
      date: query.date,
      sport: query.sport,
      council: aiCouncil,
      invalidationMonitor,
      governance,
      actionSandbox,
      learningQueue,
      operatingCycle
    })
  );
}
