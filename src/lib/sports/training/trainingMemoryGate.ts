import type { LearnedWeightPromotionGovernor, LearnedWeightPromotionGovernorStatus } from "@/lib/sports/training/learnedWeightPromotionGovernor";
import type { SupabaseTrainingCorpusCensus } from "@/lib/sports/training/supabaseTrainingCorpusCensus";
import type { TrainingCorpusCommand, TrainingCorpusSport } from "@/lib/sports/training/multiSportCorpusPlan";
import type { TrainingReadiness, TrainingReadinessGateStatus } from "@/lib/sports/training/trainingReadiness";

export type TrainingMemoryGateStatus = "memory-ready-shadow" | "waiting-backtest" | "waiting-corpus" | "waiting-supabase" | "locked";

export type TrainingMemoryGateCheck = {
  id: string;
  label: string;
  status: TrainingReadinessGateStatus;
  detail: string;
  requiredEvidence: string;
};

export type TrainingMemoryGateSport = {
  sport: TrainingCorpusSport;
  status: TrainingMemoryGateStatus;
  memoryScore: number;
  trainableShadow: boolean;
  supabaseFinishedFixtures: number | null;
  supabaseOddsSnapshots: number | null;
  supabaseFeatureSnapshots: number | null;
  supabaseCompletedBacktests: number | null;
  learnedWeights: number;
  firstBlocker: string;
};

