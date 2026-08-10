# Team and player pages

## Identity

- Team: `/predictions/team/[teamId]`, player: `/predictions/player/[playerId]`.
- `[teamId]`/`[playerId]` is the URL-encoded canonical external id
  (`api-football:33`, `api-tennis:501`); the dash form (`api-football-33`)
  is also accepted (last dash → colon). Lookup is `op_teams.external_id`;
  unknown ids are noindexed (`follow: false`) and 404 — never a soft-404.
- Tennis players are `op_teams` rows under `api-tennis:` (players ride the
  team columns on tennis fixtures). No player entities exist for football or
  basketball; those pages render the adapter's honest-absence note.

## Sections (driven by `src/lib/entities/sportSections.ts`)

Team pages: fixtures/results (`readTeamFixtures` — both home and away indexed
scans, deduped, correction-aware, model-coverage flagged), derived form
(`deriveFormFromResults`), table position (league of the most recent fixture →
`buildOfficialTable`; pre-season shows "Season not started", never a rank),
official picks involving the team (publication window sweep filtered by the
team's fixture ids, receipt links), squad/roster honest-absence notes, sport
news (labelled not-team-specific), community (`subjectType="team"`),
`FollowTeamButton`.

Player pages (tennis-backed): matches, form, per-surface ratings from
`loadHistoricalTennisStrength` resolved by `personNamesAlign` (each rating
shows its sample size; under 20 matches it carries "small sample — treat with
caution"), head-to-head as sample-warned context linking match pages (no
fabricated H2H table), tournament-draw absence note, community
(`subjectType="player"`).

## Thin-page indexability

- Team: indexable only when the team has at least one stored fixture
  (upcoming, live or result); otherwise `robots: { index: false, follow: true }`.
- Player: indexable only with **≥ 5 stored matches AND a corpus rating**;
  otherwise noindex. Neither page type enters the sitemap — they are crawled
  through links (match pages, hubs, search), so thin pages are never
  mass-indexed.

## Search

`/api/search` now carries canonical external ids for teams and fixture
external ids for fixtures; `searchCatalogue.teamEntities` routes id-bearing
teams to their team page (name-only rows keep the next-fixture fallback).

Tests: `src/test/team-page.test.ts`, `src/test/player-page.test.ts`,
`src/test/sport-adapters.test.ts`, `src/test/entity-reads.test.ts`,
`src/test/entity-linking.test.ts`.
