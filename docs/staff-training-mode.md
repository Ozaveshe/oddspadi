# Staff training mode

New staff learn the operation without any path to production. Two independent
mechanisms provide this.

## 1. Training mode — real actions preview, never write

`ODDSPADI_OPS_TRAINING` (any truthy value) puts the operations workspace in
training mode. Every mutating case action, sync, and quality review then returns
a **preview** and performs **zero** writes:

- `guardCaseAction` withholds the payload — there is nothing to persist.
- `assertProductionWriteAllowed` throws a `TrainingViolation` immediately before
  any `op_*` write, so a path that forgot to branch fails loudly rather than
  silently mutating production.

Two guards, both required to reach a write. Enforced by test on
`/api/ops/cases`, `/api/ops/cases/sync` and `/api/ops/quality-reviews`. The
`/ops` overview shows a banner when training mode is on, so no one mistakes a
preview for a live action. (`src/lib/ops/trainingMode.ts`.)

## 2. Training sandbox — synthetic data to act on

`/ops/training` is a sandbox of five synthetic scenarios
(`src/lib/ops/trainingScenarios.ts`) covering exactly the tasks the brief names:

- resolve a synthetic **stale fixture**,
- **map a market**,
- **settle an edge case** (an abandoned match — void, don't grade),
- **approve content** (reject a guaranteed-win claim),
- **moderate a sample report** (a paid-tips scam — hide + flag, don't delete).

Every id is `SYNTHETIC-*`; every choice is graded **purely in the browser** by
`evaluateTrainingChoice`, which returns teaching feedback. The sandbox makes
**no network call and no write** — a trainee can click every option with no path
to production, and a test asserts the component contains no `fetch` and the page
reads no data source.

## How they combine

The sandbox teaches the judgement calls on invented data; training mode lets a
new hire then rehearse those calls on the *real* workspace with the write path
disabled. Neither touches production. When training is complete, unset
`ODDSPADI_OPS_TRAINING` and the same actions write, audited, as normal.

## Scope

Training mode governs the operations workspace writes only — it is not a global
read-only switch, and it does not fabricate a parallel world of live data (the
sandbox is the synthetic dataset). Reads a page performs are already read-only.
