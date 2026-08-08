# Fixture ranking

*Implementation: [`fixtureRanking.ts`](../src/lib/discovery/fixtureRanking.ts).
Board composition: [`todayBoard.ts`](../src/lib/discovery/todayBoard.ts).*

## What the ranking is for

The board is dominated by whatever the providers happen to return, which on a
normal day means hundreds of low-tier fixtures from one sport. The answer is
not to delete that coverage — it is legitimate, and someone follows every one
of those teams — but to rank it and cap how much of the first screen any single
competition can occupy.

## Two rules that matter more than the weights

**1. Relevance is not "the model likes a bet."** A pass on a big match is more
interesting than a pick on a match nobody is watching. Decision *availability*
contributes to the score; the model's *verdict* does not. A `pass` scores the
same as a `pick` on the coverage factor.

This is deliberate and it is the rule most likely to be "optimised" away by
someone measuring click-through.

**2. Every score is explainable.** Each ranked fixture carries the
contributions that produced it, so a curated board can always answer "why is
this here?" — for a reader, and for whoever has to debug it later.

## Factors

User follow, sport preference, competition tier, regional relevance, match
importance, live status, start proximity, model coverage, official publication,
data freshness, evidence readiness.

Competition tiers are weighted with the audience in mind: `africa-primary` sits
deliberately close to `top-five`, because OddsPadi's readers care more about
those than about a mid-table fixture in a European league they cannot watch.

## Diversity

Caps are applied **after** scoring, which keeps the two concerns separate: the
score says what is most relevant, the caps stop one competition's forty
fixtures occupying the whole board even when each individually outranks the
alternatives.

Held-back counts are returned, never dropped. A board that quietly hides
coverage is the failure this system exists to avoid.

## Board composition

The ranked list is one thing; a screen is another. `buildTodayBoard` splits it:

| Section | Contents |
|---|---|
| `primary` | Scheduled and live — what can still be acted on |
| `recentResults` | Finished, with a published claim — the record |
| `evidenceArchive` | Finished, no claim — real analysis, filed |

Every fixture lands in exactly one section and the counts are reported. On a
normal day the archive outnumbers everything a reader came for, which is why it
is not on the primary board — and why it is not deleted either.

**A capped board says so.** `boardDisclosure()` states how many are not shown
and how many diversity held back. A board showing 40 of 300 with no note reads
as the whole slate, and a reader acting on that is acting on a false premise
this system created.

**Empty is two states.** *Nothing today* and *nothing at all* are different
facts, and only the first is normal. `primaryEmptyWithCoverage` distinguishes
them.
