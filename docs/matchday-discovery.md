# Matchday discovery

How Today, Explore and Live fit together.

*Ranking: [fixture-ranking.md](fixture-ranking.md).
Card: [fixture-card-system.md](fixture-card-system.md).
Transitions: [live-continuity.md](live-continuity.md).*

## The problem

Broad coverage across football, basketball and tennis is worth keeping. The
default experience being *dominated* by it is not. On a normal day most of the
catalogue is finished fixtures the model passed on, and they outnumber
everything a reader opened the site for.

Three surfaces, one system:

| Surface | Answers |
|---|---|
| **Today** | What matters now |
| **Explore** | Everything, filtered |
| **Live** | What is happening this minute |

All three render the same card and speak the same eight consumer states. That
is the point — three surfaces each building their own is how one fixture comes
to say "Pick" on one page and "Waiting for odds" on another.

## Today

Ranked, diversity-capped, and split so finished no-pick evidence does not sit
among fixtures a reader can still act on. Rails: live now, starting soon,
followed, top matches, Africa-relevant, official decisions, recently settled.

The rails complement rather than repeat — "top matches" excludes what is
already surfaced as live or personal.

## Explore

The full catalogue, with filters for sport, competition, country, date,
team/player, status, model coverage, official publication, watchlist, evidence
readiness, followed, and Africa relevance.

Nothing is removed from Explore. Everything Today holds back is reachable here,
and the "view all" path from a capped board lands in it.

## Live

Same fixture identity and route as scheduled and finished — see
[live-continuity.md](live-continuity.md). A fixture going live does not become
a new object with a new URL; it keeps its route, its saves and its pre-match
decision, and the decision is labelled historical rather than refreshed.

## Search

Unified across teams, players, competitions and fixtures, resolving to
canonical entities. Every result carries its kind and canonical id. A genuine
tie between two entities of the same kind is reported as ambiguous rather than
resolved silently — a reader landing on the wrong Arsenal while believing it is
the right one is worse than being asked which.

## Performance

Discovery reads the public projection store. It does not fetch or render
hundreds of full decision audits on first load; the ranking inputs are a narrow
projection, and the deep analysis lives behind the match page.

## Still to wire

The ranking engine, filters and board composition are built and tested. The
pages that consume them are not yet rewired: `app/page.tsx`, `/explore` and
`/live-scores` still use their existing composition. The live board's fallback
card is the first surface on the shared card.
