import { buildDailyDouble, eligibleLegs, type DailyDouble, type DoubleCandidate } from "@/lib/accumulator/dailyDouble";
import type { BandEvidence } from "@/lib/accumulator/calibratedBands";
import type { ProbabilityCalibrationBucket } from "@/lib/sports/prediction/decisionCalibration";
import type { SlateFixture } from "@/lib/sports/intelligence/types";

/**
 * Turning today's slate into a daily double, without a database round trip.
 *
 * The page reads the already-cached tips product rather than querying, which
 * keeps it inside the public-read discipline: no expensive work on the request
 * path. Calibration bands are the one extra input, and they are small.
 */

/** The calibration profile's buckets are already band-shaped. */
export function bandsFromBuckets(buckets: ProbabilityCalibrationBucket[]): BandEvidence[] {
  return buckets.map((bucket) => ({
    lowerBound: bucket.lowerBound,
    upperBound: bucket.upperBound,
    settledSize: bucket.settledSize,
    calibrationGap: bucket.calibrationGap
  }));
}

/**
 * Every priced selection on the slate, as a candidate leg.
 *
 * Draws from `allMarketAnalyses` rather than only the headline pick: the best
 * leg for a double is often not the fixture's own best pick, because the double
 * is optimising a combined price rather than a single edge.
 */
export function candidatesFromSlate(rows: SlateFixture[]): DoubleCandidate[] {
  const candidates: DoubleCandidate[] = [];
  for (const row of rows) {
    const { fixture } = row;
    // A fixture that has already started cannot be added to a slip.
    if (fixture.status !== "scheduled") continue;

    for (const analysis of row.decisionSummary.allMarketAnalyses) {
      if (!(analysis.odds > 1)) continue;
      // No margin-free price means the edge cannot be separated from the vig.
      if (typeof analysis.noVigImpliedProbability !== "number") continue;
      candidates.push({
        fixtureId: fixture.fixtureId,
        competition: fixture.league,
        sport: fixture.sport,
        kickoffAt: fixture.kickoffAt,
        market: analysis.marketId,
        selection: analysis.selectionId,
        selectionLabel: `${fixture.homeTeam.name} v ${fixture.awayTeam.name} — ${analysis.label}`,
        modelProbability: analysis.modelProbability,
        decimalOdds: analysis.odds,
        noVigProbability: analysis.noVigImpliedProbability,
        bookmakerCount:
          typeof (analysis as { consensusBookmakerCount?: number }).consensusBookmakerCount === "number"
            ? (analysis as { consensusBookmakerCount?: number }).consensusBookmakerCount ?? 0
            : 0
      });
    }
  }
  return candidates;
}

/**
 * Bands are per sport, and a candidate must be judged against its own.
 *
 * The first version read one sport's profile and applied it to the whole
 * slate. On a slate that is 78% tennis that means tennis selections were being
 * scored against football's measured accuracy — two different models, two
 * different error profiles, one set of bands. The bands are keyed by sport now
 * and a candidate whose sport has no profile is excluded rather than borrowing
 * another sport's.
 */
export type BandsBySport = Record<string, BandEvidence[]>;

export type DailyDoubleView =
  | { state: "unavailable"; note: string }
  | { state: "no-bands"; note: string }
  | { state: "ready"; slip: DailyDouble };

/**
 * Build the view, refusing to guess when the inputs are not there.
 *
 * Three distinct empty states, deliberately: no slate read is an outage, no
 * calibration profile is a capability gap, and no qualifying combination is a
 * genuine finding about today. Collapsing them into one "nothing today" would
 * repeat the error-becomes-empty defect the rest of the product spent so long
 * removing.
 */
export function buildDailyDoubleView({
  rows,
  bandsBySport
}: {
  rows: SlateFixture[] | null;
  bandsBySport: BandsBySport | null;
}): DailyDoubleView {
  if (!rows) {
    return { state: "unavailable", note: "Today's slate could not be read, so no slip is shown. This is not the same as there being nothing to show." };
  }
  const sportsWithBands = Object.entries(bandsBySport ?? {}).filter(([, bands]) => bands.length);
  if (!sportsWithBands.length) {
    return {
      state: "no-bands",
      note: "No calibration profile is available yet, so there is no measured accuracy to build a slip from. A slip assembled without it would be a guess wearing a probability."
    };
  }

  // Each sport's candidates are filtered by that sport's own bands, then the
  // survivors compete for the slip together.
  const candidates = candidatesFromSlate(rows);
  const eligible = sportsWithBands.flatMap(([sport, bands]) =>
    eligibleLegs(candidates.filter((candidate) => candidate.sport === sport), bands)
  );

  // The legs are already band-filtered, so the builder is handed a permissive
  // band set rather than being asked to filter twice against the wrong sport.
  const passthrough: BandEvidence[] = [{ lowerBound: 0, upperBound: 1, settledSize: Number.MAX_SAFE_INTEGER, calibrationGap: 0 }];
  return { state: "ready", slip: buildDailyDouble(eligible, passthrough) };
}
