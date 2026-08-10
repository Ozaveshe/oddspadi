# Release & Reconciliation System Implementation Plan (Prompt 20)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Add the automated controls that keep stale fixtures, contradictory decisions, record mismatches, slow routes, inaccessible interfaces and incomplete navigation migrations out of production — a scheduled production reconciler that alerts (never rewrites), the missing prohibited-contradiction gates, per-route performance budgets, sitemap-hygiene and accessibility gates, an observability spec, and the reconciliation/observability/rollback docs.

**Architecture:** Almost all primitives already exist (coherence model in `stateMatrix.ts`, cross-surface reconciler in `surfaceClaim.ts`, `reconcile-truth.mjs`, `op_settlement_exceptions` + `op_record_settlement_exception` RPC + `buildAlertReport`, provider-run tracking, projection freshness, model registry). This plan closes gaps: extract the reconciler's detections into a **tested TS module** and run them from a **scheduled Netlify worker** that writes findings to the existing exception queue (alert-not-rewrite); add the 6 missing contradiction blocks; add per-route budget + bundle + sitemap-hygiene tests; extend accessibility; and write the six docs. The reconciler's exception rows are the feed Prompt 21's case system consumes.

**Tech Stack:** Next.js 15, Netlify scheduled functions, Supabase, Vitest. No new deps.

## Global Constraints

- **Reconciler must alert, never rewrite** — a detected mismatch becomes an `op_settlement_exceptions` row (via `op_record_settlement_exception`) and/or a derived `buildAlertReport` finding; it never corrects a source table. Immutable records (publications) are never edited.
- **Never report zero on failure** — an unreadable source is `unavailable`/`could-not-check` (exit 2), never an empty finding list; `DataAvailability` distinguishes `unavailable` from `confirmed_empty`.
- **Scheduled entrypoint discipline** — a sweep declares `export const config: Config = { schedule }`, does NOT read an inbound token, does NOT touch the DB; the worker verifies `x-oddspadi-schedule-token` with `safeTokenMatches` and does the work (`job-endpoint-security.test.ts`). Pick a cron minute clear of the busy ones.
- **Contradictions fail CI** — new invariants land in `prohibited-contradictions.test.tsx` (the CI-gating suite) or a sibling gated by `gate:release`.
- **Performance waiver** — a critical reliability fix is not blocked solely for a minor cosmetic budget, but the waiver must be explicit (documented mechanism).
- **SEO** — private/thin/empty routes (the `NOINDEX` set) must be absent from `sitemap.ts`.
- Full proof: `npm run build && npm run typecheck && npm test && git diff --check`. One commit per task. Migration files are file-only handoffs.

---

### Task 1: Extract reconciler detections into a tested TS module

**Files:** Create `src/lib/reconciliation/detections.ts`, `src/test/reconciliation-detections.test.ts`.

**Interfaces (produces):**
```ts
export type ReconcilerSeverity = "critical" | "warning" | "info";
export type ReconcilerFindingKind =
  | "publication_track_record_mismatch" | "news_publication_mismatch" | "unsettled_final_fixture"
  | "stale_current_decision" | "missing_closing_price" | "duplicate_fixture" | "result_conflict"
  | "orphaned_community_selection" | "projection_age_breach" | "route_error_spike" | "model_version_mismatch";
export type ReconcilerFinding = {
  kind: ReconcilerFindingKind; severity: ReconcilerSeverity;
  entity: string;            // the affected fixture/publication/projection id
  detail: string;            // human, sanitised — never raw SQL/provider text
};
export type ReconcilerInput = { /* pure arrays the worker gathers, see below */ };
export type ReconcilerReport = {
  generatedAt: string; findings: ReconcilerFinding[];
  couldNotCheck: string[];   // sources that failed to read
  status: "clean" | "findings" | "could_not_check";
};
export function reconcile(input: ReconcilerInput, now: Date): ReconcilerReport;
```
- Pure functions, one per detection, each taking already-fetched rows (so the tests need no DB). Port the exact rules from `reconcile-truth.mjs` (publication-after-kickoff dedupe, `SETTLE_DEADLINE_MS = 60*60_000`, `REFRESH_INTERVAL_MS*3` projection stale, orphaned-community-fixture, article-count-without-ids) PLUS the three the script lacks: `result_conflict` (from `op_fixture_results.verification_state === "conflicted"`), `missing_closing_price` (published + `kickoff_at < now` + no current `op_closing_prices.captured`), `model_version_mismatch` (`op_publications.model_version` with no `approved` `op_model_registry` row). `couldNotCheck` non-empty ⇒ `status: "could_not_check"` and it outranks findings — never a false "clean".
- Deleted/moderated community tips (`deleted_at`/`moderated_at`) are still-present rows, never orphan gaps.

