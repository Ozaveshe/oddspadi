# Engine v1.3 — build plan

Written 2026-07-29 at the end of the v1.2 session. Everything here is measured,
not assumed. Execute in order; each step is verifiable before the next.

## Where v1.2 left the engine

| fact | value | source |
|---|---|---|
| football Brier skill vs base rate | **+0.0055** | 2,292 settled outcomes |
| football ECE | **0.0759** (inside the 0.10 gate) | same |
| worst calibration buckets | predicts 45% → actual 31%; predicts 64% → actual 46% | same |
| tennis gradeable decisions | **0** of ~188k | finished tennis fixtures store no score |
| closing-line coverage | 0.667 against a 0.80 gate | promotion readiness |
| published value picks | 0 | market anchor holds unproven models at 80% market weight |

The model is marginally better than guessing and systematically overconfident
where it matters. It is not broken; it is under-evidenced. v1.3 is about
evidence, not about loosening gates.

## The corpus

`C:\Users\Oza\Documents\Codex\2026-07-29\tennis-results-with-scores-unblocks-188k-2\outputs\oddspadi-expanded-training-data-standard-v2.zip`

- `datasets/tennis_matches_with_scores_2024_to_2026.csv` — 13,642 matches,
  13,216 with `gradeable_match_winner = true`
- `datasets/tennis_match_odds_2024_to_2026.csv` — 102,069 quotes
- `datasets/football_matches_multileague_3_seasons.csv` — 37,266 matches
- `datasets/football_odds_multileague_3_seasons.csv` — 678,475 quotes,
  Market Average closing coverage 99.78%
- `datasets/source_manifest.csv` — keep this; licensing depends on attribution

### Leakage trap, verified

`winner_side` is `player_1` on **all 13,642** tennis rows — the file is
canonicalised so the winner is listed first, and 0 gradeable rows contradict it.
A model reading player_1/player_2 positionally learns "player_1 wins" and scores
~100% on nothing.

**De-canonicalise before any training or calibration use**: randomise side order
per row using a seed derived from `match_id` (so it is deterministic and
reproducible), or key features to a stable player identifier rather than
position. Check the football files for the same pattern before trusting them.

## Step 1 — load tennis results and make them gradeable

The blocker is that `op_fixtures` rows for tennis finish with `home_score` /
`away_score` null, so `gradeMarketDecision` correctly refuses them.

1. Parse `tennis_matches_with_scores_2024_to_2026.csv`, keeping only
   `gradeable_match_winner = true`.
2. Match to `op_fixtures` where `sport = 'tennis'`. Names will not join exactly:
   the corpus uses `Popyrin A.` style, the provider uses its own form. There is
   an existing team-name aligner in the codebase — reuse it rather than writing a
   third matcher. Match on (normalised player pair, match date ± 1 day).
3. Write `home_score` / `away_score` as **set counts** (`player_1_sets`,
   `player_2_sets`), respecting which side each player occupies on the fixture.
4. **Report the match rate before writing.** If it is below ~70%, the aligner
   needs work — do not paper over it by loosening the date window.

Verify: `select count(*) from op_fixtures where sport='tennis' and status='finished' and home_score is not null`.

## Step 2 — settle tennis

`npm run ops:settle -- --commit` already grades `match_winner` / `moneyline`
from a final score, and tennis decisions are all `match_winner`. Once step 1
lands, the existing grader handles them with no code change.

Verify: settlement status counts by sport should show tennis `won`/`lost` rows
for the first time.

## Step 3 — measure before changing the model

`npm run ops:calibration-report` gives per-sport reliability buckets, ECE, Brier
score and Brier skill. Run it for both sports.

**Do not touch the model before reading this.** The whole point of v1.2 was that
the previously quoted −0.368 Brier skill was noise from an 18-sample candidate;
the real figure on 2,292 outcomes was +0.0055. Tennis has never been measured at
all. Find out what it is first.

## Step 4 — fix the overconfidence

Football's failure is specific and correctable: it overstates the 40-50% and
60-70% bands. Options in order of preference:

1. **Recalibrate** — fit an isotonic or Platt correction on the settled corpus
   and apply it in `applyLearnedProbabilityCalibration`, which already exists in
   the runtime pipeline. This is the cheapest real gain.
2. Revisit model features only if calibration alone does not close the gap.

Recalibration must be fit on a **time-based split** — train on earlier matches,
validate on later ones. Random splits leak across a season.

## Step 5 — earn a promotion

With the corpus loaded, the promotion gates become reachable:

- ≥30 settled outcomes: already far exceeded
- positive Brier skill: verify post-recalibration
- ECE ≤ 0.10: football is at 0.0759
- closing-line coverage ≥ 0.80: the corpus supplies 99.78%

Then `npm run ops:calibration -- --sport football` lists candidates and refuses
any reporting `canInfluenceLive: false`. Promote only a candidate that passes on
its own metrics — the script exists to stop a repeat of the earlier
"promote it anyway" temptation.

Once a profile is promoted, `buildModelSkillAnchor` moves the sport from
`unproven` (0.80 market floor) toward `proven` (0.25), and the empirical value
floor becomes available — which is what finally lets real picks publish.

## What must not happen

- Do not lower `minimumConsensusBookmakers`, the uncalibrated bars, or the
  plausibility ceiling to make picks appear. Every one of those exists because
  the model produced a 57.4% edge on tennis while being unable to check itself.
- Do not train on canonicalised tennis sides (see the leakage trap).
- Do not use closing odds as a pre-kickoff feature for the prediction being
  judged. The corpus README states this and it is correct.
- Do not treat public-corpus readiness as authorisation to publish picks.

## Also open, unrelated to the engine

- `v13/homepage-read` holds `d4dfdad` (counts-only homepage read, 15ms vs ~14s).
  Committed, unreleased, not browser-verified.
- #26 design pass has not started.
- Two branches hold unmerged work: `codex/mvp-completion-audit-20260717`
  (unlanded 571-line migration) and `codex/premium-product-design`.
