# OddsPadi automations — operator playbook

Everything that keeps the product alive without a human, plus the scripts an
agent (Codex, Claude, or a cron box) can run. Production = https://oddspadi.com,
Netlify site `oddspadi` (`3ba4bf38-60ec-4bc4-b49f-aca9495a9aa2`), Supabase
project `wncwtzqipnoqwmqlznqn`.

## Scheduled Netlify functions

| Function | Schedule (UTC) | What it does |
| --- | --- | --- |
| `decision-cycle-sweep` | `5,35 * * * *` | Football decision/prediction capture |
| `multi-sport-decision-cycle-sweep` | `20 */2 * * *` | Basketball/tennis capture |
| `sports-intelligence-sweep` | `25 */2 * * *` | Refreshes the canonical multi-sport intelligence pipeline and daily/weekly public slates |
| `football-settlement-sweep` | `*/30 * * * *` | Grades finished football picks |
| `football-corpus-refresh-sweep` | `40 3 * * *` | Idempotently stores the previous two complete UTC days of EPL fixtures, events, lineups, and finished-match player statistics |
| `multi-sport-settlement-sweep` | `50 * * * *` | Grades other sports |
| `results-settlement-sweep` | `15 * * * *` | Settles the canonical public-pick ledger and records explicit pending/manual-review reasons |
| `editorial-generation-sweep` | `35 5,11,17,23 * * *` | Regenerates News stories from ledger rows (OpenAI prose pass when `OPENAI_API_KEY` is set; deterministic fallback otherwise) |
| `push-notification-sweep` | `*/10 * * * *` | Web-push delivery |
| `weekly-results-recap` | `15 6 * * 1` | Weekly recap rows |

All sweeps need `ODDSPADI_SITE_URL` + `ODDSPADI_ADMIN_TOKEN` in Netlify env or
they 503; the workers additionally need `SUPABASE_URL` + `SUPABASE_SECRET_KEY`
(or `SUPABASE_SERVICE_ROLE_KEY`). The editorial worker also reads
`OPENAI_API_KEY` and optional `OPENAI_EDITORIAL_MODEL` (default `gpt-5-mini`).

## Scripts (run from the repo root)

| Script | Purpose | Needs |
| --- | --- | --- |
| `node scripts/site-health.mjs` | Read-only production sweep: page latency + size budgets, `/api/health`, per-sport prediction APIs, community feed non-empty. Exit 1 on any failure — use as the canary after every deploy. | optional `ODDSPADI_ADMIN_TOKEN` for the provider section |
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
