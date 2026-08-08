/**
 * Walk-forward validation.
 *
 * A random split on a time series measures memorisation. Tomorrow's match ends
 * up teaching the model about yesterday's, the score looks excellent, and it
 * describes a capability the model will never have in production.
 *
 * So every production claim comes from rolling-origin evaluation: train on
 * everything before a point, score the window after it, roll forward, repeat.
 * Each fold is a small simulation of deployment, which is the only thing a
 * backtest is for.
 */

export type Fold = {
  index: number;
  trainFrom: string;
  trainTo: string;
  testFrom: string;
  testTo: string;
};

export type WalkForwardOptions = {
  /** First moment any data exists. */
  from: string;
  /** Last moment; the final fold ends at or before this. */
  to: string;
  /** How much history the first fold trains on. */
  initialTrainDays: number;
  /** How much each fold scores. */
  testDays: number;
  /**
   * Expanding keeps all history in every fold; rolling drops the oldest.
   *
   * Expanding is the default because dropping history to chase recency is a
   * decision that should be argued for, not inherited.
   */
  mode?: "expanding" | "rolling";
  /**
   * A gap between train and test, in days.
   *
   * Not cosmetic. A result settles hours after kickoff and a correction can
   * arrive days later, so a test window that begins the instant training ends
   * can score against rows whose labels were still moving. The gap is how long
   * a label takes to stop changing.
   */
  embargoDays?: number;
};

const DAY_MS = 86_400_000;

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}

export function buildFolds(options: WalkForwardOptions): Fold[] {
  const { from, to, initialTrainDays, testDays } = options;
  const mode = options.mode ?? "expanding";
  const embargoDays = options.embargoDays ?? 0;

  if (!(from < to)) return [];
  if (initialTrainDays <= 0 || testDays <= 0) return [];

  const folds: Fold[] = [];
  let trainTo = addDays(from, initialTrainDays);
  let index = 0;

  while (true) {
    const testFrom = addDays(trainTo, embargoDays);
    const testTo = addDays(testFrom, testDays);
    // A fold that would run past the data does not get truncated into a
    // shorter one: a final fold scoring three days against everyone else's
    // thirty is not comparable, and averaging it in is a quiet distortion.
    if (testTo > to) break;

    const trainFrom = mode === "expanding" ? from : addDays(trainTo, -initialTrainDays);
    folds.push({ index, trainFrom, trainTo, testFrom, testTo });

    trainTo = testTo;
    index += 1;
    // Guard against a pathological configuration producing an unbounded loop.
    if (index > 1000) break;
  }

  return folds;
}

export type FoldDefect = { fold: number; kind: "overlap" | "test_before_train" | "embargo_violated"; detail: string };

/**
 * Whether a fold set is honest.
 *
 * Checked rather than trusted, because a fold generator is exactly the kind of
 * code that looks right and is off by one window — and the symptom is a better
 * score, which nobody investigates.
 */
export function validateFolds(folds: Fold[], embargoDays = 0): FoldDefect[] {
  const defects: FoldDefect[] = [];

  for (const fold of folds) {
    if (fold.testFrom < fold.trainTo) {
      defects.push({
        fold: fold.index,
        kind: "test_before_train",
        detail: `test starts ${fold.testFrom} before training ends ${fold.trainTo}`
      });
      continue;
    }
    const gapDays = (new Date(fold.testFrom).getTime() - new Date(fold.trainTo).getTime()) / DAY_MS;
    if (gapDays + 1e-9 < embargoDays) {
      defects.push({
        fold: fold.index,
        kind: "embargo_violated",
        detail: `gap of ${gapDays.toFixed(2)} days is shorter than the ${embargoDays}-day embargo, so labels may still have been moving`
      });
    }
  }

  for (let index = 0; index < folds.length - 1; index += 1) {
    const current = folds[index]!;
    const next = folds[index + 1]!;
    if (next.testFrom < current.testTo) {
      defects.push({
        fold: next.index,
        kind: "overlap",
        detail: `test window overlaps fold ${current.index}, so the same rows are scored twice`
      });
    }
  }

  return defects;
}

export type FoldScore = { fold: number; sample: number; score: number };

export type WalkForwardSummary = {
  folds: number;
  totalSample: number;
  /** Sample-weighted, so a thin fold cannot swing the headline. */
  weightedMean: number | null;
  /** Unweighted, kept alongside because a large gap between them is a finding. */
  simpleMean: number | null;
  worstFold: FoldScore | null;
  bestFold: FoldScore | null;
  /** Folds with too few outcomes to mean anything, reported not dropped. */
  thinFolds: number;
};

export const MIN_FOLD_SAMPLE = 50;

/**
 * Summarise fold scores.
 *
 * Weighted and unweighted means are both reported. A large gap between them
 * says the result depends on one busy fold, which is the thing an average is
 * best at hiding.
 */
export function summariseFolds(scores: FoldScore[], minSample = MIN_FOLD_SAMPLE): WalkForwardSummary {
  const usable = scores.filter((entry) => entry.sample >= minSample);
  const thinFolds = scores.length - usable.length;

  if (usable.length === 0) {
    return {
      folds: scores.length,
      totalSample: scores.reduce((sum, entry) => sum + entry.sample, 0),
      weightedMean: null,
      simpleMean: null,
      worstFold: null,
      bestFold: null,
      thinFolds
    };
  }

  const totalSample = usable.reduce((sum, entry) => sum + entry.sample, 0);
  const weightedMean = usable.reduce((sum, entry) => sum + entry.score * entry.sample, 0) / totalSample;
  const simpleMean = usable.reduce((sum, entry) => sum + entry.score, 0) / usable.length;
  const sorted = [...usable].sort((a, b) => a.score - b.score);

  return {
    folds: scores.length,
    totalSample: scores.reduce((sum, entry) => sum + entry.sample, 0),
    weightedMean,
    simpleMean,
    // Lower is better for Brier and log loss, so the worst fold is the highest.
    worstFold: sorted[sorted.length - 1] ?? null,
    bestFold: sorted[0] ?? null,
    thinFolds
  };
}
