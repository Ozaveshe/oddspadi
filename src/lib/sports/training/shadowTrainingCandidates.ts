import type { TrainingReadiness, TrainingReadinessSport, TrainingReadinessStatus } from "@/lib/sports/training/trainingReadiness";
import type { StoredBacktestRun, TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import type { Sport } from "@/lib/sports/types";

type CandidateSport = Extract<Sport, "football" | "basketball" | "tennis">;

export type ShadowTrainingCandidateStatus = "ready-shadow" | "waiting-backtest" | "waiting-corpus" | "blocked";
export type ShadowTrainingCandidateGateStatus = "pass" | "watch" | "block";

export type ShadowTrainingCandidateGate = {
  id: string;
  label: string;
  status: ShadowTrainingCandidateGateStatus;
  detail: string;
  requiredAction: string | null;
};

export type ShadowLearnedWeight = {
  key: string;
  value: number;
  status: ShadowTrainingCandidateGateStatus;
  application: string;
};

export type ShadowTrainingCandidate = {
  sport: CandidateSport;
  status: ShadowTrainingCandidateStatus;
  candidateHash: string;
  backtestId: string | null;
  modelKey: string | null;
  sampleSize: number;
  trainSize: number;
  testSize: number;
  pickCount: number;
  brierScore: number | null;
  logLoss: number | null;
  roiUnits: number;
  yield: number | null;
  closingLineValue: number | null;
  calibrationError: number | null;
  calibrationBuckets: number;
  learnedWeights: ShadowLearnedWeight[];
  gates: ShadowTrainingCandidateGate[];
  promotionBlockers: string[];
  nextAction: string;
};

export type ShadowTrainingCandidates = {
  generatedAt: string;
  date: string;
  mode: "shadow-training-candidates";
  status: ShadowTrainingCandidateStatus;
  candidateHash: string;
  summary: string;
  readinessStatus: TrainingReadinessStatus;
  candidates: ShadowTrainingCandidate[];
  totals: {
    sports: number;
    readyShadow: number;
    waitingBacktest: number;
    waitingCorpus: number;
    blocked: number;
    learnedWeights: number;
    completedBacktests: number;
  };
  nextSafeCommand: TrainingReadiness["nextSafeCommand"];
  controls: {
    canInspectReadOnly: true;
    canRunBackfillDryRun: boolean;
    canWriteProviderRows: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canUseLearnedWeights: false;
    canPromoteLearnedWeights: false;
    canPublishPicks: false;
    canUpgradePublicAction: false;
  };
  blockers: string[];
  proofUrls: string[];
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

function unique(values: Array<string | null | undefined>, limit = 30): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function isCandidateSport(sport: Sport): sport is CandidateSport {
  return sport === "football" || sport === "basketball" || sport === "tennis";
}

function numberWeight(weights: Record<string, unknown>, key: string): number | null {
  const value = weights[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function weightApplication(sport: CandidateSport, key: string): string {
  const common: Record<string, string> = {
    minimumEdge: "Raises or lowers the minimum positive value edge required before a shadow pick can pass.",
    valueEdgeWeight: "Scales the model edge contribution inside shadow decision scoring.",
    dataQualityWeight: "Caps confidence when provider quality or feature provenance is weak."
  };
  if (common[key]) return common[key];
  if (sport === "football" && key === "marketAdjustmentWeight") return "Tunes how strongly no-vig market probability pulls the football posterior.";
  if (sport === "football" && key === "homeAdvantageElo") return "Tunes football home-advantage Elo before expected-goals conversion.";
  if (sport === "basketball" && key === "paceWeight") return "Tunes basketball pace contribution for totals and margin logic.";
  if (sport === "basketball" && key === "homeCourtPoints") return "Tunes basketball home-court points before spread and moneyline conversion.";
  if (sport === "tennis" && key === "surfaceWeight") return "Tunes tennis surface rating contribution before match-winner probability.";
  if (sport === "tennis" && key === "eloKFactor") return "Tunes tennis Elo update speed for replayed match history.";
  return "Stored learned parameter for shadow inspection only.";
}

function weightKeysForSport(sport: CandidateSport): string[] {
  if (sport === "football") return ["minimumEdge", "valueEdgeWeight", "dataQualityWeight", "marketAdjustmentWeight", "homeAdvantageElo"];
  if (sport === "basketball") return ["minimumEdge", "valueEdgeWeight", "dataQualityWeight", "paceWeight", "homeCourtPoints"];
  return ["minimumEdge", "valueEdgeWeight", "dataQualityWeight", "surfaceWeight", "eloKFactor"];
}

function learnedWeights(sport: CandidateSport, backtest: StoredBacktestRun | null): ShadowLearnedWeight[] {
  if (!backtest) return [];
  return weightKeysForSport(sport).flatMap((key) => {
    const value = numberWeight(backtest.learnedWeights, key);
    if (value === null) return [];
    return [
      {
        key,
        value,
        status: Number.isFinite(value) && value > 0 ? "pass" : "watch",
        application: weightApplication(sport, key)
      }
    ];
  });
}

function gate(input: ShadowTrainingCandidateGate): ShadowTrainingCandidateGate {
  return input;
}

function candidateStatus({
  readiness,
  snapshot,
  backtest,
  demoOnly
}: {
  readiness: TrainingReadinessSport | null;
  snapshot: TrainingDataSnapshot;
  backtest: StoredBacktestRun | null;
  demoOnly: boolean;
}): ShadowTrainingCandidateStatus {
  if (!readiness || readiness.status === "blocked" || snapshot.status === "failed") return "blocked";
  if (!backtest || backtest.status !== "completed" || demoOnly) return "waiting-backtest";
  if (backtest.calibrationError === null || !backtest.calibrationBuckets.length) return "waiting-backtest";
  if (backtest.calibrationError > 0.14) return "waiting-corpus";
  if (readiness.status !== "trainable-shadow" || !snapshot.readiness.readyForTraining) return "waiting-corpus";
  return "ready-shadow";
}

function candidateGates({
  readiness,
  snapshot,
  backtest,
  weights,
  demoOnly
}: {
  readiness: TrainingReadinessSport | null;
  snapshot: TrainingDataSnapshot;
  backtest: StoredBacktestRun | null;
  weights: ShadowLearnedWeight[];
  demoOnly: boolean;
}): ShadowTrainingCandidateGate[] {
  return [
    gate({
      id: "completed-backtest",
      label: "Completed real-data backtest",
      status: backtest?.status === "completed" && !demoOnly ? "pass" : backtest ? "watch" : "block",
      detail: backtest ? `Backtest ${backtest.id} is ${backtest.status} from ${backtest.dataSource}.` : "No stored backtest exists.",
      requiredAction: backtest?.status === "completed" && !demoOnly ? null : "Run and store a completed non-demo backtest after the corpus is populated."
    }),
    gate({
      id: "sample-size",
      label: "Sample size",
      status: backtest && backtest.sampleSize >= snapshot.readiness.minimumRecommendedFixtures ? "pass" : backtest && backtest.sampleSize > 0 ? "watch" : "block",
      detail: `${backtest?.sampleSize ?? 0}/${snapshot.readiness.minimumRecommendedFixtures} backtest samples.`,
      requiredAction:
        backtest && backtest.sampleSize >= snapshot.readiness.minimumRecommendedFixtures
          ? null
          : "Backfill enough real historical rows for a meaningful train/test split."
    }),
    gate({
      id: "learned-weight-payload",
      label: "Learned weight payload",
      status: weights.length >= 3 ? "pass" : weights.length ? "watch" : "block",
      detail: `${weights.length} learned parameter(s) were extracted for shadow inspection.`,
      requiredAction: weights.length >= 3 ? null : "Store learned weights from the completed backtest output."
    }),
    gate({
      id: "calibration-reliability",
      label: "Probability calibration",
      status:
        backtest?.calibrationError !== null && backtest?.calibrationError !== undefined && backtest.calibrationBuckets.length
          ? backtest.calibrationError <= 0.08
            ? "pass"
            : "watch"
          : "block",
      detail:
        backtest?.calibrationError !== null && backtest?.calibrationError !== undefined
          ? `Expected calibration error ${backtest.calibrationError}; ${backtest.calibrationBuckets.length} probability bucket(s).`
          : "No calibration bucket evidence is stored for this backtest.",
      requiredAction:
        backtest?.calibrationError !== null && backtest?.calibrationError !== undefined && backtest.calibrationBuckets.length
          ? backtest.calibrationError <= 0.14
            ? null
            : "Import more representative history or recalibrate before treating learned weights as ready."
          : "Store calibration buckets from the completed holdout backtest."
    }),
    gate({
      id: "corpus-readiness",
      label: "Corpus readiness",
      status: readiness?.status === "trainable-shadow" && snapshot.readiness.readyForTraining ? "pass" : readiness?.status === "backfill-ready" ? "watch" : "block",
      detail: readiness ? `${readiness.sport} readiness is ${readiness.status}.` : "No training readiness row exists for this sport.",
      requiredAction:
        readiness?.status === "trainable-shadow" && snapshot.readiness.readyForTraining
          ? null
          : "Clear corpus, odds, feature, label, and backtest deficits before learned weights can be trusted."
    }),
    gate({
      id: "promotion-lock",
      label: "Promotion lock",
      status: "pass",
      detail: "Candidate weights can be inspected only; they cannot train, publish, persist, stake, or upgrade a public action from this artifact.",
      requiredAction: null
    })
  ];
}

function nextAction(status: ShadowTrainingCandidateStatus, gates: ShadowTrainingCandidateGate[], readiness: TrainingReadinessSport | null): string {
  if (status === "ready-shadow") return "Compare this candidate against model governance and calibration before any operator-controlled activation.";
  return gates.find((item) => item.requiredAction)?.requiredAction ?? readiness?.nextAction ?? "Keep collecting corpus proof before learned weights are inspected.";
}

function buildCandidate({
  snapshot,
  readiness
}: {
  snapshot: TrainingDataSnapshot;
  readiness: TrainingReadinessSport | null;
}): ShadowTrainingCandidate {
  const sport = isCandidateSport(snapshot.sport) ? snapshot.sport : "football";
  const backtest = snapshot.latestBacktest;
  const demoOnly = Boolean(backtest?.dataSource.toLowerCase().includes("demo")) || snapshot.counts.realFinishedFixtures === 0;
  const weights = learnedWeights(sport, backtest);
  const gates = candidateGates({ readiness, snapshot, backtest, weights, demoOnly });
  const status = candidateStatus({ readiness, snapshot, backtest, demoOnly });
  const promotionBlockers = unique(gates.filter((item) => item.status !== "pass").map((item) => `${item.label}: ${item.requiredAction ?? item.detail}`), 8);

  return {
    sport,
    status,
    candidateHash: stableHash({
      sport,
      status,
      backtest: backtest?.id ?? null,
      weights: weights.map((weight) => [weight.key, weight.value]),
      gates: gates.map((item) => [item.id, item.status])
    }),
    backtestId: backtest?.id ?? null,
    modelKey: backtest?.modelKey ?? null,
    sampleSize: backtest?.sampleSize ?? 0,
    trainSize: backtest?.trainSize ?? 0,
    testSize: backtest?.testSize ?? 0,
    pickCount: backtest?.pickCount ?? 0,
    brierScore: backtest?.brierScore ?? null,
    logLoss: backtest?.logLoss ?? null,
    roiUnits: backtest?.roiUnits ?? 0,
    yield: backtest?.yield ?? null,
    closingLineValue: backtest?.closingLineValue ?? null,
    calibrationError: backtest?.calibrationError ?? null,
    calibrationBuckets: backtest?.calibrationBuckets.length ?? 0,
    learnedWeights: weights,
    gates,
    promotionBlockers,
    nextAction: nextAction(status, gates, readiness)
  };
}

function overallStatus(candidates: ShadowTrainingCandidate[], readiness: TrainingReadiness): ShadowTrainingCandidateStatus {
  if (readiness.status === "blocked" || candidates.some((candidate) => candidate.status === "blocked")) return "blocked";
  if (candidates.every((candidate) => candidate.status === "ready-shadow")) return "ready-shadow";
  if (candidates.some((candidate) => candidate.status === "waiting-backtest")) return "waiting-backtest";
  return "waiting-corpus";
}

function summary(status: ShadowTrainingCandidateStatus): string {
  if (status === "ready-shadow") return "Learned-weight candidates are available for shadow inspection only; public influence remains locked.";
  if (status === "waiting-backtest") return "Shadow learned weights are waiting on completed non-demo backtests and stored weight payloads.";
  if (status === "waiting-corpus") return "Shadow learned weights are waiting on trainable corpus volume, odds labels, feature parity, and calibration proof.";
  return "Shadow learned-weight candidates are blocked by Supabase, corpus, or training-readiness proof.";
}

export function buildShadowTrainingCandidates({
  date,
  trainingReadiness,
  trainingSnapshots,
  now = new Date()
}: {
  date: string;
  trainingReadiness: TrainingReadiness;
  trainingSnapshots: TrainingDataSnapshot[];
  now?: Date;
}): ShadowTrainingCandidates {
  const readinessBySport = new Map(trainingReadiness.sports.map((sport) => [sport.sport, sport]));
  const candidates = trainingSnapshots
    .filter((snapshot) => isCandidateSport(snapshot.sport))
    .map((snapshot) => buildCandidate({ snapshot, readiness: readinessBySport.get(snapshot.sport as CandidateSport) ?? null }));
  const status = overallStatus(candidates, trainingReadiness);
  const totals = {
    sports: candidates.length,
    readyShadow: candidates.filter((candidate) => candidate.status === "ready-shadow").length,
    waitingBacktest: candidates.filter((candidate) => candidate.status === "waiting-backtest").length,
    waitingCorpus: candidates.filter((candidate) => candidate.status === "waiting-corpus").length,
    blocked: candidates.filter((candidate) => candidate.status === "blocked").length,
    learnedWeights: candidates.reduce((sum, candidate) => sum + candidate.learnedWeights.length, 0),
    completedBacktests: candidates.filter((candidate) => candidate.backtestId && candidate.gates[0]?.status === "pass").length
  };
  const blockers = unique([
    ...trainingReadiness.blockers,
    ...candidates.flatMap((candidate) => candidate.promotionBlockers.map((blocker) => `${candidate.sport}: ${blocker}`))
  ]);

  return {
    generatedAt: now.toISOString(),
    date,
    mode: "shadow-training-candidates",
    status,
    candidateHash: stableHash({
      date,
      readiness: trainingReadiness.readinessHash,
      candidates: candidates.map((candidate) => [candidate.sport, candidate.status, candidate.candidateHash])
    }),
    summary: summary(status),
    readinessStatus: trainingReadiness.status,
    candidates,
    totals,
    nextSafeCommand: trainingReadiness.nextSafeCommand,
    controls: {
      canInspectReadOnly: true,
      canRunBackfillDryRun: trainingReadiness.controls.canRunBackfillDryRun,
      canWriteProviderRows: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canUseLearnedWeights: false,
      canPromoteLearnedWeights: false,
      canPublishPicks: false,
      canUpgradePublicAction: false
    },
    blockers,
    proofUrls: unique([
      "/api/sports/decision/training/shadow-candidates",
      "/api/sports/decision/training/readiness",
      "/api/sports/decision/model-governance",
      "/api/sports/decision/model-cards",
      ...trainingReadiness.proofUrls
    ])
  };
}
