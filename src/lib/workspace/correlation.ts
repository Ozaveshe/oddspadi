import type { AnalysedLeg, CanonicalSelection } from "@/lib/workspace/selection";

/**
 * Correlation detection for multi-leg analysis.
 *
 * Multiplying every leg's probability together assumes each outcome is
 * independent. Across different matches that is roughly defensible. Within one
 * match it is simply false: "Arsenal to win" and "Arsenal over 1.5 goals" move
 * together, and multiplying them understates the true joint probability —
 * making the combined number look worse than reality. "Over 2.5" plus "under
 * 3.5" also move together, and multiplying overstates the risk of both.
 *
 * Rather than guess a correlation coefficient we do not have, the workspace
 * says what it knows. Where no approved joint model exists, no precise
 * combined model probability is offered at all, and the interface says why.
 * A missing number the user understands is better than a confident wrong one.
 */
export type CorrelationKind =
  | "same-game"
  | "opposing-selections"
  | "mutually-exclusive"
  | "nested-market"
  | "related-totals"
  | "team-result-and-scoring"
  | "duplicate-fixture"
  | "competition-dependency";

export type CorrelationFinding = {
  kind: CorrelationKind;
  legIds: string[];
  severity: "blocking" | "warning" | "note";
  detail: string;
};

/**
 * How a combined model probability may be described.
 *
 * `combined-unavailable` is a first-class outcome, not a failure: it is the
 * correct answer whenever correlated legs have no approved joint model.
 */
export type CombinationBasis =
  | "independently-modelled"
  | "correlation-adjusted"
  | "correlation-unknown"
  | "combined-unavailable";

const TOTALS_MARKET = /^(over_under|home_team_over_under|away_team_over_under|total)/;
const RESULT_MARKET = /^(match_winner|double_chance|draw_no_bet)$/;
const SCORING_MARKET = /^(over_under|btts|clean_sheet|correct_score|home_team_over_under|away_team_over_under)/;

/** Line encoded in a market id, e.g. over_under_25 → 2.5. */
function marketLine(marketId: string): number | null {
  const match = /_(\d+)$/.exec(marketId);
  if (!match) return null;
  const digits = match[1]!;
  const value = digits.length >= 2 ? Number(`${digits.slice(0, -1)}.${digits.slice(-1)}`) : Number(digits);
  return Number.isFinite(value) ? value : null;
}

/**
 * Two selections on the same market that cannot both win.
 *
 * Handled explicitly because a slip containing both is not a long shot — it is
 * an impossibility, and presenting a small combined probability for it would
 * imply it could land.
 */
function areMutuallyExclusive(left: CanonicalSelection, right: CanonicalSelection): boolean {
  if (left.fixtureId !== right.fixtureId) return false;
  if (left.marketId !== right.marketId) return false;
  if (left.selectionId === right.selectionId) return false;
  // One market, one winning selection: any two distinct selections on the same
  // market of the same fixture are exclusive.
  return true;
}

function areOpposing(left: CanonicalSelection, right: CanonicalSelection): boolean {
  if (left.fixtureId !== right.fixtureId) return false;
  const leftTotals = TOTALS_MARKET.test(left.marketId);
  const rightTotals = TOTALS_MARKET.test(right.marketId);
  if (!leftTotals || !rightTotals) return false;
  const leftLine = marketLine(left.marketId);
  const rightLine = marketLine(right.marketId);
  if (leftLine === null || rightLine === null) return false;
  const leftSide = left.selectionId.startsWith("over") ? "over" : left.selectionId.startsWith("under") ? "under" : null;
  const rightSide = right.selectionId.startsWith("over") ? "over" : right.selectionId.startsWith("under") ? "under" : null;
  if (!leftSide || !rightSide || leftSide === rightSide) return false;
  // over 3.5 with under 2.5 cannot both land; over 2.5 with under 3.5 can.
  return leftSide === "over" ? leftLine >= rightLine : rightLine >= leftLine;
}

