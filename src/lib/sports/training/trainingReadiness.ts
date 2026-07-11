import type { TrainingCorpusCommand, TrainingCorpusSignal, TrainingCorpusSport } from "@/lib/sports/training/multiSportCorpusPlan";
import type { TrainingCorpusProof, TrainingCorpusProofGateStatus, TrainingCorpusProofSport } from "@/lib/sports/training/trainingCorpusProof";
import type { TrainingDataBlueprint, TrainingDataBlueprintPhase } from "@/lib/sports/training/trainingDataBlueprint";

export type TrainingReadinessStatus = "trainable-shadow" | "backfill-ready" | "waiting-corpus" | "blocked";
export type TrainingReadinessGateStatus = TrainingCorpusProofGateStatus;

export type TrainingReadinessGate = {
  id: string;
  label: string;
  status: TrainingReadinessGateStatus;
  detail: string;
  requiredEvidence: string;
};

export type TrainingReadinessLabelState = {
  resultLabels: TrainingReadinessGateStatus;
  closingOdds: TrainingReadinessGateStatus;
  featureParity: TrainingReadinessGateStatus;
  trainValidationTestSplit: TrainingReadinessGateStatus;
  backtestOutcome: TrainingReadinessGateStatus;
  clv: TrainingReadinessGateStatus;
};

export type TrainingReadinessModelFamily = {
  id: string;
  label: string;
  status: TrainingReadinessStatus;
  blockedBy: string[];
  unlocks: string;
};

export type TrainingReadinessSport = {
  sport: TrainingCorpusSport;
  status: TrainingReadinessStatus;
  readinessScore: number;
  estimatedHistoricalMatches: number;
  current: TrainingCorpusProofSport["current"];
  deficits: TrainingCorpusProofSport["deficits"];
  labelState: TrainingReadinessLabelState;
  modelFamilies: TrainingReadinessModelFamily[];
  gates: TrainingReadinessGate[];
  signals: TrainingCorpusSignal[];
  nextAction: string;
};

