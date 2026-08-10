# Competition hubs

`/predictions/league/[slug]` is the intelligence hub for each prediction
league (25 leagues from `src/lib/sports/footballLeagues.ts`); the official
table keeps its own page at `/predictions/league/[slug]/table`.

## Sections and their data sources

| Section | Source | Honest-empty rule |
|---|---|---|
| Official table (top 6) | `resolveVerifiedLeagueTable` → `toStandingRows` → `buildOfficialTable` | builder's `unavailable` note; pre-season notice; freshness line |
| Live now / Upcoming / Results | `readCompetitionFixtures` (`src/lib/entities/entityReads.ts`) — op_fixtures by league id (both stored formats), model coverage from decision summaries, correction-aware scores | "could not be read — nothing substituted" vs "none scheduled" |
| Form / Top teams | in-progress official table rows only | suppressed pre-season |
| Official publications + performance | `readOfficialPublicationsInWindow` (180 d, sport) filtered in memory by competition name → `summarisePublications`; links `/track-record?competition=` | ledger-unreadable → no record shown |
| Season outlook | Premier League: link + revision line; others: `seasonCoverageQueue` status | "No season outlook is published" |
| News | `getNewsStories()` sport-filtered; labelled "not competition-specific" unless the league is named | "No football stories are published right now" |
| Community | `CommunitySubjectPanel subjectType="competition"` | honest empty state |

Every fixture row stamps a `SurfaceClaimMarker` (`surface: "competition"`), so
cross-surface reconciliation sees the hub. Simulated points never enter any
hub section; the outlook is linked as a separate research object.

Identity: the slug is canonical (`leagueBySlug`); unknown slugs are noindexed
and 404. Hubs are in the sitemap (priority 0.7). Note `op_publications.competition`
is free text with no index — the hub filters a windowed sweep in memory; a
`(competition)` index is the known follow-up if the window grows.
