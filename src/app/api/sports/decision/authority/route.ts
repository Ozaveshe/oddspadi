import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { buildDecisionActivationAudit } from "@/lib/sports/prediction/decisionActivationAudit";
import { buildDecisionActionSandbox } from "@/lib/sports/prediction/decisionActionSandbox";
import { buildDecisionAgentLoop } from "@/lib/sports/prediction/decisionAgentLoop";
import { buildDecisionAICouncil } from "@/lib/sports/prediction/decisionAICouncil";
import { buildDecisionAIFirewall } from "@/lib/sports/prediction/decisionAIFirewall";
import { buildDecisionAIHandoffPacket } from "@/lib/sports/prediction/decisionAIHandoff";
import { runDecisionAIOrchestrator, type DecisionAIOrchestratorRunScope } from "@/lib/sports/prediction/decisionAIOrchestrator";
import { buildDecisionAIReviewLedger } from "@/lib/sports/prediction/decisionAIReviewLedger";
import { buildDecisionAuthority } from "@/lib/sports/prediction/decisionAuthority";
import { buildDecisionAutopilot } from "@/lib/sports/prediction/decisionAutopilot";
import { buildDecisionBeliefRevision } from "@/lib/sports/prediction/decisionBeliefRevision";
import { buildDecisionBrainSlate } from "@/lib/sports/prediction/decisionBrain";
import { getCalibrationSnapshot } from "@/lib/sports/prediction/decisionCalibration";
import { buildDecisionCounterfactualLab } from "@/lib/sports/prediction/decisionCounterfactualLab";
import { buildDecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import { buildDecisionFeatureMatrix } from "@/lib/sports/prediction/decisionFeatureMatrix";
import { buildDecisionInvalidationMonitor } from "@/lib/sports/prediction/decisionInvalidationMonitor";
import { buildDecisionLearningQueue } from "@/lib/sports/prediction/decisionLearningQueue";
import { getDecisionMemorySnapshot } from "@/lib/sports/prediction/decisionMemory";
import { buildDecisionMetacognition } from "@/lib/sports/prediction/decisionMetacognition";
import { buildDecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { buildDecisionOperatingCycle } from "@/lib/sports/prediction/decisionOperatingCycle";
import { buildDecisionProofRunner } from "@/lib/sports/prediction/decisionProofRunner";
import { buildDecisionRepairPlan } from "@/lib/sports/prediction/decisionRepairPlanner";
import { buildDecisionRepairVerification } from "@/lib/sports/prediction/decisionRepairVerifier";
import { buildDecisionResearchAgent } from "@/lib/sports/prediction/decisionResearchAgent";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionSelfAudit } from "@/lib/sports/prediction/decisionSelfAudit";
import { buildDecisionSupervisorQueue } from "@/lib/sports/prediction/decisionSupervisor";
import { buildDecisionTraceLedger } from "@/lib/sports/prediction/decisionTraceLedger";
import { getPredictions } from "@/lib/sports/service";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

function parseRunScope(value: string | null): DecisionAIOrchestratorRunScope {
  if (value === "1" || value === "true" || value === "all") return "all";
  if (value === "slate") return "slate";
  if (value === "match" || value === "active-match") return "active-match";
  return "none";
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const runScope = parseRunScope(url.searchParams.get("run"));
  if (runScope !== "none" && !isDecisionAdminAuthorized(request)) {
    return apiError("OpenAI authority execution requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
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
  const aiOrchestrator = await runDecisionAIOrchestrator({
    rows,
    date: query.date,
    sport: query.sport,
    readiness,
    brainSlate,
    selfAudit,
    agentLoop,
    dataIntake,
    council: aiCouncil,
    runScope
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
  const autopilot = buildDecisionAutopilot({
    date: query.date,
    sport: query.sport,
    council: aiCouncil,
    invalidationMonitor,
    governance,
    actionSandbox,
    learningQueue,
    operatingCycle
  });
  const researchAgent = buildDecisionResearchAgent({
    rows,
    date: query.date,
    sport: query.sport,
    dataIntake,
    governance,
    invalidationMonitor,
    autopilot
  });
  const traceLedger = buildDecisionTraceLedger({
    rows,
    date: query.date,
    sport: query.sport,
    governance,
    invalidationMonitor,
    researchAgent,
    aiCouncil,
    autopilot,
    actionSandbox,
    learningQueue
  });
  const activationAudit = buildDecisionActivationAudit({
    date: query.date,
    sport: query.sport,
    readiness,
    dataIntake,
    governance,
    autopilot,
    traceLedger
  });
  const proofRunner = buildDecisionProofRunner({
    date: query.date,
    sport: query.sport,
    activationAudit,
    traceLedger,
    autopilot
  });
  const aiReviewLedger = buildDecisionAIReviewLedger({
    date: query.date,
    sport: query.sport,
    orchestrator: aiOrchestrator,
    activationAudit,
    proofRunner
  });
  const counterfactualLab = buildDecisionCounterfactualLab({
    rows,
    date: query.date,
    sport: query.sport,
    limit: 40
  });
  const beliefRevision = buildDecisionBeliefRevision({
    rows,
    date: query.date,
    sport: query.sport,
    counterfactualLab,
    proofRunner,
    aiReviewLedger,
    limit: 12
  });
  const metacognition = buildDecisionMetacognition({
    rows,
    date: query.date,
    sport: query.sport,
    brainSlate,
    operatingCycle,
    autopilot,
    counterfactualLab,
    beliefRevision,
    proofRunner,
    aiReviewLedger
  });
  const handoff = buildDecisionAIHandoffPacket({
    rows,
    date: query.date,
    sport: query.sport,
    orchestrator: aiOrchestrator,
    aiReviewLedger,
    metacognition
  });
  const firewall = buildDecisionAIFirewall({
    date: query.date,
    sport: query.sport,
    council: aiCouncil,
    orchestrator: aiOrchestrator,
    aiReviewLedger,
    metacognition,
    handoff
  });

  return apiSuccess(
    buildDecisionAuthority({
      rows,
      date: query.date,
      sport: query.sport,
      metacognition,
      handoff,
      firewall,
      proofRunner,
      aiReviewLedger
    })
  );
}
