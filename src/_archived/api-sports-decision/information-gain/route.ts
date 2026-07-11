import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionActivationAudit } from "@/lib/sports/prediction/decisionActivationAudit";
import { buildDecisionActionSandbox } from "@/lib/sports/prediction/decisionActionSandbox";
import { buildDecisionAgentLoop } from "@/lib/sports/prediction/decisionAgentLoop";
import { buildDecisionAICouncil } from "@/lib/sports/prediction/decisionAICouncil";
import { buildDecisionAIOrchestrator } from "@/lib/sports/prediction/decisionAIOrchestrator";
import { buildDecisionAIReviewLedger } from "@/lib/sports/prediction/decisionAIReviewLedger";
import { buildDecisionAutopilot } from "@/lib/sports/prediction/decisionAutopilot";
import { buildDecisionBeliefRevision } from "@/lib/sports/prediction/decisionBeliefRevision";
import { buildDecisionBrainSlate } from "@/lib/sports/prediction/decisionBrain";
import { getCalibrationSnapshot } from "@/lib/sports/prediction/decisionCalibration";
import { buildDecisionCounterfactualLab } from "@/lib/sports/prediction/decisionCounterfactualLab";
import { buildDecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import { buildDecisionEvidenceRefreshScheduler } from "@/lib/sports/prediction/decisionEvidenceRefreshScheduler";
import { buildDecisionFeatureMatrix } from "@/lib/sports/prediction/decisionFeatureMatrix";
import { buildDecisionHypothesisLab } from "@/lib/sports/prediction/decisionHypothesisLab";
import { buildDecisionInformationGainPlanner } from "@/lib/sports/prediction/decisionInformationGain";
import { buildDecisionInvalidationMonitor } from "@/lib/sports/prediction/decisionInvalidationMonitor";
import { buildDecisionLearningQueue } from "@/lib/sports/prediction/decisionLearningQueue";
import { getDecisionMemorySnapshot } from "@/lib/sports/prediction/decisionMemory";
import { buildDecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { buildDecisionModelTrust } from "@/lib/sports/prediction/decisionModelTrust";
import { DECISION_MULTI_SPORTS } from "@/lib/sports/prediction/decisionMultiSportThinking";
import { buildDecisionOddsBoard } from "@/lib/sports/prediction/decisionOddsBoard";
import { buildDecisionOperatingCycle } from "@/lib/sports/prediction/decisionOperatingCycle";
import { buildDecisionPortfolioRisk } from "@/lib/sports/prediction/decisionPortfolioRisk";
import { buildDecisionProofRunner } from "@/lib/sports/prediction/decisionProofRunner";
import { buildDecisionRepairPlan } from "@/lib/sports/prediction/decisionRepairPlanner";
import { buildDecisionRepairVerification } from "@/lib/sports/prediction/decisionRepairVerifier";
import { buildDecisionResearchAgent } from "@/lib/sports/prediction/decisionResearchAgent";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionSelfAudit } from "@/lib/sports/prediction/decisionSelfAudit";
import { buildDecisionSignalReliability } from "@/lib/sports/prediction/decisionSignalReliability";
import { buildDecisionSupervisorQueue } from "@/lib/sports/prediction/decisionSupervisor";
import { buildDecisionTraceLedger } from "@/lib/sports/prediction/decisionTraceLedger";
import { getPredictions } from "@/lib/sports/service";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 40) : 12;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const [rows, readiness, memory, calibration, training, slates] = await Promise.all([
    getPredictions({ date: query.date, sport: query.sport }),
    verifyDecisionEngineReadiness(),
    getDecisionMemorySnapshot({ limit: 8 }),
    getCalibrationSnapshot(query.sport),
    getTrainingDataSnapshot(query.sport),
    Promise.all(
      DECISION_MULTI_SPORTS.map(async (sport) => ({
        sport,
        rows: await getPredictions({ date: query.date, sport })
      }))
    )
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
  const dataIntake = buildDecisionDataIntakeQueue({ rows, date: query.date, sport: query.sport, readiness, limit: 10 });
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
  const oddsBoard = buildDecisionOddsBoard({ date: query.date, slates, limit: 40 });
  const portfolioRisk = buildDecisionPortfolioRisk({ board: oddsBoard, limit: 12 });
  const modelTrust = buildDecisionModelTrust({ date: query.date, sport: query.sport, governance, calibration, training, board: oddsBoard, portfolio: portfolioRisk });
  const signalReliability = buildDecisionSignalReliability({ rows, date: query.date, sport: query.sport, dataIntake });
  const evidenceRefresh = buildDecisionEvidenceRefreshScheduler({
    rows,
    date: query.date,
    sport: query.sport,
    dataIntake,
    signalReliability,
    modelTrust,
    oddsBoard,
    portfolioRisk,
    limit: 12
  });
  const hypothesisLab = buildDecisionHypothesisLab({ rows, date: query.date, sport: query.sport, limit: 12 });
  const counterfactualLab = buildDecisionCounterfactualLab({ rows, date: query.date, sport: query.sport, limit: 12 });
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
  const aiOrchestrator = buildDecisionAIOrchestrator({
    rows,
    date: query.date,
    sport: query.sport,
    readiness,
    brainSlate,
    selfAudit,
    agentLoop,
    dataIntake,
    council: aiCouncil
  });
  const proofRunner = buildDecisionProofRunner({ date: query.date, sport: query.sport, activationAudit, traceLedger, autopilot, limit: 8 });
  const aiReviewLedger = buildDecisionAIReviewLedger({ date: query.date, sport: query.sport, orchestrator: aiOrchestrator, activationAudit, proofRunner, limit: 8 });
  const beliefRevision = buildDecisionBeliefRevision({
    rows,
    date: query.date,
    sport: query.sport,
    counterfactualLab,
    proofRunner,
    aiReviewLedger,
    limit: 10
  });

  return apiSuccess(
    buildDecisionInformationGainPlanner({
      date: query.date,
      sport: query.sport,
      dataIntake,
      evidenceRefresh,
      hypothesisLab,
      counterfactualLab,
      beliefRevision,
      limit: parseLimit(url.searchParams.get("limit"))
    })
  );
}
