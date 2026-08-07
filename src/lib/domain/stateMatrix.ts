import {
  DATA_AVAILABILITY_STATES,
  DECISION_STATUSES,
  FIXTURE_STATUSES,
  PUBLICATION_STATUSES,
  SETTLEMENT_STATUSES,
  type DataAvailability,
  type DecisionStatus,
  type FixtureStatus,
  type PublicationStatus,
  type SettlementStatus
} from "@/lib/domain/states";

/**
 * Which combinations of the five state dimensions can actually exist.
 *
 * The dimensions were already defined separately and correctly. What was
 * missing is the model of how they constrain each other — so nothing prevented
 * the product from rendering a scheduled fixture with a settled result, or a
 * settlement with no publication behind it. Each of those is individually
 * representable and jointly nonsense.
 *
 * This is the coherence model. It serves three callers:
 *
 *   1. the state test matrix, which enumerates the coherent cells
 *   2. the contradiction suite, which asserts the product never renders an
 *      incoherent one
 *   3. the reconciliation job, which reports incoherent rows found in
 *      production without touching them
 *
 * A rule here is a claim about the domain, not about the code. If a rule is
 * wrong the fix is to correct the rule, not to widen it until CI passes.
 */
export type StateCell = {
  fixture: FixtureStatus;
  data: DataAvailability;
  decision: DecisionStatus;
  publication: PublicationStatus | null;
  settlement: SettlementStatus;
};

/** Fixtures that have stopped and will not resume. */
const TERMINAL_FIXTURES: ReadonlySet<FixtureStatus> = new Set<FixtureStatus>([
  "finished",
  "cancelled",
  "abandoned"
]);

/** Fixtures where a score can exist at all. */
const SCORING_FIXTURES: ReadonlySet<FixtureStatus> = new Set<FixtureStatus>(["live", "finished", "abandoned"]);

/** Publication states that mean "this was shown to the public as official". */
const PUBLIC_PUBLICATIONS: ReadonlySet<PublicationStatus> = new Set<PublicationStatus>([
  "published",
  "corrected",
  "retracted"
]);

/**
 * Settlements that assert an outcome, as opposed to returning a stake.
 *
 * The half outcomes belong here: an Asian quarter line that half-wins has
 * resolved, it simply resolved across the two neighbouring half lines. Treating
 * them as undecided would let a coherent cell put a half win on an abandoned
 * fixture, which is exactly the contradiction this model exists to make
 * unrepresentable.
 */
const DECIDED_SETTLEMENTS: ReadonlySet<SettlementStatus> = new Set<SettlementStatus>([
  "won",
  "half_won",
  "half_lost",
  "lost",
  "push"
]);

/**
 * Whether "monitor this", "before kickoff", "add to your slip" language is
 * allowed. Anything that has started or ended cannot carry it.
 */
export function actionLanguageAllowed(fixture: FixtureStatus): boolean {
  return fixture === "scheduled" || fixture === "delayed";
}

export function mayHaveScore(fixture: FixtureStatus): boolean {
  return SCORING_FIXTURES.has(fixture);
}

/**
 * Every reason a cell cannot exist. Empty means coherent.
 *
 * Returns all violations rather than the first, because a reconciliation
 * report that surfaces one problem per row makes an operator fix, re-run, and
 * discover the next one.
 */
