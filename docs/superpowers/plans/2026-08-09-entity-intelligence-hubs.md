# Entity Intelligence Hubs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn competition, team and player pages into intelligence hubs that connect fixtures, standings, form, projections, model coverage, publications, news and community around canonical entities — while keeping official standings and simulations visually and technically separate.

**Architecture:** Harden the existing official-table lane first (the page currently discards `buildOfficialTable` output; deductions and staleness are unrepresentable), then add one service-role entity-reads module per entity kind, a pure sport-adapter module that declares which sections each sport can honestly support, three pages (`/predictions/league/[slug]` hub, `/predictions/team/[teamId]`, `/predictions/player/[playerId]`), a versioned season-outlook object, and an internal-linking pass. Simulations never enter official standings; player pages are noindex unless durable data exists.

**Tech Stack:** Next.js 15 App Router, Supabase service-role reads (op_fixtures/op_teams/op_fixture_results/op_fixture_decision_summaries), existing canonical reads for op_publications, Vitest. No new dependencies.

## Global Constraints

- Official table derives only from verified results or provider standings; **"do not mix simulated points into official standings"** — projections stay in separate components/types (`ProjectedTable.kind === "simulation"`; `assertTablesSeparate` must stay green).
- Pre-season: label **"Season not started"**, neutral/alphabetical order, no implied rank (no position column, no zone classes).
- In-season: show update time; handle deductions; do not fake per-competition tiebreaks we don't implement (points → GD → GF → name, disclosed).
- Outlooks must carry: competition, season, evidence cutoff, source receipts, model version, simulation count, included factors, missing factors, next revision trigger, publication date, correction history. Promoted teams get an explicit structural treatment (`returning-team-baseline` research object).
- **Index only pages with meaningful current or durable value** — player pages noindex unless the durable-data gate passes; unknown-entity metadata is `robots: { index: false, follow: false }` before `notFound()` (league-table pattern).
- Contract tests that bind every new route: `route-canonical-contract` (route-map registration, canonical/noindex, no-orphan), `product-shell-contract` (add `[teamId]`, `[playerId]` to CONCRETE at :70-76), `page-metadata-seo` (use `pageMetadata`/`siteUrl`, never re-derive origin), `dynamic-link-encoding` (every `` href={`/…/${x}`} `` needs `encodeURIComponent`), `server-rendered-timezone` (use `LocalTime`/`LocalTimeText`), `consumer-copy-integrity` (no certainty language).
- Fixture links only ever point at `/predictions/${id}`; new pages live under the `/predictions` prefix so `surfaceForPath` resolves Explore with no `surfaces.ts` change.
- Full proof stack before final commit: `npm run build`, `npm run typecheck`, `npm test`, `git diff --check`. One commit per task.

---

### Task 1: Official-table hardening — deductions, staleness, and actually rendering `buildOfficialTable`

**Files:**
- Modify: `src/lib/discovery/tableState.ts`, `src/lib/sports/leagueStandings.ts`, `src/app/predictions/league/[slug]/table/page.tsx`, `src/app/predictions/[matchId]/page.tsx` (pre-season guard on the inline "Nth · N pts")
- Test: `src/test/official-standings.test.ts` (new), extend `src/test/discovery-curation.test.ts` expectations only if broken

**Interfaces:**
- `StandingRow` gains `pointsAdjustment?: number | null` and `adjustmentNote?: string | null` (deductions render as e.g. "−6 pts: points deduction" beside points; ranking uses the already-net `points`).
- New export `classifyTableFreshness(updatedAt: string | null, now?: Date): { status: "current" | "delayed" | "unavailable"; note: string | null }` in `tableState.ts` — `delayed` past 24 h, `unavailable` when null.
- New export `toStandingRows(table: LeagueTable): StandingRow[]` in `leagueStandings.ts` mapping `LeagueStandingRow` (incl. new optional `pointsAdjustment`/`adjustmentNote` on `LeagueStandingRow`) so the page can feed `buildOfficialTable` and render **its** rows.
- The table page renders `officialTable.rows` for every state: `season-not-started` → alphabetical, position column shows "—", zone classes suppressed, label "Season not started"; `in-progress` → positions from the builder, `verifiedAt`/update time + freshness badge; `unavailable` → the builder's note (no raw-rows fallback).

- [ ] **Step 1: Failing tests** (`src/test/official-standings.test.ts`)

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildOfficialTable, classifyTableFreshness, assertTablesSeparate } from "@/lib/discovery/tableState";

