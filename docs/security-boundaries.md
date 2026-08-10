# Security boundaries

The operational boundary of OddsPadi, and the tests that keep each part honest.
Companions: [job-endpoint-security.md](job-endpoint-security.md),
[user-data-privacy.md](user-data-privacy.md),
[public-methodology-boundary.md](public-methodology-boundary.md),
[responsible-use.md](responsible-use.md).

## Trust zones

| Zone | Who | Auth | Notes |
|---|---|---|---|
| Public reads | anyone | none | slate/tips/track-record/live/search; sanitised, cached, GET-only |
| Community/account writes | signed-in user (RLS) | cookie session + origin guard + per-user rate limit | `privateJson`, `Vary: Cookie` |
| Anonymous workspace | guest browser | origin guard + device-keyed rate limit | service-role compute, bounded work |
| Jobs | Netlify scheduler | scheduled entrypoint → worker shared-secret | see job-endpoint-security.md |
| Admin (routine) | operator | `ODDSPADI_ADMIN_TOKEN` (constant-time) | receipts, previews, reversible jobs |
| Admin (destructive) | operator | admin token **+** `ODDSPADI_ADMIN_STEPUP_TOKEN` **+** typed `confirm` + audit row | model promotion, production run |

## RBAC

The only role in the product is `op_profiles.is_admin`, gating community
moderation (`/community/moderation`, `/api/community/moderation`). Operational
jobs and admin routes use a shared bearer token with no identity; the
destructive class adds a step-up secret (see below). `actor` on settlement
actions is self-declared attribution, never access control.

## Step-up (destructive class)

`requireStepUp` (`src/lib/security/adminStepUp.ts`) requires the base admin
token, a **distinct** `ODDSPADI_ADMIN_STEPUP_TOKEN`, and a typed `confirm`
naming the action. Fails closed when the step-up secret is unset. Wired to
model promotion (`training/calibration-promotion` approve) and the persisting
production cycle (`autonomous-cycle` POST). Every step-up action writes one
`op_operator_audit` row (`src/lib/security/operatorAudit.ts`) with a token
**fingerprint**, never the secret. Provider disable / model rollback /
destructive migration use the same primitive when such routes exist.

## Errors

`databaseUnavailable` (`src/lib/security/databaseError.ts`) logs only a
regex-validated code and returns an operator-written message; used by every
private route. Public read paths route raw failure text through
`toPublicReason` (`src/lib/security/publicErrorText.ts`) — a coarse
"delayed / unavailable" phrase, never SQL, vendor detail, run ids or provider
names. See public-methodology-boundary.md.

## Headers & CSP

HSTS (preload), COOP, CORP, X-Frame-Options DENY and the CSP are declared
identically in `next.config.mjs` and `netlify.toml` (kept in sync by
`content-security-policy.test.ts`). The CSP locks the high-risk document sinks
(`base-uri`, `object-src`, `frame-src`, `frame-ancestors`, `form-action`,
`script-src-attr`) and bounds `connect-src`/`img-src`/`font-src`. `script-src`
is deliberately unset so Next's inline hydration runs without `'unsafe-inline'`;
a nonce-based `script-src` is the documented follow-up.

## No file uploads

There is no upload path anywhere: avatars are OAuth-provider URLs, no storage
bucket, no file input. `upload-surface-absent.test.ts` keeps it that way — a
new upload surface must be a reviewed decision.

## Client bundle

No non-`NEXT_PUBLIC_*` env var and no server secret is referenced in any
`"use client"` file; no browser source maps (`job-endpoint-security.test.ts`).
