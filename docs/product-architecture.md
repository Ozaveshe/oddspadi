# OddsPadi product architecture

*Adopted 2026-07-31 (v1.7 "One OddsPadi"). This document is the contract for how
surfaces relate; the route-level detail lives in [route-map.md](route-map.md).*

## The problem this architecture solves

OddsPadi's capabilities — fixtures, live scores, model predictions, value
analysis, slip analysis, season projections, news, public results, performance
analytics, community — grew as parallel features with their own pages, their
own navigation entries, and their own words for the same states. The product
read as several microsites. Nothing was wrong with the capabilities; what was
missing was a single spine for them to hang off.

## The spine: one event hierarchy

Every surface orbits the same chain, and every entity on it has exactly one
canonical identity:

```
Sport
└─ Competition                      (league slug; one table/outlook context)
   └─ Fixture                       (op_fixtures id — THE canonical identity)
      └─ Market                     (canonical market id, e.g. match_winner)
         └─ Model decision          (op_market_decisions row + publicStatus)
            └─ User selection       (slip leg / saved fixture — guest-first)
               └─ Live state        (same fixture id, live score feed)
                  └─ Final result   (home/away score on the same fixture)
                     └─ Settlement  (won/lost/push/void on the decision)
                        └─ Performance record (op_prediction_outcomes)
                           └─ Related discussion & content (community + news)
```

Rules that keep the spine honest:

1. **A fixture has one public page**: `/predictions/[matchId]`. Score, model
   probabilities, odds, decision status, lineups, head-to-head, community
   pulse, settlement and the historical model state all render there. No other
   page may present a *different version* of that match's truth — other
   surfaces show projections of the same reads and link back.
2. **Every reference uses the canonical fixture id** (`op_fixtures.id` /
   provider-prefixed external id). Community threads, slip legs, news
   references, settlement rows and live scores already key on it; anything new
   must too.
3. **A decision's words come from one vocabulary** —
   `src/lib/product/vocabulary.ts`. Pick / Lean / Watch / Pass / Withheld /
   Stale / Unavailable. No surface invents synonyms ("No prediction",
   "Provider gap", "Not generated" are banned by contract test).
4. **Settlement belongs to the decision that was published.** Track Record
   pages join outcomes back to the original decision rows; corrections are
   append-only and visible.

## The four product surfaces

Top-level navigation is exactly four destinations (plus the brand mark → Today):

| Surface | Route | Job |
|---|---|---|
| **Today** | `/` | The daily loop's front door: live now, next kickoffs, model coverage, published decisions or the honest "0 published" state, your saved fixtures, engine freshness, yesterday's record, latest news. |
| **Explore** | `/explore` | Every way to find a fixture: by sport, date, competition, live/upcoming/finished, model coverage, plus tables, season outlooks and news archives. |
| **My Padi** | `/my` | The visitor's own state: bet workspace (slip), saved fixtures, recently viewed, followed teams, alerts, account. Fully usable signed out — local storage first, account optional. |
| **Track Record** | `/track-record` | The accountability surface: published picks and their settlements, model performance, calibration, the seven promotion gates, methodology, corrections. |

Everything else remains reachable — as *content within* these surfaces, not as
competing top-level destinations. Deep routes keep their URLs (see route map);
the mobile "More" sheet lists the deep links for thumb reach.

## The primary journey

The product is built around this loop, and each step hands context to the next
because every step keys on the same fixture id:

1. **Discover** — Today (or Explore for anything beyond today).
2. **Open** the fixture's canonical page.
3. **Understand** — probabilities, evidence quality, odds, decision status in
   canonical vocabulary, lineups, head-to-head.
4. **Act** — add a market to the slip (guest, local), save the fixture, or pass.
5. **Follow** — the same page carries the live score; Today lists it under
   "Live now".
6. **Result** — same page shows the final score and each market's settlement.
7. **Review** — Track Record aggregates settled decisions into the performance
   ledger, which links back to fixtures.
8. **Continue** — competition table, season outlook, related news, community
   pulse — all one link away from the fixture, all carrying its identity.

## Mobile is the primary context

The tab bar carries the four surfaces. Fixture cards stay compact; market
actions are buttons, not hovers; critical status labels are text, not color
alone; diagnostics tables scroll inside their own container, never the page.
Anything that only works on a wide desktop analytics screen belongs on the
engine page, and even there must degrade to vertical stacking.

## Guest-first personalisation

No registration wall anywhere in the loop. Local mechanisms:

- Bet workspace: `oddspadi-bet-slip-v1` (existing).
- Saved fixtures: `oddspadi-saved-fixtures-v1` (v1.7).
- Recently viewed: `oddspadi-recent-fixtures-v1` (v1.7).
- Timezone: `oddspadi-timezone` (existing).

Accounts add cross-device follows, community identity and push alerts on top —
they never gate reading or the slip.

## Where the states come from

| State | Source of truth | Rendered by |
|---|---|---|
| Fixture status/score | `op_fixtures` | ScoreState components everywhere |
| Decision status | `DecisionSummary.publicStatus` | vocabulary.ts labels |
| Odds + freshness | `op_odds_snapshots` (24h stale rule) | OddsTable, DecisionPriceSignal |
| Settlement | `op_market_decisions.settlement_status` | match page + Track Record |
| Performance | `op_prediction_outcomes` | Track Record, gate board, homepage record |
| Engine freshness | `op_provider_ingestion_runs` | AutomationHeartbeatBoard, Today status line |

One reader per state; components must not re-derive these differently.
