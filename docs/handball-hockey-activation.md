# Handball and ice hockey — foundation and activation checklist

Shipped 2026-07-30 as capability, deliberately not yet activated. The v4
training standard set explicit gates for both sports and neither is met, so
the catalogue keeps them `active: false` and the decision-model registry does
not include them. What exists today:

- **Provider adapters** — `api-handball` / `api-hockey` (API-Sports scoreboard
  shape) with fixtures, live statuses and final scores, behind a six-hour
  per-day cache because both keys run free plans capped at **100 requests/day
  and 10/minute**. Even fully active, page traffic costs at most four upstream
  reads per sport per day.
- **Models** — `handball-poisson-v1` (true three-way; the draw is real) and
  `ice-hockey-poisson-v1` (two-way; overtime forbids drawn finals, regulation
  draw mass is reallocated like draw-no-bet). Totals lines 50.5/54.5/58.5 and
  5.5/6.5 respectively, all read from one score matrix, all settle-able by the
  existing grader.
- **Settlement** — `match_winner` and the `over_under_<line>` family already
  grade from final scores with no code change.

## To activate (in order)

1. Fund or upgrade the API-Sports plans if fixture pages will be public
   (free-tier quota is the binding constraint, not code).
2. Flip `active: true` in `src/lib/sports/service.ts` — this opens API
   validation and the sport picker.
3. Add the sports to `ODDSPADI_PIPELINE_SPORTS` when decisions should start
   being recorded (they will be watchlist-only: no odds are attached yet, so
   the market anchor cannot apply and nothing can publish).
4. Odds attachment: The Odds API `icehockey_nhl` / handball keys, plus closing
   snapshots — required by the v4 gate before any value calibration.
5. Register in the decision-model registry (`modelIdentity.ts`) only once the
   v4 evidence gates are met: handball ≥ 1,000 finished matches collected
   (10,365 already exist in the v4 corpus for backtesting), NHL with closing
   odds coverage.

The v4 corpus (`standard-v4`) already contains the global league registry,
10,365 handball results, 33,647 hockey results and NHL play-by-play for
feature work — the offline evidence can be built before live activation.
