import { apiError, apiSuccess, parsePublicHistoryFlag, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { getCalibrationSnapshot } from "@/lib/sports/prediction/decisionCalibration";
import { buildDecisionActivationAudit } from "@/lib/sports/prediction/decisionActivationAudit";
import { buildDecisionActivationRunbook } from "@/lib/sports/prediction/decisionActivationRunbook";
import { buildDecisionActionSandbox } from "@/lib/sports/prediction/decisionActionSandbox";
import { buildDecisionAgentKernel } from "@/lib/sports/prediction/decisionAgentKernel";
import { buildDecisionAgentLoop } from "@/lib/sports/prediction/decisionAgentLoop";
import { buildDecisionAgentRuntime } from "@/lib/sports/prediction/decisionAgentRuntime";
import { buildDecisionAICitationValidator } from "@/lib/sports/prediction/decisionAICitationValidator";
import { buildDecisionAICognitiveLoop } from "@/lib/sports/prediction/decisionAICognitiveLoop";
import { buildDecisionAIContextDossier } from "@/lib/sports/prediction/decisionAIContextDossier";
import { buildDecisionAIControlPacket } from "@/lib/sports/prediction/decisionAIControlPacket";
import { buildDecisionAICouncil } from "@/lib/sports/prediction/decisionAICouncil";
import { buildDecisionAIDeliberation } from "@/lib/sports/prediction/decisionAIDeliberation";
import {
  buildDecisionAIExecutive,
  runDecisionAIExecutiveProofObservation,
  runDecisionAIExecutiveReview
} from "@/lib/sports/prediction/decisionAIExecutive";
import { buildDecisionAIExecutiveCycle } from "@/lib/sports/prediction/decisionAIExecutiveCycle";
import { buildDecisionAIExecutiveFeedback } from "@/lib/sports/prediction/decisionAIExecutiveFeedback";
import { buildDecisionAIExecutiveGovernor } from "@/lib/sports/prediction/decisionAIExecutiveGovernor";
import { buildDecisionAIExecutiveRunbook } from "@/lib/sports/prediction/decisionAIExecutiveRunbook";
import { buildDecisionAIExperimentEpisode } from "@/lib/sports/prediction/decisionAIExperimentEpisode";
import { buildDecisionAIExperimentObserver } from "@/lib/sports/prediction/decisionAIExperimentObserver";
import { buildDecisionAIExperimentPlanner } from "@/lib/sports/prediction/decisionAIExperimentPlanner";
import { buildDecisionAIExperimentState } from "@/lib/sports/prediction/decisionAIExperimentState";
import { buildDecisionAIFirewall } from "@/lib/sports/prediction/decisionAIFirewall";
import { buildDecisionAIHandoffPacket } from "@/lib/sports/prediction/decisionAIHandoff";
import { buildDecisionAIOrchestrator } from "@/lib/sports/prediction/decisionAIOrchestrator";
import { buildDecisionAIReasoningGateway } from "@/lib/sports/prediction/decisionAIReasoningGateway";
import { buildDecisionAIReviewLedger } from "@/lib/sports/prediction/decisionAIReviewLedger";
import { buildDecisionAISession } from "@/lib/sports/prediction/decisionAISession";
import { buildDecisionAISessionShadowEvaluation } from "@/lib/sports/prediction/decisionAISessionShadowEvaluation";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import { buildDecisionAIThoughtEpisode } from "@/lib/sports/prediction/decisionAIThoughtEpisode";
import { getDecisionAIThoughtMemory } from "@/lib/sports/prediction/decisionAIThoughtMemory";
import { buildDecisionAuthority } from "@/lib/sports/prediction/decisionAuthority";
import { buildDecisionAutopilot } from "@/lib/sports/prediction/decisionAutopilot";
import { buildDecisionBeliefRevision } from "@/lib/sports/prediction/decisionBeliefRevision";
import { buildDecisionBrainSlate } from "@/lib/sports/prediction/decisionBrain";
import { buildDecisionCapabilityContract } from "@/lib/sports/prediction/decisionCapabilityContract";
import { buildDecisionCounterfactualLab } from "@/lib/sports/prediction/decisionCounterfactualLab";
import { buildDecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import { buildDecisionEvidenceRefreshScheduler } from "@/lib/sports/prediction/decisionEvidenceRefreshScheduler";
import { buildDecisionEvidenceRefreshVerifier } from "@/lib/sports/prediction/decisionEvidenceRefreshVerifier";
import { buildDecisionEvidenceTransition } from "@/lib/sports/prediction/decisionEvidenceTransition";
import { buildDecisionFeatureMatrix } from "@/lib/sports/prediction/decisionFeatureMatrix";
import { buildDecisionHypothesisLab } from "@/lib/sports/prediction/decisionHypothesisLab";
import { buildDecisionInformationGainPlanner } from "@/lib/sports/prediction/decisionInformationGain";
import { buildDecisionInvalidationMonitor } from "@/lib/sports/prediction/decisionInvalidationMonitor";
import { buildDecisionLearningQueue } from "@/lib/sports/prediction/decisionLearningQueue";
import { buildDecisionMetacognition } from "@/lib/sports/prediction/decisionMetacognition";
import { buildDecisionMind } from "@/lib/sports/prediction/decisionMind";
import { buildDecisionModelEnsemble } from "@/lib/sports/prediction/decisionModelEnsemble";
import { buildDecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { buildDecisionModelTrust } from "@/lib/sports/prediction/decisionModelTrust";
import { DECISION_MULTI_SPORTS, type DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";
import { buildDecisionMvpRequirementAudit } from "@/lib/sports/prediction/decisionMvpRequirementAudit";
import { buildDecisionNetlifyDeployment } from "@/lib/sports/prediction/decisionNetlifyDeployment";
import { buildDecisionOddsBoard } from "@/lib/sports/prediction/decisionOddsBoard";
import { buildDecisionOperatingCycle } from "@/lib/sports/prediction/decisionOperatingCycle";
import { buildDecisionOperatorEpisode } from "@/lib/sports/prediction/decisionOperatorEpisode";
import { buildDecisionOperatorReceipt } from "@/lib/sports/prediction/decisionOperatorReceipt";
import { buildDecisionOperatorState } from "@/lib/sports/prediction/decisionOperatorState";
import { buildDecisionOperatorTurn } from "@/lib/sports/prediction/decisionOperatorTurn";
import { buildDecisionPortfolioRisk } from "@/lib/sports/prediction/decisionPortfolioRisk";
import { buildDecisionProofRunner } from "@/lib/sports/prediction/decisionProofRunner";
import { buildDecisionProviderIngestionEvidence } from "@/lib/sports/prediction/decisionProviderIngestionEvidence";
import { buildDecisionReasoningAlignment } from "@/lib/sports/prediction/decisionReasoningAlignment";
import { buildDecisionRepairPlan } from "@/lib/sports/prediction/decisionRepairPlanner";
import { buildDecisionRepairVerification } from "@/lib/sports/prediction/decisionRepairVerifier";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionResearchAgent } from "@/lib/sports/prediction/decisionResearchAgent";
import { buildDecisionSelfAudit } from "@/lib/sports/prediction/decisionSelfAudit";
import { buildDecisionSignalReliability } from "@/lib/sports/prediction/decisionSignalReliability";
import { buildDecisionSupabaseBootstrap } from "@/lib/sports/prediction/decisionSupabaseBootstrap";
import { buildDecisionSupabaseProjectIsolation } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";
import { buildDecisionSupervisorQueue } from "@/lib/sports/prediction/decisionSupervisor";
import { buildDecisionTraceLedger } from "@/lib/sports/prediction/decisionTraceLedger";
import { getDecisionMemorySnapshot } from "@/lib/sports/prediction/decisionMemory";
import { getDecisionOpenAIModel } from "@/lib/sports/prediction/openaiModel";
import { getPredictions } from "@/lib/sports/service";
import { buildTenYearFootballCorpusBackfillPlan } from "@/lib/sports/training/corpusBackfillPlan";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

function shouldRun(url: URL): boolean {
  return url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true" || url.searchParams.get("ai") === "1";
}

function shouldObserve(url: URL): boolean {
  return shouldRun(url) || url.searchParams.get("observe") === "1" || url.searchParams.get("observe") === "true" || url.searchParams.get("proof") === "1";
}

function verdictRank(verdict: string) {
  if (verdict === "strong-value") return 5;
  if (verdict === "lean-value") return 4;
  if (verdict === "watchlist") return 3;
  if (verdict === "avoid") return 2;
  return 1;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  const requestUrl = new URL(request.url);
  const runRequested = shouldRun(requestUrl);
  if (runRequested && !isDecisionAdminAuthorized(request)) {
    return apiError("OpenAI executive review requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  const observeRequested = shouldObserve(requestUrl);
  const publicHistory = parsePublicHistoryFlag(request);
  if (!DECISION_MULTI_SPORTS.includes(query.sport as DecisionMultiSport)) {
    return apiError("The AI executive currently supports football, basketball, and tennis.");
  }
  const decisionSport = query.sport as DecisionMultiSport;

  const [readiness, rows, memory, calibration, training, corpusPlan] = await Promise.all([
    verifyDecisionEngineReadiness(),
    getPredictions({ date: query.date, sport: query.sport, publicHistory }),
    getDecisionMemorySnapshot({ limit: 8 }),
    getCalibrationSnapshot(query.sport),
    getTrainingDataSnapshot(query.sport),
    buildTenYearFootballCorpusBackfillPlan({ baseUrl: decisionSiteOrigin() })
  ]);
  const rankedRows = rows.slice().sort((a, b) => {
    const verdictDiff = verdictRank(b.prediction.decision.verdict) - verdictRank(a.prediction.decision.verdict);
    if (verdictDiff !== 0) return verdictDiff;
    const aEv = a.prediction.bestPick.hasValue ? a.prediction.bestPick.expectedValue : -1;
    const bEv = b.prediction.bestPick.hasValue ? b.prediction.bestPick.expectedValue : -1;
    if (bEv !== aEv) return bEv - aEv;
    const aEdge = a.prediction.bestPick.hasValue ? a.prediction.bestPick.edge : -1;
    const bEdge = b.prediction.bestPick.hasValue ? b.prediction.bestPick.edge : -1;
    if (bEdge !== aEdge) return bEdge - aEdge;
    return b.match.dataQualityScore - a.match.dataQualityScore;
  });

  const brainSlate = buildDecisionBrainSlate({ rows: rankedRows, date: query.date, sport: query.sport, limit: 4 });
  const agentLoop = buildDecisionAgentLoop({ rows: rankedRows, date: query.date, sport: query.sport, limit: 6, brainSlate });
  const selfAudit = buildDecisionSelfAudit({ rows: rankedRows, date: query.date, sport: query.sport, agentLoop });
  const repairPlan = buildDecisionRepairPlan({ rows: rankedRows, date: query.date, sport: query.sport, agentLoop, selfAudit });
  const repairVerification = buildDecisionRepairVerification({ repairPlan, selfAudit, readiness });
  const supervisorQueue = buildDecisionSupervisorQueue({ rows: rankedRows, date: query.date, sport: query.sport, limit: 8 });
  const operatingCycle = buildDecisionOperatingCycle({
    rows: rankedRows,
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
    rows: rankedRows,
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
  const dataIntakeQueue = buildDecisionDataIntakeQueue({ rows: rankedRows, date: query.date, sport: query.sport, readiness, limit: 8 });
  const providerIngestionEvidence = buildDecisionProviderIngestionEvidence({
    date: query.date,
    sport: query.sport,
    dataIntake: dataIntakeQueue,
    readiness,
    training,
    corpusPlan,
    baseUrl: requestUrl.origin
  });
  const signalReliability = buildDecisionSignalReliability({ rows: rankedRows, date: query.date, sport: query.sport, dataIntake: dataIntakeQueue });
  const learningQueue = buildDecisionLearningQueue({ rows: rankedRows, date: query.date, sport: query.sport, readiness, memory, calibration, training });
  const aiCouncil = buildDecisionAICouncil({
    rows: rankedRows,
    date: query.date,
    sport: query.sport,
    readiness,
    brainSlate,
    selfAudit,
    agentLoop,
    dataIntake: dataIntakeQueue,
    limit: 5
  });
  const modelEnsemble = buildDecisionModelEnsemble({ rows: rankedRows, date: query.date, sport: query.sport, limit: 6 });
  const featureMatrix = buildDecisionFeatureMatrix({ rows: rankedRows, date: query.date, sport: query.sport, limit: 6 });
  const modelGovernance = buildDecisionModelGovernance({ matrix: featureMatrix, training, date: query.date, sport: query.sport });
  const oddsBoard = buildDecisionOddsBoard({ date: query.date, slates: [{ sport: decisionSport, rows: rankedRows }], limit: 40 });
  const portfolioRisk = buildDecisionPortfolioRisk({ board: oddsBoard, limit: 10 });
  const modelTrust = buildDecisionModelTrust({
    date: query.date,
    sport: query.sport,
    governance: modelGovernance,
    calibration,
    training,
    board: oddsBoard,
    portfolio: portfolioRisk
  });
  const evidenceRefresh = buildDecisionEvidenceRefreshScheduler({
    rows: rankedRows,
    date: query.date,
    sport: query.sport,
    dataIntake: dataIntakeQueue,
    signalReliability,
    modelTrust,
    oddsBoard,
    portfolioRisk,
    limit: 10
  });
  const evidenceRefreshVerification = buildDecisionEvidenceRefreshVerifier({
    scheduler: evidenceRefresh,
    signalReliability,
    dataIntake: dataIntakeQueue,
    modelTrust,
    portfolioRisk,
    oddsBoard
  });
  const evidenceTransition = buildDecisionEvidenceTransition({
    scheduler: evidenceRefresh,
    verifier: evidenceRefreshVerification,
    signalReliability,
    dataIntake: dataIntakeQueue,
    modelTrust,
    portfolioRisk,
    oddsBoard
  });
  const invalidationMonitor = buildDecisionInvalidationMonitor({
    rows: rankedRows,
    date: query.date,
    sport: query.sport,
    dataIntake: dataIntakeQueue,
    governance: modelGovernance,
    limit: 8
  });
  const autopilot = buildDecisionAutopilot({
    date: query.date,
    sport: query.sport,
    council: aiCouncil,
    invalidationMonitor,
    governance: modelGovernance,
    actionSandbox,
    learningQueue,
    operatingCycle,
    limit: 8
  });
  const researchAgent = buildDecisionResearchAgent({
    rows: rankedRows,
    date: query.date,
    sport: query.sport,
    dataIntake: dataIntakeQueue,
    governance: modelGovernance,
    invalidationMonitor,
    autopilot
  });
  const traceLedger = buildDecisionTraceLedger({
    rows: rankedRows,
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
    dataIntake: dataIntakeQueue,
    governance: modelGovernance,
    autopilot,
    traceLedger
  });
  const aiOrchestrator = buildDecisionAIOrchestrator({
    rows: rankedRows,
    date: query.date,
    sport: query.sport,
    readiness,
    brainSlate,
    selfAudit,
    agentLoop,
    dataIntake: dataIntakeQueue,
    council: aiCouncil
  });
  const proofRunner = buildDecisionProofRunner({ date: query.date, sport: query.sport, activationAudit, traceLedger, autopilot, limit: 8 });
  const aiReviewLedger = buildDecisionAIReviewLedger({ date: query.date, sport: query.sport, orchestrator: aiOrchestrator, activationAudit, proofRunner, limit: 8 });
  const hypothesisLab = buildDecisionHypothesisLab({ rows: rankedRows, date: query.date, sport: query.sport, limit: 8 });
  const counterfactualLab = buildDecisionCounterfactualLab({ rows: rankedRows, date: query.date, sport: query.sport, limit: 8 });
  const beliefRevision = buildDecisionBeliefRevision({
    rows: rankedRows,
    date: query.date,
    sport: query.sport,
    counterfactualLab,
    proofRunner,
    aiReviewLedger,
    limit: 8
  });
  const metacognition = buildDecisionMetacognition({
    rows: rankedRows,
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
  const aiHandoff = buildDecisionAIHandoffPacket({ rows: rankedRows, date: query.date, sport: query.sport, orchestrator: aiOrchestrator, aiReviewLedger, metacognition });
  const aiFirewall = buildDecisionAIFirewall({ date: query.date, sport: query.sport, council: aiCouncil, orchestrator: aiOrchestrator, aiReviewLedger, metacognition, handoff: aiHandoff });
  const aiCitations = buildDecisionAICitationValidator({ date: query.date, sport: query.sport, handoff: aiHandoff, firewall: aiFirewall });
  const authority = buildDecisionAuthority({
    rows: rankedRows,
    date: query.date,
    sport: query.sport,
    metacognition,
    handoff: aiHandoff,
    firewall: aiFirewall,
    proofRunner,
    aiReviewLedger
  });
  const agentKernel = buildDecisionAgentKernel({
    date: query.date,
    sport: query.sport,
    metacognition,
    handoff: aiHandoff,
    citations: aiCitations,
    firewall: aiFirewall,
    authority,
    proofRunner,
    aiReviewLedger
  });
  const agentRuntime = buildDecisionAgentRuntime({
    date: query.date,
    sport: query.sport,
    kernel: agentKernel,
    activationAudit,
    orchestrator: aiOrchestrator,
    autopilot,
    dataIntake: dataIntakeQueue,
    traceLedger
  });
  const supabaseBootstrap = buildDecisionSupabaseBootstrap({ readiness, corpusPlan, runtime: agentRuntime });
  const capabilityContract = buildDecisionCapabilityContract({
    date: query.date,
    sport: query.sport,
    readiness,
    dataIntake: dataIntakeQueue,
    signalReliability,
    modelTrust,
    oddsBoard,
    transition: evidenceTransition,
    authority,
    runtime: agentRuntime,
    activationAudit,
    supabaseBootstrap
  });
  const netlifyDeployment = buildDecisionNetlifyDeployment({ readiness, runtime: agentRuntime, supabaseBootstrap });
  const mvpAudit = buildDecisionMvpRequirementAudit({
    rows: rankedRows,
    date: query.date,
    sport: query.sport,
    readiness,
    dataIntake: dataIntakeQueue,
    featureMatrix,
    modelGovernance,
    supabaseBootstrap,
    netlifyDeployment,
    agentRuntime,
    corpusPlan,
    training
  });
  const activationRunbook = buildDecisionActivationRunbook({
    rows: rankedRows,
    date: query.date,
    sport: query.sport,
    mvpAudit,
    readiness,
    supabaseBootstrap,
    netlifyDeployment,
    agentRuntime,
    corpusPlan,
    training
  });
  const decisionMind = buildDecisionMind({
    rows: rankedRows,
    date: query.date,
    sport: query.sport,
    brainSlate,
    researchAgent,
    metacognition,
    aiOrchestrator,
    handoff: aiHandoff,
    firewall: aiFirewall,
    authority,
    activationRunbook
  });
  const informationGain = buildDecisionInformationGainPlanner({
    date: query.date,
    sport: query.sport,
    dataIntake: dataIntakeQueue,
    evidenceRefresh,
    hypothesisLab,
    counterfactualLab,
    beliefRevision,
    limit: 10
  });
  const reasoningAlignment = buildDecisionReasoningAlignment({
    date: query.date,
    sport: query.sport,
    mind: decisionMind,
    informationGain
  });
  const operatorTurn = buildDecisionOperatorTurn({
    date: query.date,
    sport: query.sport,
    mind: decisionMind,
    contract: capabilityContract,
    transition: evidenceTransition,
    runtime: agentRuntime,
    authority
  });
  const operatorReceipt = buildDecisionOperatorReceipt({ turn: operatorTurn, runRequested: false });
  const operatorState = buildDecisionOperatorState({ receipt: operatorReceipt });
  const operatorEpisode = buildDecisionOperatorEpisode({ turn: operatorTurn, receipt: operatorReceipt, state: operatorState });
  const aiReasoningGateway = buildDecisionAIReasoningGateway({ episode: operatorEpisode });
  const aiCognitiveLoop = buildDecisionAICognitiveLoop({ episode: operatorEpisode, gateway: aiReasoningGateway });
  const aiContextDossier = buildDecisionAIContextDossier({
    rows: rankedRows,
    date: query.date,
    sport: query.sport,
    modelEnsemble,
    featureMatrix,
    modelGovernance,
    dataIntake: dataIntakeQueue,
    cognitiveLoop: aiCognitiveLoop
  });
  const aiSession = buildDecisionAISession({
    date: query.date,
    sport: query.sport,
    council: aiCouncil,
    contextDossier: aiContextDossier,
    reasoningGateway: aiReasoningGateway,
    authority,
    mvpAudit
  });
  const aiSessionEvaluation = buildDecisionAISessionShadowEvaluation({ session: aiSession, learningQueue, calibration, training });
  const aiDeliberation = buildDecisionAIDeliberation({ session: aiSession, evaluation: aiSessionEvaluation });
  const aiControl = buildDecisionAIControlPacket({ deliberation: aiDeliberation, runtime: agentRuntime, capabilityContract, operatorTurn });
  const aiThoughtEpisode = buildDecisionAIThoughtEpisode({ control: aiControl, episode: operatorEpisode });
  const aiThoughtMemory = await getDecisionAIThoughtMemory({ thought: aiThoughtEpisode, limit: 12 });
  const aiExperimentPlanner = buildDecisionAIExperimentPlanner({ control: aiControl, thought: aiThoughtEpisode, memory: aiThoughtMemory });
  const aiExperimentObserver = buildDecisionAIExperimentObserver({ planner: aiExperimentPlanner });
  const aiExperimentState = buildDecisionAIExperimentState({ planner: aiExperimentPlanner, observer: aiExperimentObserver });
  const aiExperimentEpisode = buildDecisionAIExperimentEpisode({ observer: aiExperimentObserver, state: aiExperimentState });
  const supabaseIsolation = buildDecisionSupabaseProjectIsolation({ readiness });

  const executive = buildDecisionAIExecutive({
    mind: decisionMind,
    cognitiveLoop: aiCognitiveLoop,
    session: aiSession,
    deliberation: aiDeliberation,
    control: aiControl,
    experimentEpisode: aiExperimentEpisode,
    capabilityContract,
    reasoningAlignment,
    supabaseIsolation,
    providerIngestionEvidence,
    runRequested
  });
  const observedExecutive = await runDecisionAIExecutiveProofObservation({
    executive,
    observeRequested,
    origin: requestUrl.origin
  });

  const reviewedExecutive = await runDecisionAIExecutiveReview({
    executive: observedExecutive,
    runRequested,
    apiKey: process.env.OPENAI_API_KEY,
    model: getDecisionOpenAIModel()
  });
  const feedback = buildDecisionAIExecutiveFeedback({
    executive: reviewedExecutive,
    learningQueue,
    providerIngestionEvidence,
    supabaseIsolation
  });
  const cycle = buildDecisionAIExecutiveCycle({ executive: reviewedExecutive, feedback });
  const runbook = buildDecisionAIExecutiveRunbook({
    executive: reviewedExecutive,
    feedback,
    cycle,
    providerIngestionEvidence,
    supabaseIsolation
  });
  const governor = buildDecisionAIExecutiveGovernor({
    executive: reviewedExecutive,
    feedback,
    cycle,
    runbook
  });

  return apiSuccess({ ...reviewedExecutive, feedback, cycle, runbook, governor });
}