const row = (name: string, extra: Partial<Parameters<typeof buildOfficialTable>[0][number]> = {}) => ({
  teamId: name.toLowerCase(), teamName: name, played: 0, won: 0, drawn: 0, lost: 0,
  goalsFor: 0, goalsAgainst: 0, points: 0, ...extra
});

describe("official table", () => {
  it("pre-season zero table is alphabetical with no positions and says so", () => {
    const table = buildOfficialTable([row("Wolves"), row("Arsenal")]);
    expect(table.state).toBe("season-not-started");
    if (table.state !== "season-not-started") return;
    expect(table.rows.map((r) => r.teamName)).toEqual(["Arsenal", "Wolves"]);
    expect(table.rows[0]).not.toHaveProperty("position");
    expect(table.label).toBe("Season not started");
  });

  it("in-season table ranks by net points and keeps positions", () => {
    const table = buildOfficialTable([
      row("Arsenal", { played: 3, won: 3, points: 9, goalsFor: 7, goalsAgainst: 2 }),
      row("Wolves", { played: 3, won: 1, points: 3, goalsFor: 3, goalsAgainst: 5 })
    ]);
    expect(table.state).toBe("in-progress");
    if (table.state !== "in-progress") return;
    expect(table.rows[0]).toMatchObject({ teamName: "Arsenal", position: 1 });
  });

  it("carries a points deduction annotation without inventing points", () => {
    const table = buildOfficialTable([
      row("Everton", { played: 10, won: 6, points: 12, pointsAdjustment: -6, adjustmentNote: "points deduction" }),
      row("Arsenal", { played: 10, won: 5, points: 15 })
    ]);
    expect(table.state).toBe("in-progress");
    if (table.state !== "in-progress") return;
    const everton = table.rows.find((r) => r.teamName === "Everton");
    expect(everton?.pointsAdjustment).toBe(-6);
    expect(everton?.position).toBe(2); // net points rank, annotation is display-only
  });

  it("classifies provider-table freshness honestly", () => {
    const now = new Date("2026-08-09T12:00:00Z");
    expect(classifyTableFreshness("2026-08-09T11:00:00Z", now).status).toBe("current");
    expect(classifyTableFreshness("2026-08-07T11:00:00Z", now).status).toBe("delayed");
    expect(classifyTableFreshness(null, now).status).toBe("unavailable");
  });
});

