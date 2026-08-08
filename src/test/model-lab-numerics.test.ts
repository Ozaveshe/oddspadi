import { describe, expect, it } from "vitest";
import { brier, ece, logLoss, pairedBootstrapDiff, rps, sharpness, type Forecast } from "@/lib/model/evalMetrics";
import { fitDixonColes, predictDixonColes, type DcMatch } from "@/lib/model/poissonDixonColes";
import { fitElo, predictElo } from "@/lib/model/eloFootball";
import { fitBlendWeight, fitTemperature, ISOTONIC_MIN_SAMPLE, selectCalibrator } from "@/lib/model/calibrationFit";

/** Deterministic PRNG so synthetic worlds are the same world every run. */
function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("metrics", () => {
  it("scores a perfect forecast at zero and a wrong certainty maximally", () => {
    expect(brier([{ probabilities: [1, 0, 0], outcome: 0 }])).toBe(0);
    expect(brier([{ probabilities: [1, 0, 0], outcome: 2 }])).toBe(2);
    expect(logLoss([{ probabilities: [1, 0, 0], outcome: 0 }])).toBe(0);
  });

  it("gives RPS what Brier cannot see: distance in outcome order", () => {
    // Both put 100% on a wrong class; home-when-away is *further* than
    // draw-when-away in goal terms.
    const farMiss = rps([{ probabilities: [1, 0, 0], outcome: 2 }])!;
    const nearMiss = rps([{ probabilities: [0, 1, 0], outcome: 2 }])!;
    expect(farMiss).toBeGreaterThan(nearMiss);
    expect(brier([{ probabilities: [1, 0, 0], outcome: 2 }])).toBe(brier([{ probabilities: [0, 1, 0], outcome: 2 }]));
  });

  it("reports zero ECE for a perfectly calibrated synthetic world", () => {
    const random = mulberry(7);
    const forecasts: Forecast[] = [];
    for (let index = 0; index < 20000; index += 1) {
      const p = 0.55;
      forecasts.push({ probabilities: [p, 1 - p, 0], outcome: random() < p ? 0 : 1 });
    }
    expect(ece(forecasts)!).toBeLessThan(0.02);
  });

  it("sees the base-rate model as calibrated but unsharp", () => {
    const flat: Forecast[] = Array.from({ length: 100 }, (_, index) => ({
      probabilities: [0.45, 0.27, 0.28],
      outcome: index % 100 < 45 ? 0 : index % 100 < 72 ? 1 : 2
    }));
    expect(sharpness(flat)).toBeCloseTo(0.45, 6);
  });

  it("pairs the bootstrap so shared noise cancels", () => {
    const random = mulberry(11);
    const a: Forecast[] = [];
    const b: Forecast[] = [];
    for (let index = 0; index < 800; index += 1) {
      const outcome = random() < 0.5 ? 0 : 1;
      // b is a slightly sharper version of a on the SAME matches.
      a.push({ probabilities: [0.55, 0.45, 0], outcome });
      b.push({ probabilities: [0.5, 0.5, 0], outcome });
    }
    const diff = pairedBootstrapDiff(a, b, brier)!;
    expect(diff.high95 - diff.low95).toBeLessThan(0.05);
    expect(diff.diff).toBeCloseTo(brier(a)! - brier(b)!, 10);
  });

  it("is deterministic across runs", () => {
    const forecasts: Forecast[] = Array.from({ length: 50 }, (_, index) => ({
      probabilities: [0.5, 0.3, 0.2],
      outcome: index % 3
    }));
    const first = pairedBootstrapDiff(forecasts, forecasts, brier)!;
    const second = pairedBootstrapDiff(forecasts, forecasts, brier)!;
    expect(first).toEqual(second);
  });
});

/** A synthetic league whose true strengths are known, so recovery is checkable. */
function syntheticLeague(seed: number, rounds: number): { matches: DcMatch[]; strong: string; weak: string } {
  const random = mulberry(seed);
  const teams = ["strong", "mid-a", "mid-b", "weak"];
  const attack: Record<string, number> = { strong: 0.4, "mid-a": 0.05, "mid-b": -0.05, weak: -0.4 };
  const matches: DcMatch[] = [];
  const samplePoisson = (lambda: number): number => {
    let k = 0;
    let p = Math.exp(-lambda);
    let cumulative = p;
    const u = random();
    while (u > cumulative && k < 10) {
      k += 1;
      p = (p * lambda) / k;
      cumulative += p;
    }
    return k;
  };
  for (let round = 0; round < rounds; round += 1) {
    for (const home of teams) {
      for (const away of teams) {
        if (home === away) continue;
        const lambdaHome = Math.exp(attack[home]! - -attack[away]! * 0.5 + 0.25);
        const lambdaAway = Math.exp(attack[away]! - -attack[home]! * 0.5);
        matches.push({
          homeTeam: home,
          awayTeam: away,
          homeGoals: samplePoisson(lambdaHome),
          awayGoals: samplePoisson(lambdaAway),
          daysAgo: (rounds - round) * 7
        });
      }
    }
  }
  return { matches, strong: "strong", weak: "weak" };
}

