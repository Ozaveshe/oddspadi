import type { MultiSportCorpusPlan, TrainingCorpusSport, TrainingCorpusSportPlan } from "@/lib/sports/training/multiSportCorpusPlan";
import type { StoredBacktestRun, TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export type MultiSportModelGovernanceStatus = "shadow-review-ready" | "partial-models-ready" | "waiting-provider-data" | "blocked-storage";
export type MultiSportModelGovernanceSportStatus = "shadow-eligible" | "backtest-ready" | "model-ready-data-waiting" | "waiting-provider-env" | "blocked-storage";
export type MultiSportModelGovernanceGateStatus = "pass" | "watch" | "block";

export type MultiSportModelGovernanceGate = {
  id: "model-implemented" | "provider-env" | "stored-data" | "odds-history" | "feature-quality" | "backtest" | "calibration" | "promotion-lock";
  label: string;
  status: MultiSportModelGovernanceGateStatus;
  evidence: string;
  requiredAction: string;
};

export type MultiSportModelGovernanceSport = {
  sport: TrainingCorpusSport;
  status: MultiSportModelGovernanceSportStatus;
  modelKey: string | null;
  modelFamily: string;
  targetCompetitions: string[];
  requiredFeatures: string[];
  missingEnv: string[];
  corpus: {
    estimatedHistoricalMatches: number;
    storedFixtures: number;
    realFinishedFixtures: number;
    realOddsSnapshots: number;
    featureSnapshots: number;
    completeFeatureSnapshots: number;
    partialFeatureSnapshots: number;
    proxyFeatureSnapshots: number;
    backtestRuns: number;
  };
  latestBacktest: {
    present: boolean;
    sampleSize: number;
    pickCount: number;
    brierScore: number | null;
    logLoss: number | null;
    yield: number | null;
    calibrationError: number | null;
    closingLineValue: number | null;
  };
  gates: MultiSportModelGovernanceGate[];
  nextAction: string;
  proofUrl: string;
};

export type MultiSportModelGovernance = {
  mode: "multi-sport-model-governance";
  generatedAt: string;
  status: MultiSportModelGovernanceStatus;
  governanceHash: string;
  summary: string;
  sports: MultiSportModelGovernanceSport[];
  totals: {
    sports: number;
    shadowEligible: number;
    backtestReady: number;
    waitingProviderData: number;
    blockedStorage: number;
    requiredEnv: number;
    missingEnv: number;
  };
  sequence: Array<{
    step: number;
    sport: TrainingCorpusSport;
    action: string;
    proofUrl: string;
  }>;
  controls: {
    canInspectReadOnly: true;
    canRunReadOnlyProof: true;
    canRunBacktests: boolean;
    canPersistTrainingRows: false;
    canApplyLearnedWeights: false;
    canPromoteLiveProbabilities: false;
    canPublishPicks: false;
    canStake: false;
  };
  locks: string[];
  proofUrls: string[];
};

const MINIMUMS: Record<TrainingCorpusSport, { fixtures: number; odds: number; backtestSample: number; maxCalibrationError: number }> = {
  football: { fixtures: 1000, odds: 1000, backtestSample: 300, maxCalibrationError: 0.14 },
  basketball: { fixtures: 300, odds: 300, backtestSample: 80, maxCalibrationError: 0.16 },
  tennis: { fixtures: 500, odds: 500, backtestSample: 120, maxCalibrationError: 0.16 }
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
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function modelFamily(sport: TrainingCorpusSport): string {
  if (sport === "football") return "Poisson expected goals, Elo/team strength, home advantage, recent form, odds edge, xG-ready context";
  if (sport === "basketball") return "Team rating, pace, offensive/defensive efficiency, rest days, home court, injuries, moneyline/spread/total logic";
  return "Player Elo, surface rating, recent form, head-to-head, fatigue/load, tournament round, injury/news context";
}

function latest(backtest: StoredBacktestRun | null): MultiSportModelGovernanceSport["latestBacktest"] {
  return {
    present: Boolean(backtest),
    sampleSize: backtest?.sampleSize ?? 0,
    pickCount: backtest?.pickCount ?? 0,
    brierScore: backtest?.brierScore ?? null,
    logLoss: backtest?.logLoss ?? null,
    yield: backtest?.yield ?? null,
    calibrationError: backtest?.calibrationError ?? null,
    closingLineValue: backtest?.closingLineValue ?? null
  };
}

function gate(input: MultiSportModelGovernanceGate): MultiSportModelGovernanceGate {
  return {
    ...input,
    evidence: input.evidence.replace(/\s+/g, " ").trim(),
    requiredAction: input.requiredAction.replace(/\s+/g, " ").trim()
  };
}

function gatesFor({
  plan,
  snapshot,
  backtest
}: {
  plan: TrainingCorpusSportPlan;
  snapshot: TrainingDataSnapshot;
  backtest: MultiSportModelGovernanceSport["latestBacktest"];
}): MultiSportModelGovernanceGate[] {
  const minimum = MINIMUMS[plan.sport];
  const storageReady = snapshot.status === "ready" && snapshot.storage?.status === "ready";
  const enoughFixtures = snapshot.counts.realFinishedFixtures >= minimum.fixtures;
  const enoughOdds = snapshot.counts.realOddsSnapshots >= minimum.odds;
  const completeFeatureSnapshots = snapshot.counts.completeFeatureSnapshots ?? snapshot.counts.featureSnapshots;
  const enoughCompleteFeatures = completeFeatureSnapshots >= minimum.fixtures;
  const storedProviderEvidenceReady = storageReady && enoughFixtures && enoughOdds && enoughCompleteFeatures && backtest.present;
  const enoughBacktest = backtest.sampleSize >= minimum.backtestSample && backtest.present;
  const calibrationPass = backtest.calibrationError !== null && backtest.calibrationError <= minimum.maxCalibrationError;

  return [
    gate({
      id: "model-implemented",
      label: "Model implemented",
      status: plan.backtestRunnerStatus === "implemented" && plan.backtestModelKey ? "pass" : "block",
      evidence: `${plan.adapter}; model ${plan.backtestModelKey ?? "missing"}; runner ${plan.backtestRunnerStatus}.`,
      requiredAction: "Keep sport-specific model and backtest runner implemented before collecting promotion evidence."
    }),
    gate({
      id: "provider-env",
      label: "Provider environment",
      status: plan.missingEnvKeys.length ? (storedProviderEvidenceReady ? "watch" : "block") : "pass",
      evidence: plan.missingEnvKeys.length
        ? storedProviderEvidenceReady
          ? `Stored corpus and backtest evidence are present; future live refresh still misses ${plan.missingEnvKeys.join(", ")}.`
          : `Missing ${plan.missingEnvKeys.join(", ")}.`
        : `Configured ${plan.configuredEnvKeys.join(", ") || "required provider env"}.`,
      requiredAction: storedProviderEvidenceReady
        ? `Keep ${plan.sport} historical governance in shadow review, and configure missing provider env before live refresh automation.`
        : `Configure provider and odds keys for ${plan.sport} without exposing secrets.`
    }),
    gate({
      id: "stored-data",
      label: "Stored historical data",
      status: storageReady && enoughFixtures ? "pass" : storageReady && snapshot.counts.realFinishedFixtures > 0 ? "watch" : "block",
      evidence: `${snapshot.counts.realFinishedFixtures}/${minimum.fixtures} real finished fixture(s); storage ${snapshot.storage?.status ?? snapshot.status}.`,
      requiredAction: `Store at least ${minimum.fixtures.toLocaleString()} real finished ${plan.sport} rows before trusting calibration.`
    }),
    gate({
      id: "odds-history",
      label: "Odds history",
      status: enoughOdds ? "pass" : snapshot.counts.realOddsSnapshots > 0 ? "watch" : "block",
      evidence: `${snapshot.counts.realOddsSnapshots}/${minimum.odds} real odds snapshot(s).`,
      requiredAction: "Store bookmaker odds snapshots with market, selection, decimal price, bookmaker, and timestamp."
    }),
    gate({
      id: "feature-quality",
      label: "Complete model features",
      status: enoughCompleteFeatures ? "pass" : completeFeatureSnapshots > 0 ? "watch" : "block",
      evidence: `${completeFeatureSnapshots}/${minimum.fixtures} complete sport-specific feature row(s); ${snapshot.counts.featureSnapshots} total, ${snapshot.counts.partialFeatureSnapshots ?? 0} partial, ${snapshot.counts.proxyFeatureSnapshots ?? 0} proxy.`,
      requiredAction: `Materialize at least ${minimum.fixtures.toLocaleString()} proxy-free rows containing every core ${plan.sport} model input.`
    }),
    gate({
      id: "backtest",
      label: "Backtest evidence",
      status: enoughBacktest ? "pass" : backtest.present ? "watch" : "block",
      evidence: backtest.present ? `${backtest.sampleSize}/${minimum.backtestSample} sample rows; ${backtest.pickCount} pick(s).` : "No stored backtest run.",
      requiredAction: "Run and review a stored historical backtest before any learned weights can be considered."
    }),
    gate({
      id: "calibration",
      label: "Calibration quality",
      status: calibrationPass ? "pass" : backtest.calibrationError !== null ? "watch" : "block",
      evidence: `Brier ${backtest.brierScore ?? "n/a"}; log-loss ${backtest.logLoss ?? "n/a"}; calibration ${backtest.calibrationError ?? "n/a"}; yield ${backtest.yield ?? "n/a"}.`,
      requiredAction: `Calibration error must be <= ${minimum.maxCalibrationError} with enough holdout rows and market comparison.`
    }),
    gate({
      id: "promotion-lock",
      label: "Promotion lock",
      status: "pass",
      evidence: "This governance receipt cannot apply learned weights, publish picks, or stake.",
      requiredAction: "Use separate promotion and answer gates after sport-specific backtests pass."
    })
  ];
}

function statusFor(gates: MultiSportModelGovernanceGate[], plan: TrainingCorpusSportPlan, snapshot: TrainingDataSnapshot): MultiSportModelGovernanceSportStatus {
  if (snapshot.status !== "ready" || snapshot.storage?.status === "credential-error" || snapshot.storage?.status === "schema-error") return "blocked-storage";
  if (plan.missingEnvKeys.length && gates.some((item) => item.id === "provider-env" && item.status === "block")) return "waiting-provider-env";
  const blockingCore = gates.filter((item) => item.id !== "promotion-lock" && item.status === "block");
  if (!blockingCore.length && gates.some((item) => item.id === "backtest" && item.status === "pass") && gates.some((item) => item.id === "calibration" && item.status === "pass")) {
    return "shadow-eligible";
  }
  if (!blockingCore.length || gates.some((item) => item.id === "backtest" && item.status !== "block")) return "backtest-ready";
  return "model-ready-data-waiting";
}

function nextActionFor(status: MultiSportModelGovernanceSportStatus, gates: MultiSportModelGovernanceGate[], plan: TrainingCorpusSportPlan): string {
  if (status === "shadow-eligible") return "Queue shadow comparison only; keep learned weights and public picks locked.";
  if (status === "blocked-storage") return "Fix OddsPadi Supabase credential/schema proof before reading or storing training evidence.";
  if (status === "waiting-provider-env") return `Configure ${plan.missingEnvKeys[0] ?? "provider env"} and rerun the corpus proof.`;
  const first = gates.find((item) => item.status === "block") ?? gates.find((item) => item.status === "watch");
  return first?.requiredAction ?? "Run sport-specific backtest and promotion receipts.";
}

function sportProofUrl(sport: TrainingCorpusSport): string {
  return `/api/sports/decision/training/readiness?sport=${sport}`;
}

function buildSport(plan: TrainingCorpusSportPlan, snapshot: TrainingDataSnapshot): MultiSportModelGovernanceSport {
  const backtest = latest(snapshot.latestBacktest);
  const gates = gatesFor({ plan, snapshot, backtest });
  const status = statusFor(gates, plan, snapshot);
  return {
    sport: plan.sport,
    status,
    modelKey: plan.backtestModelKey,
    modelFamily: modelFamily(plan.sport),
    targetCompetitions: plan.targetCompetitions.map((target) => target.name),
    requiredFeatures: plan.modelFeatures,
    missingEnv: plan.missingEnvKeys,
    corpus: {
      estimatedHistoricalMatches: plan.estimatedHistoricalMatches,
      storedFixtures: snapshot.counts.fixtures,
      realFinishedFixtures: snapshot.counts.realFinishedFixtures,
      realOddsSnapshots: snapshot.counts.realOddsSnapshots,
      featureSnapshots: snapshot.counts.featureSnapshots,
      completeFeatureSnapshots: snapshot.counts.completeFeatureSnapshots ?? snapshot.counts.featureSnapshots,
      partialFeatureSnapshots: snapshot.counts.partialFeatureSnapshots ?? 0,
      proxyFeatureSnapshots: snapshot.counts.proxyFeatureSnapshots ?? 0,
      backtestRuns: snapshot.counts.backtestRuns
    },
    latestBacktest: backtest,
    gates,
    nextAction: nextActionFor(status, gates, plan),
    proofUrl: sportProofUrl(plan.sport)
  };
}

function overallStatus(sports: MultiSportModelGovernanceSport[]): MultiSportModelGovernanceStatus {
  if (sports.some((sport) => sport.status === "blocked-storage")) return "blocked-storage";
  if (sports.some((sport) => sport.status === "shadow-eligible")) return "shadow-review-ready";
  if (sports.some((sport) => sport.status === "backtest-ready")) return "partial-models-ready";
  return "waiting-provider-data";
}

function summaryFor(status: MultiSportModelGovernanceStatus, sports: MultiSportModelGovernanceSport[]): string {
  if (status === "shadow-review-ready") return "At least one sport has enough stored backtest and calibration evidence for shadow comparison; learned weights and public picks remain locked.";
  if (status === "partial-models-ready") return "Sport-specific model runners exist and at least one sport has partial backtest evidence, but promotion remains locked.";
  if (status === "blocked-storage") return "Multi-sport model governance is blocked by OddsPadi storage or credential proof.";
  return `Multi-sport model governance is waiting for provider data across ${sports.length} sport(s).`;
}

export function buildMultiSportModelGovernance({
  corpusPlan,
  trainingSnapshots,
  now = new Date()
}: {
  corpusPlan: MultiSportCorpusPlan;
  trainingSnapshots: TrainingDataSnapshot[];
  now?: Date;
}): MultiSportModelGovernance {
  const snapshots = new Map(trainingSnapshots.map((snapshot) => [snapshot.sport, snapshot]));
  const sports = corpusPlan.sports.map((plan) => buildSport(plan, snapshots.get(plan.sport) ?? {
    generatedAt: now.toISOString(),
    status: "not-configured",
    configured: false,
    sport: plan.sport,
    counts: {
      fixtures: 0,
      finishedFixtures: 0,
      realFinishedFixtures: 0,
      demoFinishedFixtures: 0,
      oddsSnapshots: 0,
      realOddsSnapshots: 0,
      demoOddsSnapshots: 0,
      eventSnapshots: 0,
      realEventSnapshots: 0,
      demoEventSnapshots: 0,
      newsSnapshots: 0,
      realNewsSnapshots: 0,
      demoNewsSnapshots: 0,
      standingsSnapshots: 0,
      realStandingsSnapshots: 0,
      demoStandingsSnapshots: 0,
      availabilitySnapshots: 0,
      realAvailabilitySnapshots: 0,
      demoAvailabilitySnapshots: 0,
      lineupSnapshots: 0,
      realLineupSnapshots: 0,
      demoLineupSnapshots: 0,
      weatherSnapshots: 0,
      realWeatherSnapshots: 0,
      demoWeatherSnapshots: 0,
      featureSnapshots: 0,
      backtestRuns: 0
    },
    latestBacktest: null,
    readiness: {
      hasHistoricalFixtures: false,
      hasOdds: false,
      hasBacktests: false,
      readyForTraining: false,
      minimumRecommendedFixtures: MINIMUMS[plan.sport].fixtures,
      detail: "Training snapshot was unavailable."
    }
  }));
  const status = overallStatus(sports);
  const totals = {
    sports: sports.length,
    shadowEligible: sports.filter((sport) => sport.status === "shadow-eligible").length,
    backtestReady: sports.filter((sport) => sport.status === "backtest-ready").length,
    waitingProviderData: sports.filter((sport) => sport.status === "model-ready-data-waiting" || sport.status === "waiting-provider-env").length,
    blockedStorage: sports.filter((sport) => sport.status === "blocked-storage").length,
    requiredEnv: corpusPlan.requiredEnvKeys.length,
    missingEnv: corpusPlan.missingEnvKeys.length
  };
  const sequence = sports
    .filter((sport) => sport.status !== "shadow-eligible")
    .map((sport, index) => ({
      step: index + 1,
      sport: sport.sport,
      action: sport.nextAction,
      proofUrl: sport.proofUrl
    }));

  return {
    mode: "multi-sport-model-governance",
    generatedAt: now.toISOString(),
    status,
    governanceHash: stableHash({
      status,
      corpus: [corpusPlan.id, corpusPlan.status, corpusPlan.missingEnvKeys],
      sports: sports.map((sport) => [
        sport.sport,
        sport.status,
        sport.modelKey,
        sport.corpus.realFinishedFixtures,
        sport.corpus.realOddsSnapshots,
        sport.corpus.completeFeatureSnapshots,
        sport.latestBacktest.sampleSize,
        sport.latestBacktest.calibrationError
      ])
    }),
    summary: summaryFor(status, sports),
    sports,
    totals,
    sequence,
    controls: {
      canInspectReadOnly: true,
      canRunReadOnlyProof: true,
      canRunBacktests: corpusPlan.status === "ready" && totals.blockedStorage === 0,
      canPersistTrainingRows: false,
      canApplyLearnedWeights: false,
      canPromoteLiveProbabilities: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Multi-sport model governance is read-only and cannot persist training rows, apply learned weights, promote live probabilities, publish picks, or stake.",
      "Football, basketball, and tennis models can be implemented while still blocked from public authority until stored data, odds, backtests, and calibration pass.",
      "A sport becoming shadow-eligible only allows separate shadow comparison; it does not unlock live probabilities or picks.",
      "Provider env and Supabase credentials must stay server-only and cannot be exposed in client code, AI prompts, or proof receipts."
    ],
    proofUrls: unique([
      "/api/sports/decision/training/multi-sport-model-governance",
      "/api/sports/decision/training/multi-sport-corpus-plan",
      "/api/sports/decision/training/readiness",
      ...sports.map((sport) => sport.proofUrl),
      ...(corpusPlan.proofUrls ?? [])
    ])
  };
}
