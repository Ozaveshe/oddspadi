import type { CanonicalResult, VerificationState } from "@/lib/results/canonicalResult";
import type { CanonicalSport } from "@/lib/markets/canonicalMarkets";

/**
 * Deciding whether we believe a result.
 *
 * Settlement has always read the provider's status directly, which means "the
 * provider said finished" and "we know what happened" were the same statement.
 * They are not. A provider can report a terminal status with a partial score,
 * revise a score an hour later, or report a fixture finished that a second
 * observation contradicts.
 *
 * This module produces the state settlement filters on. It never writes a
 * verdict and never repairs a score — an unverifiable result stays
 * unverifiable, and somebody is told.
 */

export type ResultObservation = {
  sourceId: string;
  observedAt: string;
  resultStatus: CanonicalResult["resultStatus"];
  regulationHome: number | null;
  regulationAway: number | null;
  winner: CanonicalResult["winner"];
};

/**
 * A source of result observations.
 *
 * One implementation is registered today — re-observation of the primary
 * provider at a later time. A licensed second provider is a new implementation
 * and no schema change, which is the whole reason this is an interface rather
 * than a provider name threaded through the verifier.
 */
export type ResultSource = {
  id: string;
  observe(fixtureId: string): Promise<ResultObservation | null>;
};

export const AGREEMENT_WINDOW_MINUTES = 10;
export const SINGLE_OBSERVATION_TIMEOUT_HOURS = 6;

export type VerificationInput = {
  sport: CanonicalSport;
  observations: ResultObservation[];
  /** Goals recorded in the live event stream, where we have one. */
  liveEventGoals?: { home: number; away: number } | null;
  now: Date;
};

export type VerificationVerdict = {
  state: VerificationState;
  reason: string;
  /** Set when the verdict should raise an exception for an operator. */
  exception?: { kind: string; detail: Record<string, unknown> };
};

const TERMINAL_STATUSES = new Set(["finished", "postponed", "cancelled", "abandoned", "retired", "walkover", "awarded"]);

/** What a sport needs on the row before any of its markets can be graded. */
function scoreIsComplete(sport: CanonicalSport, observation: ResultObservation): boolean {
  if (observation.resultStatus !== "finished" && observation.resultStatus !== "retired") {
    // A postponed or cancelled fixture legitimately has no score; completeness
    // is not the question for those.
    return true;
  }
  if (sport === "tennis") {
    // Tennis grades from the awarded winner and the set/game counts, which the
    // observation carries separately; a winner is the minimum.
    return observation.winner === "home" || observation.winner === "away";
  }
  return observation.regulationHome !== null && observation.regulationAway !== null;
}

function sameOutcome(a: ResultObservation, b: ResultObservation): boolean {
  return (
    a.resultStatus === b.resultStatus &&
    a.regulationHome === b.regulationHome &&
    a.regulationAway === b.regulationAway &&
    a.winner === b.winner
  );
}

function minutesBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60_000;
}

export function verifyResult(input: VerificationInput): VerificationVerdict {
  const { observations, sport, now } = input;
  if (observations.length === 0) {
    return { state: "provisional", reason: "No observation of this fixture has been recorded." };
  }

  const ordered = [...observations].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const latest = ordered[ordered.length - 1]!;

  if (!TERMINAL_STATUSES.has(latest.resultStatus)) {
    return { state: "provisional", reason: `Latest observation reports ${latest.resultStatus}, which is not terminal.` };
  }

  // Disagreement outranks everything below it. A conflict is a fact about our
  // evidence, and no amount of further agreement resolves it automatically.
  const disagreeing = ordered.filter((observation) => !sameOutcome(observation, latest));
  if (disagreeing.length > 0) {
    return {
      state: "conflicted",
      reason: `${disagreeing.length} of ${ordered.length} observations disagree with the latest.`,
      exception: {
        kind: "result_conflict",
        detail: {
          reason: "observations_disagree",
          latest,
          disagreeing: disagreeing.map((observation) => ({
            sourceId: observation.sourceId,
            observedAt: observation.observedAt,
            resultStatus: observation.resultStatus,
            regulationHome: observation.regulationHome,
            regulationAway: observation.regulationAway,
            winner: observation.winner
          }))
        }
      }
    };
  }

  if (!scoreIsComplete(sport, latest)) {
    return {
      state: "provisional",
      reason: `Terminal status ${latest.resultStatus} arrived without a score complete enough for ${sport} markets.`
    };
  }

  // The live event stream is a third signal where it exists. It is checked
  // against the score rather than trusted over it: a mismatch means one of the
  // two is wrong and we do not know which.
  if (input.liveEventGoals && latest.regulationHome !== null && latest.regulationAway !== null) {
    const { home, away } = input.liveEventGoals;
    if (home !== latest.regulationHome || away !== latest.regulationAway) {
      return {
        state: "conflicted",
        reason: `Live event stream recorded ${home}-${away}; the final score says ${latest.regulationHome}-${latest.regulationAway}.`,
        exception: {
          kind: "result_conflict",
          detail: { reason: "event_stream_mismatch", eventStream: input.liveEventGoals, finalScore: { home: latest.regulationHome, away: latest.regulationAway } }
        }
      };
    }
  }

  const distinctSources = new Set(ordered.map((observation) => observation.sourceId));
  if (distinctSources.size > 1) {
    return { state: "verified", reason: `Agreed by ${distinctSources.size} independent sources.` };
  }

  const spread = minutesBetween(ordered[0]!.observedAt, latest.observedAt);
  if (ordered.length > 1 && spread >= AGREEMENT_WINDOW_MINUTES) {
    return {
      state: "verified",
      reason: `Two agreeing observations ${Math.round(spread)} minutes apart from ${latest.sourceId}.`
    };
  }

  /**
   * A single stable observation will never acquire a second one — the provider
   * has said its last word. Left as `provisional` it would trip the unverified
   * SLA alert on every sweep forever, and an alert nobody can clear is an alert
   * everybody learns to ignore. So it escalates to a human instead.
   */
  const ageHours = (now.getTime() - new Date(latest.observedAt).getTime()) / 3_600_000;
  if (ageHours >= SINGLE_OBSERVATION_TIMEOUT_HOURS) {
    return {
      state: "manual_review",
      reason: `Only one observation after ${Math.round(ageHours)} hours; a second will not arrive.`,
      exception: {
        kind: "result_conflict",
        detail: { reason: "single_observation_timeout", observedAt: latest.observedAt, ageHours: Math.round(ageHours) }
      }
    };
  }

  return {
    state: "provisional",
    reason:
      ordered.length > 1
        ? `Observations agree but are only ${Math.round(spread)} minutes apart; ${AGREEMENT_WINDOW_MINUTES} required.`
        : "Awaiting a second observation."
  };
}
