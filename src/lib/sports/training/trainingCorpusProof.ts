import type { DecisionSupabaseProofBinder } from "@/lib/sports/prediction/decisionSupabaseProofBinder";
import type { MultiSportCorpusPlan, TrainingCorpusCommand, TrainingCorpusSignal, TrainingCorpusSport } from "@/lib/sports/training/multiSportCorpusPlan";
import type { TrainingDataBlueprint, TrainingDataBlueprintSport } from "@/lib/sports/training/trainingDataBlueprint";

export type TrainingCorpusProofStatus = "shadow-ready" | "ready-dry-run" | "waiting-env" | "waiting-corpus" | "blocked-supabase";
export type TrainingCorpusProofGateStatus = "pass" | "watch" | "block";

export type TrainingCorpusProofGate = {
  id: string;
  status: TrainingCorpusProofGateStatus;
  label: string;
  detail: string;
  unlocks: string;
};

export type TrainingCorpusProofSport = {
  sport: TrainingCorpusSport;
  status: TrainingCorpusProofStatus;
  readinessScore: number;
  adapter: string;
  backtestModelKey: string | null;
  targetCompetitions: number;
  estimatedHistoricalMatches: number;
  estimatedOddsSnapshots: number;
  current: TrainingDataBlueprintSport["currentCorpus"];
  deficits: TrainingDataBlueprintSport["deficits"];
  signals: TrainingCorpusSignal[];
  gates: TrainingCorpusProofGate[];
  nextAction: string;
};

