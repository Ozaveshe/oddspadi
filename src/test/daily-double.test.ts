import { describe, expect, it } from "vitest";
import {
  assessBand,
  consensusEdgePremium,
  disagreementEdgePremium,
  publicationRequirement,
  type BandEvidence
} from "@/lib/accumulator/calibratedBands";
import { buildDailyDouble, eligibleLegs, type DoubleCandidate } from "@/lib/accumulator/dailyDouble";

/**
 * The bands as production actually measured them on 2026-08-03, against 932
 * settled tennis outcomes. Using the real shape matters: the whole design rests
 * on the middle being well sampled and both tails being empty, and a tidy
 * invented fixture would hide that.
 */
const REAL_BANDS: BandEvidence[] = [
  { lowerBound: 0.0, upperBound: 0.1, settledSize: 1, calibrationGap: 0.959 },
  { lowerBound: 0.1, upperBound: 0.2, settledSize: 7, calibrationGap: 0.259 },
  { lowerBound: 0.2, upperBound: 0.3, settledSize: 77, calibrationGap: 0.063 },
  { lowerBound: 0.3, upperBound: 0.4, settledSize: 162, calibrationGap: 0.065 },
  { lowerBound: 0.4, upperBound: 0.5, settledSize: 217, calibrationGap: 0.007 },
  { lowerBound: 0.5, upperBound: 0.6, settledSize: 221, calibrationGap: 0.024 },
  { lowerBound: 0.6, upperBound: 0.7, settledSize: 162, calibrationGap: 0.034 },
  { lowerBound: 0.7, upperBound: 0.8, settledSize: 77, calibrationGap: 0.024 },
  { lowerBound: 0.8, upperBound: 0.9, settledSize: 7, calibrationGap: 0.259 },
  { lowerBound: 0.9, upperBound: 1.0, settledSize: 1, calibrationGap: 0.959 }
];

function candidate(overrides: Partial<DoubleCandidate> & { fixtureId: string }): DoubleCandidate {
  return {
    competition: `league-${overrides.fixtureId}`,
    sport: "tennis",
    kickoffAt: "2026-08-03T18:00:00.000Z",
    market: "match_winner",
    selection: "home",
    selectionLabel: "Home win",
    modelProbability: 0.72,
    decimalOdds: 1.5,
    noVigProbability: 0.66,
    bookmakerCount: 4,
    ...overrides
  };
}

describe("bands decide what is publishable, not a hardcoded price", () => {
  it("supports the bands with real sample and tight calibration", () => {
    for (const band of REAL_BANDS.filter((b) => b.settledSize >= 77 && (b.calibrationGap ?? 1) <= 0.05)) {
      expect(assessBand(band).supported, `${band.lowerBound}`).toBe(true);
    }
  });

  it("refuses the short-price tail where the model is unmeasured", () => {
    // p80-90 is implied odds ~1.20 — exactly the range the old floor blocked.
    // It stays blocked, but now for the true reason: seven settled outcomes,
    // on which the model claimed 83% and hit 57%.
    const shortPrice = REAL_BANDS.find((b) => b.lowerBound === 0.8)!;
    const verdict = assessBand(shortPrice);
    expect(verdict.supported).toBe(false);
    expect(verdict.reason).toContain("7 settled outcomes");
  });

  it("refuses the longshot tail for the same reason", () => {
    expect(assessBand(REAL_BANDS.find((b) => b.lowerBound === 0.1)!).supported).toBe(false);
  });

  it("would admit a short price once the band earns it", () => {
    // The point of deriving the bound: it moves on its own as evidence lands.
    // The same 0.8-0.9 band with real sample and tight calibration passes.
    const earned: BandEvidence = { lowerBound: 0.8, upperBound: 0.9, settledSize: 140, calibrationGap: 0.02 };
    expect(assessBand(earned).supported).toBe(true);
  });

  it("charges more edge where calibration is looser", () => {
    const tight = assessBand({ lowerBound: 0.4, upperBound: 0.5, settledSize: 217, calibrationGap: 0.007 });
    const loose = assessBand({ lowerBound: 0.6, upperBound: 0.7, settledSize: 162, calibrationGap: 0.045 });
    expect(loose.edgePremium).toBeGreaterThan(tight.edgePremium);
  });
});

describe("bookmaker panel scales the bar instead of gating it", () => {
  it("lets a single book through at a higher price", () => {
    // The old rule refused outright, which cost 13.9% of qualified decisions.
    expect(Number.isFinite(consensusEdgePremium(1))).toBe(true);
    expect(consensusEdgePremium(1)).toBeGreaterThan(consensusEdgePremium(3));
  });

  it("still refuses with no price at all", () => {
    expect(Number.isFinite(consensusEdgePremium(0))).toBe(false);
  });

  it("rewards a deep agreeing panel", () => {
    expect(consensusEdgePremium(8)).toBeLessThan(0);
  });

  it("gives up when the books price different events", () => {
    expect(disagreementEdgePremium(0.2)).toBeNull();
    expect(disagreementEdgePremium(0.02)).toBe(0);
  });

  it("composes every uncertainty into one required edge", () => {
    const thin = publicationRequirement({
      baseEdge: 0.04,
      band: REAL_BANDS.find((b) => b.lowerBound === 0.6)!,
      bookmakerCount: 1,
      maxProbabilitySpread: 0.09
    });
    const rich = publicationRequirement({
      baseEdge: 0.04,
      band: REAL_BANDS.find((b) => b.lowerBound === 0.4)!,
      bookmakerCount: 8,
      maxProbabilitySpread: 0.01
    });
    expect(thin.publishable).toBe(true);
    expect(rich.publishable).toBe(true);
    // Same base edge, very different bars — which is the entire point.
    expect(thin.requiredEdge).toBeGreaterThan(rich.requiredEdge);
  });
});

