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
import { buildDecisionCounterfactualLab } from "@/lib/sports/prediction/decisionCounterfactualLab";
import { buildDecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import { buildDecisionFeatureMatrix } from "@/lib/sports/prediction/decisionFeatureMatrix";
import { buildDecisionInvalidationMonitor } from "@/lib/sports/prediction/decisionInvalidationMonitor";
import { buildDecisionLearningQueue } from "@/lib/sports/prediction/decisionLearningQueue";
import { getDecisionMemorySnapshot } from "@/lib/sports/prediction/decisionMemory";
import { buildDecisionMetacognition } from "@/lib/sports/prediction/decisionMetacognition";
import { buildDecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { buildDecisionMvpRequirementAudit } from "@/lib/sports/prediction/decisionMvpRequirementAudit";
import { buildDecisionNetlifyDeployment } from "@/lib/sports/prediction/decisionNetlifyDeployment";
import { buildDecisionOperatingCycle } from "@/lib/sports/prediction/decisionOperatingCycle";
import { buildDecisionProofRunner } from "@/lib/sports/prediction/decisionProofRunner";
import { buildDecisionRepairPlan } from "@/lib/sports/prediction/decisionRepairPlanner";
import { buildDecisionRepairVerification } from "@/lib/sports/prediction/decisionRepairVerifier";
import { buildDecisionResearchAgent } from "@/lib/sports/prediction/decisionResearchAgent";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionSelfAudit } from "@/lib/sports/prediction/decisionSelfAudit";
import { buildDecisionSupabaseBootstrap } from "@/lib/sports/prediction/decisionSupabaseBootstrap";
import { buildDecisionSupervisorQueue } from "@/lib/sports/prediction/decisionSupervisor";
import { buildDecisionTraceLedger } from "@/lib/sports/prediction/decisionTraceLedger";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import { getPredictions } from "@/lib/sports/service";
import { buildTenYearFootballCorpusBackfillPlan } from "@/lib/sports/training/corpusBackfillPlan";
import { buildFootballDataHistoricalLearningDossier } from "@/lib/sports/training/footballDataHistoricalLearningDossier";
import { buildFootballDataMarketBenchmark } from "@/lib/sports/training/footballDataMarketBenchmark";
import { buildFootballDataMarketLearningRoadmap } from "@/lib/sports/training/footballDataMarketLearningRoadmap";
import { buildFootballDataMarketSegmentRetest } from "@/lib/sports/training/footballDataMarketSegmentRetest";
import { buildFootballDataModelPromotionDecision } from "@/lib/sports/training/footballDataModelPromotionDecision";
import { buildFootballDataProviderLearningActivationReceipt } from "@/lib/sports/training/footballDataProviderLearningActivationReceipt";
import { readFootballDataProviderRetestBridge } from "@/lib/sports/training/footballDataProviderRetestBridge";
import { buildFootballDataProviderRetestContract } from "@/lib/sports/training/footballDataProviderRetestContract";
import { runFootballDataProviderRetest } from "@/lib/sports/training/footballDataProviderRetestRunner";
import { buildFootballDataThresholdSweep } from "@/lib/sports/training/footballDataThresholdSweep";
import { buildFootballDataWalkForwardValidation } from "@/lib/sports/training/footballDataWalkForwardValidation";
import { buildPublicHistoricalTrainingEvidence } from "@/lib/sports/training/publicHistoricalTrainingEvidence";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

function parsePositiveInteger(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNumber(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isEnabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const publicHistoryRequested = isEnabled(url.searchParams.get("publicHistory")) || isEnabled(url.searchParams.get("historical"));
  const [rows, readiness, memory, calibration, training, corpusPlan] = await Promise.all([
    getPredictions({ date: query.date, sport: query.sport }),
    verifyDecisionEngineReadiness(),
    getDecisionMemorySnapshot({ limit: 8 }),
    getCalibrationSnapshot(query.sport),
    getTrainingDataSnapshot(query.sport),
    buildTenYearFootballCorpusBackfillPlan({ baseUrl: decisionSiteOrigin() })
  ]);
  const publicHistoricalTrainingEvidence = publicHistoryRequested
    ? buildPublicHistoricalTrainingEvidence({
        dossier: await buildFootballDataHistoricalLearningDossier({
          seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom")),
          seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo")),
          maxSeasons: parsePositiveInteger(url.searchParams.get("maxSeasons")),
          trainRatio: parseNumber(url.searchParams.get("trainRatio")),
          minEdge: parseNumber(url.searchParams.get("minEdge")),
          minModelProbability: parseNumber(url.searchParams.get("minModelProbability")),
          minPickCount: parsePositiveInteger(url.searchParams.get("minPickCount")),
          minTrainingSeasons: parsePositiveInteger(url.searchParams.get("minTrainingSeasons"))
        })
      })
    : null;
  const footballDataModelPromotionDecision = publicHistoryRequested
    ? await (async () => {
        const seasonFrom = parsePositiveInteger(url.searchParams.get("seasonFrom"));
        const seasonTo = parsePositiveInteger(url.searchParams.get("seasonTo"));
        const maxSeasons = parsePositiveInteger(url.searchParams.get("maxSeasons"));
        const trainRatio = parseNumber(url.searchParams.get("trainRatio"));
        const minPickCount = parsePositiveInteger(url.searchParams.get("minPickCount"));
        const minTrainingSeasons = parsePositiveInteger(url.searchParams.get("minTrainingSeasons"));
        const minEdge = parseNumber(url.searchParams.get("minEdge"));
        const minModelProbability = parseNumber(url.searchParams.get("minModelProbability"));
        const [benchmark, thresholdSweep, walkForward] = await Promise.all([
          buildFootballDataMarketBenchmark({
            seasonFrom,
            seasonTo,
            maxSeasons,
            trainRatio,
            minEdge,
            minModelProbability
          }),
          buildFootballDataThresholdSweep({
            seasonFrom,
            seasonTo,
            maxSeasons,
            trainRatio,
            minPickCount
          }),
          buildFootballDataWalkForwardValidation({
            seasonFrom,
            seasonTo,
            maxSeasons,
            minTrainingSeasons,
            minEdge,
            minModelProbability
          })
        ]);
        const segmentRetest = buildFootballDataMarketSegmentRetest({ benchmark, thresholdSweep });
        const roadmap = buildFootballDataMarketLearningRoadmap({ benchmark, thresholdSweep, segmentRetest });
        const contract = buildFootballDataProviderRetestContract({ roadmap, segmentRetest });
        const bridge = await readFootballDataProviderRetestBridge({
          contract,
          limit: parsePositiveInteger(url.searchParams.get("limit"))
        });
        const runner = runFootballDataProviderRetest({ contract, rows: bridge.normalizedRows });
        const activation = buildFootballDataProviderLearningActivationReceipt({
          contract,
          bridge,
          runner,
          source: "stored-supabase"
        });
        return buildFootballDataModelPromotionDecision({
          walkForward,
          thresholdSweep,
          marketLearningRoadmap: roadmap,
          providerRetestContract: contract,
          providerLearningActivation: activation
        });
      })()
    : null;
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
  const netlifyDeployment = buildDecisionNetlifyDeployment({ readiness, runtime: agentRuntime, supabaseBootstrap });

  return apiSuccess(
    buildDecisionMvpRequirementAudit({
      rows,
      date: query.date,
      sport: query.sport,
      readiness,
      dataIntake,
      featureMatrix,
      modelGovernance,
      supabaseBootstrap,
      netlifyDeployment,
      agentRuntime,
      corpusPlan,
      training,
      publicHistoricalTrainingEvidence,
      footballDataModelPromotionDecision
    })
  );
}
