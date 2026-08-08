# Correlation policy

Why the workspace refuses to multiply some probabilities, and what it says
instead.

## The rule

Multiplying leg probabilities asserts independence. Within one match that
assertion is false, and the error compounds silently: "Arsenal to win" ×
"Arsenal over 1.5 goals" understates the true joint chance, "over 2.5" ×
"under 3.5" overstates the risk. **No combined model probability is shown
for correlated legs unless OddsPadi has a validated joint method for exactly
that pair.** A missing number the user understands beats a confident wrong
one.

## What is detected

Implemented in `src/lib/workspace/correlation.ts`, pairwise across the slip:

| Finding | Severity | Meaning |
|---|---|---|
| `mutually-exclusive` | blocking | Two outcomes of one market — cannot both win |
| `opposing-selections` | blocking | Contradictory totals (over 3.5 with under 2.5) |
| `duplicate-fixture` | blocking | The same leg twice, or the same event under two listings (same label + kickoff, different ids — cross-provider duplicates are real in this catalogue) |
| `related-totals` | warning | Two totals markets on one match |
| `team-result-and-scoring` | warning | Result market + scoring market on one match |
| `nested-market` | warning | One outcome contains the other (double chance ⊃ match winner) |
| `same-game` | warning | Any other same-match pair |
| `competition-dependency` | note | Different fixtures, same competition, kickoffs within 48h — shared context (standings incentives, rotation) that independence does not capture |

Blocking findings also mark the slip as containing an impossible
combination, and every combined number is withheld — a small probability for
a contradiction would imply it could land.

## The four combination states

| State | When | What is shown |
|---|---|---|
| `independently-modelled` | No warnings or blocks | Product of leg probabilities, as a range |
| `correlation-adjusted` | Every correlated pair covered by an approved joint model | Joint figure with a widened band |
| `correlation-unknown` | Correlated, no approved joint model | **No combined model number**, with the reason |
| `combined-unavailable` | A blocking finding, or a leg unusable for combination | No number; leg notes say what is missing |

Notes (severity `note`) inform without changing the state — there is no
defensible adjustment factor for "same competition round", so the workspace
says it and stops.

## Approved joint methods

Exactly one today: match winner × goal totals on the same football match,
because the Dixon–Coles score matrix produces both from one joint
distribution. The list is a code constant (`APPROVED_JOINT_MODELS`), extended
only when a validated joint method actually exists — never by wishing.

## The de-vigged market chance

The accumulator shows a market-based combined chance (product of per-leg
de-vigged probabilities) beside the naive implied one. Removing the margin
does not remove the independence assumption, so this figure obeys the same
blocking rule and is read alongside the combination basis.
