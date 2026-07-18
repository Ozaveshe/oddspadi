import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { MultiSportCorpusPlan, TrainingCorpusSport } from "@/lib/sports/training/multiSportCorpusPlan";
import { inspectRuntimeBacktestEvidence } from "@/lib/sports/training/runtimeBacktestEvidence";
import {
  historicalBacktestExecutionModelKey,
  runAndStoreHistoricalBacktest,
  type BacktestRunStoreResult,
  type TrainingDataSnapshot
} from "@/lib/sports/training/trainingRepository";

export type MultiSportBacktestRunStatus = "preview" | "ready-to-run" | "admin-required" | "stored" | "no-data" | "blocked-storage" | "failed";
export type MultiSportBacktestJobStatus =
  | "preview"
  | "ready"
  | "waiting-data"
  | "storage-blocked"
  | "admin-required"
  | "stored"
  | "no-data"
  | "not-configured"
  | "failed";

type BacktestRunner = (input: {
  sport: TrainingCorpusSport;
  minSample: number;
  limit: number;
  includeDemo: boolean;
}) => Promise<BacktestRunStoreResult>;

export type MultiSportBacktestJob = {
  sport: TrainingCorpusSport;
  status: MultiSportBacktestJobStatus;
  modelKey: string;
  selected: boolean;
  runAttempted: boolean;
  storageStatus: NonNullable<TrainingDataSnapshot["storage"]>["status"] | "unknown";
  storedFixtures: number;
  realFinishedFixtures: number;
  realOddsSnapshots: number;
  backtestRuns: number;
  latestBacktest: {
    id: string;
    modelKey: string;
    status: string;
    dataSource: string;
    sampleSize: number;
    brierScore: number | null;
    logLoss: number | null;
    calibrationError: number | null;
    createdAt: string;
    compatibility: string;
    exactRuntimeParity: boolean;
    realDataOnly: boolean;
  } | null;
  minSample: number;
  limit: number;
  includeDemo: boolean;
  command: string;
  result: {
    status: BacktestRunStoreResult["status"] | "not-run";
    id: string | null;
    sampleSize: number;
    pickCount: number;
    brierScore: number | null;
    logLoss: number | null;
    yield: number | null;
    calibrationError: number | null;
    selectionPolicyStatus: "active" | "abstain" | null;
    allowedConfidenceBands: string[];
    baselinePickCount: number | null;
    baselineYield: number | null;
    probabilityCalibrationPolicyStatus: "active" | "identity" | null;
    probabilityTemperature: number | null;
    baselineHoldoutLogLoss: number | null;
    calibratedHoldoutLogLoss: number | null;
    holdoutLogLossDelta: number | null;
    marketPriorScalingPolicyStatus: "active" | "identity" | null;
    marketPriorWeightScale: number | null;
    marketPriorCandidateWeightScale: number | null;
    marketPriorScalingFitSampleSize: number | null;
    marketPriorScalingValidationSampleSize: number | null;
    marketPriorScalingValidationBrierDelta: number | null;
    marketPriorScalingValidationLogLossDelta: number | null;
    empiricalValueGuardStatus: "active" | "abstain" | null;
    empiricalValueGuardSampleSize: number | null;
    empiricalValueGuardEligibleBuckets: number | null;
    empiricalValueGuardMinimumRegimeSample: number | null;
    empiricalValueGuardEarlierSampleSize: number | null;
    empiricalValueGuardRecentSampleSize: number | null;
    empiricalValueGuardLargestRateDrift: number | null;
    empiricalValueGuardBaselinePickCount: number | null;
    empiricalValueGuardSelectedPickCount: number | null;
    empiricalValueGuardPicksRemoved: number | null;
    segmentValueGuardStatus: "active" | "abstain" | null;
    segmentValueGuardDimension: "competition" | "surface" | null;
    segmentValueGuardEligibleSegments: number | null;
    segmentValueGuardUnresolvedSampleSize: number | null;
    segmentValueGuardLargestRateDrift: number | null;
    segmentValueGuardBaselinePickCount: number | null;
    segmentValueGuardSelectedPickCount: number | null;
    segmentValueGuardPicksRemoved: number | null;
    marketPriorStatus: "applied" | "no-priced-market" | null;
    marketPriorAdjustedFixtures: number | null;
    marketPriorCoverage: number | null;
    marketPriorAverageWeight: number | null;
    finalPosteriorHoldoutLogLoss: number | null;
    finalPosteriorLogLossDelta: number | null;
    reason: string | null;
  };
  nextAction: string;
};

