import { buildFootballDataHistoricalLearningDossier, type FootballDataHistoricalLearningDossier } from "@/lib/sports/training/footballDataHistoricalLearningDossier";
import { buildFootballDataMarketBenchmark, type FootballDataMarketBenchmark } from "@/lib/sports/training/footballDataMarketBenchmark";
import { buildFootballDataMarketLearningRoadmap } from "@/lib/sports/training/footballDataMarketLearningRoadmap";
import { buildFootballDataMarketSegmentRetest } from "@/lib/sports/training/footballDataMarketSegmentRetest";
import { buildFootballDataModelPromotionDecision, type FootballDataModelPromotionDecision } from "@/lib/sports/training/footballDataModelPromotionDecision";
import { buildFootballDataProviderLearningActivationReceipt } from "@/lib/sports/training/footballDataProviderLearningActivationReceipt";
import { readFootballDataProviderRetestBridge } from "@/lib/sports/training/footballDataProviderRetestBridge";
import { buildFootballDataProviderRetestContract } from "@/lib/sports/training/footballDataProviderRetestContract";
import { runFootballDataProviderRetest } from "@/lib/sports/training/footballDataProviderRetestRunner";
import { buildFootballDataThresholdSweep } from "@/lib/sports/training/footballDataThresholdSweep";
import { buildFootballDataWalkForwardValidation } from "@/lib/sports/training/footballDataWalkForwardValidation";
import { buildMultiSportBacktestRun } from "@/lib/sports/training/multiSportBacktestRun";
import { buildMultiSportCorpusPlan } from "@/lib/sports/training/multiSportCorpusPlan";
import { buildMultiSportModelGovernance } from "@/lib/sports/training/multiSportModelGovernance";
import { buildPublicHistoryBacktestBridge, type PublicHistoryBacktestBridge } from "@/lib/sports/training/publicHistoryBacktestBridge";
import { buildPublicHistoricalTrainingEvidence, type PublicHistoricalTrainingEvidence } from "@/lib/sports/training/publicHistoricalTrainingEvidence";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export type FootballDataHistoricalPromotionProof = {
  historicalLearningDossier: FootballDataHistoricalLearningDossier | null;
  publicHistoricalTrainingEvidence: PublicHistoricalTrainingEvidence | null;
  benchmark: FootballDataMarketBenchmark | null;
  publicHistoryBacktestBridge: PublicHistoryBacktestBridge | null;
  modelPromotionDecision: FootballDataModelPromotionDecision | null;
};

export type FootballDataHistoricalPromotionProofInput = {
  baseUrl: string;
  env: NodeJS.ProcessEnv;
  seasonFrom?: number;
  seasonTo?: number;
  maxSeasons?: number;
  trainRatio?: number;
  minEdge?: number;
  minModelProbability?: number;
  minPickCount?: number;
  minTrainingSeasons?: number;
  minSample?: number;
  limit?: number;
  includePublicHistory?: boolean;
  includeBridge?: boolean;
  includeModelPromotion?: boolean;
};

export async function buildFootballDataHistoricalPromotionProof({
  baseUrl,
  env,
  seasonFrom,
  seasonTo,
  maxSeasons,
  trainRatio,
  minEdge,
  minModelProbability,
  minPickCount,
  minTrainingSeasons,
  minSample = 30,
  limit,
  includePublicHistory = true,
  includeBridge = true,
  includeModelPromotion = true
}: FootballDataHistoricalPromotionProofInput): Promise<FootballDataHistoricalPromotionProof> {
  const historicalLearningDossier = includePublicHistory
    ? await buildFootballDataHistoricalLearningDossier({
        seasonFrom,
        seasonTo,
        maxSeasons,
        trainRatio,
        minEdge,
        minModelProbability,
        minPickCount,
        minTrainingSeasons
      })
    : null;
  const publicHistoricalTrainingEvidence = historicalLearningDossier ? buildPublicHistoricalTrainingEvidence({ dossier: historicalLearningDossier }) : null;
  const benchmark = historicalLearningDossier
    ? (historicalLearningDossier.artifacts.marketBenchmark as unknown as FootballDataMarketBenchmark)
    : includeModelPromotion
      ? await buildFootballDataMarketBenchmark({
          seasonFrom,
          seasonTo,
          maxSeasons,
          trainRatio,
          minEdge,
          minModelProbability
        })
      : null;

  const publicHistoryBacktestBridge =
    publicHistoricalTrainingEvidence && includeBridge
      ? await (async () => {
          const corpusPlan = buildMultiSportCorpusPlan({
            env,
            baseUrl,
            seasonFrom,
            seasonTo,
            sports: ["football"]
          });
          const trainingSnapshots = await Promise.all(corpusPlan.sports.map((sportPlan) => getTrainingDataSnapshot(sportPlan.sport)));
          const multiSportBacktest = await buildMultiSportBacktestRun({
            corpusPlan,
            trainingSnapshots,
            selectedSports: ["football"],
            runRequested: false,
            adminAuthorized: false,
            minSample,
            limit: limit ?? 5000
          });
          const multiSportGovernance = buildMultiSportModelGovernance({
            corpusPlan,
            trainingSnapshots
          });
          return buildPublicHistoryBacktestBridge({
            publicEvidence: publicHistoricalTrainingEvidence,
            multiSportBacktest,
            multiSportGovernance
          });
        })()
      : null;

  const modelPromotionDecision =
    benchmark && includeModelPromotion
      ? await (async () => {
          const [thresholdSweep, walkForward] = await Promise.all([
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
          const bridge = await readFootballDataProviderRetestBridge({ contract, limit });
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

  return {
    historicalLearningDossier,
    publicHistoricalTrainingEvidence,
    benchmark,
    publicHistoryBacktestBridge,
    modelPromotionDecision
  };
}
