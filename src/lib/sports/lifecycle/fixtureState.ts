/**
 * What state a fixture is in, and why.
 *
 * The board used to answer this with a single `status` column that a batch job
 * mutated four times a day. Between runs the column was simply wrong, and the
 * read path had no opinion of its own: a football match that finished at 14:00
 * still presented as `scheduled` until the 20:20 sweep noticed. Correctness
 * depended on a cron having fired, which is not a property a page should have.
 *
 * So state is derived here, from timestamps, at read time — and the same
 * function is what reconciliation uses to decide what to write. One rule,
 * evaluated in two places, cannot disagree with itself.
 *
 * The rule that matters most: **the scheduled time alone never proves
 * anything**. Kickoff passing does not mean a match is live, and kickoff plus
 * four hours does not mean it finished. Both are guesses, and both were being
 * rendered as facts. When the clock has passed but no provider evidence has
 * arrived, the honest states are `due` and `unresolved`, and both of them say
 * out loud that we do not know.
 */

/** Longest a match plausibly runs, measured from kickoff. */
const PLAY_WINDOW_MS: Record<string, number> = {
  football: 4 * 60 * 60 * 1000,
  basketball: 4.5 * 60 * 60 * 1000,
  tennis: 8 * 60 * 60 * 1000
};
const DEFAULT_PLAY_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * These mirror `op_expire_stale_fixtures`. Two copies of a policy drift, so
 * `temporal-lifecycle.test.ts` parses the migration and asserts they agree.
 */
export function playWindowMs(sport: string): number {
  return PLAY_WINDOW_MS[sport] ?? DEFAULT_PLAY_WINDOW_MS;
}

export type FixtureLifecycleState =
  /** Kickoff is in the future. */
  | "scheduled"
  /** Kickoff has passed; no provider evidence of play or result yet. */
  | "due"
  /** Observed in play. */
  | "live"
  /** A final result was observed. */
  | "finished"
  /** Past its plausible window with no evidence either way. Quarantine, not "finished". */
  | "unresolved"
  | "postponed"
  | "cancelled"
  | "abandoned"
  | "suspended";

/** Terminal states never re-open, so reconciliation must not overwrite them. */
export const TERMINAL_STATES: ReadonlySet<FixtureLifecycleState> = new Set([
  "finished",
  "cancelled",
  "abandoned"
]);

/** States a visitor may act on. Everything else is history or an unknown. */
export const ACTIONABLE_STATES: ReadonlySet<FixtureLifecycleState> = new Set(["scheduled"]);

/** Only what the decision actually depends on, so callers cannot pass a whole row by habit. */
export type FixtureTemporalFacts = {
  sport: string;
  kickoffAt: Date;
  /** Provider-stated status, when there is one. */
  status?: string | null;
  startedAt?: Date | null;
  resultedAt?: Date | null;
  homeScore?: number | null;
  awayScore?: number | null;
};

export type FixtureLifecycle = {
  state: FixtureLifecycleState;
  /** The evidence the state rests on — rendered as copy, and logged by the reconciler. */
  basis: "provider-status" | "result-observed" | "start-observed" | "clock-only" | "no-evidence";
  actionable: boolean;
  terminal: boolean;
  /** How far past the plausible window, in ms. Zero when still inside it. */
  overdueByMs: number;
};

/** Provider vocabularies vary; map them once rather than at every call site. */
const PROVIDER_STATES: Record<string, FixtureLifecycleState> = {
  postponed: "postponed",
  cancelled: "cancelled",
  canceled: "cancelled",
  abandoned: "abandoned",
  suspended: "suspended",
  finished: "finished",
  live: "live"
};

export function fixtureLifecycle(facts: FixtureTemporalFacts, now: Date): FixtureLifecycle {
  const elapsedMs = now.getTime() - facts.kickoffAt.getTime();
  const window = playWindowMs(facts.sport);
  const overdueByMs = Math.max(0, elapsedMs - window);

  const decide = (state: FixtureLifecycleState, basis: FixtureLifecycle["basis"]): FixtureLifecycle => ({
    state,
    basis,
    actionable: ACTIONABLE_STATES.has(state),
    terminal: TERMINAL_STATES.has(state),
    overdueByMs
  });

  // 1. A result is the strongest evidence there is, and it outranks a stale
  //    provider status that still says "live".
  if (facts.resultedAt) return decide("finished", "result-observed");

  // 2. A provider statement about a disruption is evidence we cannot derive.
  //    Nothing in a timestamp tells you a match was postponed.
  const stated = facts.status ? PROVIDER_STATES[facts.status.toLowerCase()] : undefined;
  if (stated && stated !== "live" && stated !== "finished") return decide(stated, "provider-status");

  // 3. "finished" without a result timestamp is history from before
  //    `resulted_at` existed. Trust it only when a score backs it up —
  //    otherwise it is a batch job's guess, which is what we are replacing.
  if (stated === "finished") {
    const scored = facts.homeScore != null && facts.awayScore != null;
    if (scored) return decide("finished", "provider-status");
    return decide(overdueByMs > 0 ? "unresolved" : "due", "no-evidence");
  }

  // 4. Observed in play — but only while that is still plausible.
  //
  //    A provider status is a claim with a timestamp we mostly do not get, and
  //    it goes stale silently. Measured against production on 2026-08-06: 35
  //    fixtures were still marked `live`, some more than 60 hours after
  //    kick-off. Trusting that unconditionally would render three-day-old
  //    matches as in-play, which is a worse lie than admitting we lost track.
  //
  //    Past the window, evidence of a start with no result is exactly the
  //    "should have finished, did not hear" case, so it lands in quarantine
  //    with everything else we cannot account for.
  if (overdueByMs > 0 && (facts.startedAt || stated === "live")) {
    return decide("unresolved", facts.startedAt ? "start-observed" : "provider-status");
  }
  if (facts.startedAt) return decide("live", "start-observed");
  if (stated === "live") return decide("live", "provider-status");

  // 5. Nothing observed. The clock is all we have, so the state must say so.
  if (elapsedMs < 0) return decide("scheduled", "clock-only");
  if (overdueByMs > 0) return decide("unresolved", "no-evidence");
  return decide("due", "no-evidence");
}

/**
 * Public copy for a state.
 *
 * Kept beside the state machine so a new state cannot ship without wording,
 * which is how "scheduled" ended up rendering under a match that finished
 * hours earlier. The strings never claim knowledge the state does not carry —
 * `unresolved` says the result is missing, not that the match was abandoned.
 */
export const LIFECYCLE_COPY: Record<FixtureLifecycleState, { label: string; detail: string }> = {
  scheduled: { label: "Scheduled", detail: "Kick-off has not arrived yet." },
  due: { label: "Awaiting update", detail: "Kick-off has passed and we have not had an update yet." },
  live: { label: "Live", detail: "In play now." },
  finished: { label: "Finished", detail: "Final result confirmed." },
  unresolved: { label: "Result missing", detail: "This match should have finished. We have not received a result." },
  postponed: { label: "Postponed", detail: "Moved to a later date by the organisers." },
  cancelled: { label: "Cancelled", detail: "Called off and will not be played." },
  abandoned: { label: "Abandoned", detail: "Stopped after starting and not completed." },
  suspended: { label: "Suspended", detail: "Paused. It may resume." }
};
