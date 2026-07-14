import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isTrainingAdminAuthorized } from "@/lib/sports/training/adminAuth";
import {
  previewStoredFootballRuntimeReplay,
  runAndStoreFootballRuntimeReplay,
  type BacktestRunStoreResult
} from "@/lib/sports/training/trainingRepository";
import type { FootballRuntimeReplayConfig, FootballRuntimeReplayResult } from "@/lib/sports/training/footballRuntimeReplay";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function integer(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function decimal(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function enabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function options(request: Request) {
  const query = new URL(request.url).searchParams;
  const config: FootballRuntimeReplayConfig = {
    trainRatio: decimal(query.get("trainRatio"), 0.7, 0.1, 0.9),
    minEdge: decimal(query.get("minEdge"), 0.04, 0, 0.25),
    minModelProbability: decimal(query.get("minModelProbability"), 0.3, 0.05, 0.95),
    minPriorMatches: integer(query.get("minPriorMatches"), 3, 0, 20)
  };
  return {
    limit: integer(query.get("limit"), 50_000, 100, 50_000),
    minSample: integer(query.get("minSample"), 100, 30, 10_000),
    includeDemo: enabled(query.get("includeDemo")),
    config
  };
}

function replaySummary(replay: FootballRuntimeReplayResult, stored?: { id: string } | null) {
  return {
    mode: "football-runtime-replay",
    status: stored ? "stored" : replay.status,
    storedBacktestId: stored?.id ?? null,
    modelKey: replay.modelKey,
    engineVersion: replay.engineVersion,
    generatedAt: replay.generatedAt,
    executionHash: replay.executionHash,
    featureContract: replay.featureContract,
    window: {
      start: replay.windowStart,
      end: replay.windowEnd,
      trainStart: replay.trainWindowStart,
      trainEnd: replay.trainWindowEnd,
      testStart: replay.testWindowStart,
      testEnd: replay.testWindowEnd
    },
    metrics: {
      sampleSize: replay.sampleSize,
      trainSize: replay.trainSize,
      testSize: replay.testSize,
      pickCount: replay.pickCount,
      brierScore: replay.brierScore,
      logLoss: replay.logLoss,
      calibrationError: replay.calibrationError,
      roiUnits: replay.roiUnits,
      yield: replay.yield,
      averageEdge: replay.averageEdge,
      closingLineValue: replay.closingLineValue
    },
    learnedWeights: replay.learnedWeights,
    config: replay.config,
    notes: replay.notes,
    rejectionSample: replay.rejections.slice(0, 20),
    controls: {
      exactRuntimeEntrypointExecuted: replay.featureContract.entrypointInvocations === replay.featureContract.evaluatedFixtures,
      canStoreWithPost: true,
      requiresAdminTokenToStore: true,
      appliesWeightsAutomatically: false,
      promotesModelAutomatically: false,
      publishesPicks: false
    }
  };
}

export const GET = withApiHandler(async (request: Request) => {
  if (!isTrainingAdminAuthorized(request)) {
    return apiError("Runtime replay execution requires a valid x-oddspadi-admin-token.", 401);
  }
  const input = options(request);
  const replay = await previewStoredFootballRuntimeReplay(input);
  if ("error" in replay) return apiError(replay.error, 503);
  return apiSuccess(replaySummary(replay), { status: replay.status === "completed" ? 200 : 409 });
});

export const POST = withApiHandler(async (request: Request) => {
  if (!isTrainingAdminAuthorized(request)) {
    return apiError("Runtime replay storage requires a valid x-oddspadi-admin-token.", 401);
  }
  const input = options(request);
  const stored: BacktestRunStoreResult = await runAndStoreFootballRuntimeReplay(input);
  if (stored.status === "stored") return apiSuccess(replaySummary(stored.result as FootballRuntimeReplayResult, { id: stored.id }));
  if (stored.result && "featureContract" in stored.result) {
    return apiSuccess({
      ...replaySummary(stored.result as FootballRuntimeReplayResult),
      status: stored.status,
      reason: stored.reason
    }, { status: stored.status === "no-data" ? 409 : 500 });
  }
  return apiError(stored.reason, stored.status === "not-configured" ? 503 : 500);
});
