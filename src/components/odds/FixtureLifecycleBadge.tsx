import { LIFECYCLE_COPY, type FixtureLifecycleState } from "@/lib/sports/lifecycle/fixtureState";

/**
 * What a fixture's state looks like to a visitor.
 *
 * The copy lives with the state machine, not here, so a new state cannot ship
 * without wording — that gap is how "Scheduled" ended up rendering under a
 * match that had finished hours earlier.
 *
 * Two states carry an admission rather than a fact. `due` says we have not had
 * an update; `unresolved` says a result we expected never arrived. Both are
 * deliberately plain: a visitor deciding whether to trust a board is better
 * served by "we have not heard" than by a confident label covering for silence.
 */

const TONE: Record<FixtureLifecycleState, string> = {
  scheduled: "neutral",
  due: "waiting",
  live: "live",
  finished: "settled",
  unresolved: "waiting",
  postponed: "disrupted",
  cancelled: "disrupted",
  abandoned: "disrupted",
  suspended: "disrupted"
};

export function FixtureLifecycleBadge({
  state,
  showDetail = false
}: {
  state: FixtureLifecycleState;
  /** Long form, for the match page. Boards use the label alone. */
  showDetail?: boolean;
}) {
  const copy = LIFECYCLE_COPY[state];
  return (
    <span
      // Reuses the shared `.badge` chip rather than a parallel class, so a
      // lifecycle state looks like every other chip on the board.
      className={`badge lifecycle-${TONE[state]}`}
      data-lifecycle-state={state}
      // The detail is the accessible name for the short label, so a screen
      // reader gets "Kick-off has passed and we have not had an update yet"
      // rather than the bare word "Awaiting".
      title={copy.detail}
    >
      <span className="lifecycle-badge__label">{copy.label}</span>
      {showDetail ? <span className="lifecycle-badge__detail">{copy.detail}</span> : <span className="sr-only">{copy.detail}</span>}
    </span>
  );
}
