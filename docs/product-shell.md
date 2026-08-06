# The product shell

One shell, four surfaces, everything else reached contextually.

## Why four

OddsPadi accumulated eighteen top-level destinations — Home, Tips, Predictions,
Live Scores, Results, News, Engine and more. Every new capability added a tab,
and the tab bar stopped answering the question a visitor actually arrives with.

The consolidated shell answers four:

| Surface | The question | Route |
|---|---|---|
| **Today** | What is on right now? | `/` |
| **Explore** | Where do I find a fixture, competition or story? | `/explore` |
| **Track Record** | How honest is this model? | `/track-record` |
| **My Padi** | What is mine? | `/my` |

Breadth did not shrink. **No route was deleted** — see `route-migration.md`.
What changed is that breadth is now reached through hubs and context rather
than through competing tabs.

## Where the shell lives

`src/app/layout.tsx`, and nowhere else. It renders:

- `DesktopNavLinks` — the four surfaces, with `aria-current="page"` on the
  active one
- `MobileTabBar` — Today, Explore, Record, My Padi, plus a **More** sheet
- `TimezonePicker` — global on purpose; see `navigation-context.md`
- `SiteFooter`

**There is exactly one `layout.tsx` in the whole app.** That is not an
accident, it is the mechanism: Next renders the closest layout, so a second one
anywhere under `src/app` would silently own its subtree's chrome. A test
enumerates layouts and fails if a second appears
(`src/test/product-shell-contract.test.tsx`).

## Secondary navigation

Each surface owns a set of deep routes and links them from its hub. The mobile
**More** sheet carries the same destinations for small screens. Specialist
routes — the Decision Engine, engine performance, forums — stay fully
accessible, they are simply reached from the surface that owns them rather than
from the top level.

Surface ownership is declared once, in `SURFACE_PREFIXES` in
`src/components/site/SiteNav.tsx`, and drives active-state highlighting. Three
prediction routes are claimed by surfaces other than Explore, because that is
where they belong to a reader:

- `/predictions/history`, `/predictions/value-picks`,
  `/predictions/decision-engine` → **Track Record**
- `/predictions/bet-slip` → **My Padi**

## Loading, empty, stale and error states

All of them render as children of the root layout, so they inherit the shell
for free. None may render its own `<header>`, tab bar or `<html>`; a test
asserts this for all seven.

`global-error.tsx` is the single exception and cannot be otherwise: Next
replaces the root layout when the layout itself throws, so it must supply its
own document. It stays branded, loads `globals.css`, and emits the viewport
meta the layout would have given it — without that it renders zoomed out on a
phone, at the moment the visitor most needs to read it.

## Mobile

Mobile is the primary matchday context, not a narrow desktop.

- One bottom navigation, present on every route
- `viewport-fit=cover` plus safe-area padding
- The bottom bar never duplicates an action already in the header
- Active state is conveyed by `aria-current`, not colour alone
- No route requires desktop-width navigation to be usable

## What would count as a regression

- A second `layout.tsx`
- A page rendering its own site header or tab bar
- A loading or error state that drops the shell
- A top-level nav carrying three or more of the pre-v1.7 labels
- An active state that highlights zero or two surfaces

Each of these fails a test in `src/test/product-shell-contract.test.tsx`.
