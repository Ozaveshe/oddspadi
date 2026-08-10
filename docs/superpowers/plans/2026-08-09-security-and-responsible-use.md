# Security & Responsible-Use Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Establish strict security, privacy and responsible-use boundaries — operational jobs cannot be triggered anonymously, admin actions are role-bound/stepped-up/audited, public errors and transparency never leak secrets or chain-of-thought, private user records stay out of analytics, and a responsible-use centre exists — without weakening legitimate transparency.

**Architecture:** Centralise the duplicated schedule-token check into one verifier that also enforces request freshness (replay protection) and method; close the one unscheduled public sweep; add a step-up secret + audit for the destructive admin class; add a single public-error sanitiser and route every public read-error through it (provider names, run ids, raw DB text, doc paths); gate AI-polished editorial output through the same banned-phrase check as source copy; redact private fields from analytics payloads; build a responsible-use centre. No new dependencies.

**Tech Stack:** Next.js 15, Netlify functions, Supabase, Vitest.

## Global Constraints

- **Public status may expose only:** operational / delayed / partial / unavailable / last public update. **Never:** raw SQL errors, DB vendor detail, internal run IDs, private provider names, queue internals, documentation paths, repair-task names.
- **Public methodology may show** data categories, model family, calibration, decision policy, publication/settlement rules, performance metrics. **Never** secret prompts, chain-of-thought, credentials, private endpoints, raw operational logs.
- **Analytics must not carry** personal slip contents, exact personal betting record, private follows, or account details.
- **OddsPadi does not take bets or hold funds** — keep this boundary accurate in all copy.
- Responsible-use copy must be consistent across the product; no unsupported claims (guaranteed winner, safe bet, sure odds, risk free, guaranteed profit) — `consumer-copy-integrity` stays green and is extended.
- Every state-changing job endpoint: protected scheduler/S2S auth, correct method, replay protection, idempotency, rate limits, structured audit, minimal response. Do not rely on an unlinked route for security.
- Existing gate tests that must stay green and be extended: `src/test/job-endpoint-security.test.ts`, `mutation-origin-security`, `user-rate-limit-security`, `bounded-json-security`, `consumer-copy-integrity`, `api-hardening`, `database-error-security`, `analytics-taxonomy`.
- Migrations are file-only handoffs (verified `supabase_oddspadi` connector required to apply). Full proof: `npm run build && npm run typecheck && npm test && git diff --check`. One commit per task.

---

### Task 1: Close the anonymous job trigger + method/freshness verifier

**Files:** Create `netlify/functions/_shared/scheduleAuth.ts`; modify `netlify/functions/multi-sport-decision-cycle-sweep.ts` (add `export const config = { schedule: … }`), all 16 `*-worker-background.ts` (use the shared verifier), and the 16 `*-sweep.ts` that mint the token; extend `src/test/job-endpoint-security.test.ts`.

- Shared verifier `verifyScheduledRequest(request, { expectedToken, now })`: constant-time token compare that does **not** branch on length first (pad-compare both to a fixed hash), rejects non-POST with 405, and enforces an `x-oddspadi-schedule-ts` freshness window (±300 s) so a captured worker call cannot be replayed. Returns `{ ok: true } | { ok: false, response }`.
- Sweeps stamp `x-oddspadi-schedule-ts` alongside the token when they POST to their worker.
- `multi-sport-decision-cycle-sweep.ts` gets a real `schedule` so it is no longer an ordinary public HTTP function.
- Test additions: every `*-sweep.ts` must declare `export const config`/`schedule` OR appear in `netlify.toml` (no unscheduled sweep); every `*-worker-background.ts` must call `verifyScheduledRequest` and reject non-POST; the length-first branch is gone.
- [ ] TDD: failing test → verifier + wiring → pass → commit `feat(security): scheduled-job verifier with method + replay-freshness; close unscheduled sweep`.

---

### Task 2: Rate-limit and lock down the unauthenticated service-role endpoints

**Files:** Modify `src/app/api/workspace/{share,settle,recheck,convert}/route.ts`; create a device-scoped limiter `src/lib/security/anonymousRateLimit.ts` (httpOnly signed cookie key + `op_consume_guest_rate_limit` RPC) + migration `20260809140000_guest_rate_limits.sql`; fix the share-revoke malformed-token bypass in `share/route.ts:90-107`; extend `mutation-origin-security` / `bounded-json-security` lists.

