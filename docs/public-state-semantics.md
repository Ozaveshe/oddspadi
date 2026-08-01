# Public state semantics

*States: [`src/lib/domain/states.ts`](../src/lib/domain/states.ts) ·
Messaging: [`PublicStateNotice.tsx`](../src/components/product/PublicStateNotice.tsx) ·
Tests: `src/test/public-read-resilience.test.ts`.*

## The distinction everything rests on

**"We asked and there is nothing" and "we could not ask" must never render the
same way.** Before this, a database timeout was caught and displayed as
"0 fixtures" / "no value picks" — the product asserting a fact about the world
when it had actually failed to look.

## The five states

| State | Meaning | Rows shown | The page says |
|---|---|---|---|
| `complete` | Fresh, verified, current | Yes | Nothing — no notice needed |
| `stale` | Verified snapshot past its freshness threshold | Yes | Its age and build time |
| `partial` | Renderable, with known gaps in evidence | Yes, partly | Which evidence is missing |
| `confirmed_empty` | Checked successfully; nothing qualifies | None — correctly | That the emptiness is the answer |
| `unavailable` | The read failed or no trustworthy snapshot exists | **None** | That no conclusion can be drawn |

`unavailable` carries `rowCount: 0` and `data: null` by construction, so there
is no number for a page to mistake for a result. A test asserts these can never
appear together with a non-zero count.

## Copy

Approved shapes, all produced by the shared component:

- **Unavailable** — "Today's slate is temporarily unavailable. We could not
  verify the current data, so nothing is shown rather than a figure we cannot
  stand behind. The last verified snapshot was built 22:15. **This is not a
  zero** — please check back shortly."
- **Stale** — "Showing the last verified snapshot, 47 minutes old. Today's
  slate may not reflect the last few minutes of changes."
- **Partial** — "Fixtures are showing with known gaps. Model decisions are
  withheld because current odds evidence is incomplete."
- **Confirmed empty** — "Nothing to show — and that is the real answer. We
  checked successfully and no qualifying records exist for today's slate."

## Freshness thresholds

| Projection | Threshold | Why |
|---|---|---|
| `live_fixture_board` | 3 min | In-play scores are the most time-sensitive thing on the site |
| `daily_fixture_slate` | 30 min | Kickoffs and prices move, but not minute to minute |
| `latest_engine_status` | 30 min | Matches the projection sweep cadence |
| `performance_summary` | 6 h | The ledger changes only when a pick settles |

Past the threshold the snapshot is still served — it is verified data — but the
page must disclose its age. Serving stale content silently is the failure mode
these thresholds exist to prevent.

## What is never shown

Raw database errors, statement-cancellation text, provider names, run ids,
queue messages and stack traces. The read model carries a `diagnostic` field
for operators; a test asserts the notice component references neither it nor
`lastError`.

The public status endpoint (`/api/status`) emits exactly two fields:

```json
{ "status": "operational" | "delayed" | "partial" | "unavailable",
  "lastUpdatedAt": "2026-08-01T01:34:00.000Z" }
```

A test feeds it a payload containing `op_odds_snapshots`, a statement-timeout
string, a provider name and a job name, then asserts none of them appear in the
serialised output. Full detail — which projection failed, what the database
said, which job last succeeded — is available through the private operational
read only.

## Precedence

When several projections disagree, the public status reports the worst:

1. any `refresh_failed` → **delayed** (a surface is silently ageing)
2. any `partial` → **partial**
3. any past threshold → **delayed**
4. otherwise → **operational**

An unreadable operational view is **unavailable**, never "operational with no
problems found".
