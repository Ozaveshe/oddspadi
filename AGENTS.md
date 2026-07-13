# OddsPadi workspace instructions

- For every live Supabase operation in this repository, use the repo-local or global `supabase_oddspadi` MCP server.
- The only valid Supabase project ref for OddsPadi is `wncwtzqipnoqwmqlznqn`.
- Before any live SQL, migration, schema, logs, or generated-types operation, verify that `get_project_url` returns `https://wncwtzqipnoqwmqlznqn.supabase.co`.
- Never use the generic `supabase`, `supabase_afrotools`, `supabase_latmtools`, or `supabase_salarypadi` connector for OddsPadi.
- If the active task exposes only a generic or mismatched Supabase connector, do not mutate the database. Reload the task so the named connector is discovered first.

## Worktree and release discipline

- Read `docs/RELEASE.md` before commit, push, deploy, or worktree-integration work.
- Start broad change or release tasks with `npm run release:status`. Worktrees are isolated checkouts; they never pull, merge, or publish themselves.
- Run `npm run worktrees:sync` only when the registered worktrees are clean. The command may fast-forward clean branches with no unique commits and refresh clean detached snapshots; it must not overwrite dirty or diverged worktrees.
- Do not build new work on a detached HEAD. Create a named `codex/<slug>` branch first, commit the complete task there, then merge or fast-forward that exact commit into `main`.
- Never deploy an uncommitted, dirty, detached, unpushed, or origin-diverged checkout. Production is released only from clean `main` when `HEAD` exactly equals `origin/main`.
- A requested fix is not complete while its intended files remain only in a working tree. Commit and integrate the task when the user authorized shipping; otherwise report the uncommitted handoff explicitly.
- Keep Git commit/push proof, local quality proof, Netlify deploy proof, live-route proof, and scheduled-function proof separate in the closeout.
- Use `npm run deploy:production` for production. It runs the full release gate before invoking the pinned OddsPadi Netlify site.

## Product operations (automations)

- The operator playbook lives at `docs/automations.md`: scheduled Netlify functions, required env, seed personas, and the daily agent routine.
- Fast aliases: `npm run ops:health` (production canary, exit 1 on failure), `npm run ops:warm` (post-deploy cache priming), `npm run ops:editorial` (force a News regeneration; needs `ODDSPADI_ADMIN_TOKEN`), `npm run ops:seed-feed` (fresh persona posts; needs `SUPABASE_URL` + `SUPABASE_SECRET_KEY`).
- PostgREST gotcha: embeds from `op_feed_posts`/`op_forum_threads` (and `op_feed_comments`) to `op_profiles` must name the FK (e.g. `op_profiles!op_feed_posts_author_id_fkey`) — the likes/replies tables double as many-to-many junctions, so bare embeds fail as ambiguous.
- The public prediction APIs accept `view=summary`; prefer it unless the decision dossier is genuinely needed (full payloads are megabytes on busy days).
