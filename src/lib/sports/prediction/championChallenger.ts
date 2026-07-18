import type { Sport } from "@/lib/sports/types";
import type { DecisionRunRow, OutcomeRow } from "./decisionCalibration";
import { strictChronologicalSplitIndex } from "./probabilityTemperatureScaling";

export type ChampionChallengerIdentity = {
  modelKey: string;
  engineVersion: string;
};

export type ChampionChallengerMetric = {
  championMean: number | null;
  challengerMean: number | null;
  meanDelta: number | null;
  standardError: number | null;
  upper95ConfidenceBound: number | null;
};

export type ChampionChallengerReceiptStatus =
  | "challenger-promotable"
  | "champion-retained"
  | "inconclusive"
  | "warming"
  | "stale"
  | "invalid";

export type ChampionChallengerReceipt = {
  version: "champion-challenger-v1";
  status: ChampionChallengerReceiptStatus;
  eligibleForPromotion: boolean;
  sport: Sport;
  champion: ChampionChallengerIdentity & { promotionId: string };
  challenger: ChampionChallengerIdentity & { candidateId: string };
  evaluationWindowStart: string;
  asOf: string;
  latestPairedOutcomeAt: string | null;
  pairedFixtureHash: string;
  receiptHash: string;
  sample: {
    championEligible: number;
    challengerEligible: number;
    paired: number;
    earlier: number;
    recent: number;
    championCoverage: number;
    challengerCoverage: number;
  };
  aggregate: {
    brier: ChampionChallengerMetric;
    logLoss: ChampionChallengerMetric;
    championCalibrationError: number | null;
    challengerCalibrationError: number | null;
  };
  earlier: { brierDelta: number | null; logLossDelta: number | null };
  recent: { brierDelta: number | null; logLossDelta: number | null };
  thresholds: {
    minimumPairedSize: 60;
    minimumRegimeSize: 30;
    minimumPairCoverage: 0.8;
    maximumBrierNonInferiorityMargin: 0.01;
    maximumLogLossNonInferiorityMargin: 0.02;
    maximumRegimeBrierRegression: 0.02;
    maximumRegimeLogLossRegression: 0.04;
    maximumCalibrationErrorRegression: 0.02;
    maximumEvidenceAgeDays: 7;
  };
  blockers: string[];
  notes: string[];
};

type PairedObservation = {
  key: string;
  settledAt: string;
  champion: OutcomeRow & { model_probability: number };
  challenger: OutcomeRow & { model_probability: number };
};

const DAY_MS = 24 * 60 * 60 * 1000;
const THRESHOLDS = {
  minimumPairedSize: 60 as const,
  minimumRegimeSize: 30 as const,
  minimumPairCoverage: 0.8 as const,
  maximumBrierNonInferiorityMargin: 0.01 as const,
  maximumLogLossNonInferiorityMargin: 0.02 as const,
  maximumRegimeBrierRegression: 0.02 as const,
  maximumRegimeLogLossRegression: 0.04 as const,
  maximumCalibrationErrorRegression: 0.02 as const,
  maximumEvidenceAgeDays: 7 as const
};
const MAXIMUM_PAIRED_SIZE = 200;
const CONFIDENCE_Z = 1.96;

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function finiteProbability(row: OutcomeRow): row is OutcomeRow & { model_probability: number } {
  return typeof row.model_probability === "number" && Number.isFinite(row.model_probability) && row.model_probability >= 0 && row.model_probability <= 1;
}

function settled(row: OutcomeRow): boolean {
  return row.result === "won" || row.result === "lost";
}

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function loss(row: OutcomeRow & { model_probability: number }, metric: "brier" | "logLoss"): number {
  const actual = row.result === "won" ? 1 : 0;
  if (metric === "brier") return (row.model_probability - actual) ** 2;
  const probability = Math.max(1e-6, Math.min(1 - 1e-6, row.model_probability));
  return actual ? -Math.log(probability) : -Math.log(1 - probability);
}

function pairedMetric(rows: PairedObservation[], metric: "brier" | "logLoss"): ChampionChallengerMetric {
  const champion = rows.map((row) => loss(row.champion, metric));
  const challenger = rows.map((row) => loss(row.challenger, metric));
  const deltas = challenger.map((value, index) => value - champion[index]!);
  const deltaMean = mean(deltas);
  if (deltaMean === null) {
    return { championMean: null, challengerMean: null, meanDelta: null, standardError: null, upper95ConfidenceBound: null };
  }
  const variance = deltas.length > 1
    ? deltas.reduce((sum, value) => sum + (value - deltaMean) ** 2, 0) / (deltas.length - 1)
    : 0;
  const standardError = Math.sqrt(variance / deltas.length);
  return {
    championMean: round(mean(champion)),
    challengerMean: round(mean(challenger)),
    meanDelta: round(deltaMean),
    standardError: round(standardError),
    upper95ConfidenceBound: round(deltaMean + CONFIDENCE_Z * standardError)
  };
}

