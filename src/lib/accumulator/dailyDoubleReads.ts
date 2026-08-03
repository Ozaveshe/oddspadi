import { unstable_cache } from "next/cache";
import { buildDailyDouble, eligibleLegs, type DailyDouble, type DoubleCandidate } from "@/lib/accumulator/dailyDouble";
import { buildTicketBoard, type TicketBoard } from "@/lib/accumulator/ticketBoard";
import { buildCurrentCalibrationMetrics } from "@/lib/sports/prediction/decisionCalibration";
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

/**
 * Where each sport's bands came from, and whether that profile is approved.
 *
 * The page was presenting "Model chance 73.9%" from a tennis profile sitting in
 * shadow review, with nothing on the page saying so. That is a claim whose
 * provenance is invisible — the same defect the publication ledger exists to
 * prevent, reintroduced one layer up because the accumulator reads calibration
 * directly rather than through the ledger.
 *
 * A profile in shadow review is legitimate input for arithmetic the reader can
 * inspect. It is not legitimate as an unqualified probability, so the state
 * travels with the bands and the page has to render it.
 */
export type ProfileProvenance = {
  sport: string;
  modelKey: string | null;
  readiness: "waiting-sample" | "waiting-quality" | "ready-shadow-review";
  settledSize: number;
  /** True only when a profile has actually been promoted for live influence. */
  approvedForLiveInfluence: boolean;
  /**
   * Whether closing-line evidence supports a value claim for this sport.
   *
   * Separate from calibration: football is well calibrated and has 32% closing
   * coverage, so it can say how likely an outcome is and cannot say the price
   * is good. The page must not let the first imply the second.
   */
  valueClaimSupported: boolean;
  valueClaimBlockers: string[];
};

export type CalibrationContext = {
  bandsBySport: BandsBySport;
  provenance: ProfileProvenance[];
};

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

/** Sports with a decision model, and therefore a calibration profile. */
export const CALIBRATED_SPORTS = ["football", "tennis", "basketball"] as const;

/**
 * Calibration bands for every sport, cached.
 *
 * Three uncached profile reads behind a 2.5s race meant a cold invocation
 * sometimes timed out on one or all of them, and the page answered "no
 * calibration profile is available" on one request and "78 selections cleared"
 * on the next. Two different truths seconds apart is precisely the
 * contradiction class the rest of the product exists to prevent, and it is
 * worse than a slow page would have been.
 *
 * A profile only changes when a calibration run stores one — daily at most —
 * so a fifteen-minute cache costs nothing in freshness and makes the answer
 * stable.
 */
export const getCachedCalibrationBands = unstable_cache(
  async (): Promise<CalibrationContext> => {
    const bandsBySport: BandsBySport = {};
    const provenance: ProfileProvenance[] = [];
    for (const sport of CALIBRATED_SPORTS) {
      const profile = await buildCurrentCalibrationMetrics(sport).catch(() => null);
      if (!profile || "error" in profile) continue;
      const mapped = bandsFromBuckets(profile.probabilityBuckets);
      if (!mapped.length) continue;
      bandsBySport[sport] = mapped;
      provenance.push({
        sport,
        modelKey: profile.modelKey,
        readiness: profile.promotionReadiness.status,
        settledSize: profile.settledSize,
        // `canInfluenceLive` is typed `false` throughout the calibration
        // module: nothing has ever been promoted. Reading it rather than
        // hardcoding keeps this honest if that ever changes.
        approvedForLiveInfluence: profile.promotionReadiness.canInfluenceLive,
        valueClaimSupported: profile.promotionReadiness.valueClaimSupported,
        valueClaimBlockers: profile.promotionReadiness.valueClaimBlockers
      });
    }
    return { bandsBySport, provenance };
  },
  ["daily-double-calibration-bands-v2"],
  { revalidate: 900 }
);

/**
 * The day's ticket board, built per sport against that sport's own bands.
 *
 * Same discipline as the single double: candidates are filtered by the bands
 * belonging to their sport, and only the survivors compete for a place on a
 * ticket.
 */
export function buildTicketBoardView({
  rows,
  bandsBySport,
  maxTickets
}: {
  rows: SlateFixture[] | null;
  bandsBySport: BandsBySport | null;
  maxTickets?: number;
}): { state: "unavailable" | "no-bands"; note: string } | { state: "ready"; board: TicketBoard } {
  if (!rows) {
    return { state: "unavailable", note: "Today's slate could not be read, so no tickets are shown. This is not the same as there being nothing to show." };
  }
  const sportsWithBands = Object.entries(bandsBySport ?? {}).filter(([, bands]) => bands.length);
  if (!sportsWithBands.length) {
    return {
      state: "no-bands",
      note: "No calibration profile is available yet, so there is no measured accuracy to build tickets from. Tickets assembled without it would be guesses wearing probabilities."
    };
  }

  const candidates = candidatesFromSlate(rows);
  const eligible = sportsWithBands.flatMap(([sport, bands]) =>
    eligibleLegs(candidates.filter((candidate) => candidate.sport === sport), bands)
  );
  const passthrough: BandEvidence[] = [{ lowerBound: 0, upperBound: 1, settledSize: Number.MAX_SAFE_INTEGER, calibrationGap: 0 }];
  return { state: "ready", board: buildTicketBoard(eligible, passthrough, { maxTickets }) };
}
