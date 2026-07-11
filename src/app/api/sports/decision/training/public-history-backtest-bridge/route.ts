import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { buildMultiSportBacktestRun } from "@/lib/sports/training/multiSportBacktestRun";
import { buildMultiSportCorpusPlan } from "@/lib/sports/training/multiSportCorpusPlan";
import { buildMultiSportModelGovernance } from "@/lib/sports/training/multiSportModelGovernance";
import { buildFootballDataHistoricalLearningDossier } from "@/lib/sports/training/footballDataHistoricalLearningDossier";
import { buildPublicHistoryBacktestBridge } from "@/lib/sports/training/publicHistoryBacktestBridge";
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun");
  if (dryRun === "0" || dryRun?.toLowerCase() === "false") {
    return apiError("public-history-backtest-bridge is read-only; use dryRun=1.", 400);
  }

  const seasonFrom = parsePositiveInteger(url.searchParams.get("seasonFrom"));
  const seasonTo = parsePositiveInteger(url.searchParams.get("seasonTo"));
  const maxSeasons = parsePositiveInteger(url.searchParams.get("maxSeasons"));
  const minSample = parsePositiveInteger(url.searchParams.get("minSample")) ?? 30;
  const limit = parsePositiveInteger(url.searchParams.get("limit")) ?? 5000;
  const corpusPlan = buildMultiSportCorpusPlan({
    env: process.env,
    baseUrl: url.origin,
    seasonFrom,
    seasonTo,
    sports: ["football"]
  });
  const [dossier, ...trainingSnapshots] = await Promise.all([
    buildFootballDataHistoricalLearningDossier({
      seasonFrom,
      seasonTo,
      maxSeasons,
      trainRatio: parseNumber(url.searchParams.get("trainRatio")),
      minEdge: parseNumber(url.searchParams.get("minEdge")),
      minModelProbability: parseNumber(url.searchParams.get("minModelProbability")),
      minPickCount: parsePositiveInteger(url.searchParams.get("minPickCount")),
      minTrainingSeasons: parsePositiveInteger(url.searchParams.get("minTrainingSeasons"))
    }),
    ...corpusPlan.sports.map((sportPlan) => getTrainingDataSnapshot(sportPlan.sport))
  ]);
  const publicEvidence = buildPublicHistoricalTrainingEvidence({ dossier });
  const multiSportBacktest = await buildMultiSportBacktestRun({
    corpusPlan,
    trainingSnapshots,
    selectedSports: ["football"],
    minSample,
    limit,
    runRequested: false,
    adminAuthorized: false
  });
  const multiSportGovernance = buildMultiSportModelGovernance({
    corpusPlan,
    trainingSnapshots
  });
  const bridge = buildPublicHistoryBacktestBridge({
    publicEvidence,
    multiSportBacktest,
    multiSportGovernance
  });

  return apiSuccess(
    {
      ...bridge,
      publicHistoricalTrainingEvidence: publicEvidence
    },
    { status: bridge.status === "failed" ? 502 : 200 }
  );
}
