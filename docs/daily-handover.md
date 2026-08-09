# Daily handover

The read a staff member starts a shift with. `/ops` renders it; `buildHandover`
in `src/lib/ops/handover.ts` computes it (pure, tested).

## What it shows

- **Open by severity** — critical / warning / info, active cases only.
- **Breached now** — active cases past their resolution deadline
  (`classifyCaseSla === "breached"`).
- **Open escalations** — active cases in the `escalated` state.
- **Resolved · last 24h** — closed since the previous shift.
- **Status** — a single headline: `clear`, `attention`, or `degraded`.

`attention` fires when anything is breached, escalated, or open at critical.

## The honesty rule: degraded, not zero

If a source could not be read, the handover is **`degraded`** and lists what it
could not read — it never renders a query failure as a clear queue. A handover
that showed zeros because the query failed would send someone home thinking the
board was empty; that is the precise failure this whole system exists to
prevent (an earlier reconciler once announced "0 projections" against a store
holding six). `buildHandover({ cases: [], couldNotRead: ["op_operational_cases"] })`
is `degraded`, not `clear`.

## The ritual

1. Open `/ops`. If the status is `degraded`, resolve the read problem before
   trusting any number below it.
2. Work `breached` and `escalated` first — those are past or approaching an SLA
   others are counting on.
3. Use `/ops/market` and `/ops/community` for the role queues; each case carries
   its SLA classification so the board self-prioritises.
4. `npm run ops:cases` is the same picture from the command line (exit 1 when
   anything is breached), for a cron or a quick check without the UI.

The handover is a **read**. It opens, edits and resolves nothing — that is the
workspace's job, and every such action is audited.
