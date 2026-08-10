# Job endpoint security

Operational jobs cannot be triggered anonymously, and their protection is a
property of the repository — not of the hosting platform.

## Shape

Each job is a **sweep** (scheduled entrypoint) that forwards to a **worker**
(does the work). The split exists because the two halves authenticate
differently:

- A **sweep** is invoked by the Netlify scheduler, which sends no header, so a
  sweep must NOT gate on an inbound token (a past inbound-token check on a
  scheduled function returned 401 every tick and froze projections for 8.5h).
  Its protection is holding no privileged logic and no database client of its
  own — it forwards to a worker.
- A **worker** is invoked by our own sweep and MUST verify the shared secret.

Both rules are enforced by `job-endpoint-security.test.ts`.

## The verifier

Workers compare the inbound `x-oddspadi-schedule-token` against
`ODDSPADI_ADMIN_TOKEN` with `safeTokenMatches`
(`netlify/functions/_shared/scheduleAuth.ts`) — a SHA-256 constant-time
compare with **no length branch** (the previous per-worker
`length === length && timingSafeEqual` leaked the secret's length by timing).
All 16 workers use the shared verifier.

## Every sweep is scheduled

An unscheduled sweep is an ordinary public HTTP function: anyone could invoke
it and drive the worker it forwards to. `multi-sport-decision-cycle-sweep`
shipped without a `schedule` and was therefore anonymously invocable; it now
declares one. The test fails any `*-sweep.ts` without a schedule (in code or
`netlify.toml`).

## Method, idempotency, replay

- **Method:** all internal work is invoked with `method: "POST"`; cron GET
  handlers report the last run only (never run the job) —
  `job-endpoint-security.test.ts`.
- **Idempotency:** the pipeline is serialised by a single DB lock
  (`op_provider_ingestion_runs`, unique partial index on `status='running'`);
  `startProviderRun` returns `skippedOverlap` on contention. Stale runs are
  closed after 15 minutes.
- **Replay:** the sweep→worker channel is internal and platform-firewalled;
  request-level replay-nonce/timestamp is a documented follow-up rather than a
  present control.

## Receipts

Public cron GET receipts go through `toPublicRunReceipt`, which exposes only
`{ status, lastSuccessAt }` — never the run UUID, provider/job names, or raw
error text (one such receipt leaked a raw Postgres timeout string in prod).
