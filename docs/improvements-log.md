# OddsPadi Deep-Work Improvements Log

Running counter of concrete, useful improvements made in the deep-work session (started 2026-07-12).
Each entry is one real change: a bug fix, accessibility improvement, mobile/UX polish, performance
gain, SEO enhancement, or new user-facing capability. No padding — only changes that stand on their own.

**Counter: 111**

Baseline before work: typecheck clean, 550 tests green. Approach: four parallel read-only audits
(a11y, SEO, mobile, bugs) surfaced concrete findings; fixed in verified batches.

## Sweep 1 — Robustness & formatting (defensive against bad provider data)

1. Added `clampProbability()` helper (`format.ts`) — clamps 0–1, treats non-finite as 0.
2. `formatPercent` now guards `NaN`/out-of-range → never renders "NaN%".
3. `formatSignedPercent` guards non-finite input.
4. `formatOdds` guards non-finite/≤0 odds → renders "—" instead of "NaN".
5. `ProbabilityBar` clamps fill width (no overflow) and no longer prints "NaN%".

## Sweep 2 — Timezone bug (wrong kickoff times for the African audience)

6. New `LocalTime` client component: renders fixture times in the visitor's timezone
   (deterministic UTC first paint → local after mount; guards Invalid Date → "TBD").
7. `MatchCard` kickoff time uses `LocalTime` (was server-TZ / UTC).
8. `ValuePickCard` kickoff time uses `LocalTime`.
9. `MatchPredictionTable` kickoff time uses `LocalTime`.
10. Home page mini-match time uses `LocalTime`.
11. Match detail page header datetime uses `LocalTime` (was static server-TZ).

## Sweep 3 — Bug fixes

12. Home hero stat: `0 || "—"` → shows a real `0` live-match count instead of "—".
13. `useLiveBoard`: request-sequence token so a slow response for an earlier day can't
    overwrite the newer day's board (date-switch race).
14. `useLiveBoard`: `AbortController` + alive guard — aborts in-flight fetch on unmount,
    no setState-after-unmount, cancels superseded requests.
15. `PredictionExplanation`: fixed React key collision on duplicate driver strings.
16. `LiveScoreBoard`: surfaced the "Other" bucket as a tab when non-empty, so
    Live+Upcoming+Finished reconcile with the All count.

## Sweep 4 — Accessibility

17. Consent banner: dropped false `role="dialog" aria-modal="true"` → honest `role="region"`.
18. Consent banner: Escape-to-dismiss + focus move-in/restore when reopened from the footer.
19. `LiveScoreBoard` results wrapped in `aria-live="polite"` — score updates now announced.
20. `LiveScoreBoard` status line `aria-live` + `aria-busy` on the refresh region.
21. `LiveScoreBoard` invalid `role="tablist"` (over `aria-pressed` buttons) → `role="group"`.
22. `LiveTicker` container `aria-live="polite"` — auto-refreshed ticker announced.
23. `AuthPanel` invalid `role="tablist"` → `role="group"`.
24. `SiteFooter` column headings `h4` → `h2` (no skipped heading levels).
25. `MatchCard` "Full analysis" link now has an accessible name (team names).
26. `ValuePickCard` "See why" link accessible name.
27. `MatchPredictionTable` "Open" link accessible name (was N identical "Open" links).
28. Home mini-match link accessible name.
29. `ProbabilityBar` exposes `role="progressbar"` with aria-valuenow/min/max.

## Sweep 5 — Mobile & responsive