export type MultiSportBacktestRun = {
  mode: "multi-sport-backtest-run";
  generatedAt: string;
  status: MultiSportBacktestRunStatus;
  runHash: string;
  summary: string;
  runRequested: boolean;
  adminAuthorized: boolean;
  selectedSports: TrainingCorpusSport[];
  options: {
    minSample: number;
    limit: number;
    includeDemo: boolean;
  };
  totals: {
    jobs: number;
    selected: number;
    ready: number;
    attempted: number;
    stored: number;
    noData: number;
    failed: number;
    blockedStorage: number;
  };
  jobs: MultiSportBacktestJob[];
  controls: {
    canInspectReadOnly: true;
    canRunBacktests: boolean;
    requiresAdminToken: true;
    canStoreBacktestRows: boolean;
    canPersistTrainingRows: false;
    canApplyLearnedWeights: false;
    canPromoteLiveProbabilities: false;
    canPublishPicks: false;
    canStake: false;
  };
  proofUrls: string[];
  locks: string[];
};

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function resultSummary(result: BacktestRunStoreResult | null): MultiSportBacktestJob["result"] {
  if (!result) {
    return {
      status: "not-run",
      id: null,
      sampleSize: 0,
      pickCount: 0,
      brierScore: null,
      logLoss: null,
      yield: null,
      calibrationError: null,
      selectionPolicyStatus: null,
      allowedConfidenceBands: [],
      baselinePickCount: null,
      baselineYield: null,
      probabilityCalibrationPolicyStatus: null,
      probabilityTemperature: null,
      baselineHoldoutLogLoss: null,
      calibratedHoldoutLogLoss: null,
      holdoutLogLossDelta: null,
      marketPriorScalingPolicyStatus: null,
      marketPriorWeightScale: null,
      marketPriorCandidateWeightScale: null,
      marketPriorScalingFitSampleSize: null,
      marketPriorScalingValidationSampleSize: null,
      marketPriorScalingValidationBrierDelta: null,
      marketPriorScalingValidationLogLossDelta: null,
      empiricalValueGuardStatus: null,
      empiricalValueGuardSampleSize: null,
      empiricalValueGuardEligibleBuckets: null,
      empiricalValueGuardMinimumRegimeSample: null,
      empiricalValueGuardEarlierSampleSize: null,
      empiricalValueGuardRecentSampleSize: null,
      empiricalValueGuardLargestRateDrift: null,
      empiricalValueGuardBaselinePickCount: null,
      empiricalValueGuardSelectedPickCount: null,
      empiricalValueGuardPicksRemoved: null,
      segmentValueGuardStatus: null,
      segmentValueGuardDimension: null,
      segmentValueGuardEligibleSegments: null,
      segmentValueGuardUnresolvedSampleSize: null,
      segmentValueGuardLargestRateDrift: null,
      segmentValueGuardBaselinePickCount: null,
      segmentValueGuardSelectedPickCount: null,
      segmentValueGuardPicksRemoved: null,
      marketPriorStatus: null,
      marketPriorAdjustedFixtures: null,
      marketPriorCoverage: null,
      marketPriorAverageWeight: null,
      finalPosteriorHoldoutLogLoss: null,
      finalPosteriorLogLossDelta: null,
      reason: null
    };
  }

  const runtimeResult = result.result && "selectionPolicy" in result.result ? result.result : null;
  const marketPolicy = runtimeResult?.marketPriorScalingPolicy ?? null;
  const marketValidationBrierDelta = marketPolicy && marketPolicy.baselineValidation.brierScore !== null && marketPolicy.candidateValidation.brierScore !== null
    ? marketPolicy.candidateValidation.brierScore - marketPolicy.baselineValidation.brierScore
    : null;
  const marketValidationLogLossDelta = marketPolicy && marketPolicy.baselineValidation.logLoss !== null && marketPolicy.candidateValidation.logLoss !== null
    ? marketPolicy.candidateValidation.logLoss - marketPolicy.baselineValidation.logLoss
    : null;
  const eligibleValueGuardBuckets = runtimeResult?.empiricalValueGuardPolicy.buckets.filter((bucket) => bucket.eligible) ?? [];
  const largestValueGuardRateDrift = eligibleValueGuardBuckets.length
    ? Math.max(...eligibleValueGuardBuckets.map((bucket) => Math.abs(
        (bucket.recent.observedRate ?? 0) - (bucket.earlier.observedRate ?? 0)
      )))
    : null;
  const eligibleSegments = runtimeResult?.segmentValueGuardPolicy.segments.filter((segment) =>
    segment.buckets.some((bucket) => bucket.eligible)
  ) ?? [];
  const eligibleSegmentBuckets = eligibleSegments.flatMap((segment) => segment.buckets.filter((bucket) => bucket.eligible));
  const largestSegmentRateDrift = eligibleSegmentBuckets.length
    ? Math.max(...eligibleSegmentBuckets.map((bucket) => Math.abs(
        (bucket.recent.observedRate ?? 0) - (bucket.earlier.observedRate ?? 0)
      )))
    : null;
  return {
    status: result.status,
    id: result.status === "stored" ? result.id : null,
    sampleSize: result.result?.sampleSize ?? 0,
    pickCount: result.result?.pickCount ?? 0,
    brierScore: result.result?.brierScore ?? null,
    logLoss: result.result?.logLoss ?? null,
    yield: result.result?.yield ?? null,
    calibrationError: result.result?.calibrationError ?? null,
    selectionPolicyStatus: runtimeResult?.selectionPolicy.status ?? null,
    allowedConfidenceBands: runtimeResult?.selectionPolicy.allowedConfidenceBands ?? [],
    baselinePickCount: runtimeResult?.economicSelectionComparison.baseline.pickCount ?? null,
    baselineYield: runtimeResult?.economicSelectionComparison.baseline.yield ?? null,
    probabilityCalibrationPolicyStatus: runtimeResult?.probabilityCalibrationPolicy.status ?? null,
    probabilityTemperature: runtimeResult?.probabilityCalibrationPolicy.temperature ?? null,
    baselineHoldoutLogLoss: runtimeResult?.probabilityCalibrationComparison.baseline.logLoss ?? null,
    calibratedHoldoutLogLoss: runtimeResult?.probabilityCalibrationComparison.calibrated.logLoss ?? null,
    holdoutLogLossDelta: runtimeResult?.probabilityCalibrationComparison.logLossDelta ?? null,
    marketPriorScalingPolicyStatus: marketPolicy?.status ?? null,
    marketPriorWeightScale: marketPolicy?.weightScale ?? null,
    marketPriorCandidateWeightScale: marketPolicy?.candidateWeightScale ?? null,
    marketPriorScalingFitSampleSize: marketPolicy?.fitSampleSize ?? null,
    marketPriorScalingValidationSampleSize: marketPolicy?.validationSampleSize ?? null,
    marketPriorScalingValidationBrierDelta: marketValidationBrierDelta,
    marketPriorScalingValidationLogLossDelta: marketValidationLogLossDelta,
    empiricalValueGuardStatus: runtimeResult?.empiricalValueGuardPolicy.status ?? null,
    empiricalValueGuardSampleSize: runtimeResult?.empiricalValueGuardPolicy.sampleSize ?? null,
    empiricalValueGuardEligibleBuckets: runtimeResult
      ? runtimeResult.empiricalValueGuardPolicy.buckets.filter((bucket) => bucket.eligible).length
      : null,
    empiricalValueGuardMinimumRegimeSample: runtimeResult?.empiricalValueGuardPolicy.minimumRegimeSample ?? null,
    empiricalValueGuardEarlierSampleSize: runtimeResult?.empiricalValueGuardPolicy.earlierWindow.sampleSize ?? null,
    empiricalValueGuardRecentSampleSize: runtimeResult?.empiricalValueGuardPolicy.recentWindow.sampleSize ?? null,
    empiricalValueGuardLargestRateDrift: largestValueGuardRateDrift,
    empiricalValueGuardBaselinePickCount: runtimeResult?.empiricalValueGuardComparison.baseline.pickCount ?? null,
    empiricalValueGuardSelectedPickCount: runtimeResult?.empiricalValueGuardComparison.selected.pickCount ?? null,
    empiricalValueGuardPicksRemoved: runtimeResult?.empiricalValueGuardComparison.picksRemoved ?? null,
    segmentValueGuardStatus: runtimeResult?.segmentValueGuardPolicy.status ?? null,
    segmentValueGuardDimension: runtimeResult?.segmentValueGuardPolicy.segmentDimension ?? null,
    segmentValueGuardEligibleSegments: runtimeResult ? eligibleSegments.length : null,
    segmentValueGuardUnresolvedSampleSize: runtimeResult?.segmentValueGuardPolicy.unresolvedSampleSize ?? null,
    segmentValueGuardLargestRateDrift: largestSegmentRateDrift,
    segmentValueGuardBaselinePickCount: runtimeResult?.segmentValueGuardComparison.baseline.pickCount ?? null,
    segmentValueGuardSelectedPickCount: runtimeResult?.segmentValueGuardComparison.selected.pickCount ?? null,
    segmentValueGuardPicksRemoved: runtimeResult?.segmentValueGuardComparison.picksRemoved ?? null,
    marketPriorStatus: runtimeResult?.marketPriorEvidence.status ?? null,
    marketPriorAdjustedFixtures: runtimeResult?.marketPriorEvidence.adjustedFixtures ?? null,
    marketPriorCoverage: runtimeResult?.marketPriorEvidence.coverage ?? null,
    marketPriorAverageWeight: runtimeResult?.marketPriorEvidence.averageWeight ?? null,
    finalPosteriorHoldoutLogLoss: runtimeResult?.marketPriorEvidence.probabilityComparison.calibrated.logLoss ?? null,
    finalPosteriorLogLossDelta: runtimeResult?.marketPriorEvidence.probabilityComparison.logLossDelta ?? null,
    reason: result.status === "stored" ? null : result.reason
  };
}

