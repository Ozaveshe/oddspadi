# OddsPadi release workflow

This repository treats `main` as the production source of truth. A Codex worktree is an isolated checkout, not a queue that automatically feeds `main`.

## Start a task

1. Run `npm run release:status` to fetch `origin/main` and inventory every registered worktree.
2. If all worktrees are clean, run `npm run worktrees:sync` to fast-forward safe branches and refresh safe detached snapshots.
3. If the active worktree is detached, create a named branch before editing:

   ```powershell
   git switch -c codex/<task-slug>
   ```

Never reset, clean, or rebase a dirty worktree just to make the inventory green. Preserve it and resolve ownership first.

## Finish work prepared in a worktree

1. Run the relevant targeted tests, then the full local proof stack:

   ```powershell
   npm run build
   npm run typecheck
   npm test
   git diff --check
   ```

2. Stage only the intended task, run `git diff --cached --check`, and commit it on the named branch.
3. Push the branch or integrate it into the canonical `main` checkout with an explicit fast-forward or reviewed merge.
4. Pull `main` with `git pull --ff-only`, then confirm `git rev-list --left-right --count HEAD...origin/main` returns `0 0`.

Detached commits, dirty worktrees, and local-only branches are handoffs, not completed releases.

## Production release

Production release is intentionally strict:

```powershell
npm run deploy:production
```

The command builds, type-checks, tests, verifies the locked Netlify/Supabase/Git identity, fetches `origin/main`, rejects dirty files, and requires local `HEAD` to equal `origin/main` before deploying to the pinned `oddspadi` Netlify site.

After Netlify finishes, verify the deploy URL and smoke at least:

- `/`
- `/predictions`
- `/live-scores`
- `/news`
- `/sitemap.xml`
- `/api/health`

Scheduled-function health is separate evidence. Check each function relevant to the release instead of inferring worker health from a successful web deploy.

## Supabase migrations

Use only `supabase_oddspadi` and verify `https://wncwtzqipnoqwmqlznqn.supabase.co` before live work. After applying a migration, compare the remote migration version with `supabase/migrations` and keep the local filename aligned with the remote history. Verify the changed schema and rerun Supabase advisors before committing.
