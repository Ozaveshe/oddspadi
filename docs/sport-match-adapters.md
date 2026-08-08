# Sport match adapters

One page structure, sport-specific modules inside it.

*Adapter: [`matchIntelligenceAdapter.ts`](../src/lib/match/matchIntelligenceAdapter.ts).
Market semantics: [market-ontology.md](market-ontology.md).*

The shared structure — header, decision, probability, market, factors,
evidence, timeline, context — is identical across sports. What differs is which
markets exist, what the probabilities mean, and which factors are worth
showing.

## Football

- **Markets:** 1X2, totals, BTTS, double chance, draw no bet, Asian handicap.
- **Probability:** three-way, and it must sum to one.
- **Factors:** expected goals, opponent-adjusted form, home advantage, rest and
  congestion, lineup and availability.
- **Basis:** every market above settles on **normal time**. A tie decided in
  extra time or on penalties settles 1X2 as a draw. Only qualification markets
  read past ninety minutes.

## Basketball

- **Markets:** moneyline, spread, total points.
- **Probability:** two-way. There is no draw in the full-game market; a tie
  after regulation is only representable in the regulation-only market, which
  is three-way for that reason.
- **Factors:** possession-based offence and defence, pace, efficiency, rest and
  back-to-backs, lineup availability.
- **Basis:** including overtime by default. The regulation-only variant is a
  **separate market key**, never a flag — so a mapping mistake is a missing
  rule, which is loud, rather than a wrong basis, which is silent.

## Tennis

- **Markets:** match winner, set handicap, total games.
- **Probability:** two-way, no draw.
- **Factors:** surface-specific rating, serve and return strength,
  opponent-adjusted form, fatigue, tournament level, best-of-three or five,
  retirement and availability history.
- **Basis:** the match winner settles on the **awarded** winner, so a
  retirement produces a result. Set and games markets **void** on a
  retirement — the count never reached its final value. Same event, two correct
  and opposite answers, which is exactly why the rule is declared per market
  rather than per sport.

## Adding a sport

1. Define its markets in the canonical registry with every settlement rule
   declared.
2. Implement grade functions; declaration parity will exercise them.
3. Add the factor set to the adapter.
4. Add deterministic page fixtures for each phase.

The page structure does not change. If it needs to, that is a signal the
structure is wrong rather than that the sport is special.
