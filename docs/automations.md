# OddsPadi automations — operator playbook

Everything that keeps the product alive without a human, plus the scripts an
agent (Codex, Claude, or a cron box) can run. Production = https://oddspadi.com,
Netlify site `oddspadi` (`3ba4bf38-60ec-4bc4-b49f-aca9495a9aa2`), Supabase
project `wncwtzqipnoqwmqlznqn`.

## Scheduled Netlify functions

| Function | Schedule (UTC) | What it does |
| --- | --- | --- |
| `decision-cycle-sweep` | `5,35 * * * *` | Football decision/prediction capture |
| `multi-sport-decision-cycle-sweep` | `20 */2 * * *` | Runs the built basketball/tennis odds-refresh and daily-engine routes; fails when either sport is degraded |
| `sports-intelligence-sweep` | `25,55 * * * *` | Refreshes bookmaker odds and rebuilds canonical decisions for today, tomorrow, and day+2 inside the 45-minute basketball freshness boundary; fixture import and the seven-day slate remain receipt-guarded to one full cycle per day |
| `sports-identity-enrichment-sweep` | `10 3 * * *` | Resolves the complete stored 400-day fixture horizon, including API-Football provider aliases, team crests, league artwork/flags, national-team countries, and domestic odds-only countries; then records a serialized receipt |
| `football-settlement-sweep` | `*/30 * * * *` | Grades finished football picks |
| `football-corpus-refresh-sweep` | `40 3 * * *` | Runs two independent EPL corpus lanes: refreshes the previous two complete UTC days with events/lineups/player statistics, then rotates through one bounded seven-day window of the most recently completed season to bootstrap historical player performances |
| `model-learning-sweep` | `45 4 * * *` | Claims the global sports-pipeline lock, stores per-sport calibration daily, re-evaluates the earliest ready freeze for each distinct candidate identity against the active champion as fresh paired evidence matures, bootstraps missing or stale exact runtime-entrypoint evidence, and refreshes every sport each Monday without auto-promotion |
| `multi-sport-settlement-sweep` | `50 * * * *` | Grades other sports |
| `results-settlement-sweep` | `15 * * * *` | Settles the canonical public-pick ledger and records explicit pending/manual-review reasons |
| `editorial-generation-sweep` | `35 5,11,17,23 * * *` | Regenerates News stories from ledger rows (OpenAI prose pass when `OPENAI_API_KEY` is set; deterministic fallback otherwise) |
| `push-notification-sweep` | `*/10 * * * *` | Web-push delivery |
| `weekly-results-recap` | `15 6 * * 1` | Weekly recap rows |

All sweeps need `ODDSPADI_SITE_URL` + `ODDSPADI_ADMIN_TOKEN` in Netlify env or
they 503; the workers additionally need `SUPABASE_URL` + `SUPABASE_SECRET_KEY`
(or `SUPABASE_SERVICE_ROLE_KEY`). The editorial worker also reads
`OPENAI_API_KEY` and optional `OPENAI_EDITORIAL_MODEL` (default `gpt-5-mini`).

The sports-intelligence worker records provider fixtures, fresh bookmaker-priced
fixtures, and canonical analysed fixtures separately for each of its three UTC
dates. `ODDSPADI_MIN_ANALYSED_FIXTURES_PER_DAY` defaults to `100`; missing the
target is an explicit failed readiness stage, never a reason to create mock
fixtures or relax the public positive-EV publication gate.

The football corpus worker uses `ODDSPADI_FOOTBALL_CORPUS_LEAGUE_ID` (default
EPL `39`), `ODDSPADI_FOOTBALL_CORPUS_FIXTURE_LIMIT` (default `12`), and
`ODDSPADI_FOOTBALL_PLAYER_HISTORY_FIXTURE_LIMIT` (default `20`, maximum `24`).
Its response reports the recent and historical lanes separately. HTTP `207`
means one lane completed while the other failed; treat that as degraded and
inspect both receipts rather than marking the corpus healthy.
HTTP `200` from an inner backfill route is not sufficient on its own: the
worker accepts `stored` only when census readback is evidence-ready, and accepts
`no-data` only for a genuinely quiet provider window. A finished fixture's
player-stat payload must cover at least 11 participants with minutes for each
team; incomplete payloads fail the lane and are not stored as player history.

