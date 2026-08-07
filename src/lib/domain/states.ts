/**
 * The one place OddsPadi defines what a thing *is*.
 *
 * Public surfaces had been reconstructing these states independently: the
 * homepage counted one way, the results page another, editorial a third. That
 * is how the product reached a state where the official ledger held zero
 * settled picks while a news story described several graded ones — both were
 * "right" against different tables.
 *
 * Everything downstream (API, pages, jobs, reconciliation) imports these
 * definitions. Presentation labels live in `@/lib/product/vocabulary`, which
 * maps *from* these states; no component may invent a state of its own.
 */

/** Where a fixture is in its own lifecycle. Provider states normalise into this. */
export const FIXTURE_STATUSES = [
  "scheduled",
  "delayed",
  "live",
  "finished",
  "postponed",
  "cancelled",
  "abandoned",
  "unknown"
] as const;
export type FixtureStatus = (typeof FIXTURE_STATUSES)[number];

/**
 * How much of the evidence a read actually returned.
 *
 * `confirmed_empty` exists because "we asked and there genuinely is nothing"
 * and "we could not ask" must never render the same. A failed read that
 * displays as zero is the specific failure this taxonomy is built to prevent.
 */
export const DATA_AVAILABILITY_STATES = ["complete", "partial", "stale", "unavailable", "confirmed_empty"] as const;
export type DataAvailability = (typeof DATA_AVAILABILITY_STATES)[number];

/** What the engine concluded about a market. Never about whether it was shown. */
export const DECISION_STATUSES = ["pick", "lean", "watch", "pass", "withheld", "unavailable"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/** Where an official publication is in its own lifecycle. */
export const PUBLICATION_STATUSES = ["draft", "published", "corrected", "retracted"] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

/**
 * How a publication resolved.
 *
 * `push`, `void` and `cancelled` are deliberately distinct from `lost`: a
 * market that never resolved is not a defeat, and folding them together
 * silently flatters or damages the record depending on which way it is done.
 */
export const SETTLEMENT_STATUSES = [
  "unsettled",
  "won",
  "lost",
  "push",
  "void",
  "cancelled",
  "pending_verification"
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

/**
 * What kind of record this is — the taxonomy that decides what may enter the
 * official public performance ledger.
 *
 * Exactly one class is official. Everything else is evidence, commentary,
 * research or somebody else's opinion, and mixing any of it into the public
 * record is a correctness failure rather than a presentation choice.
 */
export const RECORD_CLASSES = [
  /** A calibrated probability. Not a decision, not a claim. */
  "model_probability",
  /** The engine's own conclusion, published or withheld. Training evidence. */
  "internal_decision",
  /** Tracked interest that has not cleared publication. */
  "watch_observation",
  /** Something an article said. Never a pick. */
  "editorial_observation",
  /** The only class that counts publicly. */
  "official_public_pick",
  /** A visitor's or tipster's selection. */
  "community_selection",
  /** Forward simulation — hypothetical by construction. */
  "simulation",
  /** Historical replay over a corpus. */
  "backtest_record",
  /** Paper-mode run of a candidate. Explicitly not public. */
  "shadow_decision"
] as const;
export type RecordClass = (typeof RECORD_CLASSES)[number];

/**
 * The allowlist. One entry, and it stays one entry.
 *
 * Written as a set rather than an inline comparison so that any future
 * loosening is a visible, reviewable, test-breaking change rather than an
 * `||` quietly added to a condition somewhere.
 */
export const OFFICIAL_LEDGER_CLASSES: ReadonlySet<RecordClass> = new Set<RecordClass>(["official_public_pick"]);

export function isOfficialLedgerClass(value: string | null | undefined): value is RecordClass {
  return typeof value === "string" && OFFICIAL_LEDGER_CLASSES.has(value as RecordClass);
}

/** Settlement states in which the outcome is known and final. */
const TERMINAL_SETTLEMENTS: ReadonlySet<SettlementStatus> = new Set<SettlementStatus>([
  "won",
  "lost",
  "push",
  "void",
  "cancelled"
]);

export function isTerminalSettlement(status: SettlementStatus): boolean {
  return TERMINAL_SETTLEMENTS.has(status);
}

/**
 * Settlements that belong in a win-rate denominator.
 *
 * Only decided outcomes: a push returned the stake and a void never ran, so
 * counting either as a played selection misstates the record in both
 * directions.
 */
export function countsTowardRecord(status: SettlementStatus): boolean {
  return status === "won" || status === "lost";
}

export function isFixtureStatus(value: unknown): value is FixtureStatus {
  return typeof value === "string" && (FIXTURE_STATUSES as readonly string[]).includes(value);
}

export function isPublicationStatus(value: unknown): value is PublicationStatus {
  return typeof value === "string" && (PUBLICATION_STATUSES as readonly string[]).includes(value);
}

export function isSettlementStatus(value: unknown): value is SettlementStatus {
  return typeof value === "string" && (SETTLEMENT_STATUSES as readonly string[]).includes(value);
}

export function isDecisionStatus(value: unknown): value is DecisionStatus {
  return typeof value === "string" && (DECISION_STATUSES as readonly string[]).includes(value);
}

export function isDataAvailability(value: unknown): value is DataAvailability {
  return typeof value === "string" && (DATA_AVAILABILITY_STATES as readonly string[]).includes(value);
}

/**
 * Legacy slate statuses → canonical decision status.
 *
 * `SlatePublicStatus` mixes decision outcome ("no_clear_value") with data
 * condition ("stale", "needs_data") and lifecycle ("settled", "needs_review").
 * The canonical vocabulary separates those concerns, so this map is the single
 * translation point rather than a conditional repeated per component.
 */
const SLATE_STATUS_TO_DECISION: Record<string, DecisionStatus> = {
  value_pick: "pick",
  lean: "lean",
  watchlist: "watch",
  no_clear_value: "pass",
  preliminary: "watch",
  ready: "watch",
  stale: "withheld",
  needs_data: "withheld",
  suspended: "unavailable",
  settled: "pass",
  needs_review: "withheld"
};

export function decisionStatusFromSlateStatus(value: string): DecisionStatus {
  return SLATE_STATUS_TO_DECISION[value] ?? "unavailable";
}

/** Legacy settlement words used across older tables → canonical settlement. */
const LEGACY_SETTLEMENT: Record<string, SettlementStatus> = {
  pending: "unsettled",
  unsettled: "unsettled",
  won: "won",
  win: "won",
  lost: "lost",
  loss: "lost",
  push: "push",
  void: "void",
  cancelled: "cancelled",
  canceled: "cancelled",
  needs_review: "pending_verification",
  needs_manual_review: "pending_verification",
  provider_missing: "pending_verification",
  pending_verification: "pending_verification"
};

export function settlementStatusFromLegacy(value: string | null | undefined): SettlementStatus {
  if (!value) return "unsettled";
  return LEGACY_SETTLEMENT[value.toLowerCase()] ?? "pending_verification";
}
