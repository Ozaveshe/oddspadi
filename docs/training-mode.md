# Training mode

A staff member learning the workspace must be able to click every button
without changing production. Training mode is that boundary.

## The flag

`ODDSPADI_OPS_TRAINING` (documented in `.env.example`). Any truthy value
(`1`/`true`/`yes`/`on`) turns training mode on. Leave it blank in production.
`isTrainingMode(env)` / `opsMode(env)` read it; `src/lib/ops/trainingMode.ts`.

## What training mode does

Every mutating case action is wrapped in `guardCaseAction`:

- **Training mode** → the action returns `{ status: "training-preview",
  wouldHave: "<description>" }` and **withholds the payload entirely**. There is
  nothing for the caller to persist.
- **Live mode** → the action returns `{ status: "live", action: <payload> }` and
  the caller applies it.

The same call site works in both modes — the mode, not the caller's discipline,
decides whether a row is ever written. It is the same shape as
`writeExceptions({ persist: false })`.

## The belt-and-braces assert

Immediately before any `op_*` write, the route calls
`assertProductionWriteAllowed(mode)`, which **throws a `TrainingViolation`** in
training mode. So a write path that forgot to branch on `guardCaseAction` fails
loudly rather than silently mutating production. Two independent guards, both
required to reach a write.

## What is covered

- `/api/ops/cases` POST actions — every action previews and writes nothing in
  training mode (test: "previews in training mode and performs no write").
- `/api/ops/cases/sync` — reports how many cases it *would* open and calls the
  upsert RPC zero times (test: "previews in training mode without calling the
  RPC").

The `/ops` overview shows a banner when training mode is on, so no one mistakes
a preview for a live action.

## What is not in scope

Training mode governs the operations workspace writes only. It is not a global
read-only switch for the whole app, and it does not sandbox the reads a page
performs (those are already read-only). A separate training *dataset* is not
provided — training mode makes production **safe to click**, not a fabricated
world to click through.
