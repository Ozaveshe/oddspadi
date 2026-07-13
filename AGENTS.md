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