export type TrainingReadiness = {
  generatedAt: string;
  mode: "training-readiness";
  status: TrainingReadinessStatus;
  readinessHash: string;
  summary: string;
  seasonWindow: TrainingDataBlueprint["seasonWindow"];
  totals: {
    sports: number;
    trainableSports: number;
    backfillReadySports: number;
    waitingSports: number;
    blockedSports: number;
    estimatedHistoricalMatches: number;
    realFinishedFixtures: number;
    realOddsSnapshots: number;
    featureSnapshots: number;
    backtestRuns: number;
    fixtureDeficit: number;
    oddsDeficit: number;
    featureDeficit: number;
    backtestDeficit: number;
  };
  sports: TrainingReadinessSport[];
  gates: TrainingReadinessGate[];
  phases: TrainingDataBlueprintPhase[];
  nextSafeCommand: TrainingCorpusCommand;
  controls: {
    canInspectReadOnly: true;
    canRunBackfillDryRun: boolean;
    canWriteProviderRows: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canUseLearnedWeights: false;
    canPublishPicks: false;
    canUpgradePublicAction: false;
  };
  blockers: string[];
  warnings: string[];
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

function gate(input: TrainingReadinessGate): TrainingReadinessGate {
  return input;
}

function statusFromGate(status: boolean, watch: boolean): TrainingReadinessGateStatus {
  if (status) return "pass";
  return watch ? "watch" : "block";
}

function labelStateForSport(sport: TrainingCorpusProofSport): TrainingReadinessLabelState {
  const current = sport.current;
  return {
    resultLabels: statusFromGate(current.realFinishedFixtures >= 1000, current.realFinishedFixtures > 0),
    closingOdds: statusFromGate(current.realOddsSnapshots >= 2000, current.realOddsSnapshots > 0),
    featureParity: statusFromGate(current.featureSnapshots >= Math.max(1000, current.realFinishedFixtures), current.featureSnapshots > 0),
    trainValidationTestSplit: statusFromGate(current.realFinishedFixtures >= 1000 && current.featureSnapshots >= 1000, current.realFinishedFixtures > 0),
    backtestOutcome: statusFromGate(current.backtestRuns > 0, current.backtestRuns > 0),
    clv: statusFromGate(current.realOddsSnapshots >= 2000 && current.backtestRuns > 0, current.realOddsSnapshots > 0)
  };
}

function gateStatusFromLabelState(state: TrainingReadinessLabelState): TrainingReadinessGateStatus {
  const values = Object.values(state);
  if (values.every((value) => value === "pass")) return "pass";
  if (values.some((value) => value === "watch")) return "watch";
  return "block";
}

function familyDefinitions(sport: TrainingCorpusSport): Array<{ id: string; label: string; unlocks: string; requiredSignals: string[] }> {
  if (sport === "football") {
    return [
      {
        id: "football-poisson-xg",
        label: "Poisson, xG, and scoreline distribution",
        unlocks: "Calibrated expected goals and scoreline probabilities from historical outcomes.",
        requiredSignals: ["Real finished fixtures", "Historical feature snapshots", "Completed real-data backtest"]
      },
      {
        id: "football-elo-strength",
        label: "Elo/team strength and home advantage",
        unlocks: "Learned team-strength priors, home advantage, and recent-form weights.",
        requiredSignals: ["Real finished fixtures", "Historical feature snapshots"]
      },
      {
        id: "football-market-prior",
        label: "Market odds and CLV adjustment",
        unlocks: "No-vig market prior, edge calibration, and closing-line value checks.",
        requiredSignals: ["Real odds snapshots", "Completed real-data backtest"]
      }
    ];
  }
  if (sport === "basketball") {
    return [
      {
        id: "basketball-rating-efficiency",
        label: "Rating, pace, and efficiency model",
        unlocks: "Team rating, pace, offensive efficiency, defensive efficiency, and rest-day calibration.",
        requiredSignals: ["Real finished fixtures", "Historical feature snapshots", "Completed real-data backtest"]
      },
      {
        id: "basketball-market-spread",
        label: "Spread, moneyline, and totals market logic",
        unlocks: "Spread/moneyline conversion, total points calibration, and market-prior adjustment.",
        requiredSignals: ["Real odds snapshots", "Completed real-data backtest"]
      }
    ];
  }
  return [
    {
      id: "tennis-surface-elo",
      label: "Player Elo and surface-specific rating",
      unlocks: "Surface Elo, fatigue, form, and tournament-round weights.",
      requiredSignals: ["Real finished fixtures", "Historical feature snapshots", "Completed real-data backtest"]
    },
    {
      id: "tennis-market-context",
      label: "Match winner and totals market context",
      unlocks: "No-vig tennis market prior, head-to-head/fatigue risk caps, and CLV checks.",
      requiredSignals: ["Real odds snapshots", "Completed real-data backtest"]
    }
  ];
}

function blockedByForFamily(sport: TrainingCorpusProofSport, requiredSignals: string[]): string[] {
  return requiredSignals.filter((signal) => {
    if (signal === "Real finished fixtures") return sport.current.realFinishedFixtures < 1000;
    if (signal === "Real odds snapshots") return sport.current.realOddsSnapshots < 2000;
    if (signal === "Historical feature snapshots") return sport.current.featureSnapshots < Math.max(1000, sport.current.realFinishedFixtures);
    if (signal === "Completed real-data backtest") return sport.current.backtestRuns < 1;
    return false;
  });
}

function sportStatus({
  sport,
  corpusProof
}: {
  sport: TrainingCorpusProofSport;
  corpusProof: TrainingCorpusProof;
}): TrainingReadinessStatus {
  if (corpusProof.status === "blocked-supabase" || sport.status === "blocked-supabase") return "blocked";
  const labels = labelStateForSport(sport);
  if (Object.values(labels).every((value) => value === "pass")) return "trainable-shadow";
  if (sport.status === "ready-dry-run" || corpusProof.controls.canRunProviderDryRun) return "backfill-ready";
  return "waiting-corpus";
}

function scoreSport(sport: TrainingCorpusProofSport, status: TrainingReadinessStatus): number {
  if (status === "blocked") return 0;
  const labels = Object.values(labelStateForSport(sport));
  const labelScore = labels.reduce((sum, value) => sum + (value === "pass" ? 12 : value === "watch" ? 5 : 0), 0);
  const corpusScore = Math.min(18, Math.round((sport.current.realFinishedFixtures / 1000) * 8 + (sport.current.realOddsSnapshots / 2000) * 6 + (sport.current.featureSnapshots / 1000) * 4));
  const dryRunBonus = status === "backfill-ready" ? 8 : 0;
  const trainableBonus = status === "trainable-shadow" ? 10 : 0;
  return clamp(labelScore + corpusScore + dryRunBonus + trainableBonus);
}

function buildSport({
  sport,
  corpusProof
}: {
  sport: TrainingCorpusProofSport;
  corpusProof: TrainingCorpusProof;
}): TrainingReadinessSport {
  const labels = labelStateForSport(sport);
  const status = sportStatus({ sport, corpusProof });
  const modelFamilies = familyDefinitions(sport.sport).map((family): TrainingReadinessModelFamily => {
    const blockedBy = blockedByForFamily(sport, family.requiredSignals);
    return {
      id: family.id,
      label: family.label,
      status: status === "blocked" ? "blocked" : blockedBy.length ? "waiting-corpus" : "trainable-shadow",
      blockedBy,
      unlocks: family.unlocks
    };
  });
  const gates = [
    gate({
      id: "labels",
      label: "Outcome and market labels",
      status: gateStatusFromLabelState(labels),
      detail: `Results ${labels.resultLabels}; closing odds ${labels.closingOdds}; CLV ${labels.clv}.`,
      requiredEvidence: "Finished fixtures, priced bookmaker odds, closing snapshots, and resolved outcomes."
    }),
    gate({
      id: "feature-parity",
      label: "Historical feature parity",
      status: labels.featureParity,
      detail: `${sport.current.featureSnapshots.toLocaleString()} feature snapshot rows for ${sport.current.realFinishedFixtures.toLocaleString()} real finished fixtures.`,
      requiredEvidence: "Feature vectors must match the live model-card features for the sport."
    }),
    gate({
      id: "split",
      label: "Train/validation/test split",
      status: labels.trainValidationTestSplit,
      detail: `${sport.current.realFinishedFixtures.toLocaleString()} real finished fixtures available for splitting.`,
      requiredEvidence: "Enough provider-backed rows to separate train, validation, and test windows without demo rows."
    }),
    gate({
      id: "backtest",
      label: "Completed real-data backtest",
      status: labels.backtestOutcome,
      detail: `${sport.current.backtestRuns.toLocaleString()} stored backtest run(s).`,
      requiredEvidence: "A completed run with ROI, yield, Brier score, log loss, edge, and CLV metrics."
    }),
    gate({
      id: "control-policy",
      label: "No public model upgrade",
      status: "pass",
      detail: "Training readiness is shadow-only; it cannot publish picks, stake, persist training rows, or activate learned weights.",
      requiredEvidence: "Read-only receipt controls remain false for train, learned weights, publish, and public-action upgrade."
    })
  ];

  return {
    sport: sport.sport,
    status,
    readinessScore: scoreSport(sport, status),
    estimatedHistoricalMatches: sport.estimatedHistoricalMatches,
    current: sport.current,
    deficits: sport.deficits,
    labelState: labels,
    modelFamilies,
    gates,
    signals: sport.signals,
    nextAction:
      status === "trainable-shadow"
        ? "Run a real-data shadow backtest review and compare metrics before learned weights can influence decisions."
        : sport.nextAction
  };
}

function overallStatus(sports: TrainingReadinessSport[], corpusProof: TrainingCorpusProof): TrainingReadinessStatus {
  if (corpusProof.status === "blocked-supabase" || sports.some((sport) => sport.status === "blocked")) return "blocked";
  if (sports.every((sport) => sport.status === "trainable-shadow")) return "trainable-shadow";
  if (sports.some((sport) => sport.status === "backfill-ready")) return "backfill-ready";
  return "waiting-corpus";
}

function summaryFor(status: TrainingReadinessStatus): string {
  if (status === "trainable-shadow") return "The 10-year corpus is ready for shadow training review; learned weights still cannot affect public decisions.";
  if (status === "backfill-ready") return "Training is not ready yet, but the next safe step is a capped historical-provider dry-run.";
  if (status === "waiting-corpus") return "Training is waiting on real provider-backed fixtures, odds, feature snapshots, labels, and completed backtests.";
  return "Training readiness is blocked by Supabase target, schema, credential, or project-isolation proof.";
}

export function buildTrainingReadiness({
  trainingBlueprint,
  trainingCorpusProof,
  now = new Date()
}: {
  trainingBlueprint: TrainingDataBlueprint;
  trainingCorpusProof: TrainingCorpusProof;
  now?: Date;
}): TrainingReadiness {
  const sports = trainingCorpusProof.sports.map((sport) => buildSport({ sport, corpusProof: trainingCorpusProof }));
  const status = overallStatus(sports, trainingCorpusProof);
  const totals = {
    sports: sports.length,
    trainableSports: sports.filter((sport) => sport.status === "trainable-shadow").length,
    backfillReadySports: sports.filter((sport) => sport.status === "backfill-ready").length,
    waitingSports: sports.filter((sport) => sport.status === "waiting-corpus").length,
    blockedSports: sports.filter((sport) => sport.status === "blocked").length,
    estimatedHistoricalMatches: trainingCorpusProof.targets.estimatedHistoricalMatches,
    realFinishedFixtures: trainingCorpusProof.totals.realFinishedFixtures,
    realOddsSnapshots: trainingCorpusProof.totals.realOddsSnapshots,
    featureSnapshots: trainingCorpusProof.totals.featureSnapshots,
    backtestRuns: trainingCorpusProof.totals.backtestRuns,
    fixtureDeficit: trainingCorpusProof.totals.fixtureDeficit,
    oddsDeficit: trainingCorpusProof.totals.oddsDeficit,
    featureDeficit: trainingCorpusProof.totals.featureDeficit,
    backtestDeficit: trainingCorpusProof.totals.backtestDeficit
  };
  const gates = [
    gate({
      id: "supabase-corpus-proof",
      label: "Supabase and corpus proof",
      status: trainingCorpusProof.status === "blocked-supabase" ? "block" : trainingCorpusProof.supabase.schemaVerified ? "pass" : "watch",
      detail: trainingCorpusProof.supabase.blocker ?? `Supabase proof is ${trainingCorpusProof.supabase.status}; schema verified=${trainingCorpusProof.supabase.schemaVerified}.`,
      requiredEvidence: "/api/sports/decision/supabase-proof-binder and /api/sports/decision/training/corpus-proof."
    }),
    gate({
      id: "minimum-sample",
      label: "Minimum real sample by sport",
      status: sports.every((sport) => sport.current.realFinishedFixtures >= 1000) ? "pass" : sports.some((sport) => sport.current.realFinishedFixtures > 0) ? "watch" : "block",
      detail: `${totals.realFinishedFixtures.toLocaleString()} real finished fixtures; deficit ${totals.fixtureDeficit.toLocaleString()}.`,
      requiredEvidence: "At least 1,000 non-demo finished fixtures for each sport before first serious model training."
    }),
    gate({
      id: "market-labels",
      label: "Odds and CLV labels",
      status: sports.every((sport) => sport.current.realOddsSnapshots >= 2000 && sport.current.backtestRuns > 0) ? "pass" : sports.some((sport) => sport.current.realOddsSnapshots > 0) ? "watch" : "block",
      detail: `${totals.realOddsSnapshots.toLocaleString()} real odds snapshots; odds deficit ${totals.oddsDeficit.toLocaleString()}.`,
      requiredEvidence: "Opening, pre-match, and closing odds snapshots with bookmaker metadata."
    }),
    gate({
      id: "backtests",
      label: "Completed backtests",
      status: sports.every((sport) => sport.current.backtestRuns > 0) ? "pass" : "block",
      detail: `${totals.backtestRuns.toLocaleString()} completed/stored backtest run(s); deficit ${totals.backtestDeficit.toLocaleString()}.`,
      requiredEvidence: "Stored completed backtests with calibration and value metrics for every sport."
    }),
    gate({
      id: "shadow-only-controls",
      label: "Shadow-only controls",
      status: "pass",
      detail: "This receipt keeps provider writes, training-row persistence, model training, learned weights, publishing, and public-action upgrades locked.",
      requiredEvidence: "All write/train/publish controls are false in this response."
    })
  ];
  const readinessHash = stableHash({
    status,
    blueprint: trainingBlueprint.blueprintHash,
    corpus: trainingCorpusProof.proofHash,
    sports: sports.map((sport) => [sport.sport, sport.status, sport.readinessScore, sport.labelState, sport.deficits]),
    controls: trainingCorpusProof.controls
  });
  const blockers = unique([
    ...trainingCorpusProof.blockers,
    ...sports.flatMap((sport) => (sport.status === "trainable-shadow" ? [] : [`${sport.sport}: ${sport.nextAction}`]))
  ]);
  const warnings = unique([
    ...trainingBlueprint.warnings,
    ...sports.flatMap((sport) =>
      sport.modelFamilies.flatMap((family) => (family.blockedBy.length ? [`${sport.sport} ${family.label}: ${family.blockedBy.join(", ")}`] : []))
    )
  ]);

  return {
    generatedAt: now.toISOString(),
    mode: "training-readiness",
    status,
    readinessHash,
    summary: summaryFor(status),
    seasonWindow: trainingBlueprint.seasonWindow,
    totals,
    sports,
    gates,
    phases: trainingBlueprint.phases,
    nextSafeCommand: status === "blocked" ? trainingCorpusProof.nextProof : trainingBlueprint.nextSafeCommand,
    controls: {
      canInspectReadOnly: true,
      canRunBackfillDryRun: trainingCorpusProof.controls.canRunProviderDryRun,
      canWriteProviderRows: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canUseLearnedWeights: false,
      canPublishPicks: false,
      canUpgradePublicAction: false
    },
    blockers,
    warnings,
    proofUrls: unique([
      "/api/sports/decision/training/readiness",
      "/api/sports/decision/training/corpus-proof",
      "/api/sports/decision/training/data-blueprint",
      "/api/sports/decision/training/multi-sport-corpus-plan",
      "/api/sports/decision/env-activation-matrix",
      ...trainingCorpusProof.proofUrls,
      ...trainingBlueprint.proofUrls
    ])
  };
}
