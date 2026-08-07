# Platform slip conversion

*Implementation: [`conversion.ts`](../src/lib/markets/conversion.ts). Platform
registry extends
[`bookmakerAdapters.ts`](../src/lib/workspace/bookmakerAdapters.ts).*

Translating a canonical selection into a betting platform's own labels.

## The one guarantee

**This service never says two selections are interchangeable when settlement
differs.**

A label that matches is not a market that matches. Draw No Bet and Asian
Handicap 0 read identically on a slip and behave differently inside a multiple.
A tennis winner market that voids on retirement is not the market OddsPadi
settled on the award.

So an alias in `different_settlement` can never produce `exact`. A test asserts
it, because it is the single claim a user would act on financially.

## Results

```ts
type ConversionResult =
  | { status: "exact"; platformMarket; platformSelection; label }
  | { status: "conditional"; …; conditions: string[]; settlementWarning: string }
  | { status: "settlement_warning"; …; warning: string }
  | { status: "unsupported"; reason: string }
  | { status: "unavailable"; reason: string };
```

| Status | Means | Safe to place? |
|---|---|---|
| `exact` | Same market, same settlement | Yes |
| `conditional` | Equivalent under stated conditions | Read the conditions first |
| `settlement_warning` | The label matches; the result may not | Not as a substitute for our pick |
| `unsupported` | The platform does not carry this market | No |
| `unavailable` | We lack the data to say — no label, no approved mapping, or the mapping is ambiguous | Not yet; request a refresh |

`unsupported` and `unavailable` are deliberately distinct. Conflating them tells
a user the bet cannot be placed when it can, or the reverse.

## Belt and braces on `exact`

Even an alias asserting `exact_equivalent` is checked against the two markets'
declared rules before `exact` is returned. If they differ, the result is
downgraded to `settlement_warning`.

The assertion is the thing most likely to be wrong — it is the field an analyst
fills in under time pressure — so it is the field not taken on trust.

## Platform targets

```ts
type PlatformTarget = {
  id: string;
  displayName: string;
  supportedMarketKeys: string[];   // canonical keys, not display text
  labels: Record<string, { platformMarket; platformSelection; label }>;
};
```

One target is registered: `oddspadi-text`, OddsPadi's own exported slip format,
covering football 1X2, over/under 2.5 and BTTS.

Real platforms are added **one at a time**, each with its own scraped label
evidence and its own tests. That is the discipline `bookmakerAdapters.ts`
already chose, for the reason it gave: an importer that half-understands a
format produces confidently wrong analysis, which is worse than none.

`supportedMarkets` on the adapter registry moves from loose strings
(`match_winner`, `over_under_25`) to canonical market keys, so a platform cannot
claim support for a market the ontology does not define.

## Adding a platform

1. Collect label evidence per selection — screenshots or API responses, stored
   on the alias `evidence`.
2. Create aliases for the platform as a provider, with `mapping_state` set from
   an actual reading of its settlement rules, not from its market names.
3. Register the `PlatformTarget` with canonical `supportedMarketKeys`.
4. Add conversion tests, including at least one market where the platform's
   settlement differs from ours — if none does, check again rather than assume.
