import type { DecisionFeatureMatrix, DecisionFeatureStatus } from "@/lib/sports/prediction/decisionFeatureMatrix";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import { inspectRuntimeBacktestEvidence } from "@/lib/sports/training/runtimeBacktestEvidence";
import type { Sport } from "@/lib/sports/types";

export type DecisionModelGovernanceStatus = "approved" | "shadow" | "blocked";
export type DecisionModelGovernanceCheckStatus = "pass" | "warn" | "fail";
export type DecisionModelGovernanceCheckCategory = "corpus" | "features" | "targets" | "calibration" | "drift" | "runtime";

export type DecisionModelGovernanceCheck = {
  id: string;
  category: DecisionModelGovernanceCheckCategory;
  label: string;
  status: DecisionModelGovernanceCheckStatus;
  score: number;
  detail: string;
  requiredAction: string | null;
};

export type DecisionModelGovernanceFeatureDrift = {
  key: string;
  status: DecisionModelGovernanceCheckStatus;
  liveCoverage: number;
  trainingCoverage: number | null;
  driftScore: number | null;
  detail: string;
};

export type DecisionModelGovernance = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionModelGovernanceStatus;
  summary: string;
  trustScore: number;
  learnedGuardrailsAllowed: boolean;
  publishWithLearnedWeightsAllowed: boolean;
  shadowModeRequired: boolean;
  checks: DecisionModelGovernanceCheck[];
  failingChecks: number;
  warningChecks: number;
  featureDrift: DecisionModelGovernanceFeatureDrift[];
  sourceMix: Record<DecisionFeatureStatus, number>;
  liveFeatureCoverage: {
    rows: number;
    keys: number;
    averageCompletenessScore: number;
    averageTrainingReadyScore: number;
    mockFeatureRatio: number;
    missingFeatureRatio: number;
  };
  trainingCorpus: {
    status: TrainingDataSnapshot["status"];
    configured: boolean;
    realFinishedFixtures: number;
    realOddsSnapshots: number;
    featureSnapshots: number;
    backtestRuns: number;
    latestBacktestId: string | null;
    minimumRecommendedFixtures: number;
  };
  nextActions: string[];
};

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function pct(part: number, total: number): number {
  return total > 0 ? round((part / total) * 100, 1) : 0;
}

function check(input: DecisionModelGovernanceCheck): DecisionModelGovernanceCheck {
  return input;
}

function statusFromScore(score: number, hardFail = false): DecisionModelGovernanceCheckStatus {
  if (hardFail || score < 45) return "fail";
  if (score < 75) return "warn";
  return "pass";
}

function sourceMix(matrix: DecisionFeatureMatrix): Record<DecisionFeatureStatus, number> {
  return matrix.rows
    .flatMap((row) => row.features)
    .reduce(
      (acc, feature) => {
        acc[feature.status] += 1;
        return acc;
      },
      { "provider-backed": 0, computed: 0, mock: 0, missing: 0 } as Record<DecisionFeatureStatus, number>
    );
}

