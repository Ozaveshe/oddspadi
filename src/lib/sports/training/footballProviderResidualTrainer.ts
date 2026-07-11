import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";
import {
  FOOTBALL_PROVIDER_RETEST_MODEL_KEY,
  type FootballDataProviderRetestFeatureRow
} from "@/lib/sports/training/footballDataProviderRetestBridge";

type Outcome = "home" | "draw" | "away";
type Split = "train" | "validation";
type ProbabilityMap = Record<Outcome, number>;
type JsonRecord = Record<string, unknown>;

const OUTCOMES: Outcome[] = ["home", "draw", "away"];
const FEATURE_NAMES = [
  "structural_home_delta",
  "structural_draw_delta",
  "elo_edge",
  "home_attack_vs_away_defense",
  "away_attack_vs_home_defense",
  "form_edge",
  "rest_edge",
  "absence_edge",
  "lineup_edge"
] as const;
const REGULARIZATION_CANDIDATES = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2] as const;
const TRAINING_ITERATIONS = 700;
const MIN_TRAIN_ROWS = 100;
const MIN_VALIDATION_ROWS = 50;
const MIN_VALIDATION_IMPROVEMENT = 0.0005;

type ResidualExample = {
  fixtureExternalId: string;
  split: Split;
  actualOutcome: Outcome;
  marketProbabilities: ProbabilityMap;
  structuralProbabilities: ProbabilityMap;
  rawFeatures: number[];
};

type Scaler = {
  means: number[];
  standardDeviations: number[];
  activeIndexes: number[];
};

export type FootballResidualMetrics = {
  rows: number;
  brierScore: number | null;
  logLoss: number | null;
};

export type FootballMarketResidualModel = {
  version: "football-market-residual-softmax-v1";
  trainedRows: number;
  validationRows: number;
  iterations: number;
  regularization: number;
  featureNames: string[];
  droppedFeatureNames: string[];
  means: number[];
  standardDeviations: number[];
  weights: Record<Outcome, number[]>;
  modelHash: string;
};

export type FootballProviderResidualTrainerStatus =
  | "validation-pass"
  | "market-prior-dominant"
  | "thin-training-sample"
  | "thin-validation-sample"
  | "no-usable-rows"
  | "not-configured"
  | "failed";

