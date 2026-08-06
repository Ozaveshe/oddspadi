# Route migration

The canonical routing table: where each route lives, what it returns, whether
it is indexable, which surface owns it, and which analytics event it emits.

`route-map.md` records the **before and after** of the v1.7 consolidation — what
moved and why. This file is the **operational contract**: the columns you need
when changing a redirect, debugging a canonical, or wiring an event.

## Legend

- **Code** — HTTP status the route itself returns. `308` is a permanent
  redirect; `200` is a page.
- **Index** — `SEO` indexable, `noindex` excluded but followable.
- **Surface** — the top-level destination that owns it, and highlights in the
  nav.
- **Legacy support** — an old URL that must keep resolving.
- **Analytics** — the event that actually fires, and the `page_context` it
  carries. Verified against `src/components/analytics/Analytics.tsx` on
  2026-08-03; this column records what exists, not what would be tidy.

## How analytics is actually wired

There are no per-route view events. `Analytics.tsx` matches the pathname and
emits one of a **four-step funnel** defined in
`CORE_ANALYTICS_FUNNEL` (`src/lib/analytics/events.ts`):

| Step | Event | Fires on |
|---|---|---|
| land | `site_landed` | `/` |
| view_predictions | `predictions_viewed` | `/predictions*` |
| open_match_detail | `match_detail_opened` | `/predictions/[matchId]` |
| action | `share_clicked`, `betslip_pick_added`, `team_followed`, `outbound_link_clicked`, `affiliate_outbound_clicked` | anywhere |

Routes the funnel does not name emit **`surface_viewed`**, carrying a
`page_context` of the owning surface (`today`, `explore`, `track_record`,
`my_padi`) and a `surface_route`. One event per navigation, gated on consent
like every other. Surface ownership comes from
`src/lib/navigation/surfaces.ts`, the same map the nav uses for active-state
highlighting, so a view cannot report one surface while the nav highlights
another.

## Table

| Route | Canonical | Code | Index | Surface | Legacy support | Analytics |
|---|---|---|---|---|---|---|
| `/` | `/` | 200 | SEO | Today | — | `site_landed` (`home`) |
| `/explore` | `/explore` | 200 | SEO | Explore | — | `surface_viewed` (`explore`) |
| `/track-record` | `/track-record` | 200 | SEO | Track Record | — | `surface_viewed` (`track_record`) |
| `/my` | `/my` | 200 | noindex | My Padi | — | `surface_viewed` (`my_padi`) |
| `/tips` | `/predictions/today` | **308** | noindex | Explore | **yes** — pre-v1.7 alias | none (redirects before render) |
| `/predictions` | `/predictions` | 200 | SEO | Explore | — | `predictions_viewed` |
| `/predictions/[matchId]` | `/predictions/[matchId]` | 200 | SEO | Explore | — | `match_detail_opened` (+ `match_id`) |
| `/predictions/today` | `/predictions/today` | 200 | SEO | Explore | — | `predictions_viewed` |
| `/predictions/tomorrow` | `/predictions/tomorrow` | 200 | SEO | Explore | — | `predictions_viewed` |
| `/predictions/week` | `/predictions/week` | 200 | SEO | Explore | — | `predictions_viewed` |
| `/predictions/value-picks` | `/predictions/value-picks` | 200 | SEO | Track Record | — | `predictions_viewed` |
| `/predictions/history` | `/predictions/history` | 200 | SEO | Track Record | — | `predictions_viewed` |
| `/predictions/decision-engine` | `/predictions/decision-engine` | 200 | SEO | Track Record | — | `predictions_viewed` |
| `/predictions/bet-slip` | `/predictions/bet-slip` | 200 | SEO | My Padi | — | `predictions_viewed`; `betslip_pick_added` on action |
| `/predictions/league/[slug]/table` | same | 200 | SEO | Explore | — | `predictions_viewed` |
| `/daily-double` | `/daily-double` | 200 | SEO | Today | — | `surface_viewed` (`today`) |
| `/live-scores` | `/live-scores` | 200 | SEO | Explore | — | `surface_viewed` (`explore`) |
| `/news`, `/news/[slug]` | same | 200 | SEO | Explore | — | `surface_viewed` (`explore`) |
| `/season-outlooks` | `/season-outlooks` | 200 | SEO | Explore | — | `surface_viewed` (`explore`) |
| `/community`, `/community/u/[handle]` | same | 200 | SEO / noindex | Explore | — | `surface_viewed` (`explore`); `community_post_created`, `community_comment_posted` on action |
| `/forums`, `/forums/[category]`, `/forums/[category]/[thread]` | same | 200 | SEO | Explore | — | `surface_viewed` (`explore`); `forum_thread_created`, `forum_reply_created` on action |
| `/engine/performance` | `/engine/performance` | 200 | SEO | Track Record | — | `surface_viewed` (`track_record`) |
| `/account` | `/account` | 200 | noindex | My Padi | — | `surface_viewed` (`my_padi`); `account_auth_completed`, `account_signed_out` on action |
| `/about`, `/privacy`, `/terms` | same | 200 | SEO | footer | — | none |
| `/responsible-use` | `/responsible-use` | 200 | SEO | footer | — | none |
| `/offline` | — | 200 | noindex | — | — | — |

## Known gaps

Legal and utility routes (`/about`, `/privacy`, `/terms`, `/responsible-use`,
`/offline`) emit nothing. They sit outside the four surfaces —
`surfaceForPath()` returns null — so there is no surface to label them with,
and a footer page view is not a product question worth an event.

`/results` has never existed and is not linked from anywhere. It returns 404 by
design; it is listed here only because external audits have asked after it.

## Rules

**One canonical per page.** Every indexable route declares a self-referencing
canonical, either through `pageMetadata()` or an explicit `alternates` block.
Next merges metadata shallowly, so a page that sets only `title` inherits the
root layout's `openGraph` wholesale — including its `url`. Eleven routes once
advertised `og:url` as the homepage for exactly this reason.

**Permanent only where the destination is stable.** `/tips → /predictions/today`
is 308 because that destination is not moving. A 307 would tell crawlers `/tips`
is still canonical and leave it competing with its own destination.

**No chains.** A redirect must not target a route that also redirects. Tested.

**No duplicate indexable routes.** Two routes may not claim the same canonical.
Tested.

## Verifying against production

The shell and cache state were verified on 2026-08-03 with cache-busting query
strings and `Cache-Control: no-cache`. Worth repeating after any routing change,
because several routes are served from long-lived caches:

```bash
curl -sS -D- -o /dev/null -H 'Cache-Control: no-cache' \
  "https://oddspadi.com/engine/performance?cb=$(date +%s)"
```

Read `Age` and `Cache-Status`. Measured that day: `Age: 31831` (8.8 hours) on
`/engine/performance` with `Cache-Status: "Next.js"; hit; fwd=stale`, and
`Age: 227741` (2.6 days) on `/my` and `/predictions/bet-slip`. **A public audit
of this site can be up to ~2.6 days stale** — which is exactly how a report of
the pre-v1.7 navigation arrived days after the consolidation shipped.

## Tests

- `src/test/route-canonical-contract.test.ts` — canonicals, redirect codes,
  chains, duplicate canonicals, orphans, route-map coverage
- `src/test/product-shell-contract.test.tsx` — one shell on every route
- `src/test/product-navigation.test.ts` — surface ownership and hub links
- `src/test/navigation-context.test.ts` — carried `?sport=`/`?date=` and the shared surface map
