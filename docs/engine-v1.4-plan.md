# Engine v1.4 — measured baseline and next levers

Written 2026-07-30 at the close of the v1.3→v1.4 arc. Everything here is
measured, not assumed. v1.3 was about making the engine able to see itself;
v1.4 made the product show what the engine knows and validated the football
engine on history. The next points come from evidence accruing and one model
upgrade — not from more plumbing.

## Where v1.4 leaves the engine

| fact | value | source |
|---|---|---|
| football Brier skill (unique predictions) | **+0.1431**, 95% CI [+0.0585, +0.2252] | 313 settled predictions, 103 matches |
| football ECE | **0.0339** | same |
| corpus walk-forward 1X2 skill | home **+0.0794** / away **+0.0724**, ECE ≈ 0.011 | 30,855 held-out matches |
| corpus 1X2 vs closing market | trails by only **0.016** multi-Brier | same |
| tennis corr(model, market) | 0.078 → **0.92** live | anchoring fix, first post-deploy sweeps |
| tennis skill | −0.074, **CI spans zero** — unmeasurable either way | 146 unique predictions |
| markets per football fixture | **14**, one matrix, all settle-able | PR #10 |
| displayed-tip record (old rule) | 25.4% hit, −8.49u on 114 fixtures | pre-kickoff summaries |
| displayed-tip rule (new, backtested) | **54.4% hit, +9.08u** on the same fixtures | model-favorite counterfactual |
| promotion gates passing (football) | **6 of 7** | op_prediction_outcomes |
| closing-line coverage (the last gate) | ~0.27 → accruing | capped by capture history |
| published picks | 0 — by design until the gate clears | promotion governor |

Sports wired: football, tennis, basketball live; handball + ice hockey have
adapters, models and settlement but stay `active: false`
(docs/handball-hockey-activation.md is the ordered checklist; free API plans
at 100 requests/day are the binding constraint).

## Lessons v1.4 paid for (do not relearn these)

1. **Rows are not observations.** Decisions duplicate ~7× (football) to ~70×
   (tennis) per (fixture, market, selection). Any n quoted from row counts is
   inflated; the calibration report deduplicates and says so.
2. **Argmax(model − market) is argmax(model error).** Any selection rule that
   maximises claimed edge from an unpromoted model surfaces longshots and
   loses. This failed twice: first as EV-ranked tips, then again after the
   first fix, because the watchlist *tier* itself is positive-edge-filtered and
   the model's favorite (negative edge) never entered it. The display candidate
   now ranks by model probability across all non-publishable statuses.
3. **A deploy is not a behavior change.** The first tip fix passed its tests
   and deployed clean; production summaries showed displayed-tip probability
   unchanged (0.303 → 0.280). Verify effects in production data, not in test
   output. The provenance columns exist precisely for this.
4. **Corrections must come from a system's own evidence.** The corpus found
   goal lines 2–3pts cold; half was level (fixed by a burn-in-fitted 1.0189
   scale), the rest is Poisson shape. The runtime's lines settle on their own
   now — correct the runtime from its own receipts, never by corpus transfer.

## Step 1 — let the evidence accrue (no code)

Days, not work. Watch weekly:

- `npm run ops:calibration-report` — per-market skill with CIs; anchored vs
  unanchored split as provenance-carrying decisions settle.
- Closing-line coverage toward 0.80 (`npm run ops:closing-lines` after
  matchdays; imminent-first pricing is live, so coverage compounds).
- The new displayed-tip rule's **live** record vs its +9.08u backtest.

When coverage clears 0.80: regenerate a candidate, `npm run ops:calibration --
--sport football`, promote only on its own `canInfluenceLive: true`. Promotion
moves football from the 0.80 market floor toward 0.25 and opens publication.
Never `--force`.

## Step 2 — bivariate score matrix (the one model upgrade that is earned)

The corpus receipt (docs/football-corpus-validation.md): after level
correction, over 1.5/2.5 and BTTS remain 1.5–2.2pts cold while 3.5/4.5 are
correct — independent Poisson carries too little mid-total/BTTS mass. Fix the
shape, not the level: a bivariate Poisson (shared component) or
Frank/Gaussian-copula coupling on the existing matrix, fitted on the corpus
with the same walk-forward harness, shipped only if held-out ECE improves on
the totals family without degrading 1X2. The 14-market board and the corpus
harness both read the same matrix code, so one upgrade fixes product and
backtest together.

## Step 3 — tennis needs a signal, not a fix

Anchored tennis is honest but market-following. The v2/v3 corpus holds 66k
tennis matches with results and odds; build the same walk-forward harness
(surface-aware Elo) and wire fitted strengths into `historicalTennisStrength`.
Until then tennis publishes nothing, correctly.

## Step 4 — handball and NHL offline first

The v4 corpus already holds 10,365 handball and 33,647 hockey results. Run
both through the corpus harness pattern *before* live activation — the
evidence gates (≥1,000 finished matches, closing-odds coverage) can be largely
earned offline at zero API quota. Activation checklist:
docs/handball-hockey-activation.md.

## Step 5 — scale the corpus

v3 (2.73M decision-relevant rows; note: 17.1M of its 19.8M total is NBA
play-by-play flagged internal-research-only and unusable pre-match) and v4
(five-sport registry, live closing snapshots) feed the same harnesses. Scale
when a model change needs the power, not before.

## What must not happen

- Do not publish from any sport whose skill CI spans zero (tennis today).
- Do not lower `minimumConsensusBookmakers`, the uncalibrated bars, the
  plausibility ceiling, or the seven promotion gates. Coverage clears by
  capture, not by threshold surgery.
- Do not quote the +9.08u tip backtest as a track record; the live record
  starts 2026-07-30.
- Do not activate handball/ice hockey publicly on free API plans without the
  6h-cache math in front of you (100 requests/day is the ceiling).
- Do not let corpus findings edit runtime constants directly; the runtime's
  own settled lines are the only authority for runtime corrections.