export type FootballProviderResidualTrainerReceipt = {
  mode: "football-provider-residual-trainer";
  generatedAt: string;
  status: FootballProviderResidualTrainerStatus;
  trainerHash: string;
  summary: string;
  corpus: {
    inputRows: number;
    trainingRows: number;
    validationRows: number;
    rejectedRows: number;
  };
  featureAudit: {
    candidateFeatures: string[];
    activeFeatures: string[];
    droppedZeroVarianceFeatures: string[];
    timingPolicy: string;
  };
  baselines: {
    marketValidation: FootballResidualMetrics;
    structuralValidation: FootballResidualMetrics;
  };
  candidates: Array<{
    regularization: number;
    training: FootballResidualMetrics;
    validation: FootballResidualMetrics;
  }>;
  selection: {
    selectedRegularization: number | null;
    brierImprovementVsMarket: number | null;
    logLossImprovementVsMarket: number | null;
    minimumRequiredImprovement: number;
    passedValidation: boolean;
  };
  model: FootballMarketResidualModel | null;
  controls: {
    canInspectReadOnly: true;
    canQueueUntouchedTest: boolean;
    canPersistModelArtifact: false;
    canApplyResidualModel: false;
    canPublishPicks: false;
    canStake: false;
  };
  locks: string[];
  proofUrls: string[];
  error: string | null;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function finite(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function probabilityMap(value: unknown): ProbabilityMap | null {
  const source = record(value);
  const probabilities = {
    home: finite(source.home, -1),
    draw: finite(source.draw, -1),
    away: finite(source.away, -1)
  };
  const total = probabilities.home + probabilities.draw + probabilities.away;
  return OUTCOMES.every((outcome) => probabilities[outcome] >= 0 && probabilities[outcome] <= 1) && total > 0.96 && total < 1.04
    ? probabilities
    : null;
}

function outcome(value: unknown): Outcome | null {
  return value === "home" || value === "draw" || value === "away" ? value : null;
}

function split(value: unknown): Split | null {
  return value === "train" || value === "validation" ? value : null;
}

function rawFeatures(features: JsonRecord, market: ProbabilityMap, structural: ProbabilityMap): number[] {
  const home = record(features.homeFeatures);
  const away = record(features.awayFeatures);
  const homeAbsences = finite(home.injuriesCount) + finite(home.suspensionsCount);
  const awayAbsences = finite(away.injuriesCount) + finite(away.suspensionsCount);
  return [
    structural.home - market.home,
    structural.draw - market.draw,
    (finite(home.eloRating, 1500) - finite(away.eloRating, 1500)) / 400,
    finite(home.attackStrength, 1) - finite(away.defenseStrength, 1),
    finite(away.attackStrength, 1) - finite(home.defenseStrength, 1),
    (finite(home.recentFormPoints, 7.5) - finite(away.recentFormPoints, 7.5)) / 15,
    (finite(home.restDays, 7) - finite(away.restDays, 7)) / 14,
    (awayAbsences - homeAbsences) / 5,
    (home.lineupConfirmed === true ? 1 : 0) - (away.lineupConfirmed === true ? 1 : 0)
  ];
}

function exampleFromRow(row: FootballDataProviderRetestFeatureRow): ResidualExample | null {
  const rowSplit = split(row.split);
  const actualOutcome = outcome(record(row.targets).actualOutcome ?? row.label);
  const features = record(row.features);
  const market = probabilityMap(features.marketProbabilities);
  const structural = probabilityMap(features.modelProbabilities);
  if (!rowSplit || !actualOutcome || !market || !structural) return null;
  return {
    fixtureExternalId: row.fixture_external_id,
    split: rowSplit,
    actualOutcome,
    marketProbabilities: market,
    structuralProbabilities: structural,
    rawFeatures: rawFeatures(features, market, structural)
  };
}

function fitScaler(examples: ResidualExample[]): Scaler {
  const means = FEATURE_NAMES.map((_, index) =>
    examples.reduce((sum, example) => sum + example.rawFeatures[index]!, 0) / examples.length
  );
  const standardDeviations = FEATURE_NAMES.map((_, index) =>
    Math.sqrt(
      examples.reduce((sum, example) => sum + (example.rawFeatures[index]! - means[index]!) ** 2, 0) / examples.length
    )
  );
  return {
    means,
    standardDeviations,
    activeIndexes: standardDeviations.flatMap((value, index) => (value > 1e-8 ? [index] : []))
  };
}

function vector(example: ResidualExample, scaler: Scaler): number[] {
  return [
    1,
    ...scaler.activeIndexes.map(
      (index) => (example.rawFeatures[index]! - scaler.means[index]!) / scaler.standardDeviations[index]!
    )
  ];
}

function softmax(logits: number[]): number[] {
  const maximum = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0) || 1;
  return exponentials.map((value) => value / total);
}

function predict(example: ResidualExample, scaler: Scaler, weights: number[][]): ProbabilityMap {
  const input = vector(example, scaler);
  const logits = OUTCOMES.map(
    (outcomeKey, outcomeIndex) =>
      Math.log(Math.max(0.000001, example.marketProbabilities[outcomeKey])) +
      weights[outcomeIndex]!.reduce((sum, weight, featureIndex) => sum + weight * input[featureIndex]!, 0)
  );
  const probabilities = softmax(logits);
  return { home: probabilities[0]!, draw: probabilities[1]!, away: probabilities[2]! };
}

function trainWeights(examples: ResidualExample[], scaler: Scaler, regularization: number): number[][] {
  const featureCount = scaler.activeIndexes.length + 1;
  const weights = OUTCOMES.map(() => Array(featureCount).fill(0) as number[]);
  for (let iteration = 0; iteration < TRAINING_ITERATIONS; iteration += 1) {
    const gradients = OUTCOMES.map(() => Array(featureCount).fill(0) as number[]);
    for (const example of examples) {
      const input = vector(example, scaler);
      const probabilities = predict(example, scaler, weights);
      OUTCOMES.forEach((outcomeKey, outcomeIndex) => {
        const error = probabilities[outcomeKey] - (example.actualOutcome === outcomeKey ? 1 : 0);
        input.forEach((value, featureIndex) => {
          gradients[outcomeIndex]![featureIndex] += (error * value) / examples.length;
        });
      });
    }
    const learningRate = 0.12 / Math.sqrt(1 + iteration / 150);
    OUTCOMES.forEach((_, outcomeIndex) => {
      weights[outcomeIndex]!.forEach((weight, featureIndex) => {
        const penalty = featureIndex === 0 ? 0 : regularization * weight;
        weights[outcomeIndex]![featureIndex] -= learningRate * (gradients[outcomeIndex]![featureIndex]! + penalty);
      });
    });
  }
  return weights;
}

function metric(examples: ResidualExample[], probabilitiesFor: (example: ResidualExample) => ProbabilityMap): FootballResidualMetrics {
  if (!examples.length) return { rows: 0, brierScore: null, logLoss: null };
  let brier = 0;
  let logLoss = 0;
  for (const example of examples) {
    const probabilities = probabilitiesFor(example);
    OUTCOMES.forEach((outcomeKey) => {
      brier += (probabilities[outcomeKey] - (example.actualOutcome === outcomeKey ? 1 : 0)) ** 2 / 3;
    });
    logLoss -= Math.log(Math.max(0.000001, Math.min(0.999999, probabilities[example.actualOutcome])));
  }
  return {
    rows: examples.length,
    brierScore: round(brier / examples.length),
    logLoss: round(logLoss / examples.length)
  };
}

function emptyMetrics(): FootballResidualMetrics {
  return { rows: 0, brierScore: null, logLoss: null };
}

function summaryFor(status: FootballProviderResidualTrainerStatus): string {
  if (status === "validation-pass") return "The regularized market-residual model beat both opening-market validation gates and may queue one untouched test run.";
  if (status === "market-prior-dominant") return "Every trained residual candidate failed to beat the no-vig opening market on validation, so the market prior remains dominant.";
  if (status === "thin-training-sample") return "Residual training is blocked by an insufficient training split.";
  if (status === "thin-validation-sample") return "Residual selection is blocked by an insufficient validation split.";
  if (status === "not-configured") return "Residual training needs OddsPadi Supabase server-read readiness.";
  if (status === "failed") return "Residual training could not read the stored provider feature corpus.";
  return "Residual training found no usable train or validation rows.";
}

function emptyReceipt({
  status,
  inputRows,
  rejectedRows,
  error,
  generatedAt
}: {
  status: FootballProviderResidualTrainerStatus;
  inputRows: number;
  rejectedRows: number;
  error: string | null;
  generatedAt: string;
}): FootballProviderResidualTrainerReceipt {
  const trainerHash = stableHash([status, inputRows, rejectedRows, error]);
  return {
    mode: "football-provider-residual-trainer",
    generatedAt,
    status,
    trainerHash,
    summary: summaryFor(status),
    corpus: { inputRows, trainingRows: 0, validationRows: 0, rejectedRows },
    featureAudit: {
      candidateFeatures: [...FEATURE_NAMES],
      activeFeatures: [],
      droppedZeroVarianceFeatures: [],
      timingPolicy: "Only opening-time structural and market features are eligible; kickoff-time injury and lineup evidence is excluded."
    },
    baselines: { marketValidation: emptyMetrics(), structuralValidation: emptyMetrics() },
    candidates: [],
    selection: {
      selectedRegularization: null,
      brierImprovementVsMarket: null,
      logLossImprovementVsMarket: null,
      minimumRequiredImprovement: MIN_VALIDATION_IMPROVEMENT,
      passedValidation: false
    },
    model: null,
    controls: {
      canInspectReadOnly: true,
      canQueueUntouchedTest: false,
      canPersistModelArtifact: false,
      canApplyResidualModel: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Test rows are not read or scored by the residual trainer.",
      "Kickoff-time availability and lineup evidence cannot enter an opening-market model.",
      "Residual weights cannot be persisted, applied, published, or staked from this read-only receipt."
    ],
    proofUrls: [
      "/api/sports/decision/training/football-provider-residual-trainer",
      "/api/sports/decision/training/football-data-provider-retest-runner",
      "/api/sports/decision/training/football-provider-feature-storage-receipt"
    ],
    error
  };
}

export function buildFootballProviderResidualTrainer({
  rows,
  now = new Date(),
  readError = null,
  configured = true
}: {
  rows: FootballDataProviderRetestFeatureRow[];
  now?: Date;
  readError?: string | null;
  configured?: boolean;
}): FootballProviderResidualTrainerReceipt {
  const generatedAt = now.toISOString();
  if (!configured) return emptyReceipt({ status: "not-configured", inputRows: 0, rejectedRows: 0, error: null, generatedAt });
  if (readError) return emptyReceipt({ status: "failed", inputRows: 0, rejectedRows: 0, error: readError, generatedAt });

  const mapped = rows.map(exampleFromRow);
  const examples = mapped.flatMap((example) => (example ? [example] : []));
  const training = examples.filter((example) => example.split === "train");
  const validation = examples.filter((example) => example.split === "validation");
  const rejectedRows = rows.length - examples.length;
  if (!examples.length) return emptyReceipt({ status: "no-usable-rows", inputRows: rows.length, rejectedRows, error: null, generatedAt });
  if (training.length < MIN_TRAIN_ROWS) {
    const receipt = emptyReceipt({ status: "thin-training-sample", inputRows: rows.length, rejectedRows, error: null, generatedAt });
    receipt.corpus = { inputRows: rows.length, trainingRows: training.length, validationRows: validation.length, rejectedRows };
    return receipt;
  }
  if (validation.length < MIN_VALIDATION_ROWS) {
    const receipt = emptyReceipt({ status: "thin-validation-sample", inputRows: rows.length, rejectedRows, error: null, generatedAt });
    receipt.corpus = { inputRows: rows.length, trainingRows: training.length, validationRows: validation.length, rejectedRows };
    return receipt;
  }

  const scaler = fitScaler(training);
  const candidateModels = REGULARIZATION_CANDIDATES.map((regularization) => {
    const weights = trainWeights(training, scaler, regularization);
    return {
      regularization,
      weights,
      training: metric(training, (example) => predict(example, scaler, weights)),
      validation: metric(validation, (example) => predict(example, scaler, weights))
    };
  }).sort((left, right) =>
    (left.validation.logLoss ?? Number.POSITIVE_INFINITY) - (right.validation.logLoss ?? Number.POSITIVE_INFINITY) ||
    (left.validation.brierScore ?? Number.POSITIVE_INFINITY) - (right.validation.brierScore ?? Number.POSITIVE_INFINITY)
  );
  const selected = candidateModels[0]!;
  const marketValidation = metric(validation, (example) => example.marketProbabilities);
  const structuralValidation = metric(validation, (example) => example.structuralProbabilities);
  const brierImprovement =
    marketValidation.brierScore !== null && selected.validation.brierScore !== null
      ? marketValidation.brierScore - selected.validation.brierScore
      : null;
  const logLossImprovement =
    marketValidation.logLoss !== null && selected.validation.logLoss !== null
      ? marketValidation.logLoss - selected.validation.logLoss
      : null;
  const passedValidation =
    brierImprovement !== null &&
    logLossImprovement !== null &&
    brierImprovement >= MIN_VALIDATION_IMPROVEMENT &&
    logLossImprovement >= MIN_VALIDATION_IMPROVEMENT;
  const activeFeatures = scaler.activeIndexes.map((index) => FEATURE_NAMES[index]!);
  const droppedFeatures = FEATURE_NAMES.filter((_, index) => !scaler.activeIndexes.includes(index));
  const modelCore = {
    version: "football-market-residual-softmax-v1" as const,
    trainedRows: training.length,
    validationRows: validation.length,
    iterations: TRAINING_ITERATIONS,
    regularization: selected.regularization,
    featureNames: activeFeatures,
    droppedFeatureNames: [...droppedFeatures],
    means: scaler.activeIndexes.map((index) => round(scaler.means[index]!) ?? 0),
    standardDeviations: scaler.activeIndexes.map((index) => round(scaler.standardDeviations[index]!) ?? 1),
    weights: {
      home: selected.weights[0]!.map((value) => round(value) ?? 0),
      draw: selected.weights[1]!.map((value) => round(value) ?? 0),
      away: selected.weights[2]!.map((value) => round(value) ?? 0)
    }
  };
  const model: FootballMarketResidualModel = { ...modelCore, modelHash: stableHash(modelCore) };
  const status: FootballProviderResidualTrainerStatus = passedValidation ? "validation-pass" : "market-prior-dominant";
  const candidates = candidateModels.map((candidate) => ({
    regularization: candidate.regularization,
    training: candidate.training,
    validation: candidate.validation
  }));
  const trainerHash = stableHash({ status, corpus: [rows.length, training.length, validation.length], candidates, model });

  return {
    mode: "football-provider-residual-trainer",
    generatedAt,
    status,
    trainerHash,
    summary: summaryFor(status),
    corpus: { inputRows: rows.length, trainingRows: training.length, validationRows: validation.length, rejectedRows },
    featureAudit: {
      candidateFeatures: [...FEATURE_NAMES],
      activeFeatures,
      droppedZeroVarianceFeatures: [...droppedFeatures],
      timingPolicy: "Only opening-time structural and market features are eligible; kickoff-time injury and lineup evidence is excluded."
    },
    baselines: { marketValidation, structuralValidation },
    candidates,
    selection: {
      selectedRegularization: selected.regularization,
      brierImprovementVsMarket: round(brierImprovement),
      logLossImprovementVsMarket: round(logLossImprovement),
      minimumRequiredImprovement: MIN_VALIDATION_IMPROVEMENT,
      passedValidation
    },
    model,
    controls: {
      canInspectReadOnly: true,
      canQueueUntouchedTest: passedValidation,
      canPersistModelArtifact: false,
      canApplyResidualModel: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Test rows are not read or scored by the residual trainer.",
      "Kickoff-time availability and lineup evidence cannot enter an opening-market model.",
      passedValidation
        ? "Validation success permits one separately governed untouched-test run, but does not apply the model."
        : "The residual candidate failed validation, so the market prior remains dominant and test execution stays locked.",
      "Residual weights cannot be persisted, applied, published, or staked from this read-only receipt."
    ],
    proofUrls: [
      "/api/sports/decision/training/football-provider-residual-trainer",
      "/api/sports/decision/training/football-data-provider-retest-runner",
      "/api/sports/decision/training/football-provider-feature-storage-receipt"
    ],
    error: null
  };
}

export async function trainStoredFootballProviderResidualModel({
  limit = 1000,
  now = new Date()
}: {
  limit?: number;
  now?: Date;
} = {}): Promise<FootballProviderResidualTrainerReceipt> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return buildFootballProviderResidualTrainer({ rows: [], now, configured: false });
  }
  const client = getSupabaseServerClient();
  if (!client) {
    return buildFootballProviderResidualTrainer({ rows: [], now, readError: "Supabase server client could not be created." });
  }
  const { data, error } = await client
    .from("op_training_feature_snapshots")
    .select("id, fixture_external_id, sport, model_key, generated_at, label, features, targets, split, source, feature_hash, created_at")
    .eq("sport", "football")
    .eq("model_key", FOOTBALL_PROVIDER_RETEST_MODEL_KEY)
    .in("split", ["train", "validation"])
    .order("generated_at", { ascending: false })
    .limit(Math.max(1, Math.min(1000, limit)));

  return buildFootballProviderResidualTrainer({
    rows: error ? [] : ((data ?? []) as FootballDataProviderRetestFeatureRow[]),
    now,
    readError: error?.message ?? null
  });
}
