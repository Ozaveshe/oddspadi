# Bet Workspace

What the Slip Check became: an analytical workspace for a user's own
selections, connected to the same canonical fixtures, markets, models and
results as the rest of the product — and firmly outside the official ledger.

*Correlation rules: [correlation-policy.md](correlation-policy.md).
Privacy: [workspace-privacy.md](workspace-privacy.md).
Imports and platform labels: [platform-imports.md](platform-imports.md).*

## What a leg is

A leg is a **resolved** selection: fixture, market, selection, line, the
user's odds with their observation time, the model probability with its
generation time, the decision state, the official publication id where one
exists, and the start time. Resolution happens once, at add time, in
`src/lib/workspace/resolve.ts` — including the canonical selection key
(`football.1x2.regulation.home`), derived through the same legacy bridge
settlement uses. The key a leg carries is the key its settlement grades
against; there is no second mapping to disagree with the first.

Free text is **not** a leg. "Arsenal to win @ 1.8" is held as an unresolved
note, visible in the workspace and excluded from every number, until the user
binds it to a real fixture and market through a picker. There is no fuzzy
matching: three Arsenals can play in one week, and a guessed binding analysed
confidently is worse than a note analysed not at all.

## Entry points

Today, Explore, Match Intelligence, an official publication row, a watchlist
candidate, manual entry, and supported imports all add legs through one
bridge (`fromPrediction.ts` for modelled surfaces, `bookmakerAdapters.ts` for
imports). Each leg records which surface it came from as a closed vocabulary.
Adding a leg reads a decision; it never writes one — **no entry point creates
an official pick**, and the test suite greps the workspace module for ledger
writes to keep it that way.

## What a leg shows

User odds and their source; implied probability; the de-vigged market
probability captured with the odds; the model probability and its fair-odds
equivalent; the conservative probability (interval lower bound where the
model produced one, otherwise the smaller of model and market — never an
invented number); edge; expected value per unit; freshness diagnostics
(stale odds, stale model, no timestamp); the uncertainty band; whether an
official OddsPadi pick exists on the same selection; and whether the market
is inside the modelled set. Missing evidence is stated, never substituted.

## The accumulator summary

Combined bookmaker odds; the naive implied chance (margin included); the
de-vigged market chance (margin removed, independence still assumed — and
withheld entirely when the slip contains a contradiction); the combined
model chance **only where the correlation basis supports one**; supported
and stale leg counts; correlation findings; and an evidence-quality verdict.
The combination basis is one of four honest states — see the correlation
policy. No stake advice exists anywhere in the surface, and a test enforces
its absence.

## Snapshots and settlement

Before any leg starts, the user can freeze a snapshot: a deep copy of the
full analysis that nothing afterwards may edit. After kickoff the workspace
shows current score and lifecycle **beside** the frozen record, never inside
it. Settlement grades each leg from verified canonical results through the
same grader as official publications (`settlement/grade.ts`) — an Asian
quarter line half-wins for a user exactly as it would for an official pick.
Personal outcomes carry a fixed sentence stating they are not part of the
official OddsPadi track record.

## Actions

Save (automatic locally; explicit private sync for signed-in users),
duplicate, rename, archive/unarchive, remove or replace a leg (until
frozen), recheck fixtures (updates lifecycle and official-pick state; never
rewrites captured odds or model figures), share read-only, revoke the share,
and export as a self-describing JSON document.

## Guest and account mode

Guests get full function with on-device persistence, and the interface says
plainly what that means: workspaces live in this browser, are lost if its
storage is cleared, and do not follow you across devices. Signing in adds
exactly one thing — private sync to My Padi behind per-user row-level
security. Nothing else changes.
