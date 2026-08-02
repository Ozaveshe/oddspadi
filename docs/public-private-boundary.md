# The public / private boundary

Four tiers, and what each one is allowed to contain.

| Tier | Who sees it | Examples |
|---|---|---|
| **Public product** | Anyone | Fixtures, prices, published picks, the track record, match intelligence |
| **Public methodology** | Anyone | How the engine works, what a Brier score is, why a pick was withheld, the seven promotion gates |
| **Private model operations** | Operators only | Shadow model keys, unpromoted evaluations, provider identities and quotas, run IDs, raw database errors |
| **Admin controls** | Operators only | Anything that syncs, backfills, settles, promotes or publishes |

The first two are the product. The second two are the workshop, and the
distinction is not that the workshop is embarrassing — it is that publishing an
unpromoted model's numbers alongside a public track record makes the record
ambiguous, and publishing provider identities and env var names hands over a
map.

## What was actually exposed

Probed against production on 2026-08-02 with no credentials, no cookies and no
referrer. Two anonymous GETs returned:

```
GET /api/sports/decision/training/calibration
  latestRun.modelKey  "football-poisson-v5-shadow-mp-649021fd6576"
  latestRun.id        c1960ecc-5a2e-4562-8262-876ab163c7d9
  + the full unpublished evaluation: Brier 0.259467, skill -0.044046,
    log loss 0.712369, ECE 0.098287, ROI -1.61u, per-bucket breakdown,
    and the promotion blockers holding it back
```

```
GET /api/sports/decision/training/provider-capacity
  providers[].provider           "api-football", "api-basketball"
  providers[].configuredEnvName  "API_FOOTBALL_KEY", "API_BASKETBALL_KEY"
```

Neither is linked from the UI. That was the whole defence, and it is not one.

Eight more operational reads were open the same way: the autonomous decision
cycle preview, the autonomous settlement preview, three live provider receipt
previews, and the results-backfill dry run — each of which runs real engine or
provider work for an anonymous caller.

Every mutating POST was correctly rejected. Nothing was writable.

## What changed

- **Every operational handler authenticates, reads included.** Fourteen route
  files under `/api/sports/decision/training`, the two autonomous routes, and
  the `backfill-results` dry run.
- **One rejection body for all of them.** `trainingUnauthorized()` returns a
  bare `Unauthorized.` The old bodies said things like *"Provider sync requires
  a valid x-oddspadi-admin-token"* — which names the header to brute-force,
  confirms the route exists, and describes what it does.
- **Auth runs before validation.** An anonymous POST to `provider-capacity`
  used to get a 400 explaining that `run=1` was missing, teaching the interface
  to a caller holding nothing.
- **The cron GETs stay public** — they are the site's status signal — but only
  through `toPublicRunReceipt`, which reduces a run to a coarse state and a
  success time.

## What holds it

`src/test/operational-boundary.test.ts`:

- every exported handler on an operational route calls a guard, sliced per
  handler so a guard in `POST` cannot vouch for `GET`
- the guard call precedes any other rejection in mutating handlers
- no rejection anywhere names the admin header
- `isTrainingAdminAuthorized` fails closed with the secret unset, rejects a
  prefix, and compares in constant time

`src/test/job-endpoint-security.test.ts` covers the scheduled functions and the
sanitised run receipts.

## Consequence for operators

Reads that used to work anonymously now need `x-oddspadi-admin-token`.
`scripts/site-health.mjs` sends it when `ODDSPADI_ADMIN_TOKEN` is set and
prints `SKIP` for those checks when it is not, rather than reporting a false
failure — the failure mode this codebase has hit before is a tool that prints
zeros on an auth error and reads like a clean result.