- Guest limiter mirrors the guest-poll pattern (server-minted uuid cookie, service-role RPC, fixed windows): share create 10/h, settle/recheck/convert 30/10min per device. Keep guest sharing (product decision) but bound it.
- Share revoke: a `malformed` token must NOT fall through to the id-extraction revoke — only `bad_signature` on a *well-formed* token belonging to the caller (or a valid signed token) may revoke. Require either a verifiable signed token or an authenticated owner-by-id.
- [ ] TDD (route tests, house mock convention) → implement → pass → commit `feat(security): bound anonymous workspace endpoints; fix share-revoke token bypass`.

---

### Task 3: Admin RBAC + step-up + audit

**Files:** Create `src/lib/security/adminAuth.ts` (`requireAdmin`, `requireStepUp`), `src/lib/security/operatorAudit.ts`; migration `20260809150000_operator_audit_and_stepup.sql` (broaden `op_settlement_operator_actions` into an `op_operator_audit` general log, or add rows for the destructive classes); modify the destructive admin/training routes (`/api/sports/decision/autonomous-cycle` persist, `training/calibration-promotion` approve, `training/champion-challenger`, `admin/markets` writes, `admin/settlement/actions`, provider-disable/rollback paths).

- **Step-up class** (spec): production model run, publication pause/resume, model rollback, bulk settlement correction, provider disable, destructive migration. `requireStepUp` requires a **second** secret `ODDSPADI_ADMIN_STEPUP_TOKEN` (distinct from `ODDSPADI_ADMIN_TOKEN`) AND an explicit `confirm` field naming the action — the architecture's step-up within a token model. Fail closed when the step-up secret is unset.
- Every step-up action writes one `op_operator_audit` row (actor-token-fingerprint, action, target, payload digest, ts) before returning a **minimal** response (no raw run bodies, no `error.message`).
- [ ] TDD (SQL-literal + route tests: unauth→401, admin-without-stepup→403 on destructive, audit row written) → implement → pass → commit `feat(security): step-up auth + operator audit for destructive admin actions`.

---

### Task 4: Public error + transparency sanitisation

**Files:** Create `src/lib/security/publicErrorText.ts` (`toPublicReason(raw): string` — collapses any provider/DB/vendor text to a fixed operational phrase, strips run ids, table names, doc paths, provider slugs); modify `src/lib/sports/intelligence/pipeline.ts` (provider/storage error strings), `identityEnrichment.ts`, `storedFixture.ts`, `history.ts` (ledger reason), `slateWire.ts` (drop `runId`/`providerName`/raw `errors` from the public `provider` shape — keep counts + a sanitised status), `report.ts` (drop `sourceReason` raw text + `providers` slugs + `ledger` table name from the public payload), and the render sites (`IntelligenceSlate.tsx` ProviderRunStrip, `decision-engine/page.tsx` last-errors + `minimumValueEdge` threshold + doc-path link, `StoredFixtureAnalysisView.tsx`, `engine/performance/page.tsx` provider-sources, `track-record/page.tsx` table-name/doc-path footer).

- Provider names → a generic "multiple licensed data providers" label; run ids → removed; raw DB/provider error text → `toPublicReason`; the live `minimumValueEdge` publication threshold → removed from the public page (methodology may say "a value threshold applies", not the number); rendered `docs/*` paths and `op_*` table names → removed from consumer pages (keep them in the repo docs).
- Extend `database-error-security` with a scan asserting no `${error.message}` reaches a public (non-`databaseUnavailable`) render path, and a copy scan for `op_`/`docs/`/provider-slug leakage on consumer pages.
- [ ] TDD → implement → pass → commit `feat(security): sanitise public errors, provider names, run ids and doc paths`.

---

### Task 5: Methodology boundary — editorial output + blocker redaction

**Files:** Modify `src/lib/editorial/aiPolish.ts` (post-polish gate), reuse the banned-phrase list by extracting it to `src/lib/editorial/bannedClaims.ts` (shared by `aiPolish` and `consumer-copy-integrity`); modify `src/lib/sports/prediction/blockerPresentation.ts` (unmapped blocker → generic text, never verbatim engine string) and confirm `INTERNAL_MARKERS`/`isReaderFacing` also guards `MatchIntelligenceSections`/`DecisionEvidenceProfile`/publication receipt reason renders.

- `polishEditorialStories`: after parsing model output, run title/excerpt/body through the banned-claim regexes AND `isReaderFacing`; on any hit, discard the polish and keep the deterministic story (never publish raw model text that fails the gate).
- `presentBlockers`: an unmapped blocker returns a fixed "Analysis withheld pending review" style text, not the raw engine token; assert no `_`-joined internal token can reach a reader.
- [ ] TDD (aiPolish rejects a "sure odds" polish; presentBlockers redacts `calibration_support`) → implement → pass → commit `feat(security): gate AI-polished copy and redact unmapped engine blockers`.