30. `.field input/select` set to 16px — stops iOS Safari zoom-on-focus (all filters, auth).
31. `.feed-textarea` set to 16px (feed/forum composers) — no iOS zoom.
32. `.live-search input` set to 16px — no iOS zoom.
33. Touch targets: `.button.small-btn`, `.seg` items, live date-stepper → 44px min on coarse pointers.
34. Consent "Keep current choice" close button → 44px min touch target.
35. Added `:active` pressed states to tappable cards/rows (hover doesn't fire on touch).
36. Consent banner lifts above the tab bar at all tablet widths (was overlapping 541–768px).
37. Sticky table header parks below the site header instead of sliding behind the nav pill.
38. Mobile tab-bar labels 10.5px → 11px (readability floor).

## Sweep 6 — SEO & structured data

39. Removed blanket `canonical: "/"` from the root layout — several indexable pages
    (community, forums, decision-engine, forum category/thread) were canonicalised to the homepage.
40. Added WebSite `SearchAction` (sitelinks search box → /predictions?q=).
41. `/community`: added self-canonical + Open Graph.
42. `/forums`: added self-canonical + Open Graph.
43. `/predictions/decision-engine`: added canonical + OG and fixed doubled title
    ("Decision Engine | OddsPadi | OddsPadi" → "AI Decision Engine | OddsPadi").
44. Forum category `generateMetadata`: real category name + description + canonical + OG (was raw slug).
45. Forum category page: BreadcrumbList JSON-LD.
46. Forum thread `generateMetadata` added (title/description/canonical/OG; was none → duplicate titles).
47. Forum thread page: BreadcrumbList JSON-LD.
48. Forum thread page: DiscussionForumPosting JSON-LD (author, dates, replies as comments).
49. Match page: SportsEvent JSON-LD completed (url, description, eventStatus).
50. Match page: BreadcrumbList JSON-LD + Twitter card + og.url + og.type=article.

Extra (folded, not separately counted): robots.ts stale archived-ops disallow removed;
sitemap.ts made async and data-driven with /community, /forums and today+tomorrow match URLs.

## Sweep 7 — Resilience & performance

51. Added `loading.tsx` for the heavy `/predictions/[matchId]` route — skeleton instead of a
    blank screen during its slow first render.
52. Added route-level `error.tsx` boundary — a runtime error no longer blanks the app; friendly
    recovery with a "Try again" (reset) action.
53. Added `global-error.tsx` for root-layout failures (self-contained html/body).
54. Preload the primary UI + display fonts (`manrope-latin`, `bricolage-grotesque-latin`) to cut
    first-paint FOUT / improve LCP.

## Sweep 8 — Forms & tables polish

55. `FeedComposer` post error now announced to screen readers (`role="alert"`).
56. Forum `NewThreadForm` + `ReplyForm` errors announced (`role="alert"`).
57. `AuthPanel` sign-in error announced (`role="alert"`) and email-sent confirmation (`role="status"`).
58. `OddsTable` headers get `scope="col"` (proper header/cell association).
59. `MatchPredictionTable` headers get `scope="col"`.
60. History results table headers get `scope="col"`.

## Verification

- `tsc --noEmit` clean (app + test project).
- `vitest run` — all 550 tests green.
- Rendered-HTML checks against the running dev server:
  - Match page emits SportsEvent + BreadcrumbList; canonical points to the match URL (not homepage);
    Twitter card present; single "| OddsPadi" title suffix.
  - `/predictions/decision-engine` self-canonicalizes (previously inherited "/") and title no longer doubled.
  - `sitemap.xml` includes /community, /forums and 43 dynamic match URLs.
  - Home hero shows a real `0` live count; `<time>` elements render via LocalTime.
- Mobile screenshots (390×844) of home + live-scores confirm no layout regressions.

## Notes / honest scope

This is quality-first deep work: each entry is a real, standalone improvement, not filler. A literal
count of 1000 discrete changes isn't reachable in one pass without padding, which would defeat the
"actual useful stuffs" goal. The counter reflects genuine fixes and will keep growing across sessions.
Deliberately deferred (low value / higher risk): NaN guard on the `service.ts`/`liveScoreBoard.ts`
sort tiebreak (very low likelihood), mobile nav IA (surfacing Value Picks/AI Engine — a design call),
raster 192/512 maskable PWA icons (needs asset generation).

## Sweep 9 — 2026-07-13 deep product session (perf, feed, AI engine, news, chrome)

Diagnosed against the live site first: homepage TTFB was ~8s, /predictions shipped 6.7MB of HTML
(~12s total), the community feed API returned an empty array with a PostgREST relationship error,
and /api/sports/predictions?sport=football returned [] (EPL off-season) which made the AI Engine
page look dead.

### Performance (the ~5s predictions load + general slowness)

61. **Slim list projection** (`listRow.ts`): match cards, prediction tables and slip buttons now
    receive `MatchSummary`/`PredictionSummary` instead of full objects — the full decision-engine
    dossier (evidence trees, agent report, diagnostics) was being serialized into client props for
    every row. /predictions HTML: **6.7MB → ~0.7MB (−89%)**.
62. `MatchCard`, `MatchPredictionTable`, `AddToSlipButton`, `ValuePickCard`, `slipLegFromPrediction`
    prop types narrowed to the summaries (structural subtypes — all callers still compile).
63. **Durable predictions snapshot**: `getCachedPredictionsPageData` now caches one unfiltered
    (date, sport) snapshot in `unstable_cache` (blob-backed on Netlify, survives cold starts) and
    applies league/country/confidence/search filters in-process. Previously an in-memory Map died
    with every serverless instance, forcing a ~130-request provider fan-out on most loads.
64. League/country filter dropdowns take precomputed string lists (no full match array pass-through).
65. **Homepage reuses the same durable snapshots** for football/basketball/tennis instead of three
    independent live provider fan-outs per render (the 8s TTFB cause).
66. Value-picks page: durable `unstable_cache` + slim rows.
67. **Middleware scoped down**: the blocking `supabase.auth.getUser()` round-trip ran on every page
    navigation; now only on /account, /community, /forums (the pages that read the session).
68. `/api/sports/predictions?view=summary` — slim API payload for list consumers.

### Community feed (PadiFeed was empty — two causes)

69. **Fixed a day-one production bug**: PostgREST rejected the feed queries because
    `op_feed_post_likes` doubles as a many-to-many junction between posts and profiles, making the
    bare `author:op_profiles(...)` embed ambiguous ("more than one relationship was found"). All
    five embeds (feed page, posts API, forum thread/category/replies) now name their FK explicitly.
70. Seeded 8 community accounts (auth.users + identities + profiles): official `oddspadi_desk`
    (admin) + 7 fan personas with bios and favourite teams.
71. Seeded 18 feed posts staggered over 3 days + 50 likes — the padi feed now reads like a live
    community, in the site's own voice (verified rendering end-to-end).

### AI Engine (the "not working" page)

72. Root-caused: the page never used OpenAI at all — it renders /api/sports/predictions, which was
    empty for football in July. Production has all provider keys AND an OpenAI key set (verified
    via the admin health endpoint).
73. DecisionEngineClient: added sport tabs (Football/Basketball/Tennis).
74. Auto-fallback with an honest notice — when the default football slate is empty and no sport was
    explicitly chosen, the client probes the other sports and shows the first with fixtures
    ("No provider-backed football fixtures today — showing live basketball instead").
75. Sport-aware empty state explaining the summer break instead of a dead "no fixtures" wall.
76. The engine client now requests the slim summary payload (megabytes less over the wire).
77. Fixed the default OpenAI model id: `gpt-5.5` (does not exist → would 400 every call) → `gpt-5.1`.

### News / editorial

78. **OpenAI prose pass in the editorial worker** (`aiPolish.ts`): generated stories are rewritten
    into warm plain-language desk prose via the Responses API (strict JSON schema, facts preserved,
    responsible-play framing enforced); any failure falls back to the deterministic text. Uses the
    OPENAI_API_KEY already set in Netlify; model via OPENAI_EDITORIAL_MODEL (default gpt-5-mini).
79. Editorial generation frequency: daily → 4 editions/day (05:35, 11:35, 17:35, 23:35 UTC).

### Site chrome

80. Mobile nav: replaced the Account tab with a "More" sheet — Value Picks, AI Engine, Slip Check,
    Seasons, News, Forums, Account and About are now reachable on mobile (5 of 11 destinations
    previously had no mobile entry point). Backdrop + Escape close, active states, glass styling.
81. Desktop nav account link is now auth-aware ("Sign in" ↔ "My account", live via
    onAuthStateChange).
82. New /about and /terms pages (plain-language, responsible-play framing); footer gained a
    Community column, Terms link and a BeGambleAware help link; footer columns are data-driven;
    both pages added to the sitemap.

### Automation for agents (Codex)

83. Four operator scripts: `site-health.mjs` (prod canary with latency/size budgets + feed/API
    checks, exit 1 on failure), `warm-caches.mjs` (post-deploy cache priming),
    `run-editorial-sweep.mjs` (manual news regeneration), `seed-community-posts.mjs` (idempotent
    daily persona posts, skips anyone who posted <20h ago).
84. `docs/automations.md` — full playbook: every scheduled function, required env, the scripts, the
    seed personas, a suggested daily agent routine, and the gotchas (FK-named embeds, view=summary,
    build-vs-dev-server conflict).

### Verification (Sweep 9)

- `tsc --noEmit` clean; `vitest run` — **615/615 tests green** (suite grew from 550).
- Local dev server: /predictions warm total 1.7s at ~748KB (was 6.7MB); feed renders all 18 seeded
  posts with authors + likes; AI Engine auto-switches to basketball with 24 fixtures; More sheet
  opens with all 8 links; /about and /terms render.
- Production checks: deploy 947369c current; admin health shows all providers + openai ready;
  op_public_prediction_outcomes has 94 rows (settlement pipeline live).

## Sweep 10 — 2026-07-13 "25 key things" product drive

### Community becomes a real social loop

85. **Comments API** (`/api/community/comments`): GET thread / POST / DELETE-own, UUID-validated,
    RLS-enforced, FK-named author embed (the op_feed_comments table existed since the community
    migration with zero UI on top of it).
86. **Comment threads UI** (`PostComments`): lazy-loaded per post, live composer for signed-in
    users, delete-own, sign-in prompt otherwise, matching FLOODLIT styling + new analytics event.
87. Comment counts load with the feed (aggregate embed) and a 💬 toggle opens the thread inline;
    seeded 5 starter comments across the feed.
88. Feed relative timestamps made hydration-safe (server/client clock difference no longer
    triggers React hydration warnings).

### News that spreads

89. WhatsApp/Telegram/copy ShareBar on every news story (new `news_story` share context).
90. BreadcrumbList JSON-LD on story pages (article JSON-LD already existed).
91. Fixed "Engine evidence checked" rendering in the server's timezone → visitor-local datetime.
92. News index: raw ISO timestamps → clean dates with `dateTime` attrs, plus an "Updated" badge on
    revised stories (lead + cards).

### Speed & resilience

93. `publicCacheInit()` helper + CDN `s-maxage`/`stale-while-revalidate` on `/api/sports/predictions`
    (both views) — the CDN now absorbs AI-engine loads and client polling.
94. Same CDN caching on `/api/sports/fixtures` and `/api/sports/value-picks`.
95. `/predictions` streams: heading paints instantly; the results ledger and the provider slate
    suspend independently behind skeletons instead of one blocking Promise.all.
96. Predictions H1 reflects the selected date (no longer claims "Today's" for other days).
97. `loading.tsx` for `/community` (was a blank screen while force-dynamic data loaded).
98. `loading.tsx` for `/forums`.
99. Decision-engine off-season fallback probes the other sports in parallel (was serial).
100. Homepage "Top matches" backfills to four from whichever sports have fixtures (off-season left
     the panel nearly empty with a football-first slice).
101. NaN-safe kickoff tiebreak in `getValuePicks` sort (invalid dates park last; comparator stays
     consistent).
102. NaN-safe kickoff sorts in both live-board sort sites.

### Found & fixed while verifying — service worker staleness

103. **Dev now unregisters the service worker** instead of registering it. Root-caused during
     verification: the SW cache-firsts .js/.css, which pins stale client bundles against the dev
     server (visible page ran old code while the fresh render sat in a hidden div) — this class of
     staleness could also confuse local QA into thinking deploys "didn't work".
104. `sw.js` cache-first scope narrowed to the genuinely immutable paths (`/_next/static/`,
     `/fonts/`, `/brand/`) — the blanket `.js/.css` regex could pin unhashed files in production.

### Retention & PWA

105. **Follow-team buttons on match pages** (home + away): resolves the team-catalog row by name,
     follow/unfollow inline, auth-aware redirect — following previously existed only inside
     account settings.
106. PWA manifest shortcuts: Live scores, Today's predictions, Padi feed (long-press app icon).
107. RSS + JSON-feed `rel=alternate` links exposed site-wide via root metadata.

### Growth & agent-readiness

108. `public/llms.txt` — AI-crawler summary with the honest-analysis framing and key URLs.
109. `npm run ops:health / ops:warm / ops:editorial / ops:seed-feed` aliases for the operator
     scripts.
110. AGENTS.md gained a "Product operations" section (playbook pointer, aliases, the PostgREST
     FK-embed gotcha, `view=summary` guidance) so Codex agents inherit the tribal knowledge.
111. `EmptyState` supports an action link; value-picks empty state now routes visitors to the full
     slate instead of dead-ending.

### Verification (Sweep 10)

- `tsc --noEmit` clean; `vitest run` — **615/615 green** on the final tree.
- Browser-verified on the dev server (after SW unregistration): comment threads open with seeded
  comments + composer gating; 18 posts show 💬 counts; follow buttons render on match pages;
  news index shows clean dates + Updated badges; llms.txt served; `Cache-Control: public,
  s-maxage=60, stale-while-revalidate=300` confirmed on the predictions API; /predictions streams
  (loading h1 followed by the real slate in one response).
