import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionActivationAudit } from "@/lib/sports/prediction/decisionActivationAudit";
import { buildDecisionActionSandbox } from "@/lib/sports/prediction/decisionActionSandbox";
import { buildDecisionAgentKernel } from "@/lib/sports/prediction/decisionAgentKernel";
import { buildDecisionAgentLoop } from "@/lib/sports/prediction/decisionAgentLoop";
import { buildDecisionAgentRuntime } from "@/lib/sports/prediction/decisionAgentRuntime";
import { buildDecisionAICitationValidator } from "@/lib/sports/prediction/decisionAICitationValidator";
import { buildDecisionAICouncil } from "@/lib/sports/prediction/decisionAICouncil";
import { buildDecisionAIFirewall } from "@/lib/sports/prediction/decisionAIFirewall";
import { buildDecisionAIHandoffPacket } from "@/lib/sports/prediction/decisionAIHandoff";
import { buildDecisionAIOrchestrator } from "@/lib/sports/prediction/decisionAIOrchestrator";
import { buildDecisionAIReviewLedger } from "@/lib/sports/prediction/decisionAIReviewLedger";
import { buildDecisionAuthority } from "@/lib/sports/prediction/decisionAuthority";
import { buildDecisionAutopilot } from "@/lib/sports/prediction/decisionAutopilot";
import { buildDecisionBeliefRevision } from "@/lib/sports/prediction/decisionBeliefRevision";
import { buildDecisionBrainSlate } from "@/lib/sports/prediction/decisionBrain";
import { getCalibrationSnapshot } from "@/lib/sports/prediction/decisionCalibration";
import { buildDecisionCapabilityContract } from "@/lib/sports/prediction/decisionCapabilityContract";
import { buildDecisionCounterfactualLab } from "@/lib/sports/prediction/decisionCounterfactualLab";
import { buildDecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import { buildDecisionEvidenceRefreshScheduler } from "@/lib/sports/prediction/decisionEvidenceRefreshScheduler";
import { buildDecisionEvidenceRefreshVerifier } from "@/lib/sports/prediction/decisionEvidenceRefreshVerifier";
import { buildDecisionEvidenceTransition } from "@/lib/sports/prediction/decisionEvidenceTransition";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import { buildDecisionFeatureMatrix } from "@/lib/sports/prediction/decisionFeatureMatrix";
import { buildDecisionInvalidationMonitor } from "@/lib/sports/prediction/decisionInvalidationMonitor";
import { buildDecisionLearningQueue } from "@/lib/sports/prediction/decisionLearningQueue";
import { getDecisionMemorySnapshot } from "@/lib/sports/prediction/decisionMemory";
import { buildDecisionMetacognition } from "@/lib/sports/prediction/decisionMetacognition";
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
import { buildDecisionSupabaseBootstrap } from "@/lib/sports/prediction/decisionSupabaseBootstrap";
import { buildDecisionSupervisorQueue } from "@/lib/sports/prediction/decisionSupervisor";
import { buildDecisionTraceLedger } from "@/lib/sports/prediction/decisionTraceLedger";
import { getPredictions } from "@/lib/sports/service";
import { buildTenYearFootballCorpusBackfillPlan } from "@/lib/sports/training/corpusBackfillPlan";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const [rows, readiness, memory, calibration, training, corpusPlan, slates] = await Promise.all([
    getPredictions({ date: query.date, sport: query.sport }),
    verifyDecisionEngineReadiness(),
    getDecisionMemorySnapshot({ limit: 8 }),
    getCalibrationSnapshot(query.sport),
    getTrainingDataSnapshot(query.sport),
    buildTenYearFootballCorpusBackfillPlan({ baseUrl: decisionSiteOrigin() }),
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
  const dataIntake = buildDecisionDataIntakeQueue({ rows, date: query.date, sport: query.sport, readiness, limit: 8 });
  const signalReliability = buildDecisionSignalReliability({ rows, date: query.date, sport: query.sport, dataIntake });
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
  const featureMatrix = buildDecisionFeatureMatrix({ rows, date: query.date, sport: query.sport, limit: 8 });
  const modelGovernance = buildDecisionModelGovernance({ matrix: featureMatrix, training, date: query.date, sport: query.sport });
  const oddsBoard = buildDecisionOddsBoard({ date: query.date, slates, limit: 40 });
  const portfolioRisk = buildDecisionPortfolioRisk({ board: oddsBoard, limit: 12 });
  const modelTrust = buildDecisionModelTrust({ date: query.date, sport: query.sport, governance: modelGovernance, calibration, training, board: oddsBoard, portfolio: portfolioRisk });
  const evidenceRefresh = buildDecisionEvidenceRefreshScheduler({
    rows,
    date: query.date,
    sport: query.sport,
    dataIntake,
    signalReliability,
    modelTrust,
    oddsBoard,
    portfolioRisk,
    limit: 10
  });
  const evidenceVerifier = buildDecisionEvidenceRefreshVerifier({ scheduler: evidenceRefresh, signalReliability, dataIntake, modelTrust, portfolioRisk, oddsBoard });
  const evidenceTransition = buildDecisionEvidenceTransition({ scheduler: evidenceRefresh, verifier: evidenceVerifier, signalReliability, dataIntake, modelTrust, portfolioRisk, oddsBoard });
  const invalidationMonitor = buildDecisionInvalidationMonitor({
    rows,
    date: query.date,
    sport: query.sport,
    dataIntake,
    governance: modelGovernance,
    limit: 12
  });
  const autopilot = buildDecisionAutopilot({
    date: query.date,
    sport: query.sport,
    council: aiCouncil,
    invalidationMonitor,
    governance: modelGovernance,
    actionSandbox,
    learningQueue,
    operatingCycle
  });
  const researchAgent = buildDecisionResearchAgent({
    rows,
    date: query.date,
    sport: query.sport,
    dataIntake,
    governance: modelGovernance,
    invalidationMonitor,
    autopilot
  });
  const traceLedger = buildDecisionTraceLedger({
    rows,
    date: query.date,
    sport: query.sport,
    governance: modelGovernance,
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
    governance: modelGovernance,
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
  const counterfactualLab = buildDecisionCounterfactualLab({ rows, date: query.date, sport: query.sport, limit: 40 });
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
  const citations = buildDecisionAICitationValidator({ date: query.date, sport: query.sport, handoff, firewall });
  const authority = buildDecisionAuthority({
    rows,
    date: query.date,
    sport: query.sport,
    metacognition,
    handoff,
    firewall,
    proofRunner,
    aiReviewLedger
  });
  const kernel = buildDecisionAgentKernel({
    date: query.date,
    sport: query.sport,
    metacognition,
    handoff,
    citations,
    firewall,
    authority,
    proofRunner,
    aiReviewLedger
  });
  const agentRuntime = buildDecisionAgentRuntime({
    date: query.date,
    sport: query.sport,
    kernel,
    activationAudit,
    orchestrator: aiOrchestrator,
    autopilot,
    dataIntake,
    traceLedger
  });
  const supabaseBootstrap = buildDecisionSupabaseBootstrap({ readiness, corpusPlan, runtime: agentRuntime });

  return apiSuccess(
    buildDecisionCapabilityContract({
      date: query.date,
      sport: query.sport,
      readiness,
      dataIntake,
      signalReliability,
      modelTrust,
      oddsBoard,
      transition: evidenceTransition,
      authority,
      runtime: agentRuntime,
      activationAudit,
      supabaseBootstrap
    })
  );
}