- [ ] **Step 1: Failing tests** — one per detection with hand-built rows, plus: an unreadable source yields `status: "could_not_check"` (not clean); a clean input yields `status: "clean"`; findings carry sanitised detail (no `${error}`); a deleted community tip whose fixture exists is NOT orphaned.
- [ ] Steps 2-4: implement pure detections → pass.
- [ ] **Step 5: Commit** — `feat(reconciliation): tested detection module (11 mismatch kinds, alert-not-rewrite)`.

---

### Task 2: Scheduled reconciler Netlify function (alerts via the exception queue)

**Files:** Create `netlify/functions/production-reconciler-sweep.ts`, `netlify/functions/production-reconciler-worker-background.ts`, `src/app/api/cron/reconcile/route.ts`; extend `src/test/job-endpoint-security.test.ts` expectations only if the new sweep/worker need listing.

- **Sweep** (`config.schedule = "5,35 * * * *"` — clear of the busy minutes): forwards to the worker with `x-oddspadi-schedule-token`, no DB, no inbound-token gate.
- **Worker**: verify `safeTokenMatches`; call `POST /api/cron/reconcile` with `x-oddspadi-admin-token`; return minimal `{ success, status, findingCount }`.
- **Route** (`/api/cron/reconcile`, `isCronAuthorized`): read the sources with `getSupabaseServerClient()` (service role, **read-only**), build `ReconcilerInput`, call `reconcile(...)`, then for each finding write an `op_settlement_exceptions` row via `writeExceptions` / the `op_record_settlement_exception` RPC (mapping `ReconcilerFindingKind`→a settlement-exception `kind` where one exists, else a new `reconciler_*` kind) with severity — **the only write, and it is an alert, not a correction**. Response is minimal (no raw run bodies). GET reports the last reconcile receipt via `toPublicRunReceipt` (never raw findings publicly).
- Claim a provider run (`startProviderRun`/`finishProviderRun`, jobType `production-reconcile`) so overlaps skip.
- [ ] TDD: route test (house mock convention) — unauth→401; a mismatch input writes exactly one exception row per finding and never updates a source table; could-not-check returns 502 with no exception rows. Sweep/worker source-scan: sweep has schedule + no inbound token; worker uses `safeTokenMatches`.
- [ ] Migration `20260809160000_reconciler_exception_kinds.sql` extends the `op_settlement_exceptions.kind` CHECK with the new `reconciler_*` kinds. Commit `feat(reconciliation): scheduled production reconciler that alerts through the exception queue`.

---

### Task 3: The six missing prohibited contradictions

**Files:** Modify `src/test/prohibited-contradictions.test.tsx`; add small render/source assertions.

Add gated blocks for: (2) **expired price presented as current** — a fixture with `oddsAvailable`+`odds.state === "expired"`/historical must not render current-price action language (assert via the match-intelligence odds union + a claim check); (3) **no value + actionable value** — `confirmed_empty`/`pass` cell renders no add-to-slip/actionable CTA; (11) **old navigation shell** — assert no page renders the legacy nav markers (`Home|Tips|Live Scores|Results|Engine` top-level items) — reuse `product-shell-contract` markers; (14) **demo counted as organic** — assert the leaderboard/engagement views exclude `account_type in ('demo','system')` (source-scan the view SQL + `TipsterLeaderboard`); (16) **manually altered model probability** — assert the publication/decision probability carries a provenance/trace and no surface recomputes or overrides it (source-scan `claimFromPublication`/`decision-probability-trace`). Each block references the existing modules so it's a real invariant, not a tautology.
- [ ] TDD per block → commit `test(contradictions): expired-price, no-value-actionable, nav-shell, demo-as-organic, altered-probability gates`.

---

### Task 4: Per-route performance budgets + bundle gate + failing p95

**Files:** Create `src/test/route-performance-budget.test.ts`, `src/lib/performance/routeBudgets.ts`; modify `scripts/load-test-public-reads.mjs` (fail on p95 miss with a waiver env), `scripts/release-gate.mjs` (wire the budget), `package.json` if a `gate:bundle` is added.

- `routeBudgets.ts`: a declarative table of the 10 spec routes (home, Today, Explore, live scores, match, Track Record, performance, My Padi, news, competition) with `{ serverMs, lcpMs, cls, inpMs, bundleKb }` budgets, and `WAIVER_ENV = "ODDSPADI_PERF_WAIVER"`. The budget *test* asserts the table covers all 10 routes and that each budget is within a sane ceiling (this is the deterministic CI gate; real LCP/INP need a browser and stay in the load-test/observability layer).
- Make `load-test-public-reads.mjs` set `process.exitCode = 1` on a p95 budget miss **unless** `ODDSPADI_PERF_WAIVER` is set (the explicit waiver the spec requires); print the waiver when used.
- Bundle gate: a test reading `.next` build output size for the shared JS against `bundleKb`, skipped when `.next` is absent (so `npm test` without a build still passes; `gate:release --full` runs it post-build).
- [ ] TDD → commit `feat(perf): per-route budget table + failing p95 gate with explicit waiver`.