function hasPartialShadowBacktestEvidence(snapshot: TrainingDataSnapshot, minSample: number, includeDemo: boolean): boolean {
  const fixtureCount = includeDemo ? snapshot.counts.finishedFixtures : snapshot.counts.realFinishedFixtures;
  const oddsCount = includeDemo ? snapshot.counts.oddsSnapshots : snapshot.counts.realOddsSnapshots;
  return (
    snapshot.status === "ready" &&
    snapshot.storage?.status === "ready" &&
    fixtureCount >= minSample &&
    oddsCount > 0 &&
    snapshot.counts.featureSnapshots > 0
  );
}

function commandFor(sport: TrainingCorpusSport, minSample: number, limit: number, includeDemo: boolean): string {
  const query = new URLSearchParams();
  query.set("sport", sport);
  query.set("run", "1");
  query.set("minSample", String(minSample));
  query.set("limit", String(limit));
  if (includeDemo) query.set("includeDemo", "1");
  return `${decisionCurlCommand(`/api/sports/decision/training/multi-sport-backtest-run?${query.toString()}`)} -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`;
}

function initialStatus({
  runRequested,
  adminAuthorized,
  selected,
  snapshot,
  minSample,
  includeDemo
}: {
  runRequested: boolean;
  adminAuthorized: boolean;
  selected: boolean;
  snapshot: TrainingDataSnapshot;
  minSample: number;
  includeDemo: boolean;
}): MultiSportBacktestJobStatus {
  if (snapshot.status !== "ready" || snapshot.storage?.status !== "ready") return "storage-blocked";
  if (!snapshot.controls?.canRunBacktest && !hasPartialShadowBacktestEvidence(snapshot, minSample, includeDemo)) return "waiting-data";
  if (!runRequested || !selected) return "ready";
  if (!adminAuthorized) return "admin-required";
  return "preview";
}