export type TrainingCorpusProof = {
  generatedAt: string;
  mode: "training-corpus-proof";
  status: TrainingCorpusProofStatus;
  proofHash: string;
  summary: string;
  seasonWindow: TrainingDataBlueprint["seasonWindow"];
  supabase: {
    status: DecisionSupabaseProofBinder["status"];
    expectedRef: string;
    schemaVerified: boolean;
    canUseMcpForSchema: boolean;
    canWriteCorpus: false;
    blocker: string | null;
  };
  targets: {
    sports: number;
    estimatedHistoricalMatches: number;
    estimatedOddsSnapshots: number;
    minimumFixturesPerSport: number;
  };
  totals: {
    realFinishedFixtures: number;
    realOddsSnapshots: number;
    featureSnapshots: number;
    backtestRuns: number;
    fixtureDeficit: number;
    oddsDeficit: number;
    featureDeficit: number;
    backtestDeficit: number;
    passGates: number;
    watchGates: number;
    blockGates: number;
  };
  sports: TrainingCorpusProofSport[];
  phases: TrainingDataBlueprint["phases"];
  nextProof: TrainingCorpusCommand;
  controls: {
    canInspectReadOnly: true;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canUseLearnedWeights: false;
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

function unique(values: Array<string | null | undefined>, limit = 24): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function gate(input: TrainingCorpusProofGate): TrainingCorpusProofGate {
  return input;
}

function proofStatusForSport({
  sport,
  supabaseBlocked
}: {
  sport: TrainingDataBlueprintSport;
  supabaseBlocked: boolean;
}): TrainingCorpusProofStatus {
  if (supabaseBlocked) return "blocked-supabase";
  if (sport.gates.every((item) => item.status === "pass")) return "shadow-ready";
  if (sport.status === "waiting-env") return "waiting-env";
  if (sport.firstSafeCommand?.safeToRun) return "ready-dry-run";
  return "waiting-corpus";
}

function scoreSport(sport: TrainingDataBlueprintSport, supabaseBlocked: boolean): number {
  if (supabaseBlocked) return 0;
  const gateScore = sport.gates.reduce((sum, item) => sum + (item.status === "pass" ? 20 : item.status === "watch" ? 8 : 0), 0);
  const dryRunBonus = sport.firstSafeCommand?.safeToRun ? 5 : 0;
  return clamp(gateScore + dryRunBonus);
}

function commandFromBinder(binder: DecisionSupabaseProofBinder): TrainingCorpusCommand {
  return {
    label: binder.nextProof.label,
    command: binder.nextProof.command,
    verifyUrl: binder.nextProof.verifyUrl,
    safeToRun: binder.nextProof.safeToRun,
    missingEnv: binder.nextProof.missingEnv,
    expectedEvidence: binder.nextProof.expectedEvidence
  };
}

function overallStatus({
  supabaseBlocked,
  blueprint,
  sports
}: {
  supabaseBlocked: boolean;
  blueprint: TrainingDataBlueprint;
  sports: TrainingCorpusProofSport[];
}): TrainingCorpusProofStatus {
  if (supabaseBlocked) return "blocked-supabase";
  if (sports.every((sport) => sport.status === "shadow-ready")) return "shadow-ready";
  if (blueprint.status === "waiting-env") return "waiting-env";
  if (sports.some((sport) => sport.status === "ready-dry-run") || blueprint.controls.canRunDryRun) return "ready-dry-run";
  return "waiting-corpus";
}

function statusSummary(status: TrainingCorpusProofStatus): string {
  if (status === "shadow-ready") return "The 10-year corpus has enough real rows, odds, feature snapshots, and backtests for shadow learning review.";
  if (status === "ready-dry-run") return "The 10-year corpus proof is ready for supervised provider dry-runs; writes and training remain locked.";
  if (status === "waiting-env") return "The 10-year corpus proof is waiting on provider/admin/server environment before dry-runs can start.";
  if (status === "waiting-corpus") return "The 10-year corpus proof is waiting on real fixture, odds, feature, and backtest rows.";
  return "The 10-year corpus proof is blocked by Supabase project, credential, MCP, or schema proof.";
}

export function buildTrainingCorpusProof({
  corpusPlan,
  trainingBlueprint,
  supabaseProofBinder,
  now = new Date()
}: {
  corpusPlan: MultiSportCorpusPlan;
  trainingBlueprint: TrainingDataBlueprint;
  supabaseProofBinder: DecisionSupabaseProofBinder;
  now?: Date;
}): TrainingCorpusProof {
  const readOnlySchemaUsable =
    supabaseProofBinder.observed.credentialStatus === "valid" && supabaseProofBinder.observed.verifiedTableCount === supabaseProofBinder.expected.tableCount;
  const supabaseBlocked =
    supabaseProofBinder.status === "blocked-invalid-key" ||
    (supabaseProofBinder.status === "blocked-cross-project" && !readOnlySchemaUsable);
  const mixedSchemaWriteLock = supabaseProofBinder.status === "blocked-cross-project" && readOnlySchemaUsable;
  const planBySport = new Map(corpusPlan.sports.map((sport) => [sport.sport, sport]));
  const sports = trainingBlueprint.sports.map((sport): TrainingCorpusProofSport => {
    const plan = planBySport.get(sport.sport);
    const gates = [
      ...sport.gates.map((item) =>
        gate({
          id: item.id,
          status: item.status,
          label: item.label,
          detail: item.detail,
          unlocks: item.unlocks
        })
      ),
      gate({
        id: "provider-adapter",
        status: plan?.adapterStatus === "implemented" ? "pass" : "watch",
        label: "Provider adapter",
        detail: plan ? `${plan.adapterStatus} adapter: ${plan.adapter}.` : "No corpus plan exists for this sport.",
        unlocks: "Historical fixtures, results, odds, and context can be normalized into the training spine."
      }),
      gate({
        id: "backtest-runner",
        status: plan?.backtestRunnerStatus === "implemented" ? "pass" : "watch",
        label: "Backtest runner",
        detail: plan?.backtestModelKey ? `${plan.backtestRunnerStatus} runner ${plan.backtestModelKey}.` : "No sport-specific backtest runner is attached.",
        unlocks: "Real-data backtests can evaluate ROI, Brier score, log loss, CLV, and learned guardrails."
      })
    ];

    return {
      sport: sport.sport,
      status: proofStatusForSport({ sport, supabaseBlocked }),
      readinessScore: scoreSport(sport, supabaseBlocked),
      adapter: sport.adapter,
      backtestModelKey: sport.backtestModelKey,
      targetCompetitions: sport.targetCompetitions,
      estimatedHistoricalMatches: sport.estimatedHistoricalMatches,
      estimatedOddsSnapshots: sport.estimatedOddsSnapshots,
      current: sport.currentCorpus,
      deficits: sport.deficits,
      signals: plan?.signalCoverage ?? [],
      gates,
      nextAction: supabaseBlocked ? supabaseProofBinder.nextProof.expectedEvidence : sport.nextAction
    };
  });
  const gateCounts = sports.flatMap((sport) => sport.gates).reduce(
    (acc, item) => {
      if (item.status === "pass") acc.passGates += 1;
      else if (item.status === "watch") acc.watchGates += 1;
      else acc.blockGates += 1;
      return acc;
    },
    { passGates: 0, watchGates: 0, blockGates: 0 }
  );
  const totals = {
    realFinishedFixtures: sports.reduce((sum, sport) => sum + sport.current.realFinishedFixtures, 0),
    realOddsSnapshots: sports.reduce((sum, sport) => sum + sport.current.realOddsSnapshots, 0),
    featureSnapshots: sports.reduce((sum, sport) => sum + sport.current.featureSnapshots, 0),
    backtestRuns: sports.reduce((sum, sport) => sum + sport.current.backtestRuns, 0),
    fixtureDeficit: sports.reduce((sum, sport) => sum + sport.deficits.realFinishedFixtures, 0),
    oddsDeficit: sports.reduce((sum, sport) => sum + sport.deficits.realOddsSnapshots, 0),
    featureDeficit: sports.reduce((sum, sport) => sum + sport.deficits.featureSnapshots, 0),
    backtestDeficit: sports.reduce((sum, sport) => sum + sport.deficits.backtestRuns, 0),
    ...gateCounts
  };
  const status = overallStatus({ supabaseBlocked, blueprint: trainingBlueprint, sports });
  const nextProof = supabaseBlocked ? commandFromBinder(supabaseProofBinder) : trainingBlueprint.nextSafeCommand;
  const blockers = unique([
    ...(supabaseBlocked ? [supabaseProofBinder.summary] : []),
    ...trainingBlueprint.blockers,
    ...corpusPlan.blockers,
    ...sports.flatMap((sport) => (sport.status === "shadow-ready" ? [] : [`${sport.sport}: ${sport.nextAction}`]))
  ]);
  const proofHash = stableHash({
    status,
    supabase: supabaseProofBinder.status,
    corpusPlan: corpusPlan.id,
    sports: sports.map((sport) => [sport.sport, sport.status, sport.readinessScore, sport.current, sport.deficits]),
    nextProof: nextProof.verifyUrl
  });

  return {
    generatedAt: now.toISOString(),
    mode: "training-corpus-proof",
    status,
    proofHash,
    summary: statusSummary(status),
    seasonWindow: trainingBlueprint.seasonWindow,
    supabase: {
      status: supabaseProofBinder.status,
      expectedRef: supabaseProofBinder.expected.projectRef,
      schemaVerified: supabaseProofBinder.observed.verifiedTableCount === supabaseProofBinder.expected.tableCount,
      canUseMcpForSchema: supabaseProofBinder.controls.canUseMcpForSchema,
      canWriteCorpus: false,
      blocker: supabaseBlocked
        ? supabaseProofBinder.summary
        : mixedSchemaWriteLock
          ? "Mixed-schema authority keeps migrations and writes locked, but verified op_ tables may be inspected for read-only shadow learning."
          : null
    },
    targets: {
      sports: trainingBlueprint.corpusTargets.sports,
      estimatedHistoricalMatches: trainingBlueprint.corpusTargets.totalEstimatedHistoricalMatches,
      estimatedOddsSnapshots: trainingBlueprint.corpusTargets.totalEstimatedOddsSnapshots,
      minimumFixturesPerSport: trainingBlueprint.corpusTargets.minimumRecommendedFixturesPerSport
    },
    totals,
    sports,
    phases: trainingBlueprint.phases,
    nextProof,
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun: !supabaseBlocked && trainingBlueprint.controls.canRunDryRun,
      canWriteProviderRows: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canUseLearnedWeights: false,
      canPublishPicks: false,
      canUpgradePublicAction: false
    },
    blockers,
    proofUrls: unique([
      "/api/sports/decision/training/corpus-proof",
      "/api/sports/decision/training/data-blueprint",
      "/api/sports/decision/training/multi-sport-corpus-plan",
      "/api/sports/decision/supabase-proof-binder",
      ...trainingBlueprint.proofUrls,
      ...corpusPlan.proofUrls
    ])
  };
}
