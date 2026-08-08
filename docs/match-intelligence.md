# Match Intelligence

*View-model: [`matchIntelligence.ts`](../src/lib/match/matchIntelligence.ts).
Adapter: [`matchIntelligenceAdapter.ts`](../src/lib/match/matchIntelligenceAdapter.ts).
Route: `/predictions/[matchId]`.*

The match page is the centre of the product. It has to explain the event, the
model's view, the market, the publication decision and the eventual result
without exposing internal machinery and without contradicting itself.

## One view-model, no page-level truth

Every section renders from one `MatchIntelligence` object. No section
reconstructs decision truth from raw inputs, which is the only reliable way to
stop two parts of the same page disagreeing.

The contradictions this makes unrepresentable are not stylistic. They are the
ones a reader would act on:

- current odds shown beside "no odds available"
- a pre-match probability presented as a live read
- a settlement with no publication behind it
- action language on a match that has ended

`OddsView` and `ModelView` are discriminated unions rather than optional
fields, so "current odds" and "no odds" are different states of one value, not
two flags that can both be set.

## Sections

1. **Header** — participants, competition, scheduled start in the viewer's
   timezone, venue or surface, current status, score, last verified update.
2. **Canonical decision** — exactly one of pick, lean, watch, pass, withheld or
   unavailable. Where published: market, selection, publication odds and time,
   model probability, fair odds, settlement state, and a link to the ledger
   row. Where not published: the principal reason in plain language.
3. **Probability** — coherent market probabilities. Football 1X2 sums to one;
   two-way markets show both sides.
4. **Market** — current valid odds with source and timestamp, no-vig
   probability, fair odds, movement, source depth. Historical prices are
   labelled `historical-only`.
5. **Why the model sees it this way** — three to five structured factors, each
   with a direction. Never chain-of-thought.
6. **Evidence and uncertainty** — named dimensions, each with one shared
   definition. Readiness is the *weakest* dimension, not an average: an average
   lets a strong signal hide a missing one.
7. **Timeline** — snapshot, generation, odds refresh, publication, lineup,
   start, live, result, settlement, correction. Ordered, and never rewritten
   after the result.
8. **Context** — Bet Workspace, save and follow, table, form, season outlook,
   news, community, track record.

## Advanced mode

Collapsed by default: model card, version, calibration summary, factor
contributions, candidate markets, methodology.

It may never contain private prompts, chain-of-thought, repair tickets, raw
database errors, queue internals, provider secrets or mock-provider language.
A test asserts consumer copy carries none of it — those strings exist upstream
and the mistake is passing them through.

**Advanced detail cannot override canonical truth.** It explains the
conclusion; it never contradicts it.

## Enforcement

`match-intelligence-contradictions.test.ts` and
`prohibited-contradictions.test.tsx` assert each prohibition directly. They are
the specification; this document describes them.
