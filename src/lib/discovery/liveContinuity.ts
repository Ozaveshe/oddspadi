import type { FixtureStatus } from "@/lib/domain/states";

/**
 * What survives when a fixture changes state.
 *
 * A fixture is one thing across its whole life. The failure this prevents is
 * the one where going live silently becomes a different object: a new route, a
 * lost save, and — worst — a pre-match decision quietly re-presented as a live
 * read on a match already in progress.
 *
 * Three things must hold across every transition, and none of them is a
 * rendering concern:
 *
 * 1. **The route does not move.** A saved link, a shared link and a follow all
 *    point at the same URL before, during and after.
 * 2. **The pre-match decision is preserved, not updated.** It was true when it
 *    was made. It stops being current the moment the ball moves, and the card
 *    must say which of those it is showing.
 * 3. **A live model speaks only if one is approved.** Absent that, the honest
 *    live state is a score and no probability, rather than a pre-match number
 *    wearing a live badge.
 */

export type FixturePhase = "pre_match" | "live" | "completed";

export type DecisionProvenance =
  /** Made before kickoff. Historical once the match starts. */
  | "pre_match"
  /** Produced by an approved live model while the match is running. */
  | "live_approved"
  /** No decision at all. */
  | "none";

export type ContinuityState = {
  phase: FixturePhase;
  /** Unchanged across every phase — the whole point. */
  route: string;
  /** Whether the displayed analysis may be called current. */
  analysisIsCurrent: boolean;
  /** How the analysis on show was produced. */
  provenance: DecisionProvenance;
  /** Whether saves and follows carry over. Always true; asserted, not assumed. */
  retainsUserState: true;
  /** Whether the surface should present a result rather than a forecast. */
  presentsResult: boolean;
  /** Reader-facing note when the analysis is historical. */
  historicalNote: string | null;
};

export type ContinuityInput = {
  fixtureId: string;
  status: FixtureStatus;
  hasPreMatchDecision: boolean;
  /** True only where an approved live model exists for this sport. */
  hasApprovedLiveModel: boolean;
};

export function fixturePhase(status: FixtureStatus): FixturePhase {
  if (status === "live") return "live";
  if (status === "finished" || status === "postponed" || status === "cancelled" || status === "abandoned") {
    return "completed";
  }
  return "pre_match";
}

/**
 * The canonical route for a fixture, in every phase.
 *
 * A single function rather than a string built at each call site, because the
 * moment two surfaces construct it independently one of them will special-case
 * live and the identity is broken.
 */
export function fixtureRoute(fixtureId: string): string {
  return `/predictions/${fixtureId}`;
}

export function resolveContinuity(input: ContinuityInput): ContinuityState {
  const phase = fixturePhase(input.status);
  const route = fixtureRoute(input.fixtureId);

  if (phase === "pre_match") {
    return {
      phase,
      route,
      analysisIsCurrent: input.hasPreMatchDecision,
      provenance: input.hasPreMatchDecision ? "pre_match" : "none",
      retainsUserState: true,
      presentsResult: false,
      historicalNote: null
    };
  }

  if (phase === "live") {
    // An approved live model may speak in the present tense. A pre-match
    // decision may not — it is preserved and labelled, never refreshed into
    // something that looks live.
    if (input.hasApprovedLiveModel) {
      return {
        phase,
        route,
        analysisIsCurrent: true,
        provenance: "live_approved",
        retainsUserState: true,
        presentsResult: false,
        historicalNote: null
      };
    }
    return {
      phase,
      route,
      analysisIsCurrent: false,
      provenance: input.hasPreMatchDecision ? "pre_match" : "none",
      retainsUserState: true,
      presentsResult: false,
      historicalNote: input.hasPreMatchDecision
        ? "This analysis was made before kickoff and has not been updated since the match started."
        : null
    };
  }

  return {
    phase,
    route,
    analysisIsCurrent: false,
    provenance: input.hasPreMatchDecision ? "pre_match" : "none",
    retainsUserState: true,
    presentsResult: true,
    historicalNote: input.hasPreMatchDecision
      ? "This analysis was made before kickoff. The result below is what actually happened."
      : null
  };
}

/**
 * Whether a transition preserved everything it had to.
 *
 * Used by the transition tests rather than at runtime. It exists because
 * "the route is stable" is the kind of property that is obviously true right
 * up until a surface appends `?live=1` and nobody notices for a month.
 */
export function continuityHolds(before: ContinuityState, after: ContinuityState): { held: boolean; broken: string[] } {
  const broken: string[] = [];
  if (before.route !== after.route) broken.push(`route moved from ${before.route} to ${after.route}`);
  if (!after.retainsUserState) broken.push("user state was not retained");
  // A pre-match decision must never be relabelled as live analysis. Going the
  // other way — live analysis becoming historical — is the correct direction.
  if (before.provenance === "pre_match" && after.provenance === "live_approved") {
    broken.push("a pre-match decision was re-presented as an approved live model");
  }
  if (before.presentsResult && !after.presentsResult) {
    broken.push("a fixture that was presenting a result went back to presenting a forecast");
  }
  return { held: broken.length === 0, broken };
}
