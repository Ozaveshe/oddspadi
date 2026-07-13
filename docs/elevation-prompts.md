# OddsPadi Elevation Prompts

Generated 2026-07-12 from a four-dimension deep repo audit (product surface, engineering/security,
growth/SEO/retention, data layer/prediction engine). Each prompt below is self-contained — paste it
into a fresh Claude Code session as-is. They are ordered by leverage: Tier 0 protects what exists,
Tiers 1–2 grow and retain the audience, Tiers 3–5 deepen the product, engine, and revenue.

Standing constraints that apply to every prompt (repeated inside each so they survive copy-paste):
- Verify with `npm run typecheck` and `npm test` (baseline ~550+ tests green).
- Never fabricate results or promise "sure odds" — honest empty states are a brand feature.
- Supabase project ref is `wncwtzqipnoqwmqlznqn` only (see AGENTS.md).
- Restyle via `globals.css` tokens; legacy class names (`panel`, `metric`, `badge`, `data-table`) are load-bearing.
- Don't touch `src/_archived/**`.

---

## Tier 0 — Protect what exists (do these before the next deploy)

### 0.1 Fix the `void` settlement rollback bug (CRITICAL)

> In the OddsPadi repo, the new migration `supabase/migrations/20260712175340_public_prediction_outcomes_projection.sql` has a latent data-integrity bug: the base table `op_prediction_outcomes` (migration `20260624085042_add_decision_learning_loop.sql`) allows `result IN ('pending','won','lost','push','void')` and the app writes `void` (`src/lib/sports/prediction/decisionOutcomes.ts` — `PredictionOutcomeResult` includes `void`), but the new public projection table `op_public_prediction_outcomes` has a CHECK allowing only `('pending','won','lost','push')`. The `private.sync_public_prediction_outcome()` AFTER trigger inserts `lower(new.result)` unfiltered — so the first voided market will raise a CHECK violation inside the trigger and **roll back the legitimate settlement write** to the base table. The backfill SELECT would also fail if any existing row is `void`.
>
> Fix it: either add `'void'` to the projection CHECK, or make the trigger map/skip `void` rows explicitly (decide which is right for a public track record — I'd include void as its own status so the ledger stays honest). Check whether this migration has already been applied to the live Supabase project (`wncwtzqipnoqwmqlznqn` — use the `supabase_oddspadi` MCP, verify `get_project_url` first per AGENTS.md); if applied, write a follow-up migration instead of editing the old one. Also confirm the read side (`src/lib/sports/prediction/history.ts`, `publicHistoryItemFromProjection`) and `/predictions/history` filters handle `void` sensibly. Add a unit test covering the void path in `src/test/public-results-ledger.test.ts`. Verify with `npm run typecheck` and `npm test`.

### 0.2 Harden the uncommitted diff, then commit it in clean pieces

> The OddsPadi working tree has a large uncommitted feature drop (multi-sport live board, public results ledger, news, season outlooks) plus earlier deep-work fixes. Before committing, fix these audited issues:
>
> 1. **Homepage provider-mode inconsistency + quota draw**: `src/app/page.tsx` calls `getValuePicks(date, "football", "live", "preview")` — the `"live"` third arg forces a real provider fetch on every render of a `force-dynamic` homepage, while the neighbouring prediction strips use preview mode. Decide one provenance for the homepage and make it consistent; if live is intended, add caching so the homepage isn't a recurring draw on the 75k/day API-Football budget.
> 2. **Dead cache knob**: `.env.example` declares `ODDSPADI_PUBLIC_HISTORY_CACHE_TTL_MS=900000` but nothing reads it. Wire it into `getPublicPredictionHistory()` (`src/lib/sports/prediction/history.ts`) as an in-memory TTL cache — that path currently does 1–2 uncached Supabase queries per hit across three force-dynamic surfaces (home, /predictions/history, /api/sports/history).
> 3. **Live-board fan-out**: in `src/lib/sports/liveScoreBoard.ts`, the new multi-sport wrapper lost top-level memoization, and `storedFixturesForDate()` (3 Supabase queries) runs uncached on every poll when providers return nothing. Add board-level caching/in-flight dedup mirroring what `fetchFootballLiveScoreBoard` already does, and cache the stored-fixtures fallback. Also remove or re-wire the now-unused `isRelevantForSchedule` guard.
> 4. **Line endings**: add a `.gitattributes` (`* text=auto eol=lf`) so the LF/CRLF churn doesn't pollute the commit.
> 5. **Tests**: add route-level tests for `src/app/api/community/{posts,threads,replies}/route.ts` (auth rejection, length caps, happy path) — they currently have zero coverage.
>
> Then propose a commit split that separates the feature drop from the deep-work fix batch (check `docs/improvements-log.md` for what the deep-work batch contains) and ask me to confirm before committing. Verify with `npm run typecheck` and `npm test`.

---

## Tier 1 — Growth engine (organic acquisition)

### 1.1 Programmatic SEO: league hubs, daily pages, country pages

> OddsPadi (Next.js 15 App Router) has zero programmatic SEO pages — league/country are only query params on `/predictions`, which is `force-dynamic` and not independently indexable. Build the core organic surface for a football-predictions site:
>
> 1. **League hubs** at `/predictions/league/[slug]` (e.g. `premier-league`, `la-liga`, `npfl`) — server-rendered fixture+prediction list for that league, league-specific intro copy, self-canonical, `generateMetadata`, BreadcrumbList + SportsEvent JSON-LD, and links into match pages. Drive the slug list from a single central league config (create one — league config is currently scattered across `liveScoreBoard.ts` `PRIORITY_LEAGUE_IDS`, `providerBackedProvider.ts` `configuredFootballLeagueIds()`, and env).
> 2. **Daily landing pages** `/predictions/today` and `/predictions/tomorrow` — stable URLs (canonical, not query-param) that render that day's predictions.
> 3. **Country pages** `/predictions/[country]` for at least nigeria, ghana, kenya, south-africa — the site already targets `en_NG` and boosts African leagues in the live board (`AFRICAN_COUNTRIES` in `liveScoreBoard.ts`).
> 4. Add all of these to `src/app/sitemap.ts` and cross-link them from `SiteNav`/`SiteFooter` and match pages.
> 5. Use ISR (`export const revalidate = 300` or similar) rather than `force-dynamic` so crawls don't hit the sports providers — there is currently no `revalidate` anywhere in the app.
>
> Existing patterns to reuse: `/predictions/page.tsx` for the list rendering, match page for JSON-LD style. Honest empty states when a league has no fixtures (no fabricated content — that's a brand rule). Verify with `npm run typecheck`, `npm test`, and rendered-HTML curl checks against the dev server (`.claude/launch.json` name `oddspadi-dev`, port 3031).

### 1.2 Caching/ISR strategy + per-match OG images

> OddsPadi renders almost every route `force-dynamic` with zero ISR — home, live-scores, value-picks, history, community, forums all SSR on every request and hit Supabase/sports providers each time. Design and implement a caching strategy:
>
> 1. Add sensible `revalidate` windows: `/predictions` and `/predictions/[matchId]` (60–300s), `/predictions/value-picks` (300s), `/predictions/history` (900s, matching `ODDSPADI_PUBLIC_HISTORY_CACHE_TTL_MS`), `/season-outlooks` and `/news` (hours). Keep `/live-scores` dynamic (its data is client-polled via `/api/live` which already has `s-maxage=30`). Keep community/forums/account dynamic (personalised).
> 2. Where a page mixes fresh and slow data, prefer cached page + client refresh over force-dynamic.
> 3. Add **per-match dynamic OG images**: an `opengraph-image.tsx` under `/predictions/[matchId]` rendering "Team A vs Team B — kickoff, model probabilities" in the FLOODLIT brand style (charcoal `#0a0e0c`, pitch-green `#26e07d`, Bricolage Grotesque). Shared match links currently all show the generic site card — this is a big CTR lever for the share features.
>
> Watch out: `npm run build` while the dev server runs corrupts `.next` — restart dev after builds. Verify TTFB improvement by timing repeated curls, and check the OG image renders via the dev server.

### 1.3 WhatsApp/Telegram share hooks (African market)

> OddsPadi has zero share affordances — no `navigator.share`, no WhatsApp/Telegram links anywhere — and its audience is African football fans where WhatsApp is the dominant share channel. Add a share layer:
>
> 1. A small `ShareBar` client component: WhatsApp deep link (`https://wa.me/?text=`), Telegram (`https://t.me/share/url`), copy-link, and native `navigator.share` where available. Style with existing tokens; keep it compact and unobtrusive.
> 2. Place it on: match prediction pages (`src/app/predictions/[matchId]/page.tsx`) with pre-filled text like "⚽ {home} vs {away} — OddsPadi says {pick} ({prob}%). Full analysis:" + URL; value-pick cards; the results-ledger page ("Our record: {accuracy}% on {n} settled picks").
> 3. Fire the existing analytics event pipeline (`src/lib/analytics/events.ts` — add a `share_clicked` event with channel + page context; note several declared events like `value_pick_clicked` are currently never fired, wire those while you're in there).
> 4. Never phrase share text as guaranteed wins — responsible-play voice is a brand rule ("your football padi", analysis not tips).
>
> Verify with `npm run typecheck`, `npm test`, and click-through on the dev server (port 3031, launch name `oddspadi-dev`).

---

## Tier 2 — Retention (reasons to come back)

### 2.1 Follow your team: functional favourites + personalised home

> OddsPadi's `op_profiles` table already has a `favourite_team` column but there is no UI to set it and nothing consumes it. Build the follow-a-team loop:
>
> 1. A profile editor on `/account` (display name, favourite team, bio — the columns exist; there is currently NO way to set any of them, usernames just fall back to email prefix). Favourite-team picker should search teams from the provider/`op_teams`.
> 2. A "followed teams" watchlist (new Supabase table + RLS mirroring the existing community-table patterns in `supabase/migrations/20260712050714_community_accounts_feed_forums.sql`; write a proper migration).
> 3. Consume it: a "Your teams" strip on the homepage and highlighted rows in `/live-scores` and `/predictions` when the visitor follows a team (signed-in only; graceful signed-out state pointing to /account).
> 4. Surface sign-in: `SiteNav.tsx` currently has NO account entry — desktop nav stops at News and the mobile tab bar has no Account. Add a sign-in/account affordance to both, and add /forums to nav or footer (it's currently only reachable from the /account card).
>
> Follow existing auth patterns (`src/components/community/AuthPanel.tsx`, `src/app/api/community/posts/route.ts` for RLS-backed writes). Verify with `npm run typecheck`, `npm test`, plus a manual signup→set-team→see-highlight flow on the dev server.

### 2.2 Community v2: make the built community usable and alive

> OddsPadi's community (feed + forums, Supabase-backed with correct RLS) is functional but hidden and bare. Elevate it:
>
> 1. **Likes**: the `op_feed_post_likes` table already exists in the schema but no UI uses it — add like/unlike on feed posts with optimistic UI and counts.
> 2. **Match-attached posts**: `POST /api/community/posts` already accepts a `matchId` but `FeedComposer` never sends one — add a match picker so posts can reference a fixture, rendering a compact match chip that links to the prediction page. Also add a "Discuss this match" entry point on match pages that pre-fills the composer.
> 3. **Pagination**: feed and threads are hard `limit(50)`/`limit(200)` — add cursor pagination ("Load more").
> 4. **Author profiles**: authors render as plain `@handle` text — add minimal public profile pages (`/community/u/[handle]`: display name, bio, favourite team, recent posts) with `noindex` until content quality warrants indexing.
> 5. **Basics**: post delete (own posts, RLS-enforced), and a password-reset flow in `AuthPanel` (currently email+password only with no recovery).
>
> Keep the existing validation/RLS patterns from `src/app/api/community/**`. Write route-level tests for every new endpoint. Verify with `npm run typecheck` and `npm test`.

### 2.3 PWA + web push for followed teams

> OddsPadi has a PWA manifest (`src/app/manifest.ts`) but no service worker, so it isn't truly installable and can't do push. Build it:
>
> 1. Add a service worker (offline shell + cache-first for fonts/static assets, network-first for data) and the raster 192/512 maskable icons the manifest needs (generate from the existing brand mark; this was previously deferred for lack of asset generation).
> 2. Web-push subscriptions (VAPID) stored in Supabase with RLS, an opt-in UI on /account gated on the followed-teams feature, and a Netlify scheduled function that sends kickoff-soon and full-time-result notifications for followed teams — follow the existing scheduled-function patterns in `netlify/functions/` (token-gated workers, `netlify.toml [functions]` cron registration).
> 3. Notification copy in brand voice, never "sure odds".
>
> This depends on the followed-teams table from the favourites prompt — build that first if it doesn't exist. Verify with `npm run typecheck`, `npm test`, and a Lighthouse PWA check against the dev server.

---

## Tier 3 — Product depth (fill the visible gaps)

### 3.1 Fill the "Coming soon" panels: real H2H and team news on match pages

> The OddsPadi match page (`src/app/predictions/[matchId]/page.tsx` ~line 246) ships "Coming soon" placeholders for **Head-to-head** and **Team news** — thin content on the money page. Replace both with real data:
>
> 1. **H2H**: API-Football has a `fixtures/headtohead` endpoint (the key is on the ultra plan, 75k req/day). Fetch last 5–10 meetings through the existing provider layer (`src/lib/sports/providers/providerBackedProvider.ts` — reuse its `fetchJson` timeout/cache/semaphore discipline, don't fetch raw), render recent meetings with scores and a small aggregate (wins/draws). Cache aggressively (H2H barely changes; hours-long TTL).
> 2. **Team news**: the provider layer already builds injury/suspension/lineup signals for enriched fixtures (`providerContextSignals`) — render them as human-readable team news (player names, reason, status) instead of leaving the panel empty. Honest fallback text when the fixture isn't enriched.
> 3. Emit the H2H as structured content the prediction explainer can reference.
>
> Mind the enrichment budget (`API_FOOTBALL_MAX_ENRICHED_FIXTURES` default 12) — H2H fetches should be lazy (on match-page render, not list render) and cached. Verify with `npm run typecheck`, `npm test`, and a rendered match page on the dev server.

### 3.2 League tables / standings pages

> OddsPadi has no standings anywhere, despite `op_standings_snapshots` existing in the schema and API-Football exposing a standings endpoint. Add `/predictions/league/[slug]/table` (or a Standings tab on the league hubs if those exist by now): position, played, W/D/L, GD, points, form string; movement highlighting; ISR with a few-hours revalidate; BreadcrumbList JSON-LD and sitemap entries. Fetch through the provider layer with its existing timeout/cache discipline. Link standings from league hubs, match pages (both teams' positions inline near the form guide), and the footer. Honest empty state for leagues without standings data. Verify with `npm run typecheck`, `npm test`, and rendered pages on the dev server.

### 3.3 Ship the accumulator: turn the bet-slip stub into Slip Check

> `/predictions/bet-slip` is a "coming soon" noindex stub, and the footer advertises it. Build the real thing as a client-side analysis tool (no betting, no payments — that positioning is deliberate, see `SiteFooter.tsx`):
>
> 1. "Add to slip" buttons on prediction cards/tables (`MatchCard`, `MatchPredictionTable`, value-pick cards) — slip state in localStorage, no account required.
> 2. The slip page computes: combined decimal odds, model-implied combined probability (product of model probs), the gap between them, per-leg weakest-link flagging, and an honest verdict in brand voice ("this 6-leg slip has a 4% model chance — the bookmaker is pricing it at 2%").
> 3. Fire the already-declared-but-never-fired `betslip_pick_added` analytics event (`src/lib/analytics/events.ts`).
> 4. Remove the `robots: noindex` once functional, add metadata + sitemap entry.
>
> Keep it dependency-free (React state + localStorage). Verify with `npm run typecheck`, `npm test`, and a full add-picks→view-slip flow on the dev server.

### 3.4 Make the track record a marketing asset

> OddsPadi's public results ledger (`/predictions/history`, `op_public_prediction_outcomes` projection) is its most differentiating trust feature — most prediction sites hide losses. Amplify it:
>
> 1. A compact "Our record" module (settled count, accuracy, ROI, last-10 form dots) rendered on the homepage and as a strip on `/predictions` and value-picks — sourced from `getHistorySummary` with the TTL cache.
> 2. Per-league and per-market accuracy breakdowns on the history page (the projection has league/market columns).
> 3. A `Dataset`/`ClaimReview`-appropriate JSON-LD treatment on the history page, plus self-canonical + OG metadata if missing.
> 4. Weekly auto-recap: a Netlify scheduled function that writes a "week in review" summary row (picks graded, hits, misses, best call) to a Supabase table, rendered on /news — this also solves news staleness (currently 3 hardcoded stories in `src/lib/editorial/news.ts`).
> 5. Never cherry-pick: always show losses alongside wins; the honest-empty-state rule applies.
>
> Verify with `npm run typecheck`, `npm test`, rendered checks on the dev server.

---

## Tier 4 — Engine quality (better probabilities → real edge)

### 4.1 Wire the dead signals: xG, home/away splits, form recency

> Audit findings on OddsPadi's football model (`src/lib/sports/prediction/footballModel.ts`): the xG blend (`xgBlendAdjustment`) is wired but **dead on the live path** — `homeForm.xgFor/xgAgainst` are only populated by training ingestion, never by the live provider (`providerBackedProvider.ts`), so the adjustment is always 0 in production. Also: form is a flat W/D/L list with no recency weighting, there are no home/away venue splits, home advantage is a global constant `1.11`, and injury impact is raw count-delta with no player weighting.
>
> Improve the served model in order of impact:
> 1. Populate `xgFor`/`xgAgainst` on the live path — API-Football's fixture statistics include xG on the ultra plan; aggregate recent-match xG during fixture enrichment (respect the existing enrichment budget and semaphore).
> 2. Add exponential recency weighting to form (`recentResults`) so last week counts more than six weeks ago.
> 3. Split form/goals by venue (home form for the home side, away form for the away side) where enough matches exist, falling back to blended.
> 4. Make home advantage league-configurable (African leagues and the EPL differ measurably) via the central league config.
>
> For each change: add unit tests demonstrating the adjustment moves probabilities in the right direction, and run any existing calibration/backtest harness you find under `src/lib/sports/prediction/` to compare before/after. Do NOT loosen the value-pick gate (`selectBestPick` in `odds.ts`) — better inputs, same discipline. Verify with `npm run typecheck` and `npm test`.

### 4.2 League expansion: predictions beyond the EPL

> OddsPadi currently predicts only league 39 (EPL) — `API_FOOTBALL_LEAGUE_IDS=39` gates `filterFootballFixtures` in `providerBackedProvider.ts`. Live scores already cover the world with African leagues boosted, but African fans get no predictions for their own leagues. Expand deliberately:
>
> 1. Create a central league registry (id, slug, name, country, tier, enrichment priority, home-advantage factor) unifying the three scattered configs (`PRIORITY_LEAGUE_IDS` in `liveScoreBoard.ts`, `configuredFootballLeagueIds()`, env parsing). Everything (prediction gate, analysis badges, league hubs, sitemap) should read from it.
> 2. Add the top-5 European leagues + NPFL (399), South African PSL (288), Egyptian Premier (233) — mind that model confidence for thin-history leagues will be lower (Elo/corpus coverage is thin there), which is fine: the data-quality → market-prior blending in `odds.ts` already hedges this, and the value gate will simply pass fewer picks. Verify that's what happens rather than garbage picks passing.
> 3. Raise `API_FOOTBALL_MAX_ENRICHED_FIXTURES` thoughtfully (hard cap 40) and estimate the daily request budget against the 75k/day quota — show me the math before changing env defaults. Also guard the footgun where an empty `API_FOOTBALL_LEAGUE_IDS` returns ALL fixtures unfiltered.
> 4. Add per-league accuracy to the public history page so quality per league is transparent.
>
> Verify with `npm run typecheck`, `npm test`, and a dev-server check that new-league fixtures appear with honest confidence labels.

### 4.3 Living newsroom: auto-generated editorial from engine data

> OddsPadi's `/news` section is 3 hardcoded stories in `src/lib/editorial/news.ts` that will go stale immediately. Replace with a self-refreshing editorial pipeline that writes stories FROM data the site already owns:
>
> 1. Story generators: weekend preview (top fixtures + model probabilities), results recap (from the settled ledger — wins AND losses), value-picks watch, and a "model vs market" piece (biggest disagreements). Each is a deterministic template over live data — no fabricated facts, cite the data source, date every revision (mirror the honesty pattern in `seasonOutlooks.ts`).
> 2. Store generated stories in a Supabase table (proper migration + RLS: anon read, service write) so they persist and the RSS/JSON feeds (`/news/rss.xml`, `/news/feed.json`) keep working.
> 3. A Netlify scheduled function that generates on a cadence (e.g. daily), following the existing token-gated worker pattern in `netlify/functions/`.
> 4. Keep `generateStaticParams`/ISR for article pages and NewsArticle JSON-LD.
>
> This compounds with SEO (fresh crawlable content) and the track-record marketing. Verify with `npm run typecheck`, `npm test`, and generated-story rendering on the dev server.

---

## Tier 5 — Measure and monetise

### 5.1 Close the analytics loop: wire dead events + define the funnel

> OddsPadi's analytics layer (`src/lib/analytics/events.ts`, `src/components/analytics/Analytics.tsx`) is privacy-forward and well built, but several declared events are never fired (`value_pick_clicked`, `betslip_pick_added`, others — grep each event name for emit sites) and no funnel is defined. Fix:
>
> 1. Wire every declared event to its real UI moment (value-pick card clicks, slip adds, share clicks if the ShareBar exists, follow-team, community like).
> 2. Define the core funnel in code + docs: land → view predictions → open match detail → (share | slip add | follow | outbound) and make sure each step has exactly one well-named event with consistent params (league, matchId, sport).
> 3. Add a short `docs/analytics-events.md` documenting every event, params, and where it fires — so future features keep the taxonomy.
> 4. Keep everything consent-gated exactly as it is (Consent Mode v2, GPC) — no new tracking before consent.
>
> Verify with `npm run typecheck`, `npm test`, and by watching events fire in the dev server console/beacon endpoint.

### 5.2 Bookmaker affiliate layer (the revenue foundation)

> OddsPadi shows odds as bare numbers — no bookmaker names, no outbound links, no affiliate infrastructure — and has no revenue path. Build the foundation without compromising the "analysis, not betting" trust positioning:
>
> 1. A `bookmakerLinks` config module (bookmaker id → display name, base URL, affiliate-tag env var, licensed-markets list by country) — env-driven so links only render when an affiliate tag is configured; bare numbers remain the fallback.
> 2. On the match `OddsTable` and value-pick cards: attribute the odds to the bookmaker (The Odds API responses include bookmaker keys — check what `src/lib/sports/prediction/odds.ts` / the provider layer preserves and thread it through if dropped) and add a clearly-labelled "View at {bookmaker}" outbound link with `rel="sponsored noopener"` and a dedicated `affiliate_outbound_clicked` analytics event.
> 3. Responsible-gambling framing: 18+ note and a visible responsible-play line near any affiliate link, consistent with the existing footer voice; never "bet now — guaranteed".
> 4. An `docs/affiliate-readiness.md` note on what's needed commercially (licensing per market: NG/GH/KE/ZA differ) so the code ships dormant until deals exist.
>
> Verify with `npm run typecheck`, `npm test`, and rendered odds attribution on the dev server with and without a configured affiliate tag.

---

## Suggested sequence

1. **0.1 → 0.2** (protect the ledger, ship the diff clean) — same day.
2. **1.1 + 1.2** (programmatic SEO + ISR/OG) — the acquisition engine; biggest compounding return.
3. **1.3 + 3.4** (share hooks + track-record marketing) — cheap, differentiating, African-market fit.
4. **2.1 → 2.2 → 2.3** (favourites → community v2 → push) — the retention ladder, in dependency order.
5. **3.1 + 3.2** (H2H/team news + standings) — money-page depth; feeds SEO too.
6. **4.1 → 4.2** (engine signals → league expansion) — quality before scale.
7. **4.3, 3.3, 5.1, 5.2** as capacity allows.
