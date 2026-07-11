import type { DecisionMvpProgressSnapshot, DecisionMvpProgressSnapshotLane } from "@/lib/sports/prediction/decisionMvpProgressSnapshot";
import type { DecisionMvpProviderProofGate } from "@/lib/sports/prediction/decisionMvpProviderProofGate";
import type { MultiSportCorpusPlan, TrainingCorpusSportPlan } from "@/lib/sports/training/multiSportCorpusPlan";
import type { Sport } from "@/lib/sports/types";

export type DecisionMvpStorageCorpusGateStatus = "ready-dry-run" | "waiting-provider-proof" | "waiting-storage" | "waiting-corpus" | "blocked";

export type DecisionMvpStorageCorpusSport = {
  sport: TrainingCorpusSportPlan["sport"];
  status: TrainingCorpusSportPlan["status"];
  adapterStatus: TrainingCorpusSportPlan["adapterStatus"];
  backtestRunnerStatus: TrainingCorpusSportPlan["backtestRunnerStatus"];
  estimatedHistoricalMatches: number;
  estimatedOddsSnapshots: number;
  missingEnvKeys: string[];
  firstProofUrl: string | null;
  safeToRun: boolean;
  nextAction: string;
};

export type DecisionMvpStorageCorpusGate = {
  mode: "decision-mvp-storage-corpus-gate";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMvpStorageCorpusGateStatus;
  gateHash: string;
  summary: string;
  storage: {
    status: DecisionMvpProgressSnapshotLane["status"];
    percent: number;
    evidence: string;
    nextAction: string;
    proofUrl: string;
  };
  corpus: {
    status: DecisionMvpProgressSnapshotLane["status"];
    percent: number;
    seasonFrom: number;
    seasonTo: number;
    sports: number;
    estimatedHistoricalMatches: number;
    estimatedOddsSnapshots: number;
    missingEnvKeys: string[];
    nextProofUrl: string | null;
  };
  providerProof: {
    status: DecisionMvpProviderProofGate["status"];
    selectedProvider: string | null;
    canRunSelectedDryRun: boolean;
    canAdvanceToStorageReview: boolean;
  };
  nextStep: {
    label: string;
    detail: string;
    proofUrl: string;
  };
  sports: DecisionMvpStorageCorpusSport[];
  controls: {
    canInspectReadOnly: true;
    canRunCorpusDryRun: boolean;
    canWriteProviderRows: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
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

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function progressLane(snapshot: DecisionMvpProgressSnapshot, id: DecisionMvpProgressSnapshotLane["id"]): DecisionMvpProgressSnapshotLane {
  return (
    snapshot.lanes.find((lane) => lane.id === id) ?? {
      id,
      label: id,
      status: "blocked",
      percent: 0,
      evidence: `${id} lane is unavailable.`,
      nextAction: `Inspect ${id} proof before continuing.`,
      proofUrl: "/api/sports/decision/mvp-progress-snapshot"
    }
  );
}

function statusFor({
  storageLane,
  corpusLane,
  corpusPlan,
  providerProofGate
}: {
  storageLane: DecisionMvpProgressSnapshotLane;
  corpusLane: DecisionMvpProgressSnapshotLane;
  corpusPlan: MultiSportCorpusPlan;
  providerProofGate: DecisionMvpProviderProofGate;
}): DecisionMvpStorageCorpusGateStatus {
  if (storageLane.status === "blocked") return "waiting-storage";
  if (providerProofGate.status !== "proof-observed" && providerProofGate.status !== "ready-dry-run") return "waiting-provider-proof";
  if (corpusPlan.status === "blocked") return "blocked";
  if (corpusPlan.nextSafeCommand.safeToRun) return "ready-dry-run";
  if (corpusLane.status !== "done") return "waiting-corpus";
  return "ready-dry-run";
}

function summaryFor(status: DecisionMvpStorageCorpusGateStatus, corpusPlan: MultiSportCorpusPlan): string {
  if (status === "ready-dry-run") return "Storage/corpus gate is ready for supervised dry-run evidence; writes, training, and learned weights remain locked.";
  if (status === "waiting-storage") return "Storage/corpus gate is waiting on OddsPadi Supabase storage proof before provider rows or training rows can be trusted.";
  if (status === "waiting-provider-proof") return "Storage/corpus gate is waiting on provider proof before corpus import or storage review can advance.";
  if (status === "blocked") return `Storage/corpus gate is blocked by ${corpusPlan.blockers[0] ?? "corpus plan readiness"}.`;
  return "Storage/corpus gate is waiting on the 10-year fixture, odds, feature, and backtest corpus.";
}

function nextStepFor({
  status,
  storageLane,
  corpusPlan,
  providerProofGate
}: {
  status: DecisionMvpStorageCorpusGateStatus;
  storageLane: DecisionMvpProgressSnapshotLane;
  corpusPlan: MultiSportCorpusPlan;
  providerProofGate: DecisionMvpProviderProofGate;
}): DecisionMvpStorageCorpusGate["nextStep"] {
  if (status === "waiting-storage") {
    return {
      label: "Prove Supabase storage scope",
      detail: storageLane.nextAction,
      proofUrl: storageLane.proofUrl
    };
  }
  if (status === "waiting-provider-proof") {
    return {
      label: "Finish provider proof",
      detail: providerProofGate.nextAction.detail,
      proofUrl: providerProofGate.nextAction.proofUrl
    };
  }
  if (status === "ready-dry-run") {
    return {
      label: corpusPlan.nextSafeCommand.label,
      detail: corpusPlan.nextSafeCommand.expectedEvidence,
      proofUrl: corpusPlan.nextSafeCommand.verifyUrl ?? "/api/sports/decision/training/multi-sport-corpus-plan"
    };
  }
  return {
    label: "Build 10-year corpus evidence",
    detail: corpusPlan.blockers[0] ?? corpusPlan.nextSafeCommand.expectedEvidence,
    proofUrl: corpusPlan.nextSafeCommand.verifyUrl ?? "/api/sports/decision/training/ten-year-corpus-execution"
  };
}

function sportFor(plan: TrainingCorpusSportPlan): DecisionMvpStorageCorpusSport {
  return {
    sport: plan.sport,
    status: plan.status,
    adapterStatus: plan.adapterStatus,
    backtestRunnerStatus: plan.backtestRunnerStatus,
    estimatedHistoricalMatches: plan.estimatedHistoricalMatches,
    estimatedOddsSnapshots: plan.estimatedOddsSnapshots,
    missingEnvKeys: plan.missingEnvKeys,
    firstProofUrl: plan.firstDryRunCommand?.verifyUrl ?? null,
    safeToRun: Boolean(plan.firstDryRunCommand?.safeToRun),
    nextAction: plan.nextSteps[0] ?? plan.blockers[0] ?? "Inspect corpus plan before training."
  };
}

export function buildDecisionMvpStorageCorpusGate({
  date,
  sport,
  mvpProgressSnapshot,
  providerProofGate,
  corpusPlan,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  mvpProgressSnapshot: DecisionMvpProgressSnapshot;
  providerProofGate: DecisionMvpProviderProofGate;
  corpusPlan: MultiSportCorpusPlan;
  now?: Date;
}): DecisionMvpStorageCorpusGate {
  const storageLane = progressLane(mvpProgressSnapshot, "supabase-storage");
  const corpusLane = progressLane(mvpProgressSnapshot, "training-corpus");
  const status = statusFor({ storageLane, corpusLane, corpusPlan, providerProofGate });
  const sports = corpusPlan.sports.map(sportFor);
  const nextStep = nextStepFor({ status, storageLane, corpusPlan, providerProofGate });

  return {
    mode: "decision-mvp-storage-corpus-gate",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    gateHash: stableHash({
      date,
      sport,
      status,
      progress: [mvpProgressSnapshot.status, storageLane.status, corpusLane.status],
      providerProof: [providerProofGate.status, providerProofGate.gateHash],
      corpusPlan: [corpusPlan.id, corpusPlan.status, corpusPlan.missingEnvKeys, corpusPlan.nextSafeCommand.verifyUrl],
      sports: sports.map((item) => [item.sport, item.status, item.safeToRun, item.missingEnvKeys])
    }),
    summary: summaryFor(status, corpusPlan),
    storage: {
      status: storageLane.status,
      percent: storageLane.percent,
      evidence: storageLane.evidence,
      nextAction: storageLane.nextAction,
      proofUrl: storageLane.proofUrl
    },
    corpus: {
      status: corpusLane.status,
      percent: corpusLane.percent,
      seasonFrom: corpusPlan.seasonFrom,
      seasonTo: corpusPlan.seasonTo,
      sports: corpusPlan.sportCount,
      estimatedHistoricalMatches: corpusPlan.totalEstimatedHistoricalMatches,
      estimatedOddsSnapshots: corpusPlan.totalEstimatedOddsSnapshots,
      missingEnvKeys: corpusPlan.missingEnvKeys,
      nextProofUrl: corpusPlan.nextSafeCommand.verifyUrl
    },
    providerProof: {
      status: providerProofGate.status,
      selectedProvider: providerProofGate.selected?.providerId ?? null,
      canRunSelectedDryRun: providerProofGate.controls.canRunSelectedDryRun,
      canAdvanceToStorageReview: providerProofGate.status === "proof-observed"
    },
    nextStep,
    sports,
    controls: {
      canInspectReadOnly: true,
      canRunCorpusDryRun: status === "ready-dry-run" && Boolean(corpusPlan.nextSafeCommand.safeToRun),
      canWriteProviderRows: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-storage-corpus-gate",
      "/api/sports/decision/storage-activation-checklist",
      "/api/sports/decision/training/multi-sport-corpus-plan",
      "/api/sports/decision/training/ten-year-corpus-execution",
      "/api/sports/decision/training/corpus-proof",
      providerProofGate.nextAction.proofUrl,
      corpusPlan.nextSafeCommand.verifyUrl,
      ...mvpProgressSnapshot.proofUrls,
      ...providerProofGate.proofUrls,
      ...corpusPlan.proofUrls
    ]),
    locks: [
      "Storage/corpus gate never writes provider rows, training rows, odds snapshots, or learned weights.",
      "A provider proof can advance only to storage/schema review before any corpus write.",
      "Learned weights, probability adjustments, confidence upgrades, public picks, and staking stay locked until corpus, backtest, calibration, and governance proof pass.",
      ...providerProofGate.locks
    ]
  };
}