describe("the daily double", () => {
  const pool: DoubleCandidate[] = [
    candidate({ fixtureId: "a", modelProbability: 0.72, decimalOdds: 1.5, noVigProbability: 0.64 }),
    candidate({ fixtureId: "b", modelProbability: 0.68, decimalOdds: 1.55, noVigProbability: 0.61 }),
    candidate({ fixtureId: "c", modelProbability: 0.55, decimalOdds: 1.9, noVigProbability: 0.5 })
  ];

  it("builds a slip inside the target price", () => {
    const slip = buildDailyDouble(pool, REAL_BANDS);
    expect(slip.status).toBe("built");
    expect(slip.legs).toHaveLength(2);
    expect(slip.combinedOdds).toBeGreaterThanOrEqual(1.8);
    expect(slip.combinedOdds).toBeLessThanOrEqual(2.6);
  });

  it("never puts two legs from the same fixture on one slip", () => {
    const sameMatch = [
      candidate({ fixtureId: "x", selection: "home", modelProbability: 0.72, decimalOdds: 1.5, noVigProbability: 0.64 }),
      candidate({ fixtureId: "x", selection: "over", market: "over_under_25", modelProbability: 0.7, decimalOdds: 1.5, noVigProbability: 0.63 })
    ];
    expect(buildDailyDouble(sameMatch, REAL_BANDS).status).toBe("insufficient-candidates");
  });

  it("refuses a 1.10 favourite however tempting the price", () => {
    // The user-facing question this whole module answers. A 92% shot at 1.10
    // sits in a band with one settled outcome behind it.
    const shortPrices = [
      candidate({ fixtureId: "p", modelProbability: 0.92, decimalOdds: 1.12, noVigProbability: 0.86 }),
      candidate({ fixtureId: "q", modelProbability: 0.91, decimalOdds: 1.13, noVigProbability: 0.85 })
    ];
    expect(eligibleLegs(shortPrices, REAL_BANDS)).toEqual([]);
    expect(buildDailyDouble(shortPrices, REAL_BANDS).status).toBe("insufficient-candidates");
  });

  it("drops a leg with no margin-free price rather than measure edge against the vig", () => {
    const noFair = [
      candidate({ fixtureId: "a", noVigProbability: null }),
      candidate({ fixtureId: "b", noVigProbability: null })
    ];
    expect(eligibleLegs(noFair, REAL_BANDS)).toEqual([]);
  });

  it("states the compounded margin rather than absorbing it", () => {
    const slip = buildDailyDouble(pool, REAL_BANDS);
    expect(slip.combinedMargin).toBeGreaterThan(0);
    expect(slip.notes.join(" ")).toContain("multiplies the bookmaker");
  });

  it("says plainly that the slip loses more often than it wins", () => {
    const slip = buildDailyDouble(pool, REAL_BANDS);
    expect(slip.combinedProbability).toBeLessThan(0.5);
    expect(slip.notes.join(" ")).toContain("loses more often than it wins");
  });

  it("promises nothing", () => {
    const slip = buildDailyDouble(pool, REAL_BANDS);
    const copy = slip.notes.join(" ");
    // Word boundaries, not substrings: "sure" lives inside "measured", and a
    // ban that fires on that would get relaxed rather than respected.
    const banned = [/\bguaranteed\b/i, /\bsure (bet|thing|odds)\b/i, /\bbanker\b/i, /\bcan(?:'|’)?t lose\b/i, /\bsafe bet\b/i, /\brisk[- ]free\b/i];
    for (const pattern of banned) {
      expect(copy, `slip copy must not match ${pattern}`).not.toMatch(pattern);
    }
  });

  it("explains itself when it cannot build one", () => {
    const slip = buildDailyDouble([], REAL_BANDS);
    expect(slip.status).toBe("insufficient-candidates");
    expect(slip.legs).toEqual([]);
    // An empty slip must never render as a zero-probability recommendation.
    expect(slip.notes[0]).toContain("No selection cleared");
  });
});

describe("legs may share a competition", () => {
  it("pairs two matches from the same tournament", () => {
    // The rule that looked prudent and was fatal. A tennis "competition" is one
    // tournament, so a whole day's slate sits under two or three of them; a
    // one-leg-per-competition cap rejected every pair before it was scored —
    // 76 eligible legs in production, zero slips. Different matches in one
    // tournament share no player and no result.
    const sameTournament = [
      candidate({ fixtureId: "m1", competition: "Montreal ATP", modelProbability: 0.72, decimalOdds: 1.5, noVigProbability: 0.64 }),
      candidate({ fixtureId: "m2", competition: "Montreal ATP", modelProbability: 0.68, decimalOdds: 1.55, noVigProbability: 0.61 })
    ];
    const slip = buildDailyDouble(sameTournament, REAL_BANDS);
    expect(slip.status).toBe("built");
    expect(slip.legs).toHaveLength(2);
  });

  it("still refuses two legs from the same match", () => {
    const sameMatch = [
      candidate({ fixtureId: "x", competition: "Montreal ATP", selection: "home", modelProbability: 0.72, decimalOdds: 1.5, noVigProbability: 0.64 }),
      candidate({ fixtureId: "x", competition: "Montreal ATP", selection: "over", market: "over_under_25", modelProbability: 0.7, decimalOdds: 1.5, noVigProbability: 0.63 })
    ];
    expect(buildDailyDouble(sameMatch, REAL_BANDS).status).toBe("insufficient-candidates");
  });
});