export type TrainingMemoryGate = {
  generatedAt: string;
  mode: "training-memory-gate";
  status: TrainingMemoryGateStatus;
  gateHash: string;
  summary: string;
  sports: TrainingMemoryGateSport[];
  totals: {
    sports: number;
    memoryReadySports: number;
    trainableShadowSports: number;
    supabaseShadowReadySports: number;
    learnedWeights: number;
    finishedFixtures: number;
    oddsSnapshots: number;
    featureSnapshots: number;
    completedBacktests: number;
  };
  checks: TrainingMemoryGateCheck[];
  nextSafeCommand: TrainingCorpusCommand;
  controls: {
    canInspectReadOnly: true;
    canUseMemoryForShadowReview: boolean;
    canUseSupabaseRowsForShadowBacktest: boolean;
    canApplyLearnedWeightsToPredictions: false;
    canPromoteLearnedWeights: false;
    canWriteProviderRows: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
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

function unique(values: Array<string | null | undefined>, limit = 32): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function check(input: TrainingMemoryGateCheck): TrainingMemoryGateCheck {
  return input;
}

function promotionLooksReady(status: LearnedWeightPromotionGovernorStatus): boolean {
  return status === "eligible-shadow";
}

function statusForSport({
  trainableShadow,
  supabaseReady,
  completedBacktests,
  learnedWeights,
  hasSupabaseCensus
}: {
  trainableShadow: boolean;
  supabaseReady: boolean;
  completedBacktests: number | null;
  learnedWeights: number;
  hasSupabaseCensus: boolean;
}): TrainingMemoryGateStatus {
  if (trainableShadow && supabaseReady && learnedWeights > 0) return "memory-ready-shadow";
  if (completedBacktests === 0) return "waiting-backtest";
  if (!hasSupabaseCensus) return "waiting-supabase";
  if (!supabaseReady || !trainableShadow) return "waiting-corpus";
  return "locked";
}

function scoreSport({
  trainableShadow,
  supabaseFinishedFixtures,
  supabaseOddsSnapshots,
  supabaseFeatureSnapshots,
  supabaseCompletedBacktests,
  learnedWeights
}: {
  trainableShadow: boolean;
  supabaseFinishedFixtures: number | null;
  supabaseOddsSnapshots: number | null;
  supabaseFeatureSnapshots: number | null;
  supabaseCompletedBacktests: number | null;
  learnedWeights: number;
}): number {
  const corpusScore =
    Math.min(30, ((supabaseFinishedFixtures ?? 0) / 1000) * 30) +
    Math.min(25, ((supabaseOddsSnapshots ?? 0) / 2000) * 25) +
    Math.min(20, ((supabaseFeatureSnapshots ?? 0) / 1000) * 20);
  const backtestScore = (supabaseCompletedBacktests ?? 0) > 0 ? 15 : 0;
  const weightScore = learnedWeights > 0 ? 5 : 0;
  const trainableScore = trainableShadow ? 5 : 0;
  return clamp(corpusScore + backtestScore + weightScore + trainableScore);
}

function overallStatus(sports: TrainingMemoryGateSport[], hasSupabaseCensus: boolean): TrainingMemoryGateStatus {
  if (sports.length && sports.every((sport) => sport.status === "memory-ready-shadow")) return "memory-ready-shadow";
  if (!hasSupabaseCensus) return "waiting-supabase";
  if (sports.some((sport) => sport.status === "waiting-backtest")) return "waiting-backtest";
  if (sports.some((sport) => sport.status === "waiting-corpus")) return "waiting-corpus";
  return "locked";
}

function summaryFor(status: TrainingMemoryGateStatus): string {
  if (status === "memory-ready-shadow") return "Stored training memory is ready for read-only shadow review; learned weights remain blocked from live/public decisions.";
  if (status === "waiting-backtest") return "Training memory is waiting on completed backtests before learned evidence can be reviewed.";
  if (status === "waiting-corpus") return "Training memory is waiting on enough Supabase corpus rows, odds labels, feature snapshots, and labels.";
  if (status === "waiting-supabase") return "Training memory is waiting on live Supabase census proof before stored rows can be trusted.";
  return "Training memory is locked by governance controls; it cannot affect live probabilities or public picks.";
}

function censusBlockerForSport(census: SupabaseTrainingCorpusCensus["sports"][number] | null): string | null {
  if (!census) return "Waiting for Supabase corpus census.";
  if (census.fixtures === 0 && census.oddsSnapshots === 0 && census.featureSnapshots === 0) {
    return "Supabase corpus is empty; run provider dry-runs and imports before memory can review learned evidence.";
  }
  if (census.finishedFixtures === 0) return "No finished fixture labels are stored yet.";
  if (census.matchWinnerOddsSnapshots === 0) return "No match-winner odds snapshots are stored yet.";
  if (census.labeledFeatureSnapshots === 0) return "No labeled feature snapshots are stored yet.";
  if (census.completedBacktests === 0) return "No completed backtests are stored yet.";
  return null;
}

export function buildTrainingMemoryGate({
  trainingReadiness,
  supabaseTrainingCorpusCensus = null,
  learnedWeightPromotionGovernor,
  now = new Date()
}: {
  trainingReadiness: TrainingReadiness;
  supabaseTrainingCorpusCensus?: SupabaseTrainingCorpusCensus | null;
  learnedWeightPromotionGovernor: LearnedWeightPromotionGovernor;
  now?: Date;
}): TrainingMemoryGate {
  const censusBySport = new Map(supabaseTrainingCorpusCensus?.sports.map((row) => [row.sport, row]) ?? []);
  const promotionBySport = new Map(learnedWeightPromotionGovernor.decisions.map((decision) => [decision.sport, decision]));
  const hasSupabaseCensus = Boolean(supabaseTrainingCorpusCensus);
  const sports = trainingReadiness.sports.map((sport): TrainingMemoryGateSport => {
    const census = censusBySport.get(sport.sport) ?? null;
    const promotion = promotionBySport.get(sport.sport) ?? null;
    const supabaseReady = Boolean(supabaseTrainingCorpusCensus?.readiness.shadowBacktestReadySports.includes(sport.sport));
    const trainableShadow = sport.status === "trainable-shadow";
    const learnedWeights = promotion?.learnedWeights ?? 0;
    const status = statusForSport({
      trainableShadow,
      supabaseReady,
      completedBacktests: census?.completedBacktests ?? null,
      learnedWeights,
      hasSupabaseCensus
    });
    const firstBlocker =
      censusBlockerForSport(census) ??
      sport.modelFamilies.flatMap((family) => family.blockedBy.map((blocker) => `${family.label}: ${blocker}`))[0] ??
      promotion?.blockers[0] ??
      (hasSupabaseCensus ? "Waiting for model-governance approval." : "Waiting for Supabase corpus census.");

    return {
      sport: sport.sport,
      status,
      memoryScore: scoreSport({
        trainableShadow,
        supabaseFinishedFixtures: census?.finishedFixtures ?? null,
        supabaseOddsSnapshots: census?.oddsSnapshots ?? null,
        supabaseFeatureSnapshots: census?.featureSnapshots ?? null,
        supabaseCompletedBacktests: census?.completedBacktests ?? null,
        learnedWeights
      }),
      trainableShadow,
      supabaseFinishedFixtures: census?.finishedFixtures ?? null,
      supabaseOddsSnapshots: census?.oddsSnapshots ?? null,
      supabaseFeatureSnapshots: census?.featureSnapshots ?? null,
      supabaseCompletedBacktests: census?.completedBacktests ?? null,
      learnedWeights,
      firstBlocker
    };
  });
  const status = overallStatus(sports, hasSupabaseCensus);
  const totals = {
    sports: sports.length,
    memoryReadySports: sports.filter((sport) => sport.status === "memory-ready-shadow").length,
    trainableShadowSports: sports.filter((sport) => sport.trainableShadow).length,
    supabaseShadowReadySports: supabaseTrainingCorpusCensus?.readiness.shadowBacktestReadySports.length ?? 0,
    learnedWeights: sports.reduce((sum, sport) => sum + sport.learnedWeights, 0),
    finishedFixtures: supabaseTrainingCorpusCensus?.totals.finishedFixtures ?? 0,
    oddsSnapshots: supabaseTrainingCorpusCensus?.totals.oddsSnapshots ?? 0,
    featureSnapshots: supabaseTrainingCorpusCensus?.totals.featureSnapshots ?? 0,
    completedBacktests: supabaseTrainingCorpusCensus?.totals.completedBacktests ?? 0
  };
  const checks = [
    check({
      id: "supabase-census",
      label: "Supabase corpus census",
      status: !hasSupabaseCensus ? "block" : supabaseTrainingCorpusCensus?.status === "ready-shadow-backtest" ? "pass" : "watch",
      detail: supabaseTrainingCorpusCensus?.summary ?? "No live Supabase row-count census was supplied to this gate.",
      requiredEvidence: "/api/sports/decision/training/supabase-training-corpus-census with row counts for fixtures, odds, features, and backtests."
    }),
    check({
      id: "training-readiness",
      label: "Training readiness",
      status: trainingReadiness.status === "trainable-shadow" ? "pass" : trainingReadiness.status === "backfill-ready" ? "watch" : "block",
      detail: trainingReadiness.summary,
      requiredEvidence: "/api/sports/decision/training/readiness with all corpus/model-family gates passing."
    }),
    check({
      id: "promotion-governor",
      label: "Learned-weight governor",
      status: promotionLooksReady(learnedWeightPromotionGovernor.status) ? "pass" : "block",
      detail: learnedWeightPromotionGovernor.summary,
      requiredEvidence: "/api/sports/decision/training/promotion-governor with eligible-shadow status for every governed sport."
    }),
    check({
      id: "public-action-firewall",
      label: "Public action firewall",
      status: "pass",
      detail: "This gate can only approve read-only memory review; it never applies learned weights, publishes picks, stakes, or upgrades actions.",
      requiredEvidence: "All write, train, publish, stake, promote, and public-action controls remain false."
    })
  ];
  const blockers = unique([
    ...sports.filter((sport) => sport.status !== "memory-ready-shadow").map((sport) => `${sport.sport}: ${sport.firstBlocker}`),
    ...(supabaseTrainingCorpusCensus?.readiness.errors ?? []),
    ...trainingReadiness.blockers,
    ...learnedWeightPromotionGovernor.blockers
  ]);

  return {
    generatedAt: now.toISOString(),
    mode: "training-memory-gate",
    status,
    gateHash: stableHash({
      status,
      readiness: trainingReadiness.readinessHash,
      census: supabaseTrainingCorpusCensus?.censusHash ?? null,
      governor: learnedWeightPromotionGovernor.governorHash,
      sports: sports.map((sport) => [sport.sport, sport.status, sport.memoryScore])
    }),
    summary: summaryFor(status),
    sports,
    totals,
    checks,
    nextSafeCommand: trainingReadiness.nextSafeCommand,
    controls: {
      canInspectReadOnly: true,
      canUseMemoryForShadowReview: status === "memory-ready-shadow",
      canUseSupabaseRowsForShadowBacktest: supabaseTrainingCorpusCensus?.controls.canUseForShadowBacktest ?? false,
      canApplyLearnedWeightsToPredictions: false,
      canPromoteLearnedWeights: false,
      canWriteProviderRows: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    blockers,
    proofUrls: unique([
      "/api/sports/decision/training/memory-gate",
      "/api/sports/decision/training/readiness",
      "/api/sports/decision/training/supabase-training-corpus-census",
      "/api/sports/decision/training/promotion-governor",
      ...trainingReadiness.proofUrls,
      ...learnedWeightPromotionGovernor.proofUrls,
      ...(supabaseTrainingCorpusCensus?.proofUrls ?? [])
    ])
  };
}
