import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";
import { finishProviderRun, startProviderRun } from "../../src/lib/sports/intelligence/repository";
import type { ProviderRunClaim, ProviderRunLog, ProviderRunStatus } from "../../src/lib/sports/intelligence/types";
import { runAndStoreCalibration, type CalibrationRunResult } from "../../src/lib/sports/prediction/decisionCalibration";
import {
  runChampionChallengerSweep,
  type ChampionChallengerSweepResult,
  type ChampionChallengerStoreResult
} from "../../src/lib/sports/prediction/championChallengerRepository";
import {
  getTrainingDataSnapshot,
  runAndStoreFootballRuntimeReplay,
  runAndStoreHistoricalBacktest,
  type BacktestRunStoreResult
} from "../../src/lib/sports/training/trainingRepository";
import { inspectRuntimeBacktestEvidence } from "../../src/lib/sports/training/runtimeBacktestEvidence";
import type { Sport } from "../../src/lib/sports/types";

declare const Netlify: { env: { get(name: string): string | undefined } };

type LearningSport = Extract<Sport, "football" | "basketball" | "tennis">;
type CalibrationOperation = (sport: LearningSport) => Promise<CalibrationRunResult>;
type RuntimeReplayOperation = (sport: LearningSport) => Promise<BacktestRunStoreResult>;
type RuntimeReplayDueOperation = (sport: LearningSport, now: Date) => Promise<boolean>;
type ChampionChallengerSweepOperation = (input: { sport: LearningSport; now: Date }) => Promise<ChampionChallengerSweepResult>;
type ClaimLearningRun = (startedAt: string) => Promise<ProviderRunClaim>;
type FinishLearningRun = (run: ProviderRunLog, status: ProviderRunStatus, errors: string[], finishedAt: string) => Promise<ProviderRunLog>;

const clean = (value?: string | null) => value?.trim() || null;
const tokenMatches = (expected: string, supplied: string) => {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
};

const RUNTIME_REPLAY_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

async function runtimeReplayNeedsBootstrap(sport: LearningSport, now: Date): Promise<boolean> {
  const snapshot = await getTrainingDataSnapshot(sport);
  const evidence = inspectRuntimeBacktestEvidence(sport, snapshot.latestBacktest);
  if (!evidence.exactRuntimeParity) return true;

  const createdAt = Date.parse(snapshot.latestBacktest?.createdAt ?? "");
  return !Number.isFinite(createdAt) || now.getTime() - createdAt > RUNTIME_REPLAY_MAX_AGE_MS;
}