function statusFromResult(result: BacktestRunStoreResult): MultiSportBacktestJobStatus {
  if (result.status === "stored") return "stored";
  if (result.status === "no-data") return "no-data";
  if (result.status === "not-configured") return "not-configured";
  return "failed";
}

function nextActionFor(job: Pick<MultiSportBacktestJob, "status" | "sport" | "result">): string {
  if (job.status === "stored") return "Review the stored backtest through model governance before any shadow comparison.";
  if (job.status === "no-data") return `Backfill more real ${job.sport} fixtures, odds, and feature rows, then rerun the backtest.`;
  if (job.status === "failed") return job.result.reason ?? "Inspect the backtest failure and storage logs before retrying.";
  if (job.status === "not-configured" || job.status === "storage-blocked") return "Fix OddsPadi Supabase server credential/schema proof before running stored backtests.";
  if (job.status === "admin-required") return "Rerun with x-oddspadi-admin-token after confirming this should store a backtest row.";
  if (job.status === "waiting-data") return `Store enough real finished ${job.sport} fixtures and odds before running the model backtest.`;
  return "Run this job only after provider and storage proof are ready.";
}

function overallStatus(runRequested: boolean, adminAuthorized: boolean, jobs: MultiSportBacktestJob[]): MultiSportBacktestRunStatus {
  if (runRequested && !adminAuthorized) return "admin-required";
  if (jobs.some((job) => job.status === "stored")) return "stored";
  if (jobs.some((job) => job.status === "failed")) return "failed";
  if (jobs.some((job) => job.status === "no-data")) return "no-data";
  if (jobs.every((job) => job.status === "storage-blocked" || job.status === "not-configured")) return "blocked-storage";
  if (jobs.some((job) => job.status === "ready")) return runRequested ? "ready-to-run" : "preview";
  return "preview";
}

