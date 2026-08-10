# Staff Operating System & Service Levels Implementation Plan (Prompt 21)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Give OddsPadi staff two accountable role workspaces — **Market Ops Analyst** and **Social/Community Manager** — backed by a real case-management layer, measurable service levels, honest dashboards, a daily handover, a training mode that cannot touch production, quality review, and escalation. Every detected exception becomes a *case a human owns*, and every case action is audited.

**Architecture (what already exists — build on it, do not duplicate):**
- **The alert queue is `op_settlement_exceptions`** (state open/acknowledged/resolved/dismissed, severity critical/warning/info, `resolution`/`resolved_by`/`resolved_at`, dedup index, `reconciler_*` kinds). It is the machine-written alert feed. It has **no assignee and no timeline** — the gaps a case layer fills. The reconciler migration comment explicitly anticipates "the staff case system" routing `reconciler_*` findings.
- **Community work has its own queue**: `op_content_reports` (open/actioned/dismissed) + append-only `op_moderation_actions` + `op_moderation_appeals`, driven by `/api/community/moderation` and `ModerationQueue.tsx`.
- **Audit trails exist, append-only, with no reader yet**: `op_operator_audit` (destructive, `actor_fingerprint`, outcome applied/rejected/failed) via `writeOperatorAudit`; `op_settlement_operator_actions` via `operatorActions.ts`. The ops workspace is their **first reader**.
- **Auth**: shared bearer token (`isCronAuthorized`) for machine/API; cookie `auth.getUser()` + `op_profiles.is_admin` for internal UI (moderation page pattern); step-up (`requireStepUp`, `actorTokenFingerprint`) for the destructive class. Only role signal today: `account_type='staff'` + `is_admin`.
- **Metrics registry** `OBSERVABILITY_METRICS` + `classifyMetric` (14 signals, direction-aware, unread≠ok). Health via `/api/status`, `/api/health`, `readOperationalStatus`, `site-health.mjs`.
- **Cohort/provenance counts** for community growth: `scripts/audit-community-provenance.ts` (per-`account_type` row counts). Demo/staff already **excluded** from leaderboards (`op_public_tipster_leaderboard` gate).
- **Editorial validation-blocked** signal: `oddspadi-editorial-validation-blocked` log from `editorial-generation-worker-background.ts`; `validateArticle` fails closed.
- **Win rate / track record** lives only in `src/lib/performance/*` (ledger-derived). **It is walled off and must stay off every ops KPI.**

**Internal-page pattern (reuse verbatim):** server component, `export const dynamic = "force-dynamic"`, `pageMetadata({ noIndex: true })`, `createSupabaseServerClient()` → `auth.getUser()` → `op_profiles` role check → render client component if staff, else a notice. No shared admin layout exists; the gate is inlined per page.

**Tech Stack:** Next.js 15, Supabase, Netlify scheduled functions, Vitest. No new deps.

## Global Constraints

- **Cases layer on top; they never rewrite the source.** Opening/owning/resolving a case never edits `op_settlement_exceptions`, `op_publications`, `op_fixture_results`, or any immutable record. Resolving the underlying alert stays the existing operator-action path; the case records that a human did the work.
- **Training actions must not touch production.** In training mode every mutating action returns a *preview* and performs **zero** writes to any `op_*` table — enforced by test, reusing the `writeExceptions({persist:false})` preview idiom.
- **Prediction win rate is never an ops KPI.** The service-level and dashboard libraries must not import from `src/lib/performance/*`; a test asserts win rate / hit rate is absent from the ops KPI set.
- **Community growth excludes demo/staff.** Growth counts `account_type='organic'` only — the same exclusion the leaderboard already applies.
- **Targets stated honestly.** "Direct database edits: target 0" and "unsupported-claim rate: target 0" are computed from real sources; where a source cannot see everything, the doc says so rather than implying full coverage. A metric with no reading is `unknown`, never a satisfied "0".
- **Every case action is audited.** Each mutation writes one `op_operational_case_events` row **and** one `op_operator_audit` row (actor fingerprint, never a secret). Fail closed on auth; internal pages `noIndex`.
- Full proof per task: `npm run build && npm run typecheck && npm test && git diff --check`. One commit per task. Migration files are file-only handoffs (MCP connector unauthenticated this session).