function calibrationError(rows: Array<OutcomeRow & { model_probability: number }>): number | null {
  if (!rows.length) return null;
  const bins = Array.from({ length: 10 }, () => [] as Array<OutcomeRow & { model_probability: number }>);
  for (const row of rows) bins[Math.min(9, Math.floor(row.model_probability * 10))]!.push(row);
  let weightedGap = 0;
  for (const bin of bins) {
    if (!bin.length) continue;
    const averageProbability = mean(bin.map((row) => row.model_probability))!;
    const winRate = bin.filter((row) => row.result === "won").length / bin.length;
    weightedGap += (bin.length / rows.length) * Math.abs(averageProbability - winRate);
  }
  return round(weightedGap);
}

function predictionKey(row: OutcomeRow): string | null {
  const market = row.market?.trim();
  const selection = row.selection?.trim();
  return row.fixture_external_id && market && selection ? `${row.fixture_external_id}\u0000${market}\u0000${selection}` : null;
}

function identityRows({
  outcomes,
  decisionRuns,
  identity,
  sport,
  evaluationWindowStart,
  now
}: {
  outcomes: readonly OutcomeRow[];
  decisionRuns: readonly DecisionRunRow[];
  identity: ChampionChallengerIdentity;
  sport: Sport;
  evaluationWindowStart: number;
  now: number;
}): { rows: Array<OutcomeRow & { model_probability: number }>; duplicateKeys: string[]; malformed: number } {
  const runIds = new Set(
    decisionRuns
      .filter((run) => run.model_key === identity.modelKey && run.engine_version === identity.engineVersion)
      .map((run) => run.id)
  );
  const byKey = new Map<string, OutcomeRow & { model_probability: number }>();
  const duplicateKeys = new Set<string>();
  let malformed = 0;
  for (const row of outcomes) {
    if (row.sport !== sport || !row.decision_run_id || !runIds.has(row.decision_run_id) || !settled(row) || !finiteProbability(row)) continue;
    const settledAt = row.settled_at ? Date.parse(row.settled_at) : Number.NaN;
    if (!Number.isFinite(settledAt) || settledAt <= evaluationWindowStart || settledAt > now) continue;
    const key = predictionKey(row);
    if (!key) {
      malformed += 1;
      continue;
    }
    if (byKey.has(key)) duplicateKeys.add(key);
    else byKey.set(key, row);
  }
  const rows = [...byKey.values()]
    .sort((left, right) => Date.parse(left.settled_at!) - Date.parse(right.settled_at!) || predictionKey(left)!.localeCompare(predictionKey(right)!))
    .slice(-MAXIMUM_PAIRED_SIZE);
  return { rows, duplicateKeys: [...duplicateKeys], malformed };
}

function emptyMetric(): ChampionChallengerMetric {
  return { championMean: null, challengerMean: null, meanDelta: null, standardError: null, upper95ConfidenceBound: null };
}