---

### Task 5: Sitemap hygiene + breadcrumb coverage (SEO)

**Files:** Create `src/test/sitemap-hygiene.test.ts`.

- Assert every route in `route-canonical-contract`'s `NOINDEX` set (and `/live`, `/api/*`) is **absent** from `sitemap.ts`'s emitted URLs (import the sitemap default and check). Assert `robots.ts` disallows the private prefixes. Assert every indexable page that emits `BreadcrumbList` JSON-LD has Home as position 1 (source-scan the 6 breadcrumb files). Assert no `SportsEvent`/`Dataset` schema is emitted on a thin/empty page (the match page guards on a real fixture; already true — lock it).
- [ ] TDD → commit `test(seo): sitemap excludes noindex routes; breadcrumb + structured-data hygiene`.

---

### Task 6: Accessibility coverage for live matchday interactions

**Files:** Modify `src/test/live-board-accessibility.test.ts` (extend) or create `src/test/accessibility-contract.test.ts`.

- Static-contract assertions (no browser/axe dep): score updates go through the single `aria-live="polite"` `ScoreAnnouncer` (already tested — keep); every interactive control in the live/community/workspace components has an accessible name (`aria-label`/text); `prefers-reduced-motion` is honoured in `globals.css` (assert the media block exists and disables the animation utilities); loading/error states use `role="status"`/`role="alert"`; touch targets — assert the CSS defines a `--tap-target`/min-height on `.button`/tab-bar (source-scan). Document the axe/browser gap in `docs/seo-and-accessibility.md` as a named follow-up (release-gates already says a11y-automation is a gap).
- [ ] TDD → commit `test(a11y): live-score announce, reduced-motion, accessible-name and status-role contract`.

---

### Task 7: Observability spec + the six docs

**Files:** Create `src/lib/observability/metrics.ts` (the metric registry — names, thresholds, source), `docs/production-observability.md`, `docs/cross-surface-reconciliation.md`, `docs/seo-and-accessibility.md`, `docs/rollback-runbook.md`; modify `docs/release-gates.md` (add the new gates), `docs/state-test-matrix.md` (fix the "renders all ten surfaces" drift). `docs/release-gates.md`, `docs/incident-and-rollback.md` already exist — `rollback-runbook.md` cross-links and adds per-subsystem tested-rollback steps.

- `metrics.ts`: a typed registry of the 14 observability signals (public-read latency, route failures, projection age, fixture/odds/model-run/settlement lag, closing coverage, reconciliation errors, identity failures, stale-card rate, contradiction count, moderation backlog, content-validation failures) each with `{ warnThreshold, pageThreshold, source }` — the single source of truth the docs and any future emitter read. A test asserts all 14 are present.
- Docs: reconciliation (detections + alert-not-rewrite + the exception queue + the acceptance targets), observability (the 14 signals + thresholds from `reconciliation-monitoring.md`), seo-and-accessibility (what's gated + the axe follow-up), rollback-runbook (schema/projection/model/decision-policy/route/settlement/content-generator, each with a tested revert), release-gates update (reconciler + perf-budget + sitemap + a11y).
- [ ] Write metrics registry + test → write docs → `npm run build && npm run typecheck && npm test && git diff --check` → commit `feat(observability): metric registry + reconciliation/observability/rollback/seo-a11y docs`.

---

## Self-review

- **Spec coverage:** state matrix (exists — T7 fixes the doc drift); cross-surface (exists; the semantic reconciler already covers the 12 surfaces' claims — the render-coverage gap is noted, not all 12 rendered, acceptable since reconcileClaims is surface-agnostic); prohibited contradictions → T3 fills the 6 gaps; production reconciliation (safe, scheduled, alert-not-rewrite) → T1+T2; performance gates + waiver → T4; SEO → T5; accessibility → T6; observability → T7; release process + rollback → T7 (docs exist, extended). Acceptance targets are asserted by the detections (zero-as-zero, past-fixture-current, expired-price, finished/pre-match, raw-error, unauth mutation) across T1/T3 and the existing suites.
- **Deliberate scope:** real-browser LCP/INP/axe stay in the load-test/observability layer (documented follow-up) — CI gets deterministic budget-table + static-contract gates instead, since CI has no browser. Feature-flag rollout stays on the existing `builder_version` mechanism (documented), not a new flag registry.
- **Type consistency:** `ReconcilerFinding`/`ReconcilerReport` (T1) consumed by T2; the metric registry (T7) is standalone.