export function explainIncoherence(cell: StateCell): string[] {
  const problems: string[] = [];
  const settled = cell.settlement !== "unsettled";
  const published = cell.publication !== null && PUBLIC_PUBLICATIONS.has(cell.publication);

  // --- Settlement against the fixture lifecycle ------------------------------
  if (settled && !TERMINAL_FIXTURES.has(cell.fixture)) {
    problems.push(`settlement "${cell.settlement}" on a fixture that is "${cell.fixture}" and has not ended`);
  }
  // A decided outcome needs a completed match. An abandoned game may void, but
  // it cannot produce a winner — and a half win is a decided outcome too: the
  // quarter line resolved, it simply resolved across two half lines.
  if (DECIDED_SETTLEMENTS.has(cell.settlement) && cell.fixture !== "finished") {
    problems.push(`settlement "${cell.settlement}" requires a finished fixture, not "${cell.fixture}"`);
  }
  if (cell.fixture === "cancelled" && cell.settlement !== "unsettled" && cell.settlement !== "cancelled" && cell.settlement !== "void") {
    problems.push(`a cancelled fixture can only settle as cancelled or void, not "${cell.settlement}"`);
  }

  // --- Settlement against publication ---------------------------------------
  // Listed prohibited contradiction: settlement without publication. Settling
  // grades a claim; with nothing published there is no claim to grade.
  if (settled && !published) {
    problems.push(`settlement "${cell.settlement}" with no published claim to settle`);
  }
  if (cell.publication === "draft" && settled) {
    problems.push("a draft was settled, but a draft was never public");
  }

  // --- Decision against data availability -----------------------------------
  // The defect this whole taxonomy exists to prevent: a failed read must not
  // be rendered as a considered "no value here".
  if (cell.data === "unavailable" && cell.decision !== "unavailable") {
    problems.push(`data was unavailable but the decision is "${cell.decision}" — a failed read must stay unavailable`);
  }
  if (cell.data === "unavailable" && published) {
    problems.push("published a claim while the underlying data was unavailable");
  }
  if (cell.data === "confirmed_empty" && cell.decision === "pick") {
    problems.push("a pick was produced from confirmed-empty evidence");
  }
  if (cell.data === "stale" && cell.decision === "pick") {
    problems.push("a pick was produced from stale evidence rather than withheld");
  }

  // --- Decision against publication -----------------------------------------
  if (published && cell.decision !== "pick") {
    // Only a pick is publishable. A lean or a watch that reached the public
    // ledger means the publication gate was bypassed.
    problems.push(`decision "${cell.decision}" was published, but only a pick may be published`);
  }
  if (cell.decision === "withheld" && published) {
    problems.push("a withheld decision cannot also be published");
  }
  if (cell.decision === "unavailable" && cell.publication !== null) {
    problems.push("a publication record exists for a decision that was never made");
  }

  // --- Corrections and retractions ------------------------------------------
  if (cell.publication === "corrected" && cell.decision !== "pick") {
    problems.push("a correction exists for something that was never a pick");
  }

  return problems;
}

export function isCoherent(cell: StateCell): boolean {
  return explainIncoherence(cell).length === 0;
}

/**
 * The canonical matrix: every coherent combination of the five dimensions.
 *
 * Generated rather than hand-listed so a new state added to `states.ts` is
 * automatically covered instead of silently untested. The full cross-product is
 * 7 x 5 x 6 x 5 x 7 = 7,350 cells; the coherence rules cut it to the ones that
 * describe a situation the product can actually be in.
 */
export function coherentCells(): StateCell[] {
  const cells: StateCell[] = [];
  const publications: (PublicationStatus | null)[] = [null, ...PUBLICATION_STATUSES];
  for (const fixture of FIXTURE_STATUSES) {
    if (fixture === "unknown") continue; // not a state the product presents
    for (const data of DATA_AVAILABILITY_STATES) {
      for (const decision of DECISION_STATUSES) {
        for (const publication of publications) {
          for (const settlement of SETTLEMENT_STATUSES) {
            const cell = { fixture, data, decision, publication, settlement };
            if (isCoherent(cell)) cells.push(cell);
          }
        }
      }
    }
  }
  return cells;
}

/**
 * A small, hand-chosen set covering every value of every dimension at least
 * once, plus the transitions that have actually broken in production.
 *
 * The full coherent set is too large to render ten surfaces for on every CI
 * run. This is the subset the cross-surface suite walks; the full set is still
 * asserted for coherence, and the coverage test below proves this subset does
 * not quietly stop exercising a state.
 */