describe("Dixon-Coles", () => {
  const { matches, strong, weak } = syntheticLeague(23, 30);
  const params = fitDixonColes(matches, { iterations: 200 });

  it("recovers the strength ordering from synthetic data", () => {
    expect(params.attack.get(strong)!).toBeGreaterThan(params.attack.get(weak)!);
    expect(params.homeAdvantage).toBeGreaterThan(0);
  });

  it("produces coherent 1X2 probabilities by construction", () => {
    const prediction = predictDixonColes(params, strong, weak);
    const total = prediction.probabilities.reduce((sum, p) => sum + p, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(prediction.probabilities.every((p) => p > 0 && p < 1)).toBe(true);
  });

  it("favours the stronger side at home and knows it", () => {
    const strongHome = predictDixonColes(params, strong, weak);
    const weakHome = predictDixonColes(params, weak, strong);
    expect(strongHome.probabilities[0]).toBeGreaterThan(0.5);
    expect(weakHome.probabilities[2]).toBeGreaterThan(weakHome.probabilities[0]!);
  });

  it("flags rather than hides an unseen team", () => {
    const prediction = predictDixonColes(params, "nobody", weak);
    expect(prediction.usedFallback).toBe(true);
    // And the output is still a coherent distribution, not a throw.
    expect(prediction.probabilities.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 10);
  });

  it("recentres strengths so the fit is identifiable", () => {
    const mean = [...params.attack.values()].reduce((sum, value) => sum + value, 0) / params.attack.size;
    expect(Math.abs(mean)).toBeLessThan(1e-6);
  });
});

describe("Elo with Davidson draws", () => {
  const { matches, strong, weak } = syntheticLeague(31, 30);
  const params = fitElo(matches.map(({ homeTeam, awayTeam, homeGoals, awayGoals }) => ({ homeTeam, awayTeam, homeGoals, awayGoals })));

  it("ranks the synthetic strengths correctly", () => {
    expect(params.ratings.get(strong)!).toBeGreaterThan(params.ratings.get(weak)!);
  });

  it("fits the draw mass to the observed draw share", () => {
    const observed = matches.filter((match) => match.homeGoals === match.awayGoals).length / matches.length;
    let predicted = 0;
    for (const match of matches) {
      predicted += predictElo(params, match.homeTeam, match.awayTeam).probabilities[1];
    }
    expect(predicted / matches.length).toBeCloseTo(observed, 1);
  });

  it("sums to one and flags unseen teams", () => {
    const prediction = predictElo(params, "ghost", strong);
    expect(prediction.usedFallback).toBe(true);
    expect(prediction.probabilities.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 10);
  });
});

describe("calibration fitting", () => {
  /** An overconfident forecaster: says 80/15/5 when truth is 60/25/15. */
  function overconfident(seed: number, n: number): Forecast[] {
    const random = mulberry(seed);
    return Array.from({ length: n }, () => {
      const u = random();
      const outcome = u < 0.6 ? 0 : u < 0.85 ? 1 : 2;
      return { probabilities: [0.8, 0.15, 0.05], outcome };
    });
  }

  it("temperature scaling softens an overconfident forecaster", () => {
    const validation = overconfident(41, 3000);
    const calibrator = fitTemperature(validation);
    const softened = calibrator.apply([0.8, 0.15, 0.05]);
    expect(softened[0]!).toBeLessThan(0.8);
    expect(softened.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 10);
    expect(logLoss(validation.map((f) => ({ ...f, probabilities: calibrator.apply(f.probabilities) })))!).toBeLessThan(
      logLoss(validation)!
    );
  });

  it("excludes isotonic below the sample floor it earned", () => {
    // The rule the first live run taught: 802 validation matches let isotonic
    // win the fold and collapse on holdout.
    const thin = overconfident(43, ISOTONIC_MIN_SAMPLE - 1);
    expect(selectCalibrator(thin).method).not.toBe("isotonic");
  });

  it("keeps identity reachable when the forecaster is already calibrated", () => {
    const random = mulberry(47);
    const calibrated: Forecast[] = Array.from({ length: 1500 }, () => {
      const u = random();
      return { probabilities: [0.6, 0.25, 0.15], outcome: u < 0.6 ? 0 : u < 0.85 ? 1 : 2 };
    });
    const chosen = selectCalibrator(calibrated);
    // Temperature at T≈1 is equivalent to identity; either is acceptable, but
    // the fit must not "improve" an already-honest forecaster away.
    const after = logLoss(calibrated.map((f) => ({ ...f, probabilities: chosen.apply(f.probabilities) })))!;
    expect(after).toBeLessThanOrEqual(logLoss(calibrated)! + 1e-6);
  });

  it("lets the blend choose the market alone when the model adds nothing", () => {
    const random = mulberry(53);
    const market: Forecast[] = [];
    const noise: Forecast[] = [];
    for (let index = 0; index < 2000; index += 1) {
      const u = random();
      const outcome = u < 0.5 ? 0 : u < 0.8 ? 1 : 2;
      market.push({ probabilities: [0.5, 0.3, 0.2], outcome });
      // The "model" is pure noise around a wrong distribution.
      noise.push({ probabilities: [0.2, 0.3, 0.5], outcome });
    }
    const { weight } = fitBlendWeight(noise, market);
    // Zero must be reachable, and here it must be chosen.
    expect(weight).toBe(0);
  });
});
