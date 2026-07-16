import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";
import { runAndStoreCalibration, type CalibrationRunResult } from "../../src/lib/sports/prediction/decisionCalibration";
import type { Sport } from "../../src/lib/sports/types";

declare const Netlify: { env: { get(name: string): string | undefined } };

type LearningSport = Extract<Sport, "football" | "basketball" | "tennis">;
type CalibrationOperation = (sport: LearningSport) => Promise<CalibrationRunResult>;

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
  runCalibration = runAndStoreCalibration
}: {
  scheduleToken: string | null;
  adminToken: string | null;
  sports?: LearningSport[];
  runCalibration?: CalibrationOperation;
}) {
  if (!adminToken || !scheduleToken || !tokenMatches(adminToken, scheduleToken)) {
    return Response.json({ success: false, error: "Model learning worker authorization failed." }, { status: 401 });
  }

  const results: Array<{ sport: LearningSport; result: CalibrationRunResult }> = [];
  for (const sport of sports) results.push({ sport, result: await runCalibration(sport) });
  const success = results.every(({ result }) => result.status === "stored");
  console.info(JSON.stringify({
    event: "oddspadi-model-learning-cycle",
    success,
    sports: results.map(({ sport, result }) => ({ sport, status: result.status, runId: result.id ?? null, candidateStatuses: result.candidates?.map((candidate) => candidate.status) ?? [] }))
  }));
  return Response.json({
    success,
    mode: "governed-model-learning-cycle",
    controls: {
      calibrationRunsStored: true,
      candidateGeneration: true,
      automaticLivePromotion: false,
      promotionRequirement: "A model-bound candidate must pass sample, Brier, log-loss, calibration, CLV, and operator approval gates."
    },
    results
  }, { status: success ? 200 : 502 });
}

export default async function modelLearningWorker(request: Request, _context: Context) {
  return runModelLearningCycle({
    scheduleToken: request.headers.get("x-oddspadi-schedule-token"),
    adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN"))
  });
}