---

### Task 1: Case model migration + tested case domain library

**Files:** Create `supabase/migrations/20260809170000_operational_cases.sql`, `src/lib/ops/cases.ts`, `src/test/ops-cases.test.ts`.

**Migration:**
- `op_operational_cases`: `id uuid pk`, `workspace text check in ('market_ops','community')`, `source text check in ('reconciler_exception','settlement_exception','content_report','manual')`, `exception_id uuid null → op_settlement_exceptions on delete set null`, `report_id uuid null → op_content_reports on delete set null`, `kind text`, `severity text check in ('critical','warning','info')`, `title text`, `state text default 'open' check in ('open','acknowledged','in_progress','waiting','resolved','dismissed','escalated')`, `assignee_fingerprint text null`, `due_at timestamptz null`, `opened_at timestamptz default now()`, `escalated_at timestamptz null`, `resolved_at timestamptz null`, `resolution text null`, `resolved_by text null`, `detail jsonb default '{}'`. Coherence constraint `(state in ('resolved','dismissed')) = (resolved_at is not null)`. Two partial unique indexes: one open case per open exception (`(exception_id) where exception_id is not null and state not in ('resolved','dismissed')`) and per open report. Read index `(workspace, state, severity, due_at)`.
- `op_operational_case_events` (append-only): `id`, `case_id → op_operational_cases on delete cascade`, `actor_fingerprint text`, `event_type text check in ('opened','note','assign','unassign','state_change','escalate','quality_review','link')`, `from_state text null`, `to_state text null`, `body text null`, `detail jsonb default '{}'`, `created_at timestamptz default now()`.
- RPC `op_upsert_operational_case(...)` `security definer`: if an open case exists for the given `exception_id`/`report_id`, return it (refresh `severity`/`title`); else insert + write an `'opened'` event. Idempotent — the sync can run every minute.
- RLS on both; `revoke all from public,anon,authenticated`; `grant select,insert,update to service_role`. Cases are read/written only through server routes on the service-role client (same posture as moderation).

**Domain library `src/lib/ops/cases.ts` (pure):**
```ts
export type CaseWorkspace = "market_ops" | "community";
export type CaseState = "open"|"acknowledged"|"in_progress"|"waiting"|"resolved"|"dismissed"|"escalated";
export function workspaceForExceptionKind(kind: string): CaseWorkspace;       // orphaned_community_selection → community, else market_ops
export function caseFromException(row, now): NewCase;                          // maps kind→workspace, severity, title, due_at
export const CASE_TRANSITIONS: Record<CaseState, CaseState[]>;                 // legal moves only
export function canTransition(from, to): boolean;
export function applyTransition(case, to, now): CaseUpdate;                     // throws on illegal; sets resolved_at when terminal
```

- [ ] **Step 1: Failing tests** — kind→workspace routing (community for `reconciler_orphaned_community_selection`, market_ops otherwise); `caseFromException` copies severity and sets `due_at` from the SLA (Task 2 import allowed once it exists — for now use a passed-in policy fn); every legal transition allowed and every illegal one rejected (`open→resolved` ok, `resolved→open` rejected); terminal transition sets `resolved_at`; a manual case needs no exception.
- [ ] Steps 2-4: write migration + pure library → pass.
- [ ] **Step 5: Commit** — `feat(ops): operational-case model + tested case domain (state machine, exception→case mapping)`.

---

### Task 2: Service-level policy library + tests

**Files:** Create `src/lib/ops/serviceLevels.ts`, `src/test/ops-service-levels.test.ts`.