function summaryFor(status: MultiSportBacktestRunStatus): string {
  if (status === "stored") return "At least one sport produced a stored historical backtest row; promotion remains locked until governance reviews it.";
  if (status === "no-data") return "The runner executed but needs more stored fixtures, odds, or feature rows before a valid backtest can be stored.";
  if (status === "admin-required") return "Multi-sport backtest execution needs the OddsPadi admin token because it can write op_backtest_runs.";
  if (status === "blocked-storage") return "Multi-sport backtest execution is blocked by Supabase storage or credential proof.";
  if (status === "failed") return "At least one selected backtest failed before a valid stored result was produced.";
  if (status === "ready-to-run") return "Backtest jobs are ready to run through the admin-gated POST route.";
  return "Multi-sport backtest execution is in read-only preview mode.";
}

export async function buildMultiSportBacktestRun({
  corpusPlan,
  trainingSnapshots,
  selectedSports,
  runRequested = false,
  adminAuthorized = false,
  minSample = 30,
  limit = 5000,
  includeDemo = false,
  now = new Date(),
  runner = runAndStoreHistoricalBacktest
}: {
  corpusPlan: MultiSportCorpusPlan;
  trainingSnapshots: TrainingDataSnapshot[];
  selectedSports?: TrainingCorpusSport[];
  runRequested?: boolean;
  adminAuthorized?: boolean;
  minSample?: number;
  limit?: number;
  includeDemo?: boolean;
  now?: Date;
  runner?: BacktestRunner;
}): Promise<MultiSportBacktestRun> {
  const snapshotBySport = new Map(trainingSnapshots.map((snapshot) => [snapshot.sport, snapshot]));
  const selected = selectedSports?.length ? selectedSports : corpusPlan.sports.map((plan) => plan.sport);
  const selectedSet = new Set(selected);

  const jobs: MultiSportBacktestJob[] = [];
  for (const sportPlan of corpusPlan.sports) {
    const snapshot = snapshotBySport.get(sportPlan.sport);
    if (!snapshot) continue;
    const isSelected = selectedSet.has(sportPlan.sport);
    const canAttemptShadowBacktest = Boolean(snapshot.controls?.canRunBacktest) || hasPartialShadowBacktestEvidence(snapshot, minSample, includeDemo);
    const shouldAttempt = runRequested && adminAuthorized && isSelected && snapshot.status === "ready" && snapshot.storage?.status === "ready" && canAttemptShadowBacktest;
    const result = shouldAttempt ? await runner({ sport: sportPlan.sport, minSample, limit, includeDemo }) : null;
    const baseStatus = initialStatus({ runRequested, adminAuthorized, selected: isSelected, snapshot, minSample, includeDemo });
    const status = result ? statusFromResult(result) : baseStatus;
    const resultInfo = resultSummary(result);
    const latestEvidence = inspectRuntimeBacktestEvidence(sportPlan.sport, snapshot.latestBacktest);
    const job: MultiSportBacktestJob = {
      sport: sportPlan.sport,
      status,
      modelKey: historicalBacktestExecutionModelKey(sportPlan.sport),
      selected: isSelected,
      runAttempted: Boolean(result),
      storageStatus: snapshot.storage?.status ?? "unknown",
      storedFixtures: snapshot.counts.fixtures,
      realFinishedFixtures: snapshot.counts.realFinishedFixtures,
      realOddsSnapshots: snapshot.counts.realOddsSnapshots,
      backtestRuns: snapshot.counts.backtestRuns,
      latestBacktest: snapshot.latestBacktest
        ? {
            id: snapshot.latestBacktest.id,
            modelKey: snapshot.latestBacktest.modelKey,
            status: snapshot.latestBacktest.status,
            dataSource: snapshot.latestBacktest.dataSource,
            sampleSize: snapshot.latestBacktest.sampleSize,
            brierScore: snapshot.latestBacktest.brierScore,
            logLoss: snapshot.latestBacktest.logLoss,
            calibrationError: snapshot.latestBacktest.calibrationError,
            createdAt: snapshot.latestBacktest.createdAt,
            compatibility: latestEvidence.compatibility,
            exactRuntimeParity: latestEvidence.exactRuntimeParity,
            realDataOnly: latestEvidence.realDataOnly
          }
        : null,
      minSample,
      limit,
      includeDemo,
      command: commandFor(sportPlan.sport, minSample, limit, includeDemo),
      result: resultInfo,
      nextAction: ""
    };
    job.nextAction = nextActionFor(job);
    jobs.push(job);
  }

  const status = overallStatus(runRequested, adminAuthorized, jobs);
  const totals = {
    jobs: jobs.length,
    selected: jobs.filter((job) => job.selected).length,
    ready: jobs.filter((job) => job.status === "ready").length,
    attempted: jobs.filter((job) => job.runAttempted).length,
    stored: jobs.filter((job) => job.status === "stored").length,
    noData: jobs.filter((job) => job.status === "no-data").length,
    failed: jobs.filter((job) => job.status === "failed").length,
    blockedStorage: jobs.filter((job) => job.status === "storage-blocked" || job.status === "not-configured").length
  };

  return {
    mode: "multi-sport-backtest-run",
    generatedAt: now.toISOString(),
    status,
    runHash: stableHash({
      status,
      runRequested,
      adminAuthorized,
      options: [minSample, limit, includeDemo],
      jobs: jobs.map((job) => [job.sport, job.status, job.result.status, job.result.sampleSize, job.result.calibrationError])
    }),
    summary: summaryFor(status),
    runRequested,
    adminAuthorized,
    selectedSports: selected,
    options: {
      minSample,
      limit,
      includeDemo
    },
    totals,
    jobs,
    controls: {
      canInspectReadOnly: true,
      canRunBacktests: jobs.some((job) => job.status === "ready") || jobs.some((job) => job.status === "admin-required"),
      requiresAdminToken: true,
      canStoreBacktestRows: runRequested && adminAuthorized,
      canPersistTrainingRows: false,
      canApplyLearnedWeights: false,
      canPromoteLiveProbabilities: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: unique([
      "/api/sports/decision/training/multi-sport-backtest-run",
      "/api/sports/decision/training",
      "/api/sports/decision/training/multi-sport-model-governance",
      "/api/sports/decision/training/readiness",
      ...corpusPlan.proofUrls
    ]),
    locks: [
      "This runner can only create stored backtest rows through server-side training storage after admin authorization.",
      "Stored backtests remain evidence for governance; they do not apply learned weights, promote live probabilities, publish picks, or stake.",
      "GET is read-only preview; POST requires x-oddspadi-admin-token before any run can be attempted.",
      "Demo rows can be included only when includeDemo=1 is explicit and still cannot unlock public authority."
    ]
  };
}