export function buildChampionChallengerReceipt({
  sport,
  champion,
  challenger,
  evaluationWindowStart,
  outcomes,
  decisionRuns,
  now = new Date()
}: {
  sport: Sport;
  champion: ChampionChallengerIdentity & { promotionId: string };
  challenger: ChampionChallengerIdentity & { candidateId: string };
  evaluationWindowStart: string;
  outcomes: readonly OutcomeRow[];
  decisionRuns: readonly DecisionRunRow[];
  now?: Date;
}): ChampionChallengerReceipt {
  const startAt = Date.parse(evaluationWindowStart);
  const nowAt = now.getTime();
  const base = {
    version: "champion-challenger-v1" as const,
    sport,
    champion,
    challenger,
    evaluationWindowStart,
    asOf: now.toISOString(),
    thresholds: THRESHOLDS
  };
  const invalidIdentity = champion.modelKey === challenger.modelKey && champion.engineVersion === challenger.engineVersion;
  if (!Number.isFinite(startAt) || startAt >= nowAt || invalidIdentity) {
    const blockers = [
      !Number.isFinite(startAt) || startAt >= nowAt ? "The challenger evaluation window is invalid or not yet open." : "",
      invalidIdentity ? "Champion and challenger must have distinct model or engine identities." : ""
    ].filter(Boolean);
    const pairedFixtureHash = stableHash([]);
    const receiptHash = stableHash({ sport, champion, challenger, evaluationWindowStart, pairedFixtureHash, status: "invalid" });
    return {
      ...base,
      status: "invalid",
      eligibleForPromotion: false,
      latestPairedOutcomeAt: null,
      pairedFixtureHash,
      receiptHash,
      sample: { championEligible: 0, challengerEligible: 0, paired: 0, earlier: 0, recent: 0, championCoverage: 0, challengerCoverage: 0 },
      aggregate: { brier: emptyMetric(), logLoss: emptyMetric(), championCalibrationError: null, challengerCalibrationError: null },
      earlier: { brierDelta: null, logLossDelta: null },
      recent: { brierDelta: null, logLossDelta: null },
      blockers,
      notes: []
    };
  }

  const championRows = identityRows({ outcomes, decisionRuns, identity: champion, sport, evaluationWindowStart: startAt, now: nowAt });
  const challengerRows = identityRows({ outcomes, decisionRuns, identity: challenger, sport, evaluationWindowStart: startAt, now: nowAt });
  const championByKey = new Map(championRows.rows.map((row) => [predictionKey(row)!, row]));
  const pairs: PairedObservation[] = [];
  const conflictingKeys: string[] = [];
  for (const challengerRow of challengerRows.rows) {
    const key = predictionKey(challengerRow)!;
    const championRow = championByKey.get(key);
    if (!championRow) continue;
    if (championRow.result !== challengerRow.result || championRow.settled_at !== challengerRow.settled_at) {
      conflictingKeys.push(key);
      continue;
    }
    pairs.push({ key, settledAt: challengerRow.settled_at!, champion: championRow, challenger: challengerRow });
  }
  const paired = pairs
    .sort((left, right) => Date.parse(left.settledAt) - Date.parse(right.settledAt) || left.key.localeCompare(right.key))
    .slice(-MAXIMUM_PAIRED_SIZE);
  const splitRows = paired.map((row) => ({ kickoffAt: row.settledAt, row }));
  const splitIndex = paired.length >= THRESHOLDS.minimumPairedSize
    ? strictChronologicalSplitIndex(splitRows, Math.floor(splitRows.length / 2), {
        minimumLeft: THRESHOLDS.minimumRegimeSize,
        minimumRight: THRESHOLDS.minimumRegimeSize
      })
    : 0;
  const earlierRows = splitIndex ? paired.slice(0, splitIndex) : [];
  const recentRows = splitIndex ? paired.slice(splitIndex) : [];
  const aggregateBrier = pairedMetric(paired, "brier");
  const aggregateLogLoss = pairedMetric(paired, "logLoss");
  const earlierBrier = pairedMetric(earlierRows, "brier").meanDelta;
  const earlierLogLoss = pairedMetric(earlierRows, "logLoss").meanDelta;
  const recentBrier = pairedMetric(recentRows, "brier").meanDelta;
  const recentLogLoss = pairedMetric(recentRows, "logLoss").meanDelta;
  const championCalibrationError = calibrationError(paired.map((row) => row.champion));
  const challengerCalibrationError = calibrationError(paired.map((row) => row.challenger));
  const championCoverage = championRows.rows.length ? paired.length / championRows.rows.length : 0;
  const challengerCoverage = challengerRows.rows.length ? paired.length / challengerRows.rows.length : 0;
  const latestPairedOutcomeAt = paired.at(-1)?.settledAt ?? null;
  const evidenceAgeDays = latestPairedOutcomeAt ? (nowAt - Date.parse(latestPairedOutcomeAt)) / DAY_MS : Number.POSITIVE_INFINITY;
  const duplicateOrMalformed = championRows.duplicateKeys.length + challengerRows.duplicateKeys.length + conflictingKeys.length > 0 || championRows.malformed + challengerRows.malformed > 0;
  const enoughSample = paired.length >= THRESHOLDS.minimumPairedSize;
  const enoughCoverage = championCoverage >= THRESHOLDS.minimumPairCoverage && challengerCoverage >= THRESHOLDS.minimumPairCoverage;
  const strictRegimes = splitIndex > 0;
  const nonInferior =
    aggregateBrier.upper95ConfidenceBound !== null && aggregateBrier.upper95ConfidenceBound <= THRESHOLDS.maximumBrierNonInferiorityMargin &&
    aggregateLogLoss.upper95ConfidenceBound !== null && aggregateLogLoss.upper95ConfidenceBound <= THRESHOLDS.maximumLogLossNonInferiorityMargin;
  const superior =
    (aggregateBrier.upper95ConfidenceBound !== null && aggregateBrier.upper95ConfidenceBound < 0) ||
    (aggregateLogLoss.upper95ConfidenceBound !== null && aggregateLogLoss.upper95ConfidenceBound < 0);
  const regimesSafe =
    earlierBrier !== null && earlierBrier <= THRESHOLDS.maximumRegimeBrierRegression &&
    recentBrier !== null && recentBrier <= THRESHOLDS.maximumRegimeBrierRegression &&
    earlierLogLoss !== null && earlierLogLoss <= THRESHOLDS.maximumRegimeLogLossRegression &&
    recentLogLoss !== null && recentLogLoss <= THRESHOLDS.maximumRegimeLogLossRegression;
  const calibrationSafe =
    championCalibrationError !== null && challengerCalibrationError !== null &&
    challengerCalibrationError - championCalibrationError <= THRESHOLDS.maximumCalibrationErrorRegression;
  const fresh = evidenceAgeDays <= THRESHOLDS.maximumEvidenceAgeDays;
  const blockers = [
    duplicateOrMalformed ? `Comparison evidence is ambiguous: ${championRows.duplicateKeys.length + challengerRows.duplicateKeys.length} duplicate key(s), ${conflictingKeys.length} conflicting pair(s), and ${championRows.malformed + challengerRows.malformed} malformed row(s).` : "",
    !enoughSample ? `${paired.length}/${THRESHOLDS.minimumPairedSize} paired outcomes are available.` : "",
    !enoughCoverage ? `Pair coverage is ${round(championCoverage, 4)}/${round(challengerCoverage, 4)}; both models require ${THRESHOLDS.minimumPairCoverage}.` : "",
    enoughSample && !strictRegimes ? "Paired outcomes have no strict earlier/recent settlement boundary with 30 rows on each side." : "",
    enoughSample && strictRegimes && !nonInferior ? "The challenger fails paired Brier or log-loss non-inferiority at the 95% confidence bound." : "",
    enoughSample && strictRegimes && nonInferior && !superior ? "The challenger is non-inferior but has not proved superiority on Brier score or log loss." : "",
    enoughSample && strictRegimes && !regimesSafe ? "The challenger regresses beyond the governed earlier/recent regime margin." : "",
    enoughSample && !calibrationSafe ? "The challenger exceeds the governed calibration-error regression margin." : "",
    !fresh ? `Latest paired evidence is ${Number.isFinite(evidenceAgeDays) ? `${round(evidenceAgeDays, 2)} days old` : "unavailable"}; maximum is ${THRESHOLDS.maximumEvidenceAgeDays}.` : ""
  ].filter(Boolean);
  const status: ChampionChallengerReceiptStatus = duplicateOrMalformed
    ? "invalid"
    : !fresh
      ? "stale"
      : !enoughSample
        ? "warming"
        : !enoughCoverage || !strictRegimes
          ? "inconclusive"
          : !nonInferior || !regimesSafe || !calibrationSafe
            ? "champion-retained"
            : !superior
              ? "inconclusive"
              : "challenger-promotable";
  const pairedFixtureHash = stableHash(paired.map((row) => [row.key, row.settledAt, row.champion.id, row.champion.model_probability, row.challenger.id, row.challenger.model_probability, row.challenger.result]));
  const receiptHash = stableHash({
    sport,
    champion,
    challenger,
    evaluationWindowStart,
    pairedFixtureHash,
    status,
    aggregateBrier,
    aggregateLogLoss,
    earlierBrier,
    earlierLogLoss,
    recentBrier,
    recentLogLoss,
    championCalibrationError,
    challengerCalibrationError,
    championEligible: championRows.rows.length,
    challengerEligible: challengerRows.rows.length,
    championCoverage: round(championCoverage, 6),
    challengerCoverage: round(challengerCoverage, 6)
  });
  return {
    ...base,
    status,
    eligibleForPromotion: status === "challenger-promotable",
    latestPairedOutcomeAt,
    pairedFixtureHash,
    receiptHash,
    sample: {
      championEligible: championRows.rows.length,
      challengerEligible: challengerRows.rows.length,
      paired: paired.length,
      earlier: earlierRows.length,
      recent: recentRows.length,
      championCoverage: round(championCoverage, 6) ?? 0,
      challengerCoverage: round(challengerCoverage, 6) ?? 0
    },
    aggregate: {
      brier: aggregateBrier,
      logLoss: aggregateLogLoss,
      championCalibrationError,
      challengerCalibrationError
    },
    earlier: { brierDelta: earlierBrier, logLossDelta: earlierLogLoss },
    recent: { brierDelta: recentBrier, logLossDelta: recentLogLoss },
    blockers,
    notes: [
      "Only exact fixture, market, and selection pairs settled after the challenger training window are compared.",
      "Promotion requires paired non-inferiority on both primary proper scoring rules and statistically supported superiority on at least one.",
      "The confidence bound is a paired normal approximation; the receipt also requires strict chronological regimes and high pair coverage to limit misleading aggregate wins."
    ]
  };
}