export const REPRESENTATIVE_CELLS: ReadonlyArray<{ id: string; cell: StateCell; note: string }> = [
  {
    id: "scheduled-complete-pick-published",
    cell: { fixture: "scheduled", data: "complete", decision: "pick", publication: "published", settlement: "unsettled" },
    note: "The happy path: a published pick before kickoff."
  },
  {
    id: "scheduled-partial-lean",
    cell: { fixture: "scheduled", data: "partial", decision: "lean", publication: null, settlement: "unsettled" },
    note: "A directional view that did not clear the publication gate."
  },
  {
    id: "scheduled-stale-withheld",
    cell: { fixture: "scheduled", data: "stale", decision: "withheld", publication: null, settlement: "unsettled" },
    note: "Stale evidence must withhold, never pick."
  },
  {
    id: "scheduled-unavailable-read-failed",
    cell: { fixture: "scheduled", data: "unavailable", decision: "unavailable", publication: null, settlement: "unsettled" },
    note: "The failed read. Must never render as a considered pass or as zero."
  },
  {
    id: "scheduled-confirmed-empty-pass",
    cell: { fixture: "scheduled", data: "confirmed_empty", decision: "pass", publication: null, settlement: "unsettled" },
    note: "We looked and there is genuinely nothing. Distinct from the row above."
  },
  {
    id: "delayed-complete-watch",
    cell: { fixture: "delayed", data: "complete", decision: "watch", publication: null, settlement: "unsettled" },
    note: "Delayed still permits pre-kickoff action language."
  },
  {
    id: "live-complete-published",
    cell: { fixture: "live", data: "complete", decision: "pick", publication: "published", settlement: "unsettled" },
    note: "In play: a score exists and pre-kickoff language must be gone."
  },
  {
    id: "finished-complete-won",
    cell: { fixture: "finished", data: "complete", decision: "pick", publication: "published", settlement: "won" },
    note: "Settled winner. Counts toward the record."
  },
  {
    id: "finished-complete-lost",
    cell: { fixture: "finished", data: "complete", decision: "pick", publication: "published", settlement: "lost" },
    note: "Settled loser. Also counts, and must not be quietly dropped."
  },
  {
    id: "finished-half-won",
    cell: { fixture: "finished", data: "complete", decision: "pick", publication: "published", settlement: "half_won" },
    note: "Asian quarter line: one half won, the other pushed. A played pick returning half the profit — it counts toward the record, and copy must not round it to a win."
  },
  {
    id: "finished-half-lost",
    cell: { fixture: "finished", data: "complete", decision: "pick", publication: "published", settlement: "half_lost" },
    note: "Asian quarter line: one half lost, the other pushed. Half the stake returned, so it counts toward the record but costs 0.5 units rather than 1."
  },
  {
    id: "finished-push",
    cell: { fixture: "finished", data: "complete", decision: "pick", publication: "published", settlement: "push" },
    note: "Stake returned. Must not land in the win-rate denominator."
  },
  {
    id: "finished-pending-verification",
    cell: { fixture: "finished", data: "partial", decision: "pick", publication: "published", settlement: "pending_verification" },
    note: "Final whistle but the result is not trusted yet."
  },
  {
    id: "finished-corrected",
    cell: { fixture: "finished", data: "complete", decision: "pick", publication: "corrected", settlement: "won" },
    note: "An append-only correction. The original must remain visible."
  },
  {
    id: "finished-retracted",
    cell: { fixture: "finished", data: "complete", decision: "pick", publication: "retracted", settlement: "void" },
    note: "Withdrawn after publication. Excluded from the record, not deleted."
  },
  {
    id: "postponed-unsettled",
    cell: { fixture: "postponed", data: "complete", decision: "pass", publication: null, settlement: "unsettled" },
    note: "No score, no settlement, and no countdown to a kickoff that moved."
  },
  {
    id: "cancelled-void",
    cell: { fixture: "cancelled", data: "complete", decision: "pick", publication: "published", settlement: "void" },
    note: "Never played. Void, not lost."
  },
  {
    id: "abandoned-void",
    cell: { fixture: "abandoned", data: "partial", decision: "pick", publication: "published", settlement: "void" },
    note: "Started and stopped: a partial score exists but no outcome."
  },
  {
    id: "scheduled-draft",
    cell: { fixture: "scheduled", data: "complete", decision: "pick", publication: "draft", settlement: "unsettled" },
    note: "Prepared but not public. Must not appear on any public surface."
  }
];

/** Dimension coverage of the representative set, for the matrix doc and test. */
export function representativeCoverage(): Record<string, string[]> {
  const seen: Record<string, Set<string>> = {
    fixture: new Set(),
    data: new Set(),
    decision: new Set(),
    publication: new Set(),
    settlement: new Set()
  };
  for (const { cell } of REPRESENTATIVE_CELLS) {
    seen.fixture.add(cell.fixture);
    seen.data.add(cell.data);
    seen.decision.add(cell.decision);
    seen.publication.add(cell.publication ?? "none");
    seen.settlement.add(cell.settlement);
  }
  return Object.fromEntries(Object.entries(seen).map(([key, set]) => [key, [...set].sort()]));
}
