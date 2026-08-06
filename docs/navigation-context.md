# Navigation context

What a visitor carries with them, where it lives, and why it is stored there.

Moving from Today → a match → a competition → Track Record → My Padi must not
silently reset the reader's frame. Each piece of context below has exactly one
home, chosen so that carrying it costs nothing.

## The context, and where each piece lives

| Context | Stored in | Survives | Why there |
|---|---|---|---|
| **Timezone** | global shell (`layout.tsx`) + `localStorage` | every navigation | Mounted in the layout it is carried for free. Mounted per page it resets whenever a route forgets it — and a kickoff time that silently changes is the one thing a matchday reader cannot tolerate. Defaults to WAT. |
| **Odds format** | `localStorage` | every navigation, and reloads | A display preference, not a document. Putting it in the URL would fork every page into decimal and fractional variants competing in the index. |
| **Selected date** | URL query (`?date=`) | links, refresh, sharing | Part of *which* page you are on. A shared link must reopen the same day. |
| **Sport** | URL query (`?sport=`) | links, refresh, sharing | Same: `?sport=tennis` is a different board, and must be shareable. |
| **Competition** | route path | permanently | It is the identity of the page, e.g. `/predictions/league/premier-league/table`. |
| **Fixture identity** | route path | permanently | `/predictions/[matchId]` is the one canonical fixture URL. Every doorway lands here; a second fixture URL would fork the market selection and the source page. |
| **Market selection** | URL fragment / in-page state | within the fixture page | Scoped to one fixture, so it does not belong in a shared global. |
| **Source page** | `document.referrer` + analytics `from` param | one hop | Enough to render "back to Today"; deliberately not persisted further. |
| **Guest Bet Workspace** | `localStorage` | every navigation, and reloads | Guest work must never require an account. See below. |
| **Follows / saved fixtures** | `localStorage`, synced to account when signed in | every navigation | Guest-first, same reason. |

## The rule about the URL

Something belongs in the URL when it changes *what the page is* — the day, the
sport, the fixture, the competition. Something belongs in storage when it
changes *how the page reads* — timezone, odds format.

Getting this wrong in either direction is costly. A display preference in the
URL multiplies every route into indexable duplicates. A page identity in
storage makes links unshareable and the back button lie.

## Guest state is never gated

A visitor can follow a team, save a fixture and build a Bet Workspace without
an account. All of it lives in `localStorage` and is merged into the account on
sign-in. This is a product commitment, not an implementation detail: an account
wall in the middle of a matchday loop is the fastest way to lose the visit.

`src/test/product-navigation.test.ts` asserts no account gate sits in that
loop.

## What is tested

`src/test/route-canonical-contract.test.ts` covers:

- the timezone control is mounted in the global shell and **not** duplicated
  onto any page — duplication is how it silently diverges
- every fixture doorway points at the canonical `/predictions/[matchId]`, so
  context cannot be lost to a duplicate page

## What is not yet tested

Query-parameter round-tripping across a real navigation (Today → match →
back, with `?date=` and `?sport=` intact) needs a browser-driven test rather
than a unit test. It is not covered today, and is the largest remaining hole in
this document's guarantees.