export async function runModelLearningCycle({
  scheduleToken,
  adminToken,
  sports = ["football", "basketball", "tennis"],
  runCalibration = runAndStoreCalibration,
  runRuntimeReplay = async (sport) =>
    sport === "football"
      ? runAndStoreFootballRuntimeReplay({ minSample: 100, limit: 50_000 })
      : runAndStoreHistoricalBacktest({ sport, minSample: 30, limit: 50_000 }),
  runtimeReplayDue = runtimeReplayNeedsBootstrap,
  runChampionChallengerComparisonSweep = runChampionChallengerSweep,
  now = new Date()
}: {
  scheduleToken: string | null;
  adminToken: string | null;
  sports?: LearningSport[];
  runCalibration?: CalibrationOperation;
  runRuntimeReplay?: RuntimeReplayOperation;
  runtimeReplayDue?: RuntimeReplayDueOperation;
  runChampionChallengerComparisonSweep?: ChampionChallengerSweepOperation;
  now?: Date;
}) {
  if (!adminToken || !scheduleToken || !tokenMatches(adminToken, scheduleToken)) {
    return Response.json({ success: false, error: "Model learning worker authorization failed." }, { status: 401 });
  }

  const weeklyRuntimeReplay = now.getUTCDay() === 1;
  const results: Array<{
    sport: LearningSport;
    result: CalibrationRunResult;
    runtimeReplay: BacktestRunStoreResult | null;
    runtimeReplayTrigger: "weekly" | "bootstrap" | "not-due";
    comparisonSweep: ChampionChallengerSweepResult;
    comparisons: ChampionChallengerStoreResult[];
  }> = [];
  for (const sport of sports) {
    const bootstrapRuntimeReplay = weeklyRuntimeReplay ? false : await runtimeReplayDue(sport, now);
    const runtimeReplayTrigger = weeklyRuntimeReplay ? "weekly" : bootstrapRuntimeReplay ? "bootstrap" : "not-due";
    const runtimeReplay = runtimeReplayTrigger === "not-due" ? null : await runRuntimeReplay(sport);
    const result = await runCalibration(sport);
    const comparisonSweep = await runChampionChallengerComparisonSweep({ sport, now });
    const comparisons: ChampionChallengerStoreResult[] = comparisonSweep.comparisons;
    results.push({ sport, runtimeReplay, runtimeReplayTrigger, result, comparisonSweep, comparisons });
  }
  const successfulCandidateStatuses = new Set(["stored", "reused", "skipped"]);
  const successfulComparisonStatuses = new Set(["stored", "reused", "not-applicable"]);
  const success = results.every(({ result, runtimeReplay, comparisonSweep, comparisons }) =>
    result.status === "stored" &&
    (result.candidates ?? []).every((candidate) => successfulCandidateStatuses.has(candidate.status)) &&
    comparisonSweep.status === "completed" &&
    comparisons.every((comparison) => successfulComparisonStatuses.has(comparison.status)) &&
    (!runtimeReplay || runtimeReplay.status === "stored")
  );
  const resultSummary = results.map(({ sport, result, runtimeReplay, runtimeReplayTrigger, comparisonSweep, comparisons }) => ({
    sport,
    calibration: {
      status: result.status,
      runId: result.id ?? null,
      candidateStatuses: result.candidates?.map((candidate) => candidate.status) ?? [],
      candidates: result.candidates?.map((candidate) => ({ status: candidate.status, reason: candidate.reason ?? null })) ?? [],
      reason: result.status === "stored" ? null : result.reason ?? null
    },
    runtimeReplay: {
      trigger: runtimeReplayTrigger,
      status: runtimeReplay?.status ?? "not-due",
      runId: runtimeReplay?.status === "stored" ? runtimeReplay.id : null,
      sampleSize: runtimeReplay?.result?.sampleSize ?? 0,
      brierScore: runtimeReplay?.result?.brierScore ?? null,
      logLoss: runtimeReplay?.result?.logLoss ?? null,
      reason: runtimeReplay && runtimeReplay.status !== "stored" ? runtimeReplay.reason : null
    },
    championChallenger: {
      sweepStatus: comparisonSweep.status,
      candidatesInspected: comparisonSweep.candidatesInspected,
      reason: comparisonSweep.reason ?? null,
      comparisons: comparisons.map((comparison) => ({
        status: comparison.status,
        receiptId: comparison.id ?? null,
        verdict: comparison.receipt?.status ?? null,
        eligibleForPromotion: comparison.receipt?.eligibleForPromotion ?? false,
        pairedSize: comparison.receipt?.sample.paired ?? 0,
        reason: comparison.reason ?? null
      }))
    }
  }));
  console.info(JSON.stringify({
    event: "oddspadi-model-learning-cycle",
    success,
    weeklyRuntimeReplay,
    bootstrapRuntimeReplay: results.some((result) => result.runtimeReplayTrigger === "bootstrap"),
    sports: resultSummary
  }));
  return Response.json({
    success,
    mode: "governed-model-learning-cycle",
    controls: {
      calibrationRunsStored: results.every(({ result }) => result.status === "stored"),
      candidateGeneration: true,
      championChallengerEvaluation: true,
      comparisonReceiptsStored: results.every(({ comparisonSweep, comparisons }) => comparisonSweep.status === "completed" && comparisons.every((comparison) => successfulComparisonStatuses.has(comparison.status))),
      weeklyRuntimeParityBacktests: weeklyRuntimeReplay,
      bootstrapRuntimeParityBacktests: results.some((result) => result.runtimeReplayTrigger === "bootstrap"),
      automaticLivePromotion: false,
      promotionRequirement: "A distinct model challenger must prove fresh paired Brier/log-loss superiority against the active sport champion before operator approval."
    },
    results: resultSummary
  }, { status: success ? 200 : 502 });
}

/**
 * Claims the same global sports-pipeline lock used by fixture/odds jobs before
 * calibration or runtime replay can write. This makes retries idempotent at the
 * scheduler boundary and leaves one durable operational receipt.
 */
