# Football engine — corpus validation receipts

Generated 2026-07-30 by `npm run training:football-corpus` (walk-forward, no
leakage: every prediction is made before that match updates any parameter, the
first season is burn-in, and evaluation covers the remaining seasons only).

Corpus: `football_matches_multileague_3_seasons.csv` — 37,266 finished matches,
30,855 evaluated after burn-in and an 8-match-per-team warm-up floor. Market
probabilities are derived through the production `buildScoreMatrix` +
`applyDixonColesAdjustment` code, imported rather than reimplemented, so these
numbers describe the product's matrix, not a lookalike.

## Per-market calibration (held out, goal-level correction applied)

| market | predicted | actual | Brier skill | ECE |
|---|---|---|---|---|
| 1X2 home | 0.433 | 0.436 | **+0.0794** | 0.0100 |
| 1X2 draw | 0.255 | 0.264 | +0.0050 | 0.0130 |
| 1X2 away | 0.313 | 0.300 | **+0.0724** | 0.0141 |
| over 0.5 | 0.920 | 0.928 | −0.0018 | 0.0109 |
| over 1.5 | 0.743 | 0.754 | +0.0016 | 0.0352 |
| over 2.5 | 0.502 | 0.517 | +0.0024 | 0.0512 ⚠ |
| over 3.5 | 0.294 | 0.292 | +0.0016 | 0.0469 |
| over 4.5 | 0.151 | 0.142 | −0.0016 | 0.0267 |
| BTTS yes | 0.517 | 0.539 | −0.0049 | 0.0445 ⚠ |
| home goals over 1.5 | 0.431 | 0.438 | **+0.0444** | 0.0317 |
| away goals over 1.5 | 0.338 | 0.342 | **+0.0397** | 0.0282 |
| home clean sheet | 0.317 | 0.306 | +0.0265 | 0.0248 |

1X2 vs the corpus's no-vig **closing** prices (n=30,855): model multi-Brier
0.6144 against the market's 0.5984 — the model trails the closing market by
0.016, which is the expected position for a results-only model and close enough
that the market anchor has real signal to blend with. Top-scoreline hit rate
12.6%.

## What was found and fixed

The uncorrected fit under-predicted **every** over line and BTTS by 2–3 points
in the same direction — a level bias in expected goals. A single goal-level
scale (1.0189, fitted on burn-in only) removes about half of it.

## What remains, and deliberately was not tuned away

After the level fix, over 1.5/2.5 and BTTS stay ~1.5–2.2 points cold while
over 3.5/4.5 sit correct-to-slightly-hot. That pattern is not a level problem:
independent Poisson (even with the Dixon-Coles low-score correction) carries
too little mid-total and both-teams-score mass relative to real matches, whose
goal counts are positively dependent beyond the low-score cells. The honest fix
is a bivariate/overdispersed upgrade to the matrix, not a fudge factor —
parked as the next model-quality lever.

The runtime model shares the same matrix math, so the same shape caveat applies
to its goals markets. Its own lines now settle (team totals, clean sheets,
correct scores, O/U ladder), so the runtime's bias becomes directly measurable
from `ops:calibration-report` as evidence accrues — runtime corrections should
come from that, not from corpus transfer.

## Levers, in order

1. Bivariate/overdispersed score distribution (fixes the mid-total/BTTS shape).
2. v3 corpus scale-up (120k matches) once the fit is worth the extra history.
3. Per-team strengths as a runtime rating source (needs the person/club name
   aligner between football-data and provider spellings).