function buildChecks(matrix: DecisionFeatureMatrix, training: TrainingDataSnapshot): DecisionModelGovernanceCheck[] {
  const minimum = training.readiness.minimumRecommendedFixtures;
  const fixtureScore = Math.min(100, pct(training.counts.realFinishedFixtures, minimum));
  const oddsScore = Math.min(100, pct(training.counts.realOddsSnapshots, Math.max(1, training.counts.realFinishedFixtures * 2)));
  const featureSnapshotScore = Math.min(100, pct(training.counts.featureSnapshots, Math.max(1, training.counts.realFinishedFixtures)));
  const runtimeBacktest = inspectRuntimeBacktestEvidence(training.sport, training.latestBacktest);
  const backtestScore = runtimeBacktest.exactRuntimeParity ? 100 : runtimeBacktest.completed ? 35 : training.counts.backtestRuns > 0 ? 20 : 0;
  const liveFeatureScore = matrix.coverage.averageTrainingReadyScore;
  const missingRatio = pct(matrix.coverage.missingFeatures, matrix.coverage.totalFeatures);
  const mockRatio = pct(matrix.coverage.mockFeatures, matrix.coverage.totalFeatures);
  const provenanceScore = Math.max(0, 100 - mockRatio * 1.2 - missingRatio * 1.6);
  const liveTargetLabelsAvailable = matrix.rows.some((row) => row.target.result !== null || row.target.closingOddsAvailable);
  const historicalTargetLabelsReady =
    training.counts.realFinishedFixtures >= minimum &&
    training.counts.realOddsSnapshots > 0 &&
    training.latestBacktest?.status === "completed";
  const targetScore = historicalTargetLabelsReady ? 100 : liveTargetLabelsAvailable ? 72 : 0;
  const runtimeScore = training.configured && training.status === "ready" ? 100 : training.status === "failed" ? 0 : 28;

  return [
    check({
      id: "real-fixture-volume",
      category: "corpus",
      label: "Real fixture volume",
      status: statusFromScore(fixtureScore, training.counts.realFinishedFixtures < minimum),
      score: fixtureScore,
      detail: `${training.counts.realFinishedFixtures}/${minimum} real finished fixtures are available for training.`,
      requiredAction:
        training.counts.realFinishedFixtures >= minimum
          ? null
          : "Backfill real finished fixtures across the target leagues and seasons before enabling learned guardrails."
    }),
    check({
      id: "real-odds-volume",
      category: "corpus",
      label: "Real odds volume",
      status: statusFromScore(oddsScore, training.counts.realOddsSnapshots === 0),
      score: oddsScore,
      detail: `${training.counts.realOddsSnapshots} real odds snapshots are available.`,
      requiredAction: training.counts.realOddsSnapshots ? null : "Import opening/closing bookmaker odds snapshots for the historical fixtures."
    }),
    check({
      id: "feature-snapshot-volume",
      category: "features",
      label: "Historical feature snapshots",
      status: statusFromScore(featureSnapshotScore, training.counts.featureSnapshots === 0),
      score: featureSnapshotScore,
      detail: `${training.counts.featureSnapshots} historical feature snapshots are available.`,
      requiredAction: training.counts.featureSnapshots ? null : "Generate feature snapshots from provider-backed fixtures, teams, odds, and context."
    }),
    check({
      id: "live-feature-provenance",
      category: "features",
      label: "Live feature provenance",
      status: statusFromScore(provenanceScore, matrix.coverage.mockFeatures > matrix.coverage.computedFeatures + matrix.coverage.providerBackedFeatures),
      score: round(provenanceScore, 1),
      detail: `Live matrix has ${matrix.coverage.mockFeatures} mock and ${matrix.coverage.missingFeatures} missing feature values across ${matrix.coverage.totalFeatures} total feature slots.`,
      requiredAction:
        matrix.coverage.mockFeatures || matrix.coverage.missingFeatures
          ? "Replace mock/missing live features with provider-backed or historically computed values before trusting training parity."
          : null
    }),
    check({
      id: "live-training-ready-score",
      category: "features",
      label: "Live training-ready feature score",
      status: statusFromScore(liveFeatureScore, liveFeatureScore < 45),
      score: liveFeatureScore,
      detail: `Average live feature training-readiness is ${matrix.coverage.averageTrainingReadyScore}%.`,
      requiredAction: liveFeatureScore >= 75 ? null : "Improve live feature provenance and missing context before applying learned model thresholds."
    }),
    check({
      id: "target-label-availability",
      category: "targets",
      label: "Target labels",
      status: statusFromScore(targetScore, !historicalTargetLabelsReady && !liveTargetLabelsAvailable),
      score: targetScore,
      detail: historicalTargetLabelsReady
        ? `${training.counts.realFinishedFixtures} historical result labels, ${training.counts.realOddsSnapshots} odds labels, and completed backtest evidence are available.`
        : liveTargetLabelsAvailable
          ? "Some live slate rows carry settled result or closing-odds labels, but historical target proof is still incomplete."
          : "No historical backtest labels or live settled labels are available for this sport.",
      requiredAction: historicalTargetLabelsReady
        ? null
        : "Persist predictions and settle outcomes after matches finish so training rows can be labeled."
    }),
    check({
      id: "backtest-calibration",
      category: "calibration",
      label: "Runtime-parity held-out backtest",
      status: statusFromScore(backtestScore, !runtimeBacktest.exactRuntimeParity),
      score: backtestScore,
      detail: training.latestBacktest
        ? `Latest backtest ${training.latestBacktest.id} is ${training.latestBacktest.status} with sample size ${training.latestBacktest.sampleSize}; runtime compatibility is ${runtimeBacktest.compatibility}.`
        : "No runtime-parity real-data backtest is available.",
      requiredAction: runtimeBacktest.exactRuntimeParity
        ? null
        : "Replay the chronological holdout through the current runtime entrypoint and store its feature-contract receipt."
    }),
    check({
      id: "runtime-storage",
      category: "runtime",
      label: "Runtime training storage",
      status: statusFromScore(runtimeScore, !training.configured || training.status === "failed"),
      score: runtimeScore,
      detail: training.reason ?? training.readiness.detail,
      requiredAction: training.configured && training.status === "ready" ? null : "Fix Supabase service credentials and schema access before write-mode training."
    })
  ];
}

