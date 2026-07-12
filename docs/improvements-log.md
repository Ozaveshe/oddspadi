# OddsPadi Deep-Work Improvements Log

Running counter of concrete, useful improvements made in the deep-work session (started 2026-07-12).
Each entry is one real change: a bug fix, accessibility improvement, mobile/UX polish, performance
gain, SEO enhancement, or new user-facing capability. No padding — only changes that stand on their own.

**Counter: 60**

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
