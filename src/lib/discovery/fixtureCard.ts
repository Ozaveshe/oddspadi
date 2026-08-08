import type { DecisionStatus, FixtureStatus, SettlementStatus } from "@/lib/domain/states";

/**
 * The one fixture card.
 *
 * Today, Explore and Live render the same object, because three surfaces
 * building their own card is how the same fixture comes to say "Pick" on one
 * page and "Waiting for odds" on another. The view-model decides; the
 * components only lay it out.
 *
 * What the card may show is a closed list, and what it may never show is the
 * more important half:
 *
 * - **No internal gate text.** "blocked: calibration_support below 0.62" is
 *   operator language. A reader gets a sentence; the machinery stays behind
 *   the fixture page.
 * - **No stale EV as a primary visual.** A +38% edge computed against a price
 *   that expired yesterday is the most persuasive thing on the screen and the
 *   least true. Freshness gates the number, not a footnote beside it.
 * - **No odds unless current.** Historical prices are labelled, or absent.
 */

export type ConsumerState =
  | "pick"
  | "watch"
  | "pass"
  | "waiting_for_odds"
  | "analysis_unavailable"
  | "live"
  | "finished"
  | "result_being_verified";

export type CardInput = {
  fixtureStatus: FixtureStatus;
  decision: DecisionStatus | null;
  /** True when a claim was officially published for this fixture. */
  hasOfficialPick: boolean;
  settlement: SettlementStatus | null;
  /** Whether the stored price is still inside its freshness window. */
  oddsAreCurrent: boolean;
  hasHistoricalOdds: boolean;
  decimalOdds: number | null;
  /** The model's own probability, shown only where a decision stands. */
  modelProbability: number | null;
  /** One short sentence, already written for a reader. */
  reason: string | null;
};

export type FixtureCardView = {
  state: ConsumerState;
  label: string;
  /** One line, reader-facing. Never internal gate text. */
  summary: string;
  /** Odds are present only when they are current. */
  odds: { decimal: number; label: string } | null;
  /** Set when only historical prices exist, so the UI can label them. */
  historicalOddsOnly: boolean;
  showModelProbability: boolean;
  /** Whether "before kickoff" / "add to slip" language is allowed. */
  allowsAction: boolean;
  /** Whether the card should show a result rather than a forecast. */
  showsResult: boolean;
};

const LABELS: Record<ConsumerState, string> = {
  pick: "Pick",
  watch: "Watch",
  pass: "Pass",
  waiting_for_odds: "Waiting for current odds",
  analysis_unavailable: "Analysis unavailable",
  live: "Live",
  finished: "Finished",
  result_being_verified: "Result being verified"
};

const TERMINAL: ReadonlySet<FixtureStatus> = new Set<FixtureStatus>([
  "finished",
  "postponed",
  "cancelled",
  "abandoned"
]);

/**
 * Lifecycle outranks verdict.
 *
 * A finished match is finished whatever the model said before it started, and
 * showing "Pick" on a match that ended two hours ago is the single most common
 * way a board goes stale-looking. So the state is resolved in one direction:
 * result, then live, then the decision.
 */
export function resolveConsumerState(input: CardInput): ConsumerState {
  if (TERMINAL.has(input.fixtureStatus)) {
    // A published claim on a finished fixture that has not settled is not
    // "Finished" — the reader is owed the distinction between "we know" and
    // "we are checking".
    if (input.hasOfficialPick && (input.settlement === null || input.settlement === "unsettled" || input.settlement === "pending_verification")) {
      return "result_being_verified";
    }
    return "finished";
  }
  if (input.fixtureStatus === "live") return "live";

  if (input.decision === null || input.decision === "unavailable") return "analysis_unavailable";
  // A decision that exists but has no live price cannot be acted on, and
  // saying "Pick" beside a price nobody can take is worse than saying nothing.
  if (!input.oddsAreCurrent && (input.decision === "pick" || input.decision === "lean")) {
    return "waiting_for_odds";
  }
  if (input.decision === "withheld") return "analysis_unavailable";
  if (input.decision === "pick" || input.decision === "lean") return "pick";
  if (input.decision === "watch") return "watch";
  return "pass";
}

const ACTIONABLE: ReadonlySet<ConsumerState> = new Set<ConsumerState>(["pick", "watch", "pass"]);
const RESULT_STATES: ReadonlySet<ConsumerState> = new Set<ConsumerState>(["finished", "result_being_verified"]);

/** Reader-facing fallbacks. A card with no sentence is a card that explains nothing. */
const DEFAULT_SUMMARY: Record<ConsumerState, string> = {
  pick: "The model sees value at the current price.",
  watch: "Worth watching; not a call yet.",
  pass: "Analysed, and not worth a bet.",
  waiting_for_odds: "Waiting for a current price before this can be acted on.",
  analysis_unavailable: "Not enough evidence to analyse this fixture.",
  live: "In play.",
  finished: "This fixture has finished.",
  result_being_verified: "The result is being verified before the pick settles."
};

/**
 * Internal vocabulary that must never reach a card.
 *
 * Checked rather than trusted, because these strings arrive from the decision
 * engine's own fields and it is entirely reasonable for them to be there — the
 * mistake is passing them through to a reader unchanged.
 */
const INTERNAL_MARKERS = [
  "gate",
  "blocked",
  "calibration_support",
  "evidence_score",
  "needs_review",
  "quarantine",
  "shadow",
  "mock",
  "provider_",
  "op_",
  "null",
  "undefined"
];

export function isReaderFacing(summary: string): boolean {
  const value = summary.toLowerCase();
  if (/[_]{1,}[a-z]/.test(value)) return false;
  return !INTERNAL_MARKERS.some((marker) => value.includes(marker));
}

export function buildFixtureCard(input: CardInput): FixtureCardView {
  const state = resolveConsumerState(input);
  const showsResult = RESULT_STATES.has(state);
  const allowsAction = ACTIONABLE.has(state);

  // Odds appear only where they are current AND the card is still about a
  // forecast. A price beside a finished match is decoration at best.
  const odds =
    input.oddsAreCurrent && input.decimalOdds !== null && input.decimalOdds > 1 && !showsResult && state !== "live"
      ? { decimal: input.decimalOdds, label: input.decimalOdds.toFixed(2) }
      : null;

  /**
   * A supplied reason is a pre-kickoff rationale, written in the present
   * tense: "the model sees value at the current price". Once the match has
   * started that sentence is history, and rendering it beside a final score
   * asserts something about a market that closed hours ago. So live and result
   * states take the state's own sentence and ignore what the decision said.
   */
  const supplied = showsResult || state === "live" ? null : input.reason?.trim();
  const summary = supplied && isReaderFacing(supplied) ? supplied : DEFAULT_SUMMARY[state];

  return {
    state,
    label: LABELS[state],
    summary,
    odds,
    historicalOddsOnly: !input.oddsAreCurrent && input.hasHistoricalOdds && !showsResult,
    // The model's number stands beside a live verdict only. On a finished
    // fixture it is history, and on an unavailable one it does not exist.
    showModelProbability:
      input.modelProbability !== null && (state === "pick" || state === "watch" || state === "pass"),
    allowsAction,
    showsResult
  };
}