export async function runSerializedModelLearningCycle({
  scheduleToken,
  adminToken,
  now = new Date(),
  claimRun = (startedAt) => startProviderRun({
    providerName: "oddspadi-model-governance",
    jobType: "model-learning",
    startedAt,
    sport: "multi"
  }),
  finishRun = (run, status, errors, finishedAt) => finishProviderRun(run, {
    status,
    finishedAt,
    fixturesFound: 0,
    oddsFound: 0,
    predictionsGenerated: 0,
    valuePicksPublished: 0,
    errors
  }),
  cycle = runModelLearningCycle
}: {
  scheduleToken: string | null;
  adminToken: string | null;
  now?: Date;
  claimRun?: ClaimLearningRun;
  finishRun?: FinishLearningRun;
  cycle?: typeof runModelLearningCycle;
}) {
  if (!adminToken || !scheduleToken || !tokenMatches(adminToken, scheduleToken)) {
    return Response.json({ success: false, error: "Model learning worker authorization failed." }, { status: 401 });
  }

  const claim = await claimRun(now.toISOString());
  if (!claim.acquired) {
    const unavailable = claim.run.status === "failed" || claim.run.status === "unavailable";
    return Response.json({ success: false, skippedOverlap: true, run: claim.run }, { status: unavailable ? 503 : 409 });
  }

  try {
    const cycleResponse = await cycle({ scheduleToken, adminToken, now });
    const payload = await cycleResponse.json() as {
      success?: boolean;
      results?: Array<{
        sport?: string;
        calibration?: { status?: string; reason?: string | null; candidates?: Array<{ status?: string; reason?: string | null }> };
        runtimeReplay?: { status?: string; reason?: string | null };
        championChallenger?: {
          sweepStatus?: string;
          reason?: string | null;
          comparisons?: Array<{ status?: string; reason?: string | null }>;
        };
      }>;
      [key: string]: unknown;
    };
    const errors = (payload.results ?? []).flatMap((result) => {
      const sport = result.sport ?? "unknown";
      const calibration = result.calibration?.status;
      const runtimeReplay = result.runtimeReplay?.status;
      const candidateErrors = (result.calibration?.candidates ?? [])
        .filter((candidate) => candidate.status && !["stored", "reused", "skipped"].includes(candidate.status))
        .map((candidate) => `${sport} calibration candidate: ${candidate.reason ?? candidate.status}`);
      const comparisonErrors = (result.championChallenger?.comparisons ?? [])
        .filter((comparison) => comparison.status && !["stored", "reused", "not-applicable"].includes(comparison.status))
        .map((comparison) => `${sport} champion-challenger: ${comparison.reason ?? comparison.status}`);
      const sweepError = result.championChallenger?.sweepStatus && result.championChallenger.sweepStatus !== "completed"
        ? `${sport} champion-challenger sweep: ${result.championChallenger.reason ?? result.championChallenger.sweepStatus}`
        : "";
      return [
        calibration && calibration !== "stored" ? `${sport} calibration: ${result.calibration?.reason ?? calibration}` : "",
        runtimeReplay && runtimeReplay !== "stored" && runtimeReplay !== "not-due"
          ? `${sport} runtime replay: ${result.runtimeReplay?.reason ?? runtimeReplay}`
          : "",
        ...candidateErrors,
        sweepError,
        ...comparisonErrors
      ].filter(Boolean);
    });
    const anyStored = (payload.results ?? []).some((result) =>
      result.calibration?.status === "stored" || result.runtimeReplay?.status === "stored"
    );
    const runStatus: ProviderRunStatus = cycleResponse.ok ? "completed" : anyStored ? "partial" : "failed";
    const run = await finishRun(claim.run, runStatus, errors, new Date().toISOString());
    return Response.json({ ...payload, run }, { status: cycleResponse.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model learning cycle failed unexpectedly.";
    const run = await finishRun(claim.run, "failed", [message], new Date().toISOString());
    return Response.json({ success: false, error: message, run }, { status: 500 });
  }
}

export default async function modelLearningWorker(request: Request, _context: Context) {
  return runSerializedModelLearningCycle({
    scheduleToken: request.headers.get("x-oddspadi-schedule-token"),
    adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN"))
  });
}
