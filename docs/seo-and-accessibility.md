# SEO and accessibility

Two contracts a redesign or a new route can silently break, so both are pinned
by tests rather than convention.

## SEO / crawl hygiene

Enforced by `src/test/sitemap-hygiene.test.ts` against the real `sitemap` and
`robots` route handlers (sports + editorial reads mocked so the assertions are
about structure, not data).

- **Private and thin routes never enter the sitemap.** The NOINDEX set —
  operator, API, workspace, and thin-entity routes — is kept in sync with
  `route-canonical-contract`'s NOINDEX list; the test asserts none of those
  prefixes appear as sitemap paths and that each is `Disallow`ed in robots.
- **The public spine is present.** `/` and `/track-record` must appear — a
  sitemap that quietly drops the homepage is a regression the test catches.
- **Breadcrumbs start at Home.** Any page emitting `BreadcrumbList` JSON-LD must
  start at `position: 1, name: "Home"`. A breadcrumb that starts mid-tree
  misreports the page's place to search engines.
- **`SportsEvent` structured data is emitted only from the match page**, which
  guards on a real fixture (`notFound()` when absent). Structured data that
  claims an event exists must be backed by a fixture that exists — no
  `SportsEvent` on a listing or a hub, where the "event" would be a projection.

Related, enforced elsewhere: `robots`/`x-robots` on thin entity hubs
(`entity-hub` noindex gates), canonical URLs (`route-canonical-contract`), and
the projection freshness that keeps a crawled page from serving a stale zero.

## Accessibility

Enforced by `src/test/accessibility-contract.test.ts` — a **source-level** gate,
because CI has no browser DOM. It pins the matchday interactions a regression
would most easily break:

- **Live scores announce once, politely.** `ScoreAnnouncer` is the single
  `aria-live="polite"`, `aria-atomic="true"`, `role="status"`, `sr-only`
  region — score changes route through it instead of each card shouting.
- **Reduced motion is honoured.** `globals.css` neutralises animation and
  transition duration and forces `scroll-behavior: auto` under
  `prefers-reduced-motion: reduce`.
- **Touch targets meet 44px.** `.button` carries `min-height: 44px` and
  `touch-action: manipulation`.
- **Loading/error states carry a role.** The odds `EmptyState` announces via a
  live region; the `ModerationQueue` surfaces errors via `role="alert"`/`status`.
- **Icon-only controls have accessible names.** The community feed's like and
  comment buttons carry an `aria-label` — an emoji-only control ("♥ 5") reads as
  "black heart 5" to a screen reader otherwise. This gate caught, and drove the
  fix for, exactly that gap on the feed buttons.

It complements `live-board-accessibility.test.ts`.

### The documented gap: no real-DOM axe run

CI has no browser, so there is no `axe` sweep of a rendered, hydrated page. The
source-level contract above catches the specific regressions it names but cannot
catch, e.g., a computed colour-contrast failure or a focus-order problem that
only exists in the assembled DOM. Closing this needs a headless-browser job
(Playwright + `@axe-core`) rendering the deterministic worlds the cross-surface
suite already builds — the fixtures exist; the browser job does not. Until then,
this gap is stated here rather than implied to be covered.