- `SLA_POLICY: Record<CaseWorkspace, Record<Severity, {respondMins:number; resolveMins:number}>>` — critical tighter than warning tighter than info; market_ops resolution tighter than community for equal severity (a mispriced-market case outranks a spam report).
- `slaDueAt(workspace, severity, openedAt): Date`, `classifyCaseSla(case, now): "on_track"|"due_soon"|"breached"|"resolved_in_sla"|"resolved_late"` (a resolved case is judged on `resolved_at` vs `due_at`, never re-flagged as breached).
- `OPS_ANALYST_KPIS` / `COMMUNITY_MANAGER_KPIS`: typed KPI descriptors `{id,name,target,unit,direction}`. Ops-analyst set = cases-resolved-in-SLA, median-time-to-resolution, open-reconciliation-errors, **direct-database-edits (target 0)**, **unsupported-claim-rate (target 0)**. Community set = moderation-backlog, median-time-to-action, **organic-community-growth (excludes demo/staff)**, integrity-flagged-count.

- [ ] **Step 1: Failing tests** — critical `due_at` < warning `due_at` for the same open time; a case resolved before `due_at` is `resolved_in_sla`, after is `resolved_late`, never `breached`; `due_soon` fires inside the response window; **no KPI id contains "win" or "hit_rate" and neither KPI list imports from `src/lib/performance`** (assert via the descriptor set); the two "target 0" KPIs carry `target === 0`.
- [ ] Steps 2-3: implement → pass.
- [ ] **Step 4: Commit** — `feat(ops): service-level policy + role KPI sets (win rate is never an ops KPI)`.

---

### Task 3: Dashboard aggregation library + tests

**Files:** Create `src/lib/ops/dashboardMetrics.ts`, `src/test/ops-dashboard-metrics.test.ts`.

Pure aggregators over pre-fetched rows (no DB), composing `OBSERVABILITY_METRICS`/`classifyMetric`:
- `marketOpsDashboard(input)`: open cases by severity, SLA compliance %, median time-to-resolution, `reconciliation_errors`/`identity_failures`/`settlement_lag`/`closing_line_coverage` classified, `directDatabaseEditCount`, `unsupportedClaimRate`.
- `communityDashboard(input)`: `moderation_backlog` classified, median time-to-action, `organicGrowth` (current vs previous period, `account_type='organic'` only), integrity-flagged count.
- `countUnauditedMutations(governedMutations, auditRows): number` — a governed mutation with no matching `op_operator_audit`/`op_settlement_operator_actions` row in-window is an unaudited ("direct") edit. Honest scope: only mutations the reconcilers/audit surface can see; a silent edit to an unwatched table is invisible (documented in the doc, Task 8).
- `unsupportedClaimRate(blocked, total): number|null` — `null` when `total===0` (no attempts ⇒ unknown, not a satisfied 0).

- [ ] **Step 1: Failing tests** — SLA compliance and medians from hand-built cases; `organicGrowth` ignores demo/staff cohorts entirely; `countUnauditedMutations` returns 0 when every mutation has an audit row and >0 for an unexplained one; `unsupportedClaimRate(0,0)===null` and `(2,10)===20`; dashboards never read a win-rate field.
- [ ] Steps 2-3: implement → pass.
- [ ] **Step 4: Commit** — `feat(ops): role dashboard aggregators (direct-edit & unsupported-claim targets, organic-only growth)`.

---

### Task 4: Training-mode boundary + tests

**Files:** Create `src/lib/ops/trainingMode.ts`, `src/test/ops-training-mode.test.ts`.

- `isTrainingMode(env): boolean` (env flag `ODDSPADI_OPS_TRAINING`, documented in `.env.example`).
- `guardCaseAction<T>(mode, action): CaseActionResult` — in training mode returns `{status:"training-preview", wouldHave: action.describe()}` and the caller must **not** persist; in production returns `{status:"live"}` and the caller proceeds. Model on `writeExceptions({persist})`.
- A `TrainingViolation` guard `assertProductionWriteAllowed(mode)` that throws if a production write is attempted while `mode==='training'` — the belt-and-braces check the route calls right before any `op_*` write.

