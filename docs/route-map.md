# Route map — before and after v1.7

Every route that existed before the consolidation, where it lives now, and how
it is reached. **No route was deleted.** "Surface" is the top-level destination
that owns it in the unified product; deep URLs stay canonical for their content.

Legend: `nav` = linked from top-level navigation, `hub` = linked from a surface
hub page, `ctx` = reached contextually (from fixture/competition/article), `SEO`
= kept public and indexable.

| Existing route | Status after v1.7 | Surface | Reached via | Public | Redirect | Data source | Main component |
|---|---|---|---|---|---|---|---|
| `/` | **Today hub** (unchanged URL) | Today | nav | SEO | — | daily tips product + homepage summaries | `page.tsx` + IntelligenceSlate |
| `/explore` | **new** Explore hub | Explore | nav | SEO | — | composes existing reads | `explore/page.tsx` |
| `/my` | **new** My Padi hub | My Padi | nav | noindex | — | localStorage + account APIs | `my/page.tsx` |
| `/track-record` | **new** Track Record hub | Track Record | nav | SEO | — | outcomes + performance reads | `track-record/page.tsx` |
| `/predictions` | canonical fixture browser | Explore | nav ("Explore" secondary row) + hub | SEO | — | stored slate | `predictions/page.tsx` |
| `/predictions/[matchId]` | **canonical fixture page** (unchanged) | Explore | ctx from every card | SEO | — | provider-backed match read | match page |
| `/predictions/today` | today's tips list | Today | hub (Today → "Full slate") | SEO | — | daily tips product | DailyTipsPageView |
| `/predictions/tomorrow` | tomorrow's tips list | Today | hub | SEO | — | daily tips product | DailyTipsPageView |
| `/predictions/week` | weekly radar | Explore | hub + More sheet | SEO | — | weekly product | week page |
| `/predictions/value-picks` | published value picks | Track Record | hub | SEO | — | published picks read | value-picks page |
| `/predictions/history` | public results ledger | Track Record | hub (primary content) | SEO | — | public outcomes | history page |
| `/predictions/decision-engine` | engine status (nerd area) | Track Record | hub | SEO | — | slate + gates + heartbeat | decision-engine page |
| `/predictions/bet-slip` | **Bet Workspace** | My Padi | nav chip + hub | SEO | — | localStorage slip | SlipCheckClient |
| `/predictions/league/[slug]/table` | competition table | Explore | hub + ctx from fixture | SEO | — | standings read | table page |
| `/live-scores` | live board | Explore | hub + Today "Live now" | SEO | — | live fixtures read | live-scores page |
| `/tips` | legacy alias (already 308s) | Today | — | — | → `/predictions/today` (`permanentRedirect` in `tips/page.tsx`) | — | — |
| `/season-outlooks` | season projections | Explore | hub + ctx from competition | SEO | — | outlook content | season-outlooks page |
| `/news` | sports desk + engine notes | Explore | hub + Today strip | SEO | — | editorial store | news page |
| `/news/[slug]` | article | Explore | ctx | SEO | — | editorial store | article page |
| `/engine/performance` | performance dashboard | Track Record | hub | SEO | — | outcomes analytics | performance page |
| `/community` | community feed | Explore | hub + ctx from fixture desk | SEO | — | community tables | community page |
| `/community/u/[handle]` | profile | Explore | ctx | SEO | — | community tables | profile page |
| `/forums` | forum index | Explore | hub + More sheet | SEO | — | community tables | forums page |
| `/forums/[category]` | category | Explore | ctx | SEO | — | community tables | category page |
| `/forums/[category]/[thread]` | thread | Explore | ctx | SEO | — | community tables | thread page |
| `/account` | account & profile settings | My Padi | hub | noindex | — | Supabase auth | account page |
| `/daily-double` | two-leg accumulator product | Today | footer + Today hub | SEO | — | calibrated bands + slate | daily-double page |
| `/about`, `/privacy`, `/terms` | unchanged | footer | footer | SEO | — | static | static pages |
| `/responsible-use` | responsible-use & support centre | footer | footer | SEO | — | static | responsible-use page |
| `/offline` | PWA fallback | — | service worker | noindex | — | static | offline page |

## Navigation before → after

**Before** (18 destinations across three menus):
- Desktop: Home, Tips, Predictions, Live Scores, Results, News, Engine
- Mobile tabs: Home, Tips, Live, Results
- More sheet: Weekly, Value Picks, Tables, Forums, News, Engine, Slip Check

**After** (4 destinations + workspace chip; deep links live in hubs and the
More sheet):
- Desktop: Today, Explore, Track Record, My Padi (+ slip count chip)
- Mobile tabs: Today, Explore, Track Record, My Padi
- More sheet (mobile reach for deep links): Live Scores, Today's Tips, Weekly,
  Tables, News, Forums, Engine, Slip

## Rules

1. New content types must pick a surface before they get a route.
2. Nothing may join top-level navigation without removing something else.
3. A route that presents fixture truth must render from the canonical reads
   listed in [product-architecture.md](product-architecture.md) — never a
   private re-derivation.
4. Retired aliases redirect permanently in `next.config.mjs`; nothing 404s.