function buildFeatureDrift(matrix: DecisionFeatureMatrix, training: TrainingDataSnapshot): DecisionModelGovernanceFeatureDrift[] {
  const trainingCoverage =
    training.counts.realFinishedFixtures > 0 ? Math.min(100, pct(training.counts.featureSnapshots, training.counts.realFinishedFixtures)) : null;

  return matrix.featureKeys.slice(0, 12).map((key) => {
    const rowCount = matrix.rows.length;
    const present = matrix.rows.filter((row) => row.featureVector[key] !== null).length;
    const liveCoverage = pct(present, rowCount);
    const driftScore = trainingCoverage === null ? null : round(Math.abs(liveCoverage - trainingCoverage), 1);
    const status: DecisionModelGovernanceCheckStatus =
      trainingCoverage === null || driftScore === null ? "fail" : driftScore <= 15 ? "pass" : driftScore <= 35 ? "warn" : "fail";
    return {
      key,
      status,
      liveCoverage,
      trainingCoverage,
      driftScore,
      detail:
        trainingCoverage === null
          ? "Historical feature coverage is unavailable, so drift cannot be measured."
          : `Live coverage is ${liveCoverage}% vs historical feature coverage ${trainingCoverage}%.`
    };
  });
}

function trustScore(checks: DecisionModelGovernanceCheck[]): number {
  if (!checks.length) return 0;
  return round(checks.reduce((sum, item) => sum + item.score, 0) / checks.length, 1);
}

function governanceStatus(checks: DecisionModelGovernanceCheck[], score: number): DecisionModelGovernanceStatus {
  if (checks.some((item) => item.status === "fail" && (item.category === "corpus" || item.category === "targets" || item.category === "runtime"))) {
    return "blocked";
  }
  if (score >= 82 && checks.every((item) => item.status !== "fail")) return "approved";
  return "shadow";
}

function nextActions(checks: DecisionModelGovernanceCheck[]): string[] {
  return checks
    .filter((item) => item.requiredAction)
    .sort((a, b) => {
      const rank = { fail: 2, warn: 1, pass: 0 };
      return rank[b.status] - rank[a.status] || a.score - b.score;
    })
    .map((item) => `${item.label}: ${item.requiredAction}`)
    .slice(0, 6);
}

export function buildDecisionModelGovernance({
  matrix,
  training,
  date,
  sport
}: {
  matrix: DecisionFeatureMatrix;
  training: TrainingDataSnapshot;
  date: string;
  sport: Sport;
}): DecisionModelGovernance {
  const checks = buildChecks(matrix, training);
  const score = trustScore(checks);
  const status = governanceStatus(checks, score);
  const failingChecks = checks.filter((item) => item.status === "fail").length;
  const warningChecks = checks.filter((item) => item.status === "warn").length;
  const mix = sourceMix(matrix);
  const featureDrift = buildFeatureDrift(matrix, training);

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    summary:
      status === "approved"
        ? `Model governance approves learned guardrails with trust score ${score}/100.`
        : status === "shadow"
          ? `Model governance requires shadow mode; trust score is ${score}/100 with ${warningChecks} warning check(s).`
          : `Model governance blocks learned guardrails; trust score is ${score}/100 with ${failingChecks} failing check(s).`,
    trustScore: score,
    learnedGuardrailsAllowed: status === "approved",
    publishWithLearnedWeightsAllowed: status === "approved" && training.readiness.readyForTraining,
    shadowModeRequired: status !== "approved",
    checks,
    failingChecks,
    warningChecks,
    featureDrift,
    sourceMix: mix,
    liveFeatureCoverage: {
      rows: matrix.coverage.totalRows,
      keys: matrix.featureKeys.length,
      averageCompletenessScore: matrix.coverage.averageCompletenessScore,
      averageTrainingReadyScore: matrix.coverage.averageTrainingReadyScore,
      mockFeatureRatio: pct(matrix.coverage.mockFeatures, matrix.coverage.totalFeatures),
      missingFeatureRatio: pct(matrix.coverage.missingFeatures, matrix.coverage.totalFeatures)
    },
    trainingCorpus: {
      status: training.status,
      configured: training.configured,
      realFinishedFixtures: training.counts.realFinishedFixtures,
      realOddsSnapshots: training.counts.realOddsSnapshots,
      featureSnapshots: training.counts.featureSnapshots,
      backtestRuns: training.counts.backtestRuns,
      latestBacktestId: training.latestBacktest?.id ?? null,
      minimumRecommendedFixtures: training.readiness.minimumRecommendedFixtures
    },
    nextActions: nextActions(checks)
  };
}