- [ ] **Step 1: Failing tests** — a training-mode action yields `training-preview` and `assertProductionWriteAllowed` throws; a production-mode action yields `live` and the assert passes; the preview carries a human description and **no** row payload is returned for persistence.
- [ ] Steps 2-3: implement → pass.
- [ ] **Step 5: Commit** — `feat(ops): training-mode boundary — actions preview, never write, in training`.

---

### Task 5: Case API routes (sync, list, actions) + staff auth + escalation + quality review

**Files:** Create `src/lib/ops/staffAuth.ts`, `src/app/api/ops/cases/route.ts`, `src/app/api/ops/cases/sync/route.ts`; tests `src/test/ops-cases-route.test.ts`, extend `src/test/route-auth-contract.test.ts`/meta-lists if present.

- `requireStaff(request)`: accepts admin bearer token (→ `actorTokenFingerprint`) **or** a cookie session whose `op_profiles` row is `is_admin` and `account_type='staff'` (→ fingerprint of the profile id). Returns `{actorFingerprint}` or a non-revealing 401/403. Fail closed.
- `sync` route (POST): idempotently opens cases from **open** `reconciler_*`/settlement `op_settlement_exceptions` (market_ops) and **open** `op_content_reports` (community) via `op_upsert_operational_case`. Read-only over sources; the only writes are case rows/events. Never zero on failure — an unreadable source returns 502 and opens nothing.
- `cases` route: `GET` (workspace filter, state filter, SLA classification via Task 2); `POST` action ∈ `claim|assign|note|acknowledge|start|wait|resolve|dismiss|escalate|quality_review`. Each validated through `applyTransition`/`canTransition`; each writes one `op_operational_case_events` row **and** one `op_operator_audit` row. `escalate` sets `escalated_at`, may raise severity, and records who. `quality_review` attaches a reviewer verdict to a resolved case (reviewer ≠ resolver enforced, mirroring the appeals rule).
- **Training mode**: when `isTrainingMode`, every `POST` returns the training-preview and performs no write.

- [ ] **Step 1: Failing tests** — unauthenticated POST is 401 and writes nothing; an illegal transition is 409/422 and writes nothing; a legal action writes exactly one case-event and one audit row; `escalate` sets `escalated_at`; `quality_review` by the resolver is rejected; training mode returns preview with zero writes; `sync` is idempotent (second run opens no duplicate).
- [ ] Steps 2-4: implement (service-role client after `requireStaff`) → pass.
- [ ] **Step 5: Commit** — `feat(ops): case sync + list + audited actions with staff auth, escalation, quality review, training preview`.

---

### Task 6: Staff workspace pages (internal, noIndex) + daily handover

**Files:** Create `src/app/ops/page.tsx` (overview/handover), `src/app/ops/market/page.tsx`, `src/app/ops/community/page.tsx`; components `src/components/ops/CaseBoard.tsx`, `src/components/ops/OpsDashboard.tsx`, `src/components/ops/DailyHandover.tsx`, `src/lib/ops/handover.ts` + `src/test/ops-handover.test.ts`.

- Each page: the internal-page pattern (force-dynamic, `noIndex`, staff gate = `is_admin`+`account_type='staff'`, else a "Staff access required" notice). No public linking; not in `sitemap`.
- `/ops` overview = the **daily handover**: `buildHandover(input, now)` (pure, tested) → open-by-severity, breached now, resolved in last 24h, open escalations, notable state changes since the prior shift, and the two dashboards' headline numbers. It is a read; it states "could not read" honestly rather than showing zeros.
- `/ops/market` = Market Ops Analyst: `CaseBoard` (market_ops cases, claim/act) + `OpsDashboard` (ops KPIs).
- `/ops/community` = Social/Community Manager: the existing `ModerationQueue` + community `OpsDashboard` + community-scoped `CaseBoard`.

