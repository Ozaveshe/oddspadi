import { describe, expect, it } from "vitest";
import {
  buildFolds,
  MIN_FOLD_SAMPLE,
  summariseFolds,
  validateFolds,
  type Fold
} from "@/lib/model/walkForward";

const BASE = {
  from: "2026-01-01T00:00:00.000Z",
  to: "2026-07-01T00:00:00.000Z",
  initialTrainDays: 60,
  testDays: 30
};

describe("building folds", () => {
  it("rolls the origin forward without overlapping", () => {
    const folds = buildFolds(BASE);
    expect(folds.length).toBeGreaterThan(1);
    expect(validateFolds(folds)).toEqual([]);
    for (let index = 0; index < folds.length - 1; index += 1) {
      expect(folds[index + 1]!.testFrom >= folds[index]!.testTo).toBe(true);
    }
  });

  it("never tests before it trains", () => {
    for (const fold of buildFolds(BASE)) {
      expect(fold.testFrom >= fold.trainTo).toBe(true);
      expect(fold.trainFrom < fold.trainTo).toBe(true);
    }
  });

  it("expands the training window by default", () => {
    const folds = buildFolds(BASE);
    // Dropping history to chase recency should be argued for, not inherited.
    expect(new Set(folds.map((fold) => fold.trainFrom)).size).toBe(1);
    expect(folds[0]!.trainFrom).toBe(BASE.from);
  });

  it("rolls the training window when asked", () => {
    const folds = buildFolds({ ...BASE, mode: "rolling" });
    expect(new Set(folds.map((fold) => fold.trainFrom)).size).toBeGreaterThan(1);
  });

  it("honours an embargo between training and testing", () => {
    // A result settles hours after kickoff and a correction can arrive days
    // later; a test starting the instant training ends can score rows whose
    // labels were still moving.
    const folds = buildFolds({ ...BASE, embargoDays: 3 });
    for (const fold of folds) {
      const gapDays = (new Date(fold.testFrom).getTime() - new Date(fold.trainTo).getTime()) / 86_400_000;
      expect(gapDays).toBeCloseTo(3, 6);
    }
    expect(validateFolds(folds, 3)).toEqual([]);
  });

  it("drops a final fold rather than truncating it", () => {
    // A last fold scoring three days against everyone else's thirty is not
    // comparable, and averaging it in is a quiet distortion.
    const folds = buildFolds({ ...BASE, to: "2026-04-15T00:00:00.000Z" });
    for (const fold of folds) {
      const testDays = (new Date(fold.testTo).getTime() - new Date(fold.testFrom).getTime()) / 86_400_000;
      expect(testDays).toBeCloseTo(BASE.testDays, 6);
      expect(fold.testTo <= "2026-04-15T00:00:00.000Z").toBe(true);
    }
  });

  it("returns nothing for an impossible configuration", () => {
    expect(buildFolds({ ...BASE, to: BASE.from })).toEqual([]);
    expect(buildFolds({ ...BASE, testDays: 0 })).toEqual([]);
    expect(buildFolds({ ...BASE, initialTrainDays: -1 })).toEqual([]);
  });
});

describe("validating folds", () => {
  function fold(overrides: Partial<Fold> = {}): Fold {
    return {
      index: 0,
      trainFrom: "2026-01-01T00:00:00.000Z",
      trainTo: "2026-03-01T00:00:00.000Z",
      testFrom: "2026-03-01T00:00:00.000Z",
      testTo: "2026-04-01T00:00:00.000Z",
      ...overrides
    };
  }

  it("catches a test window that starts before training ends", () => {
    const defects = validateFolds([fold({ testFrom: "2026-02-01T00:00:00.000Z" })]);
    expect(defects[0]?.kind).toBe("test_before_train");
  });

  it("catches two folds scoring the same rows", () => {
    const defects = validateFolds([
      fold({ index: 0 }),
      fold({ index: 1, testFrom: "2026-03-15T00:00:00.000Z", testTo: "2026-04-15T00:00:00.000Z" })
    ]);
    expect(defects[0]?.kind).toBe("overlap");
    expect(defects[0]?.detail).toContain("scored twice");
  });

  it("catches an embargo that was not honoured", () => {
    const defects = validateFolds([fold()], 3);
    expect(defects[0]?.kind).toBe("embargo_violated");
    expect(defects[0]?.detail).toContain("labels may still have been moving");
  });
});

describe("summarising folds", () => {
  it("weights by sample so a thin fold cannot swing the headline", () => {
    const summary = summariseFolds([
      { fold: 0, sample: 1000, score: 0.2 },
      { fold: 1, sample: 100, score: 0.4 }
    ]);
    expect(summary.weightedMean).toBeCloseTo((0.2 * 1000 + 0.4 * 100) / 1100, 6);
    expect(summary.simpleMean).toBeCloseTo(0.3, 6);
  });

  it("reports both means so a gap between them is visible", () => {
    // A large gap says the result depends on one busy fold, which is what an
    // average is best at hiding.
    const summary = summariseFolds([
      { fold: 0, sample: 5000, score: 0.19 },
      { fold: 1, sample: 60, score: 0.45 }
    ]);
    expect(summary.weightedMean).not.toBeCloseTo(summary.simpleMean!, 2);
  });

  it("names the worst fold, not just the average", () => {
    const summary = summariseFolds([
      { fold: 0, sample: 500, score: 0.19 },
      { fold: 1, sample: 500, score: 0.31 },
      { fold: 2, sample: 500, score: 0.22 }
    ]);
    // Lower is better for Brier and log loss.
    expect(summary.worstFold?.fold).toBe(1);
    expect(summary.bestFold?.fold).toBe(0);
  });

  it("reports thin folds rather than silently dropping them", () => {
    const summary = summariseFolds([
      { fold: 0, sample: 500, score: 0.2 },
      { fold: 1, sample: MIN_FOLD_SAMPLE - 1, score: 0.05 }
    ]);
    expect(summary.thinFolds).toBe(1);
    // The flattering thin fold does not reach the mean.
    expect(summary.weightedMean).toBeCloseTo(0.2, 6);
  });

  it("returns null means rather than zero when every fold is thin", () => {
    const summary = summariseFolds([{ fold: 0, sample: 3, score: 0.1 }]);
    expect(summary.weightedMean).toBeNull();
    expect(summary.simpleMean).toBeNull();
    expect(summary.thinFolds).toBe(1);
  });

  it("still reports the total sample it saw", () => {
    const summary = summariseFolds([
      { fold: 0, sample: 500, score: 0.2 },
      { fold: 1, sample: 10, score: 0.9 }
    ]);
    expect(summary.totalSample).toBe(510);
  });
});