### Basketball odds-history checkpoints

`POST /api/sports/decision/training/basketball-odds-backfill` restores the
operator path for attaching historical NBA moneylines to the existing finished
fixture corpus. It is plan-only by default (`run=0`): completed receipt dates are
skipped, the next unfinished date is returned as `nextCursor`, and no provider
request is made. Execution requires `run=1`; `dryRun=1` still calls the paid
provider but does not write rows. Keep `regions=us`, `maxJobs=7`, and
`maxCredits=70` for a normal checkpoint. The historical h2h endpoint costs an
estimated 10 credits per region per date, and the route refuses to exceed the
explicit credit ceiling. Storage receipts report provider quota headers plus
`fixtures_found`, `odds_found`, and `rows_written` separately.

The identity worker uses the same server-only API-Football key as the fixture
pipeline. It batches by league and season (maximum eight competitions), keeps
continental competitions labelled `World`, and resolves each club's actual
country from the provider team directory. Domestic The Odds API fallback
fixtures receive a country from their competition key. Public cards render a
deterministic flag from that stored country and a branded initials crest when
the provider has no artwork.

## Scripts (run from the repo root)

| Script | Purpose | Needs |
| --- | --- | --- |
| `node scripts/site-health.mjs` | Read-only production sweep: page latency + size budgets, `/api/health`, per-sport prediction APIs, community feed non-empty. It also fails when live provider or private Supabase server configuration is incomplete. Exit 1 on any failure — use as the canary after every deploy. | optional `ODDSPADI_ADMIN_TOKEN` for the provider section |
| `node scripts/warm-caches.mjs` | Hits the heavy pages/APIs once so the durable caches are primed and the first visitor is fast. Run right after a deploy. | nothing |
| `node scripts/run-editorial-sweep.mjs` | Forces a News regeneration now (same worker the schedule calls). Use when the ledger changed and you don't want to wait for the next edition. | `ODDSPADI_ADMIN_TOKEN` |
| `node scripts/seed-community-posts.mjs` | Posts one fresh feed item per seed persona (skips anyone who posted in the last 20h). Keeps the padi feed alive on quiet days. | `SUPABASE_URL` + `SUPABASE_SECRET_KEY` |
| `node scripts/oddspadi-doctor.cjs` | Pre-existing local env/readiness doctor. | local `.env.local` |
| `npm run results:backfill` | Read-only summary of stale public picks and legacy internal duplicates. Add `-- --run` to tag legacy runs and attempt provider settlement. | local site URL; `ODDSPADI_ADMIN_TOKEN` for `--run` |

## Seed personas (one-off, already applied 2026-07-13)

Eight accounts exist in Supabase auth + `op_profiles`:
`oddspadi_desk` (admin), `kunle_lagos`, `ama_kotoko`, `tunde_united`,
`zainab_hoops`, `chidi_naija`, `mariam_casa`, `sipho_amakhosi` — all on
`@community.oddspadi.com` emails with random unrecoverable passwords. 18
backdated posts + likes seeded the feed. `seed-community-posts.mjs` reuses the
same personas; if they're ever missing it exits with instructions instead of
creating accounts.

## Suggested agent routine (daily)

1. `node scripts/site-health.mjs` — stop and investigate on exit 1.
2. `node scripts/seed-community-posts.mjs` — keep the feed moving.
3. If the ledger gained settled rows today: `node scripts/run-editorial-sweep.mjs`.
4. After any deploy: `node scripts/warm-caches.mjs`, then re-run the health sweep.

## Gotchas for agents

- Never commit real keys; `.env.local` stays untracked. The service-role key
  must never reach client code or `NEXT_PUBLIC_*` vars.
- `npm run build` while the dev server runs corrupts `.next` — restart dev after builds.
- PostgREST embeds between `op_feed_posts`/`op_forum_threads` and `op_profiles`
  must name their FK (e.g. `op_profiles!op_feed_posts_author_id_fkey`) because
  the likes/replies tables double as many-to-many junctions.
- The public prediction APIs accept `view=summary` — always prefer it unless
  you specifically need the decision dossier (full payload is megabytes).