---

### Task 6: Analytics redaction (private data out of marketing analytics)

**Files:** Modify `src/lib/analytics/events.ts` (payload allowlist per event), `src/components/odds/AddToSlipButton.tsx` (drop `selection` + `decimal_odds`), `src/components/account/{ProfileEditor,FollowTeamButton}.tsx` (drop `team_name`, keep only a coarse count/sport), `src/lib/analytics/events.ts` beacon (drop tokenised pathname — send `surface` label, not `/workspace/shared/<token>` or `/community/u/<handle>`); update the consent copy only if needed (it already claims no betting activity — make it true); extend `analytics-taxonomy.test.ts`.

- Introduce a per-event property allowlist enforced in `trackEvent` (unknown keys dropped), so the declarative `data-analytics-*` channel cannot smuggle private fields.
- `betslip_pick_added` keeps `sport`/`league`/`source`, drops `selection` and `decimal_odds`. `team_followed/unfollowed` keeps `sport`, drops `team_id`/`team_name`/`country`. Beacon path is replaced by the resolved `surface` (never a token/handle).
- [ ] TDD (allowlist drops `selection`/`team_name`; beacon carries no token) → implement → pass → commit `feat(privacy): redact slip contents, follows and tokens from analytics`.

---

### Task 7: Responsible-use centre + consistent copy

**Files:** Modify `src/app/responsible-use/page.tsx` (add self-exclusion links, deposit/time-limit + cooling-off guidance, self-assessment pointer, minors notice; make it a hub with reciprocal links); modify `src/components/odds/PredictionDisclaimer.tsx` (`PredictionDisclaimer` links `/responsible-use`); add a reciprocal link from `/account` and `/my`; extend `consumer-copy-integrity.test.ts` (assert self-exclusion + limit-tooling + cooling-off present; assert the disclaimer component itself links to support) and broaden its scanned roots to include `src/lib/product`, `src/lib/discovery`, `src/lib/domain`, `src/lib/sports/prediction`.

- Add: operator self-exclusion guidance (national registers / bookmaker self-exclusion, region-appropriate — no impersonation of a scheme OddsPadi doesn't run), deposit/session-limit + reality-check + blocking-software pointers, a take-a-break concept, a link to a self-assessment resource, and an explicit minors/under-18 notice. Keep "OddsPadi does not take bets or hold funds" accurate throughout.
- [ ] TDD → implement → pass → commit `feat(responsible-use): responsible-use centre with self-exclusion, limits and consistent linking`.

---

### Task 8: CSP hardening + docs + verification

**Files:** Modify `next.config.mjs` + `netlify.toml` (add `default-src 'self'`, `script-src`, `connect-src`, `img-src`, `style-src` to the CSP without breaking GA/Supabase/media host); create `docs/security-boundaries.md`, `docs/job-endpoint-security.md`, `docs/user-data-privacy.md`, `docs/responsible-use.md`, `docs/public-methodology-boundary.md`; fix the stale `README.md` route references; add a test asserting no file-upload primitive is introduced (`storage.from(`/`.upload(`/`type="file"` absent).

- CSP: allowlist the GA host, Supabase URL, the analytics endpoint, `media.api-sports.io`; keep `script-src` without `unsafe-inline` where feasible (Next needs nonces — if not feasible in this pass, document the residual and pin the rest).
- [ ] Write docs → `npm run build && npm run typecheck && npm test && git diff --check` → commit `docs(security): boundaries, job security, privacy, responsible-use, methodology` → closeout (migrations file-only handoff).

---

## Self-review

- **Spec coverage:** unauthenticated job (T1), replayed job / state-changing GET (T1 freshness + method; GETs already non-mutating — asserted), RBAC bypass / step-up (T3), raw error leakage (T4), client secret (already clean — T8 asserts no regression), expired/revoked share (T2 fix + existing), cross-user workspace access (RLS confirmed; T2 bounds anon), community XSS / unsafe link (delivered in the community work — assert still green), analytics redaction (T6), prohibited claims (T5 editorial gate + T7 copy). Docs (T8). Uploads: none — T8 asserts absence.
- **Deliberate scope:** step-up is a second-secret + confirm model (no MFA in a token architecture); guest workspace sharing is kept (product decision) but rate-limited; CSP `script-src` may retain a documented residual if Next inline requirements block a clean `script-src`.
