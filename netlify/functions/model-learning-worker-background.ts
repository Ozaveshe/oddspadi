import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";
import { runAndStoreCalibration, type CalibrationRunResult } from "../../src/lib/sports/prediction/decisionCalibration";
import {
  runAndStoreFootballRuntimeReplay,
  runAndStoreHistoricalBacktest,
  type BacktestRunStoreResult
} from "../../src/lib/sports/training/trainingRepository";
import type { Sport } from "../../src/lib/sports/types";

declare const Netlify: { env: { get(name: string): string | undefined } };

type LearningSport = Extract<Sport, "football" | "basketball" | "tennis">;
type CalibrationOperation = (sport: LearningSport) => Promise<CalibrationRunResult>;
type RuntimeReplayOperation = (sport: LearningSport) => Promise<BacktestRunStoreResult>;

const clean = (value?: string | null) => value?.trim() || null;
const tokenMatches = (expected: string, supplied: string) => {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
};

export async function runModelLearningCycle({
  scheduleToken,
  adminToken,
  sports = ["football", "basketball", "tennis"],
  runCalibration = runAndStoreCalibration,
  runRuntimeReplay = async (sport) =>
    sport === "football"
      ? runAndStoreFootballRuntimeReplay({ minSample: 100, limit: 50_000 })
      : runAndStoreHistoricalBacktest({ sport, minSample: 30, limit: 50_000 }),
  now = new Date()
}: {
  scheduleToken: string | null;
  adminToken: string | null;
  sports?: LearningSport[];
  runCalibration?: CalibrationOperation;
  runRuntimeReplay?: RuntimeReplayOperation;
  now?: Date;
}) {
  if (!adminToken || !scheduleToken || !tokenMatches(adminToken, scheduleToken)) {
    return Response.json({ success: false, error: "Model learning worker authorization failed." }, { status: 401 });
  }

  const weeklyRuntimeReplay = now.getUTCDay() === 1;
  const results: Array<{ sport: LearningSport; result: CalibrationRunResult; runtimeReplay: BacktestRunStoreResult | null }> = [];
  for (const sport of sports) {
    const runtimeReplay = weeklyRuntimeReplay ? await runRuntimeReplay(sport) : null;
    results.push({ sport, runtimeReplay, result: await runCalibration(sport) });
  }
  const success = results.every(({ result, runtimeReplay }) => result.status === "stored" && (!runtimeReplay || runtimeReplay.status === "stored"));
  const resultSummary = results.map(({ sport, result, runtimeReplay }) => ({
    sport,
    calibration: {
      status: result.status,
      runId: result.id ?? null,
      candidateStatuses: result.candidates?.map((candidate) => candidate.status) ?? []
    },
    runtimeReplay: {
      status: runtimeReplay?.status ?? "not-due",
      runId: runtimeReplay?.status === "stored" ? runtimeReplay.id : null,
      sampleSize: runtimeReplay?.result?.sampleSize ?? 0,
      brierScore: runtimeReplay?.result?.brierScore ?? null,
      logLoss: runtimeReplay?.result?.logLoss ?? null,
      reason: runtimeReplay && runtimeReplay.status !== "stored" ? runtimeReplay.reason : null
    }
  }));
  console.info(JSON.stringify({
    event: "oddspadi-model-learning-cycle",
    success,
    weeklyRuntimeReplay,
    sports: resultSummary
  }));
  return Response.json({
    success,
    mode: "governed-model-learning-cycle",
    controls: {
      calibrationRunsStored: results.every(({ result }) => result.status === "stored"),
      candidateGeneration: true,
      weeklyRuntimeParityBacktests: weeklyRuntimeReplay,
      automaticLivePromotion: false,
      promotionRequirement: "A model-bound candidate must pass sample, Brier, log-loss, calibration, CLV, and operator approval gates."
    },
    results: resultSummary
  }, { status: success ? 200 : 502 });
}

export default async function modelLearningWorker(request: Request, _context: Context) {
  return runModelLearningCycle({
    scheduleToken: request.headers.get("x-oddspadi-schedule-token"),
    adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN"))
  });
}
