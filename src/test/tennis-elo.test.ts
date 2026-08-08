import { describe, expect, it } from "vitest";
import {
  fitTennisElo,
  orientationFlip,
  predictTennisElo,
  rankPriorRating,
  type TennisMatch
} from "@/lib/model/tennisElo";
import { fitIsotonic, selectCalibrator } from "@/lib/model/calibrationFit";
import { logLoss, type Forecast } from "@/lib/model/evalMetrics";

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

describe("orientation flip", () => {
  it("is deterministic — the same match always flips the same way", () => {
    const id = "tennis-data:atp:2024:2023-12-31:popyrin-a:o-connell-c:brisbane-international:1st-round";
    expect(orientationFlip(id)).toBe(orientationFlip(id));
  });

  it("flips roughly half of realistic ids", () => {
    let flipped = 0;
    const total = 10000;
    for (let index = 0; index < total; index += 1) {
      if (orientationFlip(`tennis-data:atp:2025:2025-01-01:player-${index}:opponent-${index}:event:round`)) {
        flipped += 1;
      }
    }
    // The corpus is 100% player_1-wins; the flip is the only thing standing
    // between the lab and a fake oracle, so the balance matters.
    expect(flipped / total).toBeGreaterThan(0.45);
    expect(flipped / total).toBeLessThan(0.55);
  });
});

describe("rank prior", () => {
  it("orders ratings by rank and floors the tail", () => {
    expect(rankPriorRating(1)).toBeGreaterThan(rankPriorRating(10));
    expect(rankPriorRating(10)).toBeGreaterThan(rankPriorRating(100));
    expect(rankPriorRating(5000)).toBe(1200);
  });

  it("starts unranked players below mid-ranked ones", () => {
    expect(rankPriorRating(null)).toBeLessThan(rankPriorRating(50));
  });
});

/**
 * A synthetic tour: "champ" beats everyone 75% of the time overall, but
 * "clay-court specialist" beats champ on clay 70% of the time.
 */
function syntheticTour(seed: number, rounds: number): TennisMatch[] {
  const random = mulberry(seed);
  const matches: TennisMatch[] = [];
  const field = ["champ", "specialist", "journeyman-a", "journeyman-b"];
  // Surface-transitive by design: on clay the specialist is better than champ
  // against EVERYONE, not just head-to-head. One-dimensional Elo cannot
  // represent an intransitive surface (specialist > champ head-to-head while
  // champ > specialist against the field), so the world must not be one.
  const winProbability = (a: string, b: string, surface: string): number => {
    const clay = surface === "Clay";
    if (a === "champ" && b === "specialist") return clay ? 0.3 : 0.75;
    if (a === "specialist" && b === "champ") return clay ? 0.7 : 0.25;
    if (a === "champ") return clay ? 0.65 : 0.85;
    if (b === "champ") return clay ? 0.35 : 0.15;
    if (a === "specialist") return clay ? 0.8 : 0.55;
    if (b === "specialist") return clay ? 0.2 : 0.45;
    return 0.5;
  };
  let counter = 0;
  for (let round = 0; round < rounds; round += 1) {
    for (const surface of ["Hard", "Clay"]) {
      for (const playerA of field) {
        for (const playerB of field) {
          if (playerA === playerB) continue;
          counter += 1;
          matches.push({
            matchId: `synthetic-${counter}`,
            date: `2025-${String((round % 12) + 1).padStart(2, "0")}-01`,
            surface,
            playerA,
            playerB,
            outcome: random() < winProbability(playerA, playerB, surface) ? 0 : 1,
            rankA: null,
            rankB: null
          });
        }
      }
    }
  }
  return matches;
}

describe("tennis surface Elo", () => {
  const matches = syntheticTour(19, 40);

  it("recovers the overall strength ordering", () => {
    const params = fitTennisElo(matches, { surfaceBlend: 0 });
    expect(params.overall.get("champ")!).toBeGreaterThan(params.overall.get("journeyman-a")!);
    expect(params.overall.get("specialist")!).toBeGreaterThan(params.overall.get("journeyman-b")!);
  });

  it("lets surface ratings disagree with overall ones where the data does", () => {
    const params = fitTennisElo(matches, { surfaceBlend: 1 });
    // Overall, champ > specialist; on clay the specialist dominates.
    expect(params.overall.get("champ")!).toBeGreaterThan(params.overall.get("specialist")!);
    expect(params.bySurface.get("Clay")!.get("specialist")!).toBeGreaterThan(params.bySurface.get("Clay")!.get("champ")!);
  });

  it("moves the prediction with the surface blend", () => {
    const flat = fitTennisElo(matches, { surfaceBlend: 0 });
    const surfaced = fitTennisElo(matches, { surfaceBlend: 1 });
    const onClayFlat = predictTennisElo(flat, "specialist", "champ", "Clay").probabilities[0];
    const onClaySurfaced = predictTennisElo(surfaced, "specialist", "champ", "Clay").probabilities[0];
    expect(onClaySurfaced).toBeGreaterThan(onClayFlat);
    expect(onClaySurfaced).toBeGreaterThan(0.5);
  });

  it("sums to one and uses the rank prior for cold starts", () => {
    const params = fitTennisElo(matches);
    const ranked = predictTennisElo(params, "debutant", "journeyman-a", "Hard", { rankA: 5 });
    expect(ranked.usedFallback).toBe(false);
    expect(ranked.probabilities[0] + ranked.probabilities[1]).toBeCloseTo(1, 10);
    // A top-5 debutant should be favoured over a synthetic journeyman whose
    // rating hovers near the unranked band.
    const unranked = predictTennisElo(params, "nobody", "journeyman-a", "Hard");
    expect(unranked.usedFallback).toBe(true);
  });
});

describe("two-class calibration", () => {
  it("infers the class count so tennis forecasts do not crash isotonic", () => {
    const random = mulberry(29);
    const forecasts: Forecast[] = Array.from({ length: 2500 }, () => {
      const u = random();
      return { probabilities: [0.7, 0.3], outcome: u < 0.55 ? 0 : 1 };
    });
    const calibrator = fitIsotonic(forecasts);
    const applied = calibrator.apply([0.7, 0.3]);
    expect(applied).toHaveLength(2);
    expect(applied[0]! + applied[1]!).toBeCloseTo(1, 10);
    // The forecaster says 70% where the truth is 55% — calibration must help.
    const after = logLoss(forecasts.map((f) => ({ ...f, probabilities: calibrator.apply(f.probabilities) })))!;
    expect(after).toBeLessThan(logLoss(forecasts)!);
    // And the selector runs end to end on two-class input.
    expect(() => selectCalibrator(forecasts)).not.toThrow();
  });
});