- [ ] **Step 1: Failing tests** — `buildHandover` groups by severity, counts breached via the SLA classifier, lists resolved-last-24h, and yields a "could not read" marker (not zeros) when a source is missing; a `sitemap-hygiene` assertion that `/ops`, `/ops/market`, `/ops/community` are absent from the sitemap and `Disallow`ed.
- [ ] Steps 2-4: build pages + components + handover → pass. Verify with the browser preview (staff gate shows the notice when signed out).
- [ ] **Step 5: Commit** — `feat(ops): staff workspaces (market, community) + daily handover overview, noindex-gated`.

---

### Task 7: Scheduled case sync + operator script

**Files:** Create `netlify/functions/ops-case-sync-sweep.ts`, `netlify/functions/ops-case-sync-worker-background.ts`, `scripts/ops-cases.mjs`; extend `src/test/job-endpoint-security.test.ts` expectations for the new pair.

- **Sweep/worker** (schedule a clear minute, e.g. `12,42 * * * *`): sweep declares `config.schedule`, no DB, no inbound-token gate; worker verifies `x-oddspadi-schedule-token` with `safeTokenMatches` and calls `/api/ops/cases/sync`. Same discipline as the reconciler pair (`job-endpoint-security.test.ts`).
- `scripts/ops-cases.mjs` (`ops:cases`): read-only SLA report — open cases by workspace/severity, breached list, unassigned-and-overdue. Exit 0 clean / 1 breaches present / 2 could-not-check. Never zero on failure.

- [ ] **Step 1: Failing tests** — the security suite still passes with the new sweep listed (sweep has no token read/DB; worker verifies the token).
- [ ] Steps 2-4: implement → pass.
- [ ] **Step 5: Commit** — `feat(ops): scheduled case-sync (each open exception becomes a case) + ops:cases SLA report`.

---

### Task 8: Docs (five) + full verification + closeout

**Files:** Create `docs/staff-operating-system.md`, `docs/service-levels.md`, `docs/case-management.md`, `docs/training-mode.md`, `docs/daily-handover.md`. Document `ODDSPADI_OPS_TRAINING` in `.env.example`. Update route-map/README internal-routes note if present. Write the memory file.

- **staff-operating-system.md**: the two roles, what each owns, how exceptions/reports become cases, the auth model, the audit guarantee.
- **service-levels.md**: the SLA policy table, both KPI sets, and an explicit section: *prediction win rate is not an operations KPI, and why* (walled off in `src/lib/performance/*`); the two "target 0" definitions with their honest coverage limits.
- **case-management.md**: the state machine (diagram of legal transitions), escalation, quality review (reviewer ≠ resolver), the append-only timeline + operator audit.
- **training-mode.md**: the production boundary, the flag, what is sandboxed, the belt-and-braces assert.
- **daily-handover.md**: the handover ritual, what `/ops` shows, "could not read" over zeros.

- [ ] **Step 1**: write docs; add `.env.example` entry (env-example-coverage gate).
- [ ] **Step 2**: `npm run build && npm run typecheck && npm test && git diff --check`.
- [ ] **Step 3: Commit** — `docs(ops): staff operating system, service levels, case management, training mode, daily handover`.
- [ ] **Step 4**: closeout summary + list the file-only migration handoff (`20260809170000_operational_cases.sql`).

---

## Acceptance criteria (from the brief)

- Each detected exception can become a case a human owns, with assignment, a timeline, and an SLA — without rewriting the exception or any immutable record.
- Operations KPIs never include prediction win rate; community growth excludes demo/staff; "direct database edits" and "unsupported-claim rate" are measured with target 0 and honest coverage notes.
- Training actions perform zero production writes (test-enforced).
- Every case action writes a timeline event and an operator-audit row (actor fingerprint, never a secret).
- Staff pages are `noIndex`, staff-gated, and absent from the sitemap.
- All existing gates stay green; one commit per task; the new migration is a file-only handoff.
