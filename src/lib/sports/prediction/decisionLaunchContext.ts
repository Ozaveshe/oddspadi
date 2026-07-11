import { buildDecisionAIReviewReadiness } from "@/lib/sports/prediction/decisionAIReviewReadiness";
import { buildDecisionAILiveCycleReceipt } from "@/lib/sports/prediction/decisionAILiveCycleReceipt";
import { buildDecisionAIUnblockReceipt } from "@/lib/sports/prediction/decisionAIUnblockReceipt";
import { buildDecisionAbstentionAudit } from "@/lib/sports/prediction/decisionAbstentionAudit";
import { buildDecisionAnswerPromotionGate } from "@/lib/sports/prediction/decisionAnswerPromotionGate";
import { buildDecisionAdversarialPanel } from "@/lib/sports/prediction/decisionAdversarialPanel";
import { buildDecisionAgentOperationQueue } from "@/lib/sports/prediction/decisionAgentOperationQueue";
import { buildDecisionAgentThoughtBoard } from "@/lib/sports/prediction/decisionAgentThoughtBoard";
import { buildDecisionBayesianBeliefLedger } from "@/lib/sports/prediction/decisionBayesianBeliefLedger";
import { buildDecisionBriefing } from "@/lib/sports/prediction/decisionBriefing";
import { buildDecisionBrainReviewPacket } from "@/lib/sports/prediction/decisionBrainReviewPacket";
import { runDecisionBrainReview } from "@/lib/sports/prediction/decisionBrainReviewRunner";
import { buildDecisionBrainLiveReviewReceipt } from "@/lib/sports/prediction/decisionBrainLiveReviewReceipt";
import { buildDecisionBrainEvidenceDebtResolver } from "@/lib/sports/prediction/decisionBrainEvidenceDebtResolver";
import { buildDecisionBrainState } from "@/lib/sports/prediction/decisionBrainState";
import { buildDecisionCalibrationFeedbackPacket } from "@/lib/sports/prediction/decisionCalibrationFeedbackPacket";
import { buildDecisionChangeMindLedger } from "@/lib/sports/prediction/decisionChangeMindLedger";
import { buildDecisionCognitiveKernel } from "@/lib/sports/prediction/decisionCognitiveKernel";
import { buildDecisionContextSignalProof } from "@/lib/sports/prediction/decisionContextSignalProof";
import { buildDecisionContradictionLedger } from "@/lib/sports/prediction/decisionContradictionLedger";
import { buildDecisionContextFeatureProofReceipt } from "@/lib/sports/prediction/decisionContextFeatureProofReceipt";
import { buildDecisionContextFeatureProofSelector } from "@/lib/sports/prediction/decisionContextFeatureProofSelector";
import { buildDecisionCycleGovernor } from "@/lib/sports/prediction/decisionCycleGovernor";
import { buildDecisionCycleReceipt } from "@/lib/sports/prediction/decisionCycleReceipt";
import { buildDecisionDataAuthority } from "@/lib/sports/prediction/decisionDataAuthority";
import { buildDecisionDataBackbone } from "@/lib/sports/prediction/decisionDataBackbone";
import { buildDecisionDataGapResolver } from "@/lib/sports/prediction/decisionDataGapResolver";
import { buildDecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import { buildDecisionDataSourceCoverage } from "@/lib/sports/prediction/decisionDataSourceCoverage";
import { getCalibrationSnapshot } from "@/lib/sports/prediction/decisionCalibration";
import { buildDecisionEngineActivationContract } from "@/lib/sports/prediction/decisionEngineActivationContract";
import { buildDecisionEnvActivationMatrix } from "@/lib/sports/prediction/decisionEnvActivationMatrix";
import { buildDecisionEplFixtureIntake } from "@/lib/sports/prediction/decisionEplFixtureIntake";
import { buildDecisionEplFixtureIntakeReceipt } from "@/lib/sports/prediction/decisionEplFixtureIntakeReceipt";
import { buildDecisionEplOddsDryRunReceipt } from "@/lib/sports/prediction/decisionEplOddsDryRunReceipt";
import { buildDecisionEplOddsDryRunInterpreter } from "@/lib/sports/prediction/decisionEplOddsDryRunInterpreter";
import { buildDecisionEplOddsMarketMap } from "@/lib/sports/prediction/decisionEplOddsMarketMap";
import { buildDecisionEplPreKickoffRehearsal } from "@/lib/sports/prediction/decisionEplPreKickoffRehearsal";
import { buildDecisionEplProviderFixtureMap } from "@/lib/sports/prediction/decisionEplProviderFixtureMap";
import { buildDecisionEplProviderDryRunReceipt } from "@/lib/sports/prediction/decisionEplProviderDryRunReceipt";
import { buildDecisionEplProviderDryRunInterpreter } from "@/lib/sports/prediction/decisionEplProviderDryRunInterpreter";
import { buildDecisionEvidenceAcquisitionPlanner } from "@/lib/sports/prediction/decisionEvidenceAcquisitionPlanner";
import { buildDecisionEvidenceFreshnessGate } from "@/lib/sports/prediction/decisionEvidenceFreshnessGate";
import { buildDecisionEvidenceGraph } from "@/lib/sports/prediction/decisionEvidenceGraph";
import { buildDecisionEvidenceInfluenceLedger } from "@/lib/sports/prediction/decisionEvidenceInfluenceLedger";
import { buildDecisionEvidenceRefreshScheduler } from "@/lib/sports/prediction/decisionEvidenceRefreshScheduler";
import { buildDecisionEvidenceSufficiencyScore } from "@/lib/sports/prediction/decisionEvidenceSufficiencyScore";
import { buildDecisionExplanationAudit } from "@/lib/sports/prediction/decisionExplanationAudit";
import { buildDecisionFeatureMatrix } from "@/lib/sports/prediction/decisionFeatureMatrix";
import { buildDecisionFirstProviderProofReceipt } from "@/lib/sports/prediction/decisionFirstProviderProofReceipt";
import { buildDecisionFirstProviderProofRun } from "@/lib/sports/prediction/decisionFirstProviderProofRun";
import { buildDecisionFinalAnswerContract } from "@/lib/sports/prediction/decisionFinalAnswerContract";
import { runDecisionFinalAnswerAIReview } from "@/lib/sports/prediction/decisionFinalAnswerAIReview";
import { buildDecisionFinalAnswerCouncil } from "@/lib/sports/prediction/decisionFinalAnswerCouncil";
import { buildDecisionFinalAnswerTraceReceipt } from "@/lib/sports/prediction/decisionFinalAnswerTraceReceipt";
import { buildDecisionFinalAnswerValidationReceipt } from "@/lib/sports/prediction/decisionFinalAnswerValidationReceipt";
import { buildDecisionHistoricalDiagnosisLadder } from "@/lib/sports/prediction/decisionHistoricalDiagnosisLadder";
import { buildDecisionHistoricalDiagnosisLadderReceipt } from "@/lib/sports/prediction/decisionHistoricalDiagnosisLadderReceipt";
import { buildDecisionInterventionPlanner } from "@/lib/sports/prediction/decisionInterventionPlanner";
import { buildDecisionLaunchCommander } from "@/lib/sports/prediction/decisionLaunchCommander";
import { buildDecisionLaunchState } from "@/lib/sports/prediction/decisionLaunchState";
import { buildDecisionLearningConsolidator } from "@/lib/sports/prediction/decisionLearningConsolidator";
import { buildDecisionLearningPromotionGate } from "@/lib/sports/prediction/decisionLearningPromotionGate";
import { buildDecisionLiveDataReadiness } from "@/lib/sports/prediction/decisionLiveDataReadiness";
import { buildDecisionLiveProviderProbeLedger } from "@/lib/sports/prediction/decisionLiveProviderProbeLedger";
import { buildDecisionModelCards } from "@/lib/sports/prediction/decisionModelCards";
import { buildDecisionModelEnsemble } from "@/lib/sports/prediction/decisionModelEnsemble";
import { buildDecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { buildDecisionModelMathProof } from "@/lib/sports/prediction/decisionModelMathProof";
import { buildDecisionModelReasoningLedger } from "@/lib/sports/prediction/decisionModelReasoningLedger";
import { buildDecisionModelTrust } from "@/lib/sports/prediction/decisionModelTrust";
import { buildDecisionMarketAuditMatrix } from "@/lib/sports/prediction/decisionMarketAuditMatrix";
import { buildDecisionMarketAlternativeArbiter } from "@/lib/sports/prediction/decisionMarketAlternativeArbiter";
import { buildDecisionMarketCalibratedFusion } from "@/lib/sports/prediction/decisionMarketCalibratedFusion";
import { buildDecisionMarketPriorGovernor } from "@/lib/sports/prediction/decisionMarketPriorGovernor";
import { buildDecisionMvpProgressReceipt } from "@/lib/sports/prediction/decisionMvpProgressReceipt";
import { buildDecisionOddsBoard } from "@/lib/sports/prediction/decisionOddsBoard";
import { buildDecisionOddsFeatureGenerationReceipt } from "@/lib/sports/prediction/decisionOddsFeatureGenerationReceipt";
import { buildDecisionOddsFeatureReadiness } from "@/lib/sports/prediction/decisionOddsFeatureReadiness";
import { buildDecisionOddsIntelligenceProof } from "@/lib/sports/prediction/decisionOddsIntelligenceProof";
import { buildDecisionOddsSnapshotStorageReadiness } from "@/lib/sports/prediction/decisionOddsSnapshotStorageReadiness";
import { buildDecisionOddsSnapshotWriteReceipt } from "@/lib/sports/prediction/decisionOddsSnapshotWriteReceipt";
import { buildDecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";
import { buildDecisionOpenAILiveReviewReceipt } from "@/lib/sports/prediction/decisionOpenAILiveReviewReceipt";
import { buildDecisionOriginalBriefCoverage } from "@/lib/sports/prediction/decisionOriginalBriefCoverage";
import { buildDecisionOutcomeReplay } from "@/lib/sports/prediction/decisionOutcomeReplay";
import { buildDecisionPortfolioRisk } from "@/lib/sports/prediction/decisionPortfolioRisk";
import { buildDecisionPreMatchTrustGate } from "@/lib/sports/prediction/decisionPreMatchTrustGate";
import { buildDecisionProbabilityFusionAudit } from "@/lib/sports/prediction/decisionProbabilityFusionAudit";
import { buildDecisionSettlementImpact } from "@/lib/sports/prediction/decisionSettlementImpact";
import { buildDecisionProviderIngestionEvidence } from "@/lib/sports/prediction/decisionProviderIngestionEvidence";
import { buildDecisionProviderEvidenceLedger } from "@/lib/sports/prediction/decisionProviderEvidenceLedger";
import { buildDecisionProviderKeyBlockerResolver } from "@/lib/sports/prediction/decisionProviderKeyBlockerResolver";
import { buildDecisionProviderKeyActivationRehearsal } from "@/lib/sports/prediction/decisionProviderKeyActivationRehearsal";
import { buildDecisionProviderKeyActivationReceipt } from "@/lib/sports/prediction/decisionProviderKeyActivationReceipt";
import { buildDecisionProviderLearningBridge } from "@/lib/sports/prediction/decisionProviderLearningBridge";
import { buildDecisionProviderEnvDiagnostic } from "@/lib/sports/prediction/decisionProviderEnvDiagnostic";
import { buildDecisionProviderBatchManifest } from "@/lib/sports/prediction/decisionProviderBatchManifest";
import { buildDecisionProviderActivationQueue } from "@/lib/sports/prediction/decisionProviderActivationQueue";
import { buildDecisionProviderActivationQueueReceipt } from "@/lib/sports/prediction/decisionProviderActivationQueueReceipt";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionRequirementPulse } from "@/lib/sports/prediction/decisionRequirementPulse";
import { buildDecisionResolutionPlanner } from "@/lib/sports/prediction/decisionResolutionPlanner";
import { buildDecisionResolutionReceipt } from "@/lib/sports/prediction/decisionResolutionReceipt";
import { buildDecisionShadowLearningAgenda } from "@/lib/sports/prediction/decisionShadowLearningAgenda";
import { buildDecisionShadowBacktestLedger } from "@/lib/sports/prediction/decisionShadowBacktestLedger";
import { buildDecisionShadowInfluenceSimulator } from "@/lib/sports/prediction/decisionShadowInfluenceSimulator";
import { buildDecisionShadowLoopContinuity } from "@/lib/sports/prediction/decisionShadowLoopContinuity";
import { buildDecisionShadowLoopAutopilot } from "@/lib/sports/prediction/decisionShadowLoopAutopilot";
import { buildDecisionShadowLoopContinuityReceipt } from "@/lib/sports/prediction/decisionShadowLoopContinuityReceipt";
import { buildDecisionShadowLoopContinuityReceiptInterpreter } from "@/lib/sports/prediction/decisionShadowLoopContinuityReceiptInterpreter";
import { buildDecisionShadowLoopInterpreter } from "@/lib/sports/prediction/decisionShadowLoopInterpreter";
import { buildDecisionShadowLoopReflection } from "@/lib/sports/prediction/decisionShadowLoopReflection";
import { buildDecisionShadowLoopReflectionReceipt } from "@/lib/sports/prediction/decisionShadowLoopReflectionReceipt";
import { buildDecisionShadowLoopReflectionReceiptInterpreter } from "@/lib/sports/prediction/decisionShadowLoopReflectionReceiptInterpreter";
import { buildDecisionShadowLoopGovernor } from "@/lib/sports/prediction/decisionShadowLoopGovernor";
import { buildDecisionShadowLoopReceipt } from "@/lib/sports/prediction/decisionShadowLoopReceipt";
import { buildDecisionShadowMemoryReplay } from "@/lib/sports/prediction/decisionShadowMemoryReplay";
import { buildDecisionShadowNextCycleInterpreter } from "@/lib/sports/prediction/decisionShadowNextCycleInterpreter";
import { buildDecisionShadowNextCyclePlanner } from "@/lib/sports/prediction/decisionShadowNextCyclePlanner";
import { buildDecisionShadowNextCycleReceipt } from "@/lib/sports/prediction/decisionShadowNextCycleReceipt";
import { buildDecisionShadowReasoningLoop } from "@/lib/sports/prediction/decisionShadowReasoningLoop";
import { buildDecisionShadowReplayCritic } from "@/lib/sports/prediction/decisionShadowReplayCritic";
import { buildDecisionShadowWorkingMemory } from "@/lib/sports/prediction/decisionShadowWorkingMemory";
import { buildDecisionSupabaseAuthorityRemediation } from "@/lib/sports/prediction/decisionSupabaseAuthorityRemediation";
import { buildDecisionSupabaseCleanProjectCutover } from "@/lib/sports/prediction/decisionSupabaseCleanProjectCutover";
import { buildDecisionSupabaseMcpObservationReceipt } from "@/lib/sports/prediction/decisionSupabaseMcpObservationReceipt";
import { buildDecisionSupabaseCredentialActivationReceipt } from "@/lib/sports/prediction/decisionSupabaseCredentialActivationReceipt";
import { readDecisionSupabaseLiveMcpProofArtifact } from "@/lib/sports/prediction/decisionSupabaseLiveMcpProofArtifact";
import { buildDecisionSupabaseContainmentPolicy } from "@/lib/sports/prediction/decisionSupabaseContainmentPolicy";
import { buildDecisionSupabaseProofBinder } from "@/lib/sports/prediction/decisionSupabaseProofBinder";
import { buildDecisionSupabaseProjectIsolation } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";
import { buildDecisionSupabaseLiveSchemaActivationPacket } from "@/lib/sports/prediction/decisionSupabaseLiveSchemaActivationPacket";
import { buildDecisionSupabaseSchemaManifest } from "@/lib/sports/prediction/decisionSupabaseSchemaManifest";
import { buildDecisionSupabaseStorageProofLedger } from "@/lib/sports/prediction/decisionSupabaseStorageProofLedger";
import { buildDecisionSlateThinking } from "@/lib/sports/prediction/decisionSlateThinking";
import { buildDecisionSignalReliability } from "@/lib/sports/prediction/decisionSignalReliability";
import { buildDecisionStorageActivationChecklist } from "@/lib/sports/prediction/decisionStorageActivationChecklist";
import { buildDecisionSupervisedAgentRunner } from "@/lib/sports/prediction/decisionSupervisedAgentRunner";
import { buildDecisionSupervisedAgentRun } from "@/lib/sports/prediction/decisionSupervisedAgentRun";
import { buildDecisionTrustFirewall } from "@/lib/sports/prediction/decisionTrustFirewall";
import { buildDecisionTrustAwareAIPacket } from "@/lib/sports/prediction/decisionTrustAwareAIPacket";
import { buildDecisionWorldModel } from "@/lib/sports/prediction/decisionWorldModel";
import { buildDecisionWorldModelCritic } from "@/lib/sports/prediction/decisionWorldModelCritic";
import { getPredictions } from "@/lib/sports/service";
import { buildTenYearFootballCorpusBackfillPlan } from "@/lib/sports/training/corpusBackfillPlan";
import { buildFootballDataHistoricalLearningDossier } from "@/lib/sports/training/footballDataHistoricalLearningDossier";
import { buildLearnedWeightPromotionGovernor } from "@/lib/sports/training/learnedWeightPromotionGovernor";
import { buildLearnedWeightShadowComparison } from "@/lib/sports/training/learnedWeightShadowComparison";
import { buildMultiSportCorpusPlan } from "@/lib/sports/training/multiSportCorpusPlan";
import { buildHistoricalCorpusAcquisition } from "@/lib/sports/training/historicalCorpusAcquisition";
import { buildPublicHistoricalTrainingEvidence, type PublicHistoricalTrainingEvidence } from "@/lib/sports/training/publicHistoricalTrainingEvidence";
import { buildShadowTrainingCandidates } from "@/lib/sports/training/shadowTrainingCandidates";
import { buildTrainingActivationRunbook } from "@/lib/sports/training/trainingActivationRunbook";
import { buildTrainingCorpusProof } from "@/lib/sports/training/trainingCorpusProof";
import { buildTrainingDataBlueprint } from "@/lib/sports/training/trainingDataBlueprint";
import { buildTrainingReadiness } from "@/lib/sports/training/trainingReadiness";
import { buildTenYearCorpusExecutionManifest } from "@/lib/sports/training/tenYearCorpusExecutionManifest";
import { buildProviderCorpusDryRunQueue } from "@/lib/sports/training/providerCorpusDryRunQueue";
import { buildApiFootballEntitlementProbe } from "@/lib/sports/training/apiFootballEntitlementProbe";
import { buildFootballProviderFeatureIntakeGapReceipt } from "@/lib/sports/training/footballProviderFeatureIntakeGapReceipt";
import { buildFootballProviderFixtureFeatureReadiness } from "@/lib/sports/training/footballProviderFixtureFeatureReadiness";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import type { Sport } from "@/lib/sports/types";

type EnvLike = Record<string, string | undefined>;

async function buildLaunchPublicHistoricalTrainingEvidence(): Promise<PublicHistoricalTrainingEvidence | null> {
  try {
    const dossier = await buildFootballDataHistoricalLearningDossier({
      seasonFrom: 2016,
      seasonTo: 2025,
      maxSeasons: 10,
      trainRatio: 0.7,
      minEdge: 0.02,
      minModelProbability: 0.36,
      minPickCount: 75,
      minTrainingSeasons: 3
    });
    return buildPublicHistoricalTrainingEvidence({ dossier });
  } catch {
    return null;
  }
}

function verdictRank(verdict: string) {
  if (verdict === "strong-value") return 5;
  if (verdict === "lean-value") return 4;
  if (verdict === "watchlist") return 3;
  if (verdict === "avoid") return 2;
  return 1;
}

function rankRows<T extends Awaited<ReturnType<typeof getPredictions>>>(rows: T): T {
  return rows.slice().sort((a, b) => {
    const verdictDiff = verdictRank(b.prediction.decision.verdict) - verdictRank(a.prediction.decision.verdict);
    if (verdictDiff !== 0) return verdictDiff;
    const aEv = a.prediction.bestPick.hasValue ? a.prediction.bestPick.expectedValue : -1;
    const bEv = b.prediction.bestPick.hasValue ? b.prediction.bestPick.expectedValue : -1;
    if (bEv !== aEv) return bEv - aEv;
    const aEdge = a.prediction.bestPick.hasValue ? a.prediction.bestPick.edge : -1;
    const bEdge = b.prediction.bestPick.hasValue ? b.prediction.bestPick.edge : -1;
    if (bEdge !== aEdge) return bEdge - aEdge;
    return b.match.dataQualityScore - a.match.dataQualityScore;
  }) as T;
}

export async function buildDecisionLaunchContext({
  date,
  sport = "football",
  baseUrl,
  env = process.env,
  league,
  country,
  query,
  confidence,
  runtimeMode
}: {
  date: string;
  sport?: Sport;
  baseUrl: string;
  env?: EnvLike;
  league?: string;
  country?: string;
  query?: string;
  confidence?: string;
  runtimeMode?: "live" | "preview";
}) {
  const predictionRuntimeMode = runtimeMode ?? (env === process.env ? "live" : "preview");
  const publicHistoricalTrainingEvidencePromise = buildLaunchPublicHistoricalTrainingEvidence();
  const [readiness, rows, basketballRows, tennisRows, training, basketballTraining, tennisTraining, calibration, corpusPlan, multiSportCorpusPlan] =
    await Promise.all([
      verifyDecisionEngineReadiness(),
      getPredictions({
        date,
        sport: "football",
        providerMode: predictionRuntimeMode,
        storageMode: predictionRuntimeMode,
        league: sport === "football" ? league : undefined,
        country: sport === "football" ? country : undefined,
        query: sport === "football" ? query : undefined,
        confidence: sport === "football" ? confidence : undefined
      }),
      getPredictions({
        date,
        sport: "basketball",
        providerMode: predictionRuntimeMode,
        storageMode: predictionRuntimeMode,
        league: sport === "basketball" ? league : undefined,
        country: sport === "basketball" ? country : undefined,
        query: sport === "basketball" ? query : undefined,
        confidence: sport === "basketball" ? confidence : undefined
      }),
      getPredictions({
        date,
        sport: "tennis",
        providerMode: predictionRuntimeMode,
        storageMode: predictionRuntimeMode,
        league: sport === "tennis" ? league : undefined,
        country: sport === "tennis" ? country : undefined,
        query: sport === "tennis" ? query : undefined,
        confidence: sport === "tennis" ? confidence : undefined
      }),
      getTrainingDataSnapshot("football"),
      getTrainingDataSnapshot("basketball"),
      getTrainingDataSnapshot("tennis"),
      getCalibrationSnapshot(sport),
      buildTenYearFootballCorpusBackfillPlan({ baseUrl, env }),
      buildMultiSportCorpusPlan({ baseUrl, env })
    ]);
  const publicHistoricalTrainingEvidence = await publicHistoricalTrainingEvidencePromise;
  const rankedRows = rankRows(rows);
  const rankedBasketballRows = rankRows(basketballRows);
  const rankedTennisRows = rankRows(tennisRows);
  const allRows = [...rankedRows, ...rankedBasketballRows, ...rankedTennisRows];
  const primaryRows = sport === "basketball" ? rankedBasketballRows : sport === "tennis" ? rankedTennisRows : rankedRows;
  const primaryTraining = sport === "basketball" ? basketballTraining : sport === "tennis" ? tennisTraining : training;
  const supabaseLiveMcpProofArtifact = readDecisionSupabaseLiveMcpProofArtifact();
  const supabaseIsolation = buildDecisionSupabaseProjectIsolation({
    readiness,
    observedMcpProjectUrl: supabaseLiveMcpProofArtifact.artifact?.projectUrl ?? null,
    observedMcpTables: supabaseLiveMcpProofArtifact.artifact?.tables
  });
  const supabaseProofBinder = buildDecisionSupabaseProofBinder({ readiness, isolation: supabaseIsolation });
  const supabaseMcpObservationReceipt = buildDecisionSupabaseMcpObservationReceipt({
    isolation: supabaseIsolation,
    binder: supabaseProofBinder
  });
  const supabaseAuthorityRemediation = buildDecisionSupabaseAuthorityRemediation({
    isolation: supabaseIsolation,
    binder: supabaseProofBinder,
    mcpObservationReceipt: supabaseMcpObservationReceipt
  });
  const supabaseCleanProjectCutover = buildDecisionSupabaseCleanProjectCutover({
    remediation: supabaseAuthorityRemediation,
    binder: supabaseProofBinder,
    mcpObservationReceipt: supabaseMcpObservationReceipt
  });
  const supabaseSchemaManifest = buildDecisionSupabaseSchemaManifest({
    readiness,
    isolation: supabaseIsolation,
    binder: supabaseProofBinder
  });
  const supabaseContainmentPolicy = buildDecisionSupabaseContainmentPolicy({
    isolation: supabaseIsolation,
    binder: supabaseProofBinder,
    manifest: supabaseSchemaManifest
  });
  const supabaseLiveSchemaActivationPacket = buildDecisionSupabaseLiveSchemaActivationPacket({
    readiness,
    isolation: supabaseIsolation,
    binder: supabaseProofBinder,
    manifest: supabaseSchemaManifest
  });
  const footballDataIntake = buildDecisionDataIntakeQueue({ rows: rankedRows, date, sport: "football", readiness, limit: 8 });
  const basketballDataIntake = buildDecisionDataIntakeQueue({ rows: rankedBasketballRows, date, sport: "basketball", readiness, limit: 8 });
  const tennisDataIntake = buildDecisionDataIntakeQueue({ rows: rankedTennisRows, date, sport: "tennis", readiness, limit: 8 });
  const dataIntake = sport === "basketball" ? basketballDataIntake : sport === "tennis" ? tennisDataIntake : footballDataIntake;
  const dataSourceCoverage = buildDecisionDataSourceCoverage({
    date,
    slates: [
      { sport: "football", rows: rankedRows, dataIntake: footballDataIntake, training },
      { sport: "basketball", rows: rankedBasketballRows, dataIntake: basketballDataIntake, training: basketballTraining },
      { sport: "tennis", rows: rankedTennisRows, dataIntake: tennisDataIntake, training: tennisTraining }
    ]
  });
  const providerIngestionEvidence = buildDecisionProviderIngestionEvidence({
    date,
    sport,
    dataIntake,
    readiness,
    training: primaryTraining,
    corpusPlan,
    baseUrl
  });
  const footballFeatureMatrix = buildDecisionFeatureMatrix({ rows: rankedRows, date, sport: "football", limit: 6 });
  const footballGovernance = buildDecisionModelGovernance({ matrix: footballFeatureMatrix, training, date, sport: "football" });
  const basketballFeatureMatrix = buildDecisionFeatureMatrix({ rows: rankedBasketballRows, date, sport: "basketball", limit: 6 });
  const basketballGovernance = buildDecisionModelGovernance({
    matrix: basketballFeatureMatrix,
    training: basketballTraining,
    date,
    sport: "basketball"
  });
  const tennisFeatureMatrix = buildDecisionFeatureMatrix({ rows: rankedTennisRows, date, sport: "tennis", limit: 6 });
  const tennisGovernance = buildDecisionModelGovernance({ matrix: tennisFeatureMatrix, training: tennisTraining, date, sport: "tennis" });
  const featureMatrix = sport === "basketball" ? basketballFeatureMatrix : sport === "tennis" ? tennisFeatureMatrix : footballFeatureMatrix;
  const modelGovernance = sport === "basketball" ? basketballGovernance : sport === "tennis" ? tennisGovernance : footballGovernance;
  const modelCards = buildDecisionModelCards({
    date,
    inputs: [
      { sport: "football", matrix: footballFeatureMatrix, governance: footballGovernance, training, predictions: rankedRows.map((row) => row.prediction) },
      {
        sport: "basketball",
        matrix: basketballFeatureMatrix,
        governance: basketballGovernance,
        training: basketballTraining,
        predictions: rankedBasketballRows.map((row) => row.prediction)
      },
      { sport: "tennis", matrix: tennisFeatureMatrix, governance: tennisGovernance, training: tennisTraining, predictions: rankedTennisRows.map((row) => row.prediction) }
    ]
  });
  const dataAuthority = buildDecisionDataAuthority({
    date,
    sport,
    dataIntake,
    providerIngestionEvidence,
    modelGovernance,
    supabaseIsolation,
    containmentPolicy: supabaseContainmentPolicy,
    training: primaryTraining,
    corpusPlan
  });
  const eplFixtureIntake = buildDecisionEplFixtureIntake({
    date,
    dataAuthority,
    dataSourceCoverage,
    env
  });
  const eplFixtureIntakeReceipt = buildDecisionEplFixtureIntakeReceipt({
    intake: eplFixtureIntake,
    runRequested: false,
    origin: baseUrl
  });
  const eplProviderDryRunReceipt = buildDecisionEplProviderDryRunReceipt({
    intake: eplFixtureIntake,
    runRequested: false,
    adminAuthorized: false,
    env,
    origin: baseUrl
  });
  const eplProviderDryRunInterpreter = buildDecisionEplProviderDryRunInterpreter({
    receipt: eplProviderDryRunReceipt
  });
  const eplProviderFixtureMap = buildDecisionEplProviderFixtureMap({
    intake: eplFixtureIntake,
    receipt: eplProviderDryRunReceipt,
    interpreter: eplProviderDryRunInterpreter,
    predictionRows: rankedRows,
    env
  });
  const dataGapResolver = buildDecisionDataGapResolver({
    date,
    sport,
    dataAuthority,
    providerIngestionEvidence
  });
  const worldModel = buildDecisionWorldModel({
    date,
    sport,
    rows: primaryRows,
    dataAuthority,
    limit: 8
  });
  const worldModelCritic = buildDecisionWorldModelCritic({ worldModel, limit: 6 });
  const trainingBlueprint = buildTrainingDataBlueprint({
    corpusPlan: multiSportCorpusPlan,
    trainingSnapshots: [training, basketballTraining, tennisTraining]
  });
  const trainingCorpusProof = buildTrainingCorpusProof({ corpusPlan: multiSportCorpusPlan, trainingBlueprint, supabaseProofBinder });
  const trainingReadiness = buildTrainingReadiness({ trainingBlueprint, trainingCorpusProof });
  const historicalCorpusAcquisition = buildHistoricalCorpusAcquisition({
    corpusPlan: multiSportCorpusPlan,
    trainingBlueprint,
    eplFixtureIntake
  });
  const providerCorpusDryRunQueue = await buildProviderCorpusDryRunQueue({
    corpusPlan: multiSportCorpusPlan,
    env,
    runRequested: false,
    adminAuthorized: false,
    origin: baseUrl
  });
  const apiFootballEntitlementProbe = await buildApiFootballEntitlementProbe({
    env,
    runRequested: false,
    adminAuthorized: false,
    origin: baseUrl
  });
  const providerLearningBridge = buildDecisionProviderLearningBridge({
    date,
    sport,
    entitlementProbe: apiFootballEntitlementProbe,
    providerQueue: providerCorpusDryRunQueue
  });
  const dataBackbone = buildDecisionDataBackbone({
    dataSourceCoverage,
    dataAuthority,
    schemaManifest: supabaseSchemaManifest,
    liveSchemaActivation: supabaseLiveSchemaActivationPacket,
    containmentPolicy: supabaseContainmentPolicy,
    historicalCorpus: historicalCorpusAcquisition,
    trainingReadiness
  });
  const storageActivationChecklist = buildDecisionStorageActivationChecklist({
    date,
    sport,
    manifest: supabaseSchemaManifest,
    activation: supabaseLiveSchemaActivationPacket,
    dataBackbone,
    historicalCorpusAcquisition
  });
  const supabaseStorageProofLedger = buildDecisionSupabaseStorageProofLedger({
    manifest: supabaseSchemaManifest,
    mcpObservationReceipt: supabaseMcpObservationReceipt,
    containmentPolicy: supabaseContainmentPolicy,
    cleanProjectCutover: supabaseCleanProjectCutover,
    storageActivationChecklist,
    liveMcpProofArtifact: supabaseLiveMcpProofArtifact
  });
  const supabaseCredentialActivationReceipt = buildDecisionSupabaseCredentialActivationReceipt({
    readiness,
    schemaManifest: supabaseSchemaManifest,
    storageActivationChecklist,
    mcpObservationReceipt: supabaseMcpObservationReceipt
  });
  const providerBatchManifest = buildDecisionProviderBatchManifest({
    date,
    sport,
    providerIngestionEvidence,
    storageActivationChecklist,
    multiSportCorpusPlan,
    containmentPolicy: supabaseContainmentPolicy
  });
  const tenYearCorpusExecutionManifest = buildTenYearCorpusExecutionManifest({
    date,
    sport,
    multiSportCorpusPlan,
    trainingBlueprint,
    storageActivationChecklist,
    providerBatchManifest
  });
  const providerActivationQueue = buildDecisionProviderActivationQueue({
    date,
    sport,
    supabaseCredentialActivationReceipt,
    eplFixtureIntake,
    providerBatchManifest,
    tenYearCorpusExecutionManifest,
    historicalCorpusAcquisition,
    env
  });
  const providerActivationQueueReceipt = buildDecisionProviderActivationQueueReceipt({ queue: providerActivationQueue });
  const liveProviderProbeLedger = await buildDecisionLiveProviderProbeLedger({
    date,
    sport,
    env,
    runRequested: false,
    adminAuthorized: false
  });
  const eplPreKickoffRehearsal = buildDecisionEplPreKickoffRehearsal({
    date,
    eplFixtureIntake,
    dataBackbone,
    dataSourceCoverage
  });
  const shadowTrainingCandidates = buildShadowTrainingCandidates({
    date,
    trainingReadiness,
    trainingSnapshots: [training, basketballTraining, tennisTraining]
  });
  const learnedWeightPromotionGovernor = buildLearnedWeightPromotionGovernor({ date, shadowCandidates: shadowTrainingCandidates, modelCards });
  const aiReviewReadiness = buildDecisionAIReviewReadiness({ date, sport, baseUrl, env });
  const openAiKeyDiagnostic = buildDecisionOpenAIKeyDiagnostic({ aiReviewReadiness, env });
  const openAiLiveReviewReceipt = buildDecisionOpenAILiveReviewReceipt({
    aiReviewReadiness,
    openAiKeyDiagnostic
  });
  const requirementPulse = buildDecisionRequirementPulse({
    date,
    rows: allRows,
    dataAuthority,
    modelCards,
    trainingBlueprint,
    worldModelCritic,
    aiReviewReadiness
  });
  const launchCommander = buildDecisionLaunchCommander({
    date,
    sport,
    supabaseProofBinder,
    trainingCorpusProof,
    dataGapResolver,
    aiReviewReadiness,
    requirementPulse
  });
  const envActivationMatrix = buildDecisionEnvActivationMatrix({
    supabaseProofBinder,
    trainingCorpusProof,
    aiReviewReadiness,
    launchCommander,
    env
  });
  const oddsBoard = buildDecisionOddsBoard({
    date,
    slates: [
      { sport: "football", rows: rankedRows },
      { sport: "basketball", rows: rankedBasketballRows },
      { sport: "tennis", rows: rankedTennisRows }
    ],
    limit: 80
  });
  const marketAuditMatrix = buildDecisionMarketAuditMatrix({
    date,
    slates: [
      { sport: "football", rows: rankedRows },
      { sport: "basketball", rows: rankedBasketballRows },
      { sport: "tennis", rows: rankedTennisRows }
    ],
    limit: 120
  });
  const oddsIntelligenceProof = buildDecisionOddsIntelligenceProof({ board: oddsBoard, limit: 12 });
  const eplOddsMarketMap = buildDecisionEplOddsMarketMap({
    fixtureMap: eplProviderFixtureMap,
    oddsIntelligenceProof,
    env
  });
  const eplOddsDryRunReceipt = buildDecisionEplOddsDryRunReceipt({
    oddsMap: eplOddsMarketMap,
    runRequested: false,
    adminAuthorized: false,
    env,
    origin: baseUrl
  });
  const eplOddsDryRunInterpreter = buildDecisionEplOddsDryRunInterpreter({
    receipt: eplOddsDryRunReceipt
  });
  const oddsSnapshotStorageReadiness = buildDecisionOddsSnapshotStorageReadiness({
    oddsMap: eplOddsMarketMap,
    interpreter: eplOddsDryRunInterpreter,
    supabaseProofBinder,
    schemaManifest: supabaseSchemaManifest,
    storageActivationChecklist
  });
  const oddsSnapshotWriteReceipt = buildDecisionOddsSnapshotWriteReceipt({
    oddsMap: eplOddsMarketMap,
    storageReadiness: oddsSnapshotStorageReadiness,
    runRequested: false,
    adminAuthorized: false,
    env,
    origin: baseUrl
  });
  const oddsFeatureReadiness = buildDecisionOddsFeatureReadiness({
    writeReceipt: oddsSnapshotWriteReceipt,
    trainingBlueprint,
    trainingReadiness
  });
  const oddsFeatureGenerationReceipt = buildDecisionOddsFeatureGenerationReceipt({
    readiness: oddsFeatureReadiness,
    runRequested: false,
    adminAuthorized: false,
    env,
    origin: baseUrl
  });
  const portfolioRisk = buildDecisionPortfolioRisk({ board: oddsBoard, limit: 12 });
  const signalReliability = buildDecisionSignalReliability({ rows: primaryRows, date, sport, dataIntake });
  const modelTrust = buildDecisionModelTrust({
    date,
    sport,
    governance: modelGovernance,
    calibration,
    training: primaryTraining,
    board: oddsBoard,
    portfolio: portfolioRisk
  });
  const evidenceRefreshScheduler = buildDecisionEvidenceRefreshScheduler({
    rows: primaryRows,
    date,
    sport,
    dataIntake,
    signalReliability,
    modelTrust,
    oddsBoard,
    portfolioRisk,
    limit: 12
  });
  const evidenceFreshnessGate = buildDecisionEvidenceFreshnessGate({
    date,
    dataSourceCoverage,
    evidenceRefreshScheduler
  });
  const learnedWeightShadowComparison = buildLearnedWeightShadowComparison({
    date,
    oddsBoard,
    shadowCandidates: shadowTrainingCandidates,
    promotionGovernor: learnedWeightPromotionGovernor,
    limit: 12
  });
  const trainingActivationRunbook = buildTrainingActivationRunbook({
    date,
    trainingCorpusProof,
    trainingReadiness,
    shadowCandidates: shadowTrainingCandidates,
    promotionGovernor: learnedWeightPromotionGovernor,
    shadowComparison: learnedWeightShadowComparison,
    env
  });
  const explanationAudit = buildDecisionExplanationAudit({
    rows: primaryRows,
    date,
    sport,
    limit: 20
  });
  const modelMathProof = buildDecisionModelMathProof({
    date,
    slates: [
      { sport: "football", rows: rankedRows },
      { sport: "basketball", rows: rankedBasketballRows },
      { sport: "tennis", rows: rankedTennisRows }
    ],
    providerKeyPlan: providerActivationQueue.providerKeyPlan,
    limit: 6
  });
  const modelReasoningLedger = buildDecisionModelReasoningLedger({
    modelMathProof,
    marketAuditMatrix,
    oddsIntelligenceProof,
    trainingReadiness
  });
  const modelEnsemble = buildDecisionModelEnsemble({ rows: primaryRows, date, sport, limit: 6 });
  const probabilityFusionAudit = buildDecisionProbabilityFusionAudit({ rows: primaryRows, date, sport, limit: 8 });
  const marketAlternativeArbiter = buildDecisionMarketAlternativeArbiter({ oddsBoard, probabilityFusionAudit, date, sport, limit: 6 });
  const marketCalibratedFusion = buildDecisionMarketCalibratedFusion({
    date,
    sport,
    probabilityFusionAudit
  });
  const marketPriorGovernor = buildDecisionMarketPriorGovernor({
    date,
    sport,
    probabilityFusionAudit,
    marketAlternativeArbiter
  });
  const preMatchTrustGate = buildDecisionPreMatchTrustGate({
    date,
    sport,
    dataBackbone,
    dataAuthority,
    evidenceFreshnessGate,
    marketAlternativeArbiter,
    eplPreKickoffRehearsal,
    limit: 6
  });
  const evidenceInfluenceLedger = buildDecisionEvidenceInfluenceLedger({
    date,
    sport,
    dataSourceCoverage,
    evidenceFreshnessGate,
    providerIngestionEvidence,
    dataBackbone,
    preMatchTrustGate
  });
  const slateThinking = buildDecisionSlateThinking({ rows: primaryRows, date, sport, limit: 6 });
  const evidenceGraph = buildDecisionEvidenceGraph({
    rows: primaryRows,
    date,
    sport,
    slateThinking,
    limit: 6
  });
  const adversarialPanel = buildDecisionAdversarialPanel({
    date,
    sport,
    modelEnsemble,
    oddsIntelligenceProof,
    evidenceGraph,
    limit: 6
  });
  const agentThoughtBoard = buildDecisionAgentThoughtBoard({
    date,
    sport,
    modelEnsemble,
    slateThinking,
    evidenceGraph,
    adversarialPanel,
    openAiLiveReviewReceipt
  });
  const decisionBriefing = buildDecisionBriefing({
    date,
    sport,
    modelMathProof,
    oddsIntelligenceProof,
    adversarialPanel,
    openAiKeyDiagnostic
  });
  const contextSignalProof = buildDecisionContextSignalProof({
    date,
    slates: [
      { sport: "football", rows: rankedRows },
      { sport: "basketball", rows: rankedBasketballRows },
      { sport: "tennis", rows: rankedTennisRows }
    ],
    limit: 12
  });
  const originalBriefCoverage = buildDecisionOriginalBriefCoverage({
    dataAuthority,
    modelCards,
    modelMathProof,
    oddsIntelligenceProof,
    aiReviewReadiness,
    openAiKeyDiagnostic,
    trainingCorpusProof,
    supabaseProofBinder,
    envActivationMatrix
  });
  const launchState = buildDecisionLaunchState({
    date,
    sport,
    launchCommander,
    requirementPulse,
    openAiKeyDiagnostic,
    originalBriefCoverage,
    dataAuthority,
    supabaseProofBinder,
    trainingCorpusProof
  });
  const agentOperationQueue = buildDecisionAgentOperationQueue({
    date,
    sport,
    agentThoughtBoard,
    launchCommander,
    launchState,
    openAiLiveReviewReceipt,
    supabaseMcpObservationReceipt,
    trainingActivationRunbook
  });
  const beliefLedger = buildDecisionBayesianBeliefLedger({
    date,
    sport,
    rows: primaryRows,
    dataAuthority,
    oddsIntelligenceProof,
    openAiLiveReviewReceipt
  });
  const evidenceAcquisitionPlanner = buildDecisionEvidenceAcquisitionPlanner({
    date,
    sport,
    beliefLedger,
    dataGapResolver,
    dataIntake,
    contextSignalProof,
    agentOperationQueue,
    openAiLiveReviewReceipt
  });
  const cognitiveKernel = buildDecisionCognitiveKernel({
    date,
    sport,
    dataAuthority,
    modelMathProof,
    oddsIntelligenceProof,
    beliefLedger,
    evidenceAcquisitionPlanner,
    agentThoughtBoard,
    agentOperationQueue,
    launchState,
    openAiLiveReviewReceipt,
    requirementPulse,
    providerLearningBridge
  });
  const brainState = buildDecisionBrainState({
    date,
    sport,
    dataAuthority,
    beliefLedger,
    evidenceAcquisitionPlanner,
    agentThoughtBoard,
    agentOperationQueue,
    cognitiveKernel,
    openAiLiveReviewReceipt,
    requirementPulse
  });
  const brainReviewPacket = buildDecisionBrainReviewPacket({
    date,
    sport,
    brainState,
    evidenceInfluenceLedger,
    openAiLiveReviewReceipt
  });
  const brainReviewRunner = await runDecisionBrainReview({
    packet: brainReviewPacket,
    env,
    runRequested: false
  });
  const brainLiveReviewReceipt = buildDecisionBrainLiveReviewReceipt({
    packet: brainReviewPacket,
    runner: brainReviewRunner
  });
  const brainEvidenceDebtResolver = buildDecisionBrainEvidenceDebtResolver({
    date,
    sport,
    brainState,
    brainLiveReviewReceipt,
    evidenceAcquisitionPlanner,
    dataBackbone
  });
  const interventionPlanner = buildDecisionInterventionPlanner({
    date,
    sport,
    brainState,
    beliefLedger,
    evidenceAcquisitionPlanner,
    brainReviewRunner
  });
  const cycleGovernor = buildDecisionCycleGovernor({
    date,
    sport,
    brainState,
    beliefLedger,
    evidenceAcquisitionPlanner,
    agentOperationQueue,
    brainReviewRunner,
    interventionPlanner
  });
  const learningConsolidator = buildDecisionLearningConsolidator({
    date,
    sport,
    brainState,
    beliefLedger,
    brainReviewRunner,
    interventionPlanner,
    cycleGovernor,
    trainingReadiness,
    trainingActivationRunbook
  });
  const outcomeReplay = buildDecisionOutcomeReplay({
    date,
    sport,
    rows: primaryRows,
    training: primaryTraining,
    learningConsolidator
  });
  const learningPromotionGate = buildDecisionLearningPromotionGate({
    date,
    sport,
    outcomeReplay,
    learningConsolidator,
    promotionGovernor: learnedWeightPromotionGovernor,
    shadowComparison: learnedWeightShadowComparison,
    trainingReadiness
  });
  const settlementImpact = buildDecisionSettlementImpact({
    date,
    sport,
    outcomeReplay,
    promotionGate: learningPromotionGate
  });
  const shadowBacktestLedger = buildDecisionShadowBacktestLedger({
    date,
    sport,
    outcomeReplay,
    settlementImpact,
    training: primaryTraining,
    calibration
  });
  const calibrationFeedbackPacket = buildDecisionCalibrationFeedbackPacket({
    date,
    sport,
    outcomeReplay,
    settlementImpact,
    shadowBacktestLedger,
    learningPromotionGate
  });
  const trustFirewall = buildDecisionTrustFirewall({
    date,
    sport,
    evidenceFreshnessGate,
    marketAuditMatrix,
    oddsIntelligenceProof,
    modelTrust,
    portfolioRisk,
    openAiKeyDiagnostic,
    settlementImpact
  });
  const abstentionAudit = buildDecisionAbstentionAudit({
    date,
    sport,
    marketAuditMatrix,
    oddsIntelligenceProof,
    preMatchTrustGate,
    trustFirewall,
    limit: 8
  });
  const contradictionLedger = buildDecisionContradictionLedger({
    date,
    sport,
    rows: primaryRows,
    evidenceFreshnessGate,
    marketAuditMatrix,
    oddsIntelligenceProof,
    modelTrust,
    openAiKeyDiagnostic,
    trustFirewall
  });
  const resolutionPlanner = buildDecisionResolutionPlanner({
    date,
    sport,
    contradictionLedger,
    evidenceAcquisitionPlanner,
    agentOperationQueue,
    trustFirewall
  });
  const resolutionReceipt = buildDecisionResolutionReceipt({
    planner: resolutionPlanner,
    runRequested: false,
    origin: baseUrl
  });
  const shadowLearningAgenda = buildDecisionShadowLearningAgenda({
    date,
    sport,
    contradictionLedger,
    resolutionPlanner,
    resolutionReceipt,
    trustFirewall,
    outcomeReplay,
    settlementImpact,
    learningConsolidator
  });
  const cycleReceipt = buildDecisionCycleReceipt({
    cycleGovernor,
    runRequested: false,
    origin: baseUrl
  });
  const supervisedAgentRun = buildDecisionSupervisedAgentRun({
    date,
    sport,
    brainState,
    cognitiveKernel,
    brainReviewRunner,
    cycleGovernor,
    cycleReceipt,
    outcomeReplay,
    learningPromotionGate,
    learningConsolidator
  });
  const shadowMemoryReplay = buildDecisionShadowMemoryReplay({
    date,
    sport,
    shadowLearningAgenda,
    supervisedAgentRun,
    resolutionReceipt,
    outcomeReplay,
    settlementImpact,
    learningPromotionGate
  });
  const shadowReplayCritic = buildDecisionShadowReplayCritic({
    date,
    sport,
    shadowMemoryReplay,
    learningPromotionGate
  });
  const shadowInfluenceSimulator = buildDecisionShadowInfluenceSimulator({
    date,
    sport,
    shadowReplayCritic,
    trustFirewall,
    beliefLedger
  });
  const shadowNextCyclePlanner = buildDecisionShadowNextCyclePlanner({
    date,
    sport,
    shadowInfluenceSimulator,
    evidenceAcquisitionPlanner,
    agentOperationQueue,
    resolutionPlanner,
    publicHistoricalTrainingEvidence
  });
  const shadowNextCycleReceipt = buildDecisionShadowNextCycleReceipt({
    planner: shadowNextCyclePlanner,
    runRequested: false,
    origin: baseUrl
  });
  const shadowNextCycleInterpreter = buildDecisionShadowNextCycleInterpreter({
    planner: shadowNextCyclePlanner,
    receipt: shadowNextCycleReceipt
  });
  const historicalDiagnosisLadder = buildDecisionHistoricalDiagnosisLadder({
    publicHistoricalTrainingEvidence,
    interpreter: shadowNextCycleInterpreter,
    oddsSnapshotStorageReadiness
  });
  const historicalDiagnosisLadderReceipt = buildDecisionHistoricalDiagnosisLadderReceipt({
    ladder: historicalDiagnosisLadder,
    runRequested: false,
    origin: baseUrl
  });
  const contextFeatureIntakeGap = buildFootballProviderFeatureIntakeGapReceipt({
    env,
    origin: baseUrl
  });
  const contextFixtureFeatureReadiness = buildFootballProviderFixtureFeatureReadiness({
    fixtureMap: eplProviderFixtureMap,
    featureGap: contextFeatureIntakeGap
  });
  const contextFeatureProofSelector = buildDecisionContextFeatureProofSelector({
    ladderReceipt: historicalDiagnosisLadderReceipt,
    featureGap: contextFeatureIntakeGap,
    fixtureFeatureReadiness: contextFixtureFeatureReadiness
  });
  const contextFeatureProofReceipt = buildDecisionContextFeatureProofReceipt({
    selector: contextFeatureProofSelector,
    runRequested: false,
    origin: baseUrl
  });
  const providerKeyBlockerResolver = buildDecisionProviderKeyBlockerResolver({
    contextProofReceipt: contextFeatureProofReceipt,
    providerKeyPlan: providerActivationQueue.providerKeyPlan
  });
  const providerKeyActivationRehearsal = buildDecisionProviderKeyActivationRehearsal({
    resolver: providerKeyBlockerResolver,
    envActivationMatrix
  });
  const providerKeyActivationReceipt = buildDecisionProviderKeyActivationReceipt({
    rehearsal: providerKeyActivationRehearsal,
    providerKeyPlan: providerActivationQueue.providerKeyPlan,
    env
  });
  const providerEnvDiagnostic = buildDecisionProviderEnvDiagnostic({
    date,
    sport,
    providerKeyPlan: providerActivationQueue.providerKeyPlan,
    env
  });
  const firstProviderProofRun = buildDecisionFirstProviderProofRun({
    keyActivationReceipt: providerKeyActivationReceipt,
    eplProviderDryRunReceipt,
    eplOddsDryRunReceipt,
    providerActivationQueueReceipt
  });
  const firstProviderProofReceipt = buildDecisionFirstProviderProofReceipt({
    run: firstProviderProofRun,
    eplProviderDryRunReceipt,
    eplOddsDryRunReceipt,
    runRequested: false
  });
  const shadowWorkingMemory = buildDecisionShadowWorkingMemory({
    interpreter: shadowNextCycleInterpreter
  });
  const shadowReasoningLoop = buildDecisionShadowReasoningLoop({
    memory: shadowWorkingMemory,
    interpreter: shadowNextCycleInterpreter
  });
  const shadowLoopGovernor = buildDecisionShadowLoopGovernor({
    loop: shadowReasoningLoop,
    memory: shadowWorkingMemory,
    interpreter: shadowNextCycleInterpreter
  });
  const shadowLoopReceipt = buildDecisionShadowLoopReceipt({
    governor: shadowLoopGovernor,
    runRequested: false,
    origin: baseUrl
  });
  const shadowLoopInterpreter = buildDecisionShadowLoopInterpreter({
    governor: shadowLoopGovernor,
    receipt: shadowLoopReceipt
  });
  const shadowLoopReflection = buildDecisionShadowLoopReflection({
    interpreter: shadowLoopInterpreter
  });
  const shadowLoopReflectionReceipt = buildDecisionShadowLoopReflectionReceipt({
    reflection: shadowLoopReflection,
    runRequested: false,
    origin: baseUrl
  });
  const shadowLoopReflectionReceiptInterpreter = buildDecisionShadowLoopReflectionReceiptInterpreter({
    reflection: shadowLoopReflection,
    receipt: shadowLoopReflectionReceipt
  });
  const shadowLoopContinuity = buildDecisionShadowLoopContinuity({
    interpreter: shadowLoopReflectionReceiptInterpreter
  });
  const shadowLoopContinuityReceipt = buildDecisionShadowLoopContinuityReceipt({
    continuity: shadowLoopContinuity,
    runRequested: false,
    origin: baseUrl
  });
  const shadowLoopContinuityReceiptInterpreter = buildDecisionShadowLoopContinuityReceiptInterpreter({
    continuity: shadowLoopContinuity,
    receipt: shadowLoopContinuityReceipt
  });
  const shadowLoopAutopilot = buildDecisionShadowLoopAutopilot({
    interpreter: shadowLoopContinuityReceiptInterpreter
  });
  const supervisedAgentRunner = buildDecisionSupervisedAgentRunner({
    date,
    sport,
    runRequested: false,
    previewRun: supervisedAgentRun,
    observedRun: supervisedAgentRun,
    observedReceipt: cycleReceipt
  });
  const aiLiveCycleReceipt = buildDecisionAILiveCycleReceipt({
    date,
    sport,
    aiReviewReadiness,
    openAiKeyDiagnostic,
    openAiLiveReviewReceipt,
    agentOperationQueue,
    cognitiveKernel,
    brainState,
    cycleReceipt,
    supervisedAgentRunner
  });
  const aiUnblockReceipt = buildDecisionAIUnblockReceipt({
    date,
    sport,
    openAiKeyDiagnostic,
    openAiLiveReviewReceipt,
    aiLiveCycleReceipt,
    brainEvidenceDebtResolver,
    supabaseMcpObservationReceipt,
    oddsSnapshotStorageReadiness,
    oddsFeatureGenerationReceipt,
    trainingReadiness
  });
  const engineActivationContract = buildDecisionEngineActivationContract({
    date,
    sport,
    dataBackbone,
    eplPreKickoffRehearsal,
    launchState,
    trustFirewall,
    aiLiveCycleReceipt,
    shadowBacktestLedger,
    marketAuditMatrix,
    modelMathProof
  });
  const finalAnswerContract = buildDecisionFinalAnswerContract({
    date,
    sport,
    rows: primaryRows,
    activationContract: engineActivationContract,
    trustFirewall,
    marketAuditMatrix,
    aiLiveCycleReceipt,
    abstentionAudit
  });
  const changeMindLedger = buildDecisionChangeMindLedger({
    date,
    sport,
    finalAnswer: finalAnswerContract,
    activationContract: engineActivationContract,
    trustFirewall,
    portfolioRisk
  });
  const finalAnswerAIReview = await runDecisionFinalAnswerAIReview({
    date,
    sport,
    finalAnswer: finalAnswerContract,
    changeMindLedger,
    trustFirewall,
    portfolioRisk,
    openAiKeyDiagnostic,
    runRequested: false
  });
  const finalAnswerCouncil = buildDecisionFinalAnswerCouncil({
    date,
    sport,
    finalAnswer: finalAnswerContract,
    changeMindLedger,
    finalAnswerAIReview,
    trustFirewall,
    portfolioRisk
  });
  const providerEvidenceLedger = buildDecisionProviderEvidenceLedger({
    date,
    sport,
    dataSourceCoverage,
    providerIngestionEvidence,
    providerActivationQueue,
    eplPreKickoffRehearsal,
    eplProviderDryRunReceipt,
    eplOddsDryRunReceipt,
    trainingCorpusProof,
    trainingReadiness,
    finalAnswerCouncil
  });
  const liveDataReadiness = buildDecisionLiveDataReadiness({
    date,
    sport,
    schemaManifest: supabaseSchemaManifest,
    providerEvidenceLedger,
    dataBackbone,
    storageActivationChecklist
  });
  const answerPromotionGate = buildDecisionAnswerPromotionGate({
    date,
    sport,
    finalAnswer: finalAnswerContract,
    finalAnswerCouncil,
    finalAnswerAIReview,
    providerEvidenceLedger,
    modelReasoningLedger,
    marketAuditMatrix,
    marketCalibratedFusion,
    shadowBacktestLedger,
    trustFirewall,
    abstentionAudit,
    eplFixtureIntake: sport === "football" ? eplFixtureIntake : null
  });
  const evidenceSufficiencyScore = buildDecisionEvidenceSufficiencyScore({
    date,
    sport,
    liveDataReadiness,
    modelMathProof,
    marketCalibratedFusion,
    abstentionAudit,
    finalAnswer: finalAnswerContract,
    answerPromotionGate,
    eplPreKickoffRehearsal
  });
  const trustAwareAIPacket = buildDecisionTrustAwareAIPacket({
    date,
    sport,
    preMatchTrustGate,
    evidenceInfluenceLedger,
    finalAnswer: finalAnswerContract,
    abstentionAudit,
    briefing: decisionBriefing,
    openAiKeyDiagnostic,
    openAiLiveReviewReceipt,
    publicHistoricalTrainingEvidence
  });
  const finalAnswerValidationReceipt = buildDecisionFinalAnswerValidationReceipt({
    date,
    sport,
    finalAnswer: finalAnswerContract,
    activationContract: engineActivationContract,
    trustFirewall,
    answerPromotionGate
  });
  const finalAnswerTraceReceipt = buildDecisionFinalAnswerTraceReceipt({
    date,
    sport,
    dataBackbone,
    modelReasoningLedger,
    marketAuditMatrix,
    aiLiveCycleReceipt,
    engineActivationContract,
    trustFirewall,
    finalAnswer: finalAnswerContract,
    answerPromotionGate,
    validation: finalAnswerValidationReceipt
  });
  const mvpProgressReceipt = buildDecisionMvpProgressReceipt({
    date,
    sport,
    requirementPulse,
    dataBackbone,
    storageActivationChecklist,
    supabaseStorageProofLedger,
    providerBatchManifest,
    tenYearCorpusExecutionManifest,
    eplPreKickoffRehearsal,
    brainReviewRunner,
    openAiLiveReviewReceipt,
    finalAnswerTraceReceipt,
    answerPromotionGate,
    publicHistoricalTrainingEvidence
  });

  return {
    date,
    sport,
    baseUrl,
    readiness,
    rows,
    rankedRows,
    rankedBasketballRows,
    rankedTennisRows,
    primaryRows,
    allRows,
    training,
    basketballTraining,
    tennisTraining,
    primaryTraining,
    publicHistoricalTrainingEvidence,
    corpusPlan,
    multiSportCorpusPlan,
    supabaseIsolation,
    supabaseLiveMcpProofArtifact,
    supabaseProofBinder,
    supabaseMcpObservationReceipt,
    supabaseAuthorityRemediation,
    supabaseCleanProjectCutover,
    supabaseSchemaManifest,
    supabaseContainmentPolicy,
    supabaseLiveSchemaActivationPacket,
    storageActivationChecklist,
    supabaseStorageProofLedger,
    supabaseCredentialActivationReceipt,
    footballDataIntake,
    basketballDataIntake,
    tennisDataIntake,
    dataIntake,
    dataSourceCoverage,
    eplFixtureIntake,
    eplFixtureIntakeReceipt,
    eplPreKickoffRehearsal,
    eplProviderDryRunReceipt,
    eplProviderDryRunInterpreter,
    eplProviderFixtureMap,
    eplOddsMarketMap,
    eplOddsDryRunReceipt,
    eplOddsDryRunInterpreter,
    oddsSnapshotStorageReadiness,
    oddsSnapshotWriteReceipt,
    oddsFeatureReadiness,
    oddsFeatureGenerationReceipt,
    evidenceRefreshScheduler,
    evidenceFreshnessGate,
    providerIngestionEvidence,
    providerBatchManifest,
    tenYearCorpusExecutionManifest,
    providerCorpusDryRunQueue,
    apiFootballEntitlementProbe,
    providerLearningBridge,
    providerActivationQueue,
    providerActivationQueueReceipt,
    liveProviderProbeLedger,
    featureMatrix,
    modelGovernance,
    modelTrust,
    modelCards,
    dataAuthority,
    dataGapResolver,
    worldModel,
    worldModelCritic,
    trainingBlueprint,
    historicalCorpusAcquisition,
    dataBackbone,
    trainingCorpusProof,
    trainingReadiness,
    shadowTrainingCandidates,
    learnedWeightPromotionGovernor,
    learnedWeightShadowComparison,
    trainingActivationRunbook,
    aiReviewReadiness,
    openAiKeyDiagnostic,
    openAiLiveReviewReceipt,
    requirementPulse,
    launchCommander,
    envActivationMatrix,
    oddsBoard,
    marketAuditMatrix,
    oddsIntelligenceProof,
    portfolioRisk,
    explanationAudit,
    modelMathProof,
    modelReasoningLedger,
    modelEnsemble,
    probabilityFusionAudit,
    marketAlternativeArbiter,
    marketCalibratedFusion,
    marketPriorGovernor,
    preMatchTrustGate,
    evidenceInfluenceLedger,
    slateThinking,
    evidenceGraph,
    adversarialPanel,
    beliefLedger,
    evidenceAcquisitionPlanner,
    agentThoughtBoard,
    agentOperationQueue,
    cognitiveKernel,
    brainState,
    brainReviewPacket,
    brainReviewRunner,
    brainLiveReviewReceipt,
    brainEvidenceDebtResolver,
    interventionPlanner,
    cycleGovernor,
    cycleReceipt,
    supervisedAgentRun,
    supervisedAgentRunner,
    aiLiveCycleReceipt,
    aiUnblockReceipt,
    engineActivationContract,
    finalAnswerContract,
    changeMindLedger,
    finalAnswerAIReview,
    finalAnswerCouncil,
    providerEvidenceLedger,
    liveDataReadiness,
    evidenceSufficiencyScore,
    answerPromotionGate,
    trustAwareAIPacket,
    finalAnswerValidationReceipt,
    finalAnswerTraceReceipt,
    mvpProgressReceipt,
    outcomeReplay,
    settlementImpact,
    shadowBacktestLedger,
    calibrationFeedbackPacket,
    trustFirewall,
    abstentionAudit,
    contradictionLedger,
    resolutionPlanner,
    resolutionReceipt,
    shadowLearningAgenda,
    shadowMemoryReplay,
    shadowReplayCritic,
    shadowInfluenceSimulator,
    shadowNextCyclePlanner,
    shadowNextCycleReceipt,
    shadowNextCycleInterpreter,
    historicalDiagnosisLadder,
    historicalDiagnosisLadderReceipt,
    contextFeatureIntakeGap,
    contextFixtureFeatureReadiness,
    contextFeatureProofSelector,
    contextFeatureProofReceipt,
    providerKeyBlockerResolver,
    providerKeyActivationRehearsal,
    providerKeyActivationReceipt,
    providerEnvDiagnostic,
    firstProviderProofRun,
    firstProviderProofReceipt,
    shadowWorkingMemory,
    shadowReasoningLoop,
    shadowLoopGovernor,
    shadowLoopReceipt,
    shadowLoopInterpreter,
    shadowLoopReflection,
    shadowLoopReflectionReceipt,
    shadowLoopReflectionReceiptInterpreter,
    shadowLoopContinuity,
    shadowLoopContinuityReceipt,
    shadowLoopContinuityReceiptInterpreter,
    shadowLoopAutopilot,
    learningPromotionGate,
    learningConsolidator,
    decisionBriefing,
    contextSignalProof,
    originalBriefCoverage,
    launchState
  };
}