export function detectCorrelations(legs: AnalysedLeg[]): CorrelationFinding[] {
  const findings: CorrelationFinding[] = [];
  const selections = legs.map((leg) => leg.selection);

  for (let i = 0; i < selections.length; i += 1) {
    for (let j = i + 1; j < selections.length; j += 1) {
      const left = selections[i]!;
      const right = selections[j]!;
      const pair = [left.legId, right.legId];

      if (left.fixtureId !== right.fixtureId) {
        // The same event listed under two ids — cross-provider duplicates
        // exist in this catalogue, and a duplicated event multiplied with
        // itself is the same impossibility as a repeated leg.
        if (
          left.fixtureLabel &&
          left.fixtureLabel === right.fixtureLabel &&
          left.kickoffAt === right.kickoffAt
        ) {
          findings.push({
            kind: "duplicate-fixture",
            legIds: pair,
            severity: "blocking",
            detail: `${left.fixtureLabel} appears under two listings. These are the same event, not two independent ones.`
          });
          continue;
        }

        // Same competition, close kickoffs: results can share context —
        // standings incentives, rotation, weather at shared venues. There is
        // no number for this, so it is a note, not an adjustment.
        if (
          left.competition &&
          left.competition === right.competition &&
          Math.abs(Date.parse(left.kickoffAt) - Date.parse(right.kickoffAt)) <= 48 * 60 * 60_000
        ) {
          findings.push({
            kind: "competition-dependency",
            legIds: pair,
            severity: "note",
            detail: `${left.fixtureLabel} and ${right.fixtureLabel} are in the same competition round. Outcomes can share context (standings incentives, rotation), which independence does not capture.`
          });
        }
        continue;
      }

      if (areMutuallyExclusive(left, right)) {
        findings.push({
          kind: "mutually-exclusive",
          legIds: pair,
          severity: "blocking",
          detail: `${left.label} and ${right.label} are different outcomes of the same market — they cannot both win.`
        });
        continue;
      }

      if (left.marketId === right.marketId && left.selectionId === right.selectionId) {
        findings.push({
          kind: "duplicate-fixture",
          legIds: pair,
          severity: "blocking",
          detail: `${left.label} appears twice. A repeated leg does not multiply the return.`
        });
        continue;
      }

      if (areOpposing(left, right)) {
        findings.push({
          kind: "opposing-selections",
          legIds: pair,
          severity: "blocking",
          detail: `${left.label} and ${right.label} contradict each other — no result satisfies both.`
        });
        continue;
      }

      const bothTotals = TOTALS_MARKET.test(left.marketId) && TOTALS_MARKET.test(right.marketId);
      if (bothTotals) {
        findings.push({
          kind: "related-totals",
          legIds: pair,
          severity: "warning",
          detail: `${left.label} and ${right.label} are both goal-total markets on the same match; they move together, so they are not independent.`
        });
        continue;
      }

      const resultAndScoring =
        (RESULT_MARKET.test(left.marketId) && SCORING_MARKET.test(right.marketId)) ||
        (RESULT_MARKET.test(right.marketId) && SCORING_MARKET.test(left.marketId));
      if (resultAndScoring) {
        findings.push({
          kind: "team-result-and-scoring",
          legIds: pair,
          severity: "warning",
          detail: `${left.label} and ${right.label} depend on the same match unfolding a particular way, so they are strongly related.`
        });
        continue;
      }

      // Nested: double chance contains match_winner outcomes.
      if (left.marketId === "double_chance" || right.marketId === "double_chance") {
        findings.push({
          kind: "nested-market",
          legIds: pair,
          severity: "warning",
          detail: `${left.label} and ${right.label} overlap — one outcome is contained within the other.`
        });
        continue;
      }

      findings.push({
        kind: "same-game",
        legIds: pair,
        severity: "warning",
        detail: `${left.label} and ${right.label} are on the same match, so they are not independent events.`
      });
    }
  }

  return findings;
}

/** Correlated markets OddsPadi has an approved joint model for. */
const APPROVED_JOINT_MODELS: ReadonlySet<string> = new Set<string>([
  // The Dixon-Coles score matrix produces match_winner and goal totals from
  // one joint distribution, so those two are genuinely jointly modelled.
  "match_winner|over_under",
  "over_under|match_winner"
]);

export function hasApprovedJointModel(left: CanonicalSelection, right: CanonicalSelection): boolean {
  if (left.fixtureId !== right.fixtureId) return false;
  const key = `${left.marketId.replace(/_\d+$/, "")}|${right.marketId.replace(/_\d+$/, "")}`;
  return APPROVED_JOINT_MODELS.has(key);
}

export function resolveCombinationBasis(legs: AnalysedLeg[], findings: CorrelationFinding[]): CombinationBasis {
  if (findings.some((finding) => finding.severity === "blocking")) return "combined-unavailable";
  if (legs.some((leg) => !leg.usableForCombination)) return "combined-unavailable";

  const correlated = findings.filter((finding) => finding.severity === "warning");
  if (!correlated.length) return "independently-modelled";

  // Every correlated pair must be covered by an approved joint model before a
  // number is offered; one uncovered pair contaminates the whole combination.
  const byId = new Map(legs.map((leg) => [leg.selection.legId, leg.selection]));
  const allCovered = correlated.every((finding) => {
    const [leftId, rightId] = finding.legIds;
    const left = leftId ? byId.get(leftId) : undefined;
    const right = rightId ? byId.get(rightId) : undefined;
    return left && right ? hasApprovedJointModel(left, right) : false;
  });
  return allCovered ? "correlation-adjusted" : "correlation-unknown";
}

export const COMBINATION_BASIS_COPY: Record<CombinationBasis, string> = {
  "independently-modelled":
    "These legs are on different matches, so the combined model probability multiplies them as independent events.",
  "correlation-adjusted":
    "These legs are related, and OddsPadi models them jointly, so the combined probability accounts for that relationship.",
  "correlation-unknown":
    "These legs are related but OddsPadi has no approved joint model for them. A combined probability is not shown, because multiplying them as independent events would be misleading.",
  "combined-unavailable":
    "A combined model probability is not available for this workspace. Check the leg notes for what is missing or contradictory."
};