describe("the table page renders the official-table builder, not raw provider rows", () => {
  const page = readFileSync(join(process.cwd(), "src", "app", "predictions", "league", "[slug]", "table", "page.tsx"), "utf8");
  it("maps rows through buildOfficialTable and renders its output", () => {
    expect(page).toContain("toStandingRows");
    expect(page).toContain("officialTable.rows");
    expect(page).not.toMatch(/table\.rows\.map\(/); // raw rows no longer drive the tbody
  });
  it("shows freshness and keeps simulations out", () => {
    expect(page).toContain("classifyTableFreshness");
    expect(page).not.toMatch(/titleProbability|simulat/i);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run src/test/official-standings.test.ts`.
- [ ] **Step 3: Implement.**
  - `tableState.ts`: add the two optional fields to `StandingRow`; thread them through both row-mapping branches (spread `...row` already carries them — verify); add `classifyTableFreshness` (24 h threshold constant `TABLE_FRESHNESS_MS = 24 * 3600_000`, notes: current → null, delayed → "Provider standings have not refreshed for over 24 hours.", unavailable → "No update time is available for this table.").
  - `leagueStandings.ts`: add `pointsAdjustment?: number | null; adjustmentNote?: string | null` to `LeagueStandingRow`; export `toStandingRows(table)` mapping `wins→won, draws→drawn, losses→lost` and passing the annotation fields.
  - Table page: build `officialTable = buildOfficialTable(toStandingRows(table), { verifiedAt: table.updatedAt })`; render `officialTable.rows` in the tbody (pre-season: "—" position, no zones; in-progress: `row.position`); render the builder's `label`/`note`; deduction cell: when `pointsAdjustment` render `<small>({pointsAdjustment} pts: {adjustmentNote})</small>` after points; freshness badge from `classifyTableFreshness(table.updatedAt)` next to the Updated line; keep the movement arrow only when the raw row is found by teamId (map by id).
  - Match page: wrap the `homeStanding`/`awayStanding` "Nth · N pts" display in a pre-season guard — compute `matchesPlayed` over `match.leagueTable.rows`; when 0, render "Season not started" instead of a rank.
- [ ] **Step 4: Run** the new test + `npx vitest run src/test/discovery-curation.test.ts src/test/league-table-identity.test.ts src/test/prohibited-contradictions.test.tsx` → PASS (fix `league-table-identity` string expectations if the tbody changed markers it asserts).
- [ ] **Step 5: Commit** — `feat(standings): render the official-table builder — pre-season neutrality, deductions, freshness`

---

### Task 2: Entity reads module + fixtures index migration (correction-aware)

**Files:**
- Create: `src/lib/entities/entityReads.ts`, `supabase/migrations/20260809120000_entity_read_indexes.sql`
- Test: `src/test/entity-reads.test.ts`

**Interfaces (produces):**
```ts
export type EntityFixture = {
  fixtureId: string;            // external id (canonical fixture identity)
  sport: "football" | "basketball" | "tennis";
  leagueExternalId: string | null;
  leagueName: string | null;
  country: string | null;
  season: string | null;
  kickoffAt: string;
  status: string;
  homeTeamId: string; homeTeamName: string;
  awayTeamId: string; awayTeamName: string;
  homeScore: number | null; awayScore: number | null;
  scoreSource: "verified-result" | "provider" | null;   // correction-aware
  hasModelCoverage: boolean;
};
export type CompetitionFixtures = {
  availability: "live" | "unavailable";
  upcoming: EntityFixture[]; liveNow: EntityFixture[]; results: EntityFixture[];
};
export function applyCurrentResult(fixture: EntityFixture, result: { isCurrent: boolean; verificationState: string; homeScore: number | null; awayScore: number | null } | null): EntityFixture;
export async function readCompetitionFixtures(leagueExternalId: string, { now?, client? }): Promise<CompetitionFixtures>;
export async function readTeamFixtures(teamExternalId: string, { now?, client? }): Promise<CompetitionFixtures & { teamName: string | null }>;
export function deriveFormFromResults(teamExternalId: string, results: EntityFixture[], limit = 5): Array<"W" | "D" | "L">;
```
- `readCompetitionFixtures`: service client (`getSupabaseServerClient`), three bounded queries on `op_fixtures` (`league_external_id` eq; upcoming = `status in scheduled` kickoff now→+14 d asc limit 30; live = `status eq live` limit 20; results = `status in finished,abandoned` kickoff −14 d→now desc limit 30). Coverage: one `op_fixture_decision_summaries` select `.in("fixture_external_id", ids).is("superseded_by", null)` marking `hasModelCoverage`. Corrections: one `op_fixture_results` select of current rows `.in("fixture_id", dbIds)` mapped through `applyCurrentResult` — a current row (regulation or full score) replaces provider scores and stamps `scoreSource: "verified-result"`; provider scores stamp `"provider"`.
- `readTeamFixtures`: two indexed queries (home eq, away eq) per window, merged + deduped by fixtureId, same coverage/correction joins; team name from `op_teams` by external id.
- Failures → `availability: "unavailable"` with empty arrays (never zeros-as-truth).

Migration (both filters the module uses; `op_fixtures` has home/away+kickoff indexes already):
```sql
create index if not exists op_fixtures_league_kickoff_idx
  on public.op_fixtures (league_external_id, kickoff_at desc);
create index if not exists op_fixtures_league_status_idx
  on public.op_fixtures (league_external_id, status);
```

- [ ] **Step 1: Failing tests** — pure parts first: `applyCurrentResult` (current verified row overrides provider score and sets `scoreSource: "verified-result"`; non-current/absent row leaves provider score with `"provider"`; a superseded→current correction propagates the NEW score — this is the **result-correction propagation** test), `deriveFormFromResults` (W/D/L from the team's perspective, newest first, caps at limit, skips fixtures without scores). Mocked-client tests for `readCompetitionFixtures` following the chainable-mock convention in `src/test/community-moderation.test.ts` (`vi.mock("@/lib/supabase/server")`), asserting the queries filter by `league_external_id` and that coverage flags map by external id. SQL-literal test that the migration file contains both index names.
- [ ] **Step 2: FAIL** → **Step 3: implement** → **Step 4: PASS**.
- [ ] **Step 5: Commit** — `feat(entities): correction-aware competition/team fixture reads + supporting indexes`

---

### Task 3: Sport adapters (honest section availability)

**Files:**
- Create: `src/lib/entities/sportSections.ts`
- Test: `src/test/sport-adapters.test.ts`

**Interfaces (produces):**
```ts
export type EntitySectionKey =
  | "table" | "fixtures" | "results" | "form" | "goals" | "efficiency"
  | "squad" | "roster" | "projection" | "surface_ratings" | "tournament_draw" | "head_to_head";
export type SectionSupport = { key: EntitySectionKey; supported: boolean; note: string | null };
export function competitionSections(sport: "football" | "basketball" | "tennis"): SectionSupport[];
export function teamSections(sport: "football" | "basketball" | "tennis"): SectionSupport[];
export function playerSections(sport: "football" | "basketball" | "tennis"): SectionSupport[];
```
Encodes the spec's per-sport lists against what the data layer actually has: football — table ✓, fixtures ✓, goals/form ✓, squad ✗ ("Squad and availability need a dedicated provider feed; OddsPadi does not show a squad it cannot verify."), projection ✓ (Premier League baseline only, linked not embedded); basketball — standings ✗ ("No approved basketball standings source is wired yet."), schedule ✓, efficiency ✓ (from `ratingEvidence` pace/off/def when present), roster ✗, projection ✗ (coverage-queue note); tennis — player ✓, surface ratings ✓ (historical corpus), tournament draw ✗, form ✓, head-to-head ✓ with the mandatory small-sample warning note. Unsupported sections must carry a non-null `note` — pages render the note, never an empty fabricated section.

- [ ] Steps: failing test (every key present per sport; every unsupported entry has a note; football squad unsupported; tennis H2H note mentions sample) → implement → pass → commit `feat(entities): sport adapters declare honest section support`.

---

### Task 4: Competition hub page `/predictions/league/[slug]`

**Files:**
- Create: `src/app/predictions/league/[slug]/page.tsx`, `src/components/entities/EntityFixtureList.tsx`
- Modify: `docs/route-map.md`, `src/app/sitemap.ts` (hub entries, priority 0.7), `src/app/predictions/league/[slug]/table/page.tsx` (link up to the hub), `src/app/explore/page.tsx` only if its league links should point at the hub (they should)
- Test: `src/test/competition-hub.test.ts`

**Sections** (in order, each honest-empty rather than fabricated): compact official table (top 6 via Task 1 plumbing + "Full official table" link + freshness); live now; upcoming fixtures (model-covered flagged "Model coverage", linking `/predictions/${id}`); recent results (correction-aware scores, `scoreSource` note when verified); form snapshot (from table rows' `form` string, in-season only); top teams (top 3 of in-progress table only — never pre-season); official publications + OddsPadi historical performance for this competition (sweep `readOfficialPublicationsInWindow` last 180 d, in-memory filter `competition === league.name || competition === league.leagueName`, `summarisePublications`, link `/track-record?competition=${encodeURIComponent(league.name)}`); season outlook (premier-league only: link + revision line to `/season-outlooks`; others: coverage-queue status if listed, else "No season outlook is published for this competition."); news (latest 3 sport-matching stories, labelled "From the news desk — not competition-specific" unless title/excerpt contains the league name); community (`CommunitySubjectPanel subjectType="competition" subjectId={league.slug}`).

`EntityFixtureList` renders `EntityFixture[]` rows: kickoff via `LocalTimeText`, both team names linking `/predictions/team/${encodeURIComponent(teamId)}`, fixture link `/predictions/${encodeURIComponent(fixtureId)}`, scores when present, "Model coverage" chip, and a hidden `SurfaceClaimMarker` per row with `{ surface: "competition", fixtureId, status, score, asOf }` claim.

Metadata: `pageMetadata({ title: `${league.name} hub`, path: `/predictions/league/${league.slug}` , ...})`; unknown slug → `robots:{index:false,follow:false}` + `notFound()`. `dynamic = "force-dynamic"`.

- [ ] Steps: failing source-scan tests (hub file exists; contains `CommunitySubjectPanel`, `readCompetitionFixtures`, `summarisePublications`, `/track-record?competition=`, `SurfaceClaimMarker`; sitemap contains `/predictions/league/${league.slug}` hub entries; route-map row added; table page links the hub) + a mocked render test of `EntityFixtureList` (team links encoded, claim markers present) → implement → run new test + `route-canonical-contract` + `product-shell-contract` + `product-navigation` + `dynamic-link-encoding` + `page-metadata-seo` → commit `feat(entities): competition intelligence hub`.

---

### Task 5: Team pages `/predictions/team/[teamId]`

**Files:**
- Create: `src/app/predictions/team/[teamId]/page.tsx`
- Modify: `src/test/product-shell-contract.test.tsx` CONCRETE (`.replace("[teamId]", "api-football-33")`), `docs/route-map.md`, `src/lib/discovery/searchCatalogue.ts` (`teamEntities` now routes to `/predictions/team/${encodeURIComponent(id)}` when the row has a real external id — update its header comment), `src/app/predictions/[matchId]/page.tsx` (team names in the header/form sections link to team pages)
- Test: `src/test/team-page.test.ts`

Identity: `[teamId]` is the URL-encoded team external id (`api-football:33` encodes to `api-football%3A33`; also accept the `api-football-33` dash form by trying both on lookup, mirroring the matchId decode convention). Lookup `op_teams` by `external_id` (service client). Unknown → noindex fallback metadata + `notFound()`.

Sections via `teamSections(sport)`: upcoming fixtures + results (`readTeamFixtures`), derived form chips (`deriveFormFromResults`), table position (resolve league of the most recent fixture → `resolveVerifiedLeagueTable` → `buildOfficialTable` → position or "Season not started"), official picks involving the team (publications window sweep filtered by the team's fixture external ids, receipt links), squad/availability honest-absence note (football/basketball), news (sport-matching, labelled), community (`CommunitySubjectPanel subjectType="team" subjectId={teamExternalId}`), `FollowTeamButton`.

Indexability: `generateMetadata` — durable-data gate = team found AND (upcoming.length + results.length) > 0; otherwise `robots: { index: false, follow: true }`. Not added to the sitemap (linked crawl only — no mass indexing).

- [ ] Steps: failing tests (source-scan: page exists, uses `readTeamFixtures`, `teamSections`, `CommunitySubjectPanel`, `FollowTeamButton`, contains `index: false` gate; CONCRETE updated; match page links `/predictions/team/`; searchCatalogue routes teams to the new page and its "no team page" comment is gone) → implement → run new + contract suites → commit `feat(entities): team pages with durable-data indexability gate`.

---

### Task 6: Player pages `/predictions/player/[playerId]` (tennis-backed, thin-page-safe)

**Files:**
- Create: `src/app/predictions/player/[playerId]/page.tsx`
- Modify: `src/test/product-shell-contract.test.tsx` CONCRETE (`.replace("[playerId]", "api-tennis-501")`), `docs/route-map.md`
- Test: `src/test/player-page.test.ts`

Tennis players are `op_teams` rows under `api-tennis:`; other sports have no player entities — a non-tennis id renders the honest "No durable player data" panel with `notFound()` only for unknown ids. Sections via `playerSections("tennis")`: recent matches + upcoming (via `readTeamFixtures` — player keys live in the team columns), surface ratings from `loadHistoricalTennisStrength` (overall + per-surface `modelRating` with `sampleSize`, each row carrying "small sample" copy when `sampleSize < 20`), derived form, H2H note (rendered on match pages with sample warnings — link, not a fabricated table), news (sport-matching, labelled), community (`CommunitySubjectPanel subjectType="player" subjectId={playerExternalId}`).

**Thin-page rule:** `generateMetadata` indexable ONLY when player found AND stored matches ≥ 5 AND a surface/overall rating exists; else `robots: { index: false, follow: true }`. Never in the sitemap.

- [ ] Steps: failing tests (source-scan: gate present — file contains the `matches.length >= 5` conditional and `index: false`; uses `loadHistoricalTennisStrength`, sample-warning copy string "small sample"; CONCRETE updated; route-map row) → implement → run new + contract suites → commit `feat(entities): tennis player pages, noindex unless durable data`.

---

### Task 7: Versioned season outlooks

**Files:**
- Modify: `src/lib/sports/prediction/seasonOutlooks.ts`, `src/app/season-outlooks/page.tsx`
- Test: extend `src/test/season-outlooks.test.ts`

Add to `premierLeague2026Baseline` (keeping every existing field):
```ts
includedFactors: ["2025/26 returning-team results", "points-per-game strength", "goal-difference strength", "season-level volatility"],
missingFactors: ["promoted-team strength", "transfers", "injuries", "manager effects", "schedule strength", "opening prices"],
nextRevisionTrigger: "Calibrated Championship strength for the three promoted clubs, or any confirmed first-team transfer materially changing a returning club's rating.",
structuralTreatment: "returning-team-baseline" as const,   // promoted teams: separate research object, ranking withheld
correctionHistory: [
  { revision: 4, publishedAt: "2026-07-16", change: "Refreshed manager-change log; no probability change." },
  { revision: 3, publishedAt: "2026-07-15", change: "Initial public baseline with promoted clubs excluded." }
]
```
Page: render a "Versioned outlook" panel (competition, season, evidence cutoff `sourceAsOf`, evidence checked, model, simulations, publication date, revision, next revision trigger, correction history list); explicit included/missing factor chips; a standing "This is a research baseline, not a final ranking — the complete league ranking is withheld until promoted clubs are modelled." line; and a direct link to the official table (`/predictions/league/premier-league/table`) labelled "Official table (separate from this simulation)".

- [ ] Steps: failing tests (incomplete outlook: `missingFactors` non-empty and rendered; `nextRevisionTrigger` present; `structuralTreatment === "returning-team-baseline"`; outlook revision: `correctionHistory[0].revision === revision`; page links the official table and contains the withheld-ranking sentence) → implement → run + `season-outlooks.test.ts` + `consumer-copy-integrity` → commit `feat(outlooks): versioned, evidence-dated outlook with structural promoted-team treatment`.

---

### Task 8: Internal-linking pass + structured data

**Files:**
- Modify: `src/components/odds/IntelligenceSlate.tsx` (league text → hub link when `leagueSlugFromProviderId(fixture.leagueId)` resolves), `src/app/predictions/[matchId]/page.tsx` (SportsEvent JSON-LD: `eventStatus` reflects status — Scheduled/EventPostponed/EventCancelled; team/organizer `url` fields to the new entity pages; "League hub" link beside the table link), `src/app/news/[slug]/page.tsx` (sport chip links `/predictions?sport=`), hub/table/outlook cross-links from Tasks 4/7 verified
- Test: `src/test/entity-linking.test.ts`

- [ ] Steps: failing source-scan tests (SlateFixtureCard contains `/predictions/league/` link with `encodeURIComponent`; match page contains `/predictions/team/`; match JSON-LD no longer hardcodes `EventScheduled` unconditionally; news story page links `/predictions?sport=`; outlook page links the official table — already from Task 7, assert here as the connective test) → implement → run new + `cross-surface-consistency` + `dynamic-link-encoding` + full contract suites → commit `feat(entities): canonical internal links + truthful SportsEvent status`.

---

### Task 9: Docs + full verification + closeout

**Files:**
- Create: `docs/competition-hubs.md` (sections, data sources, honest-empty rules, links), `docs/official-standings.md` (derivation, pre-season rules, deductions, freshness, correction propagation, what is NOT implemented: per-competition tiebreaks, basketball standings), `docs/season-outlooks.md` (versioning fields, structural treatments, separation from official table), `docs/team-and-player-pages.md` (identity scheme, section adapters, thin-page indexability gates)
- Modify: `docs/route-map.md` (verify all three routes), `docs/matchday-discovery.md` pointer if it references "no team page"

- [ ] Steps: write docs → `npm run build && npm run typecheck && npm test && git diff --check` → fix fallout → commit `docs(entities): competition hubs, official standings, season outlooks, team/player pages` → closeout report (migration `20260809120000` is a file-only handoff like the community ones).

---

## Self-review

- **Spec coverage:** competition hub sections → T4 (table/fixtures/live/results/form/top-teams/coverage/publications/performance/outlook/news/community); official table pre-season + in-season + deductions + postponed-abandoned (results window includes `abandoned`; standings never locally recomputed — documented) + no simulated points → T1/T9; outlook versioning fields + promoted-team structural treatment → T7; team pages → T5 (squad = honest-absence per adapter); player pages + thin rule → T6; sport adapters → T3; internal links (fixture→competition, fixture→team, competition→track-record filter, team/player→fixtures, outlook→table, news→entities via sport chips + existing fixture sources, community→canonical subject) → T4/T5/T6/T8; SEO canonical/structured data/index-gating → T4/T5/T6/T8; tests: pre-season zero (T1), in-season (T1), deduction (T1), promoted teams (T7), incomplete outlook (T7), outlook revision (T7), entity linking (T8), thin-page noindex (T6), sport adapters (T3), stale provider table (T1), result-correction propagation (T2); docs → T9.
- **Known deliberate scope:** basketball standings and tournament draws stay unsupported-with-note (no data source); per-competition tiebreak rules disclosed as not implemented; team pages excluded from sitemap by design.
- **Type consistency:** `EntityFixture`/`CompetitionFixtures` (T2) consumed by T4/T5/T6; `SectionSupport` (T3) consumed by T4/T5/T6; `toStandingRows`/`classifyTableFreshness` (T1) consumed by T4/T5.
