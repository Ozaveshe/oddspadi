import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import {
  buildDemoFootballProviderFeatureFixture,
  buildFootballProviderFeatureMaterializer
} from "@/lib/sports/training/footballDataProviderFeatureMaterializer";
import { buildFootballDataMarketBenchmark } from "@/lib/sports/training/footballDataMarketBenchmark";
import { buildFootballDataMarketLearningRoadmap } from "@/lib/sports/training/footballDataMarketLearningRoadmap";
import { buildFootballDataMarketSegmentRetest } from "@/lib/sports/training/footballDataMarketSegmentRetest";
import { buildFootballDataModelPromotionDecision } from "@/lib/sports/training/footballDataModelPromotionDecision";
import {
  buildFootballDataProviderRetestBridgeFromRows,
  readFootballDataProviderRetestBridge
} from "@/lib/sports/training/footballDataProviderRetestBridge";
import { buildFootballDataProviderRetestContract } from "@/lib/sports/training/footballDataProviderRetestContract";
import { buildFootballDataProviderLearningActivationReceipt } from "@/lib/sports/training/footballDataProviderLearningActivationReceipt";
import { runFootballDataProviderRetest } from "@/lib/sports/training/footballDataProviderRetestRunner";
import { buildFootballDataThresholdSweep } from "@/lib/sports/training/footballDataThresholdSweep";
import { buildFootballDataWalkForwardValidation } from "@/lib/sports/training/footballDataWalkForwardValidation";

export const dynamic = "force-dynamic";

function parsePositiveInteger(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNumber(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun");
  if (dryRun === "0" || dryRun?.toLowerCase() === "false") return apiError("football-data-model-promotion-decision is read-only; use dryRun=1.", 400);

  const seasonFrom = parsePositiveInteger(url.searchParams.get("seasonFrom"));
  const seasonTo = parsePositiveInteger(url.searchParams.get("seasonTo"));
  const maxSeasons = parsePositiveInteger(url.searchParams.get("maxSeasons"));
  const trainRatio = parseNumber(url.searchParams.get("trainRatio"));
  const minPickCount = parsePositiveInteger(url.searchParams.get("minPickCount"));
  const minTrainingSeasons = parsePositiveInteger(url.searchParams.get("minTrainingSeasons"));
  const minEdge = parseNumber(url.searchParams.get("minEdge"));
  const minModelProbability = parseNumber(url.searchParams.get("minModelProbability"));
  const includeDemo = url.searchParams.get("demo") === "1" || url.searchParams.get("demo")?.toLowerCase() === "true";

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
  const bridge = includeDemo
    ? buildFootballDataProviderRetestBridgeFromRows({
        contract,
        rows: buildFootballProviderFeatureMaterializer({
          provider: "demo_provider",
          fixtures: [buildDemoFootballProviderFeatureFixture()]
        }).previewRows
      })
    : await readFootballDataProviderRetestBridge({
        contract,
        limit: parsePositiveInteger(url.searchParams.get("limit"))
      });
  const runner = runFootballDataProviderRetest({ contract, rows: bridge.normalizedRows });
  const activation = buildFootballDataProviderLearningActivationReceipt({
    contract,
    bridge,
    runner,
    source: includeDemo ? "demo-preview" : "stored-supabase"
  });

  const decision = buildFootballDataModelPromotionDecision({
    walkForward,
    thresholdSweep,
    marketLearningRoadmap: roadmap,
    providerRetestContract: contract,
    providerLearningActivation: activation
  });

  return apiSuccess(decision, { status: benchmark.status === "failed" || thresholdSweep.status === "failed" || walkForward.status === "failed" ? 502 : 200 });
}
