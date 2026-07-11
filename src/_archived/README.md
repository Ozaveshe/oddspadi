# Archived: operator decision-engine console

This directory holds code that was **removed from the Next.js build** on 2026-07-11
to shrink the production route/build surface. It is **not deleted** — it stays in
git history and can be restored at any time.

## What's here

- **`api-sports-decision/`** — the ~345 internal `/api/sports/decision/**` route
  handlers (the AI "cognition" endpoints: metacognition, belief-revision,
  counterfactual-lab, ai-council, shadow loops, mvp-ai-*, training, etc.).
- **`decision-engine-ops/`** — the 27k-line operator dashboard page that was served
  at `/predictions/decision-engine/ops` (reached only via `?ops=1`/`?full=1`/`?deep=1`).

## Why it was archived

An audit found that of ~285 `decision*` modules only ~9 feed what users actually
see (`/predictions`, `/value-picks`, `/live-scores`, `/history`). The rest existed
solely to populate this internal console. Archiving them cut the built route count
from 352 to 7 without changing any user-facing behaviour. The genuine live engine
(`decisionEngine.ts`, the sport models, `odds.ts`, the training dossier) remains in
`src/lib/sports/`.

## Notes

- It stays under `src/` so the `@/*` → `src/*` alias keeps resolving; the internal
  imports were retargeted from `@/app/api/sports/decision/*` to
  `@/_archived/api-sports-decision/*`.
- It is **not** under `src/app`, so Next never builds these as routes/pages.
- The decision *library* modules (`src/lib/sports/prediction/decision*.ts`) were left
  in place; they are simply no longer bundled (nothing on the live path imports them).
- Tests that exercise these route handlers still import them from the archive path.

## To restore

`git mv` the two folders back under `src/app/` (`api-sports-decision` →
`src/app/api/sports/decision`, `decision-engine-ops` → `src/app/predictions/decision-engine/ops`),
revert the import specifiers, and restore the `?ops`/`?full`/`?deep` redirect in
`src/app/predictions/decision-engine/page.tsx`.
