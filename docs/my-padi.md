# My Padi

The private personal layer: follows, saved fixtures, workspaces, alerts and
a personal record — valuable to repeat visitors, never required for reading.

*Alerts: [personal-alerts.md](personal-alerts.md).
Record: [personal-record.md](personal-record.md).
Migration: [guest-account-migration.md](guest-account-migration.md).
Workspace: [bet-workspace.md](bet-workspace.md).*

## Guest first, by architecture

Everything personal works signed out, on the device: followed sports,
competitions, teams and players (`personal/preferences.ts`), saved and
recent fixtures (`product/fixtureShelf.ts`), Bet Workspaces
(`workspace/store.ts`), timezone (`LocalTime.tsx` + cookie), discovery
filters, odds format. Every store follows the same convention — an
`oddspadi-<thing>-v1` key, a paired change event, a type guard on read and
write, a hard cap — and every surface that depends on this explains it with
one fixed sentence (`GUEST_PERSISTENCE_COPY`): on this device only, not
backed up, sign-in adds private sync and nothing else.

## What an account adds

Private sync for workspaces (`op_workspaces`), team follows against the
catalogue (`op_followed_teams`), generic follows (`op_follows`), alert
consent (`op_alert_preferences`), push subscriptions, and the privacy
surface: export everything, delete everything, sign out everywhere. All
tables are owner-scoped by RLS with `ON DELETE CASCADE` back to the
account. There is no public profile page and nothing personal is indexable.

## The My Padi home

`/my` composes, in order:

1. **Today for you** (`PersonalTodayPanel` ← `POST /api/my/summary`) —
   followed fixtures today with live scores inline, watchlist/decision
   state per fixture, the latest official publications, and recent
   settlements. The summary is prepared and bounded server-side: queries
   filter by the user's follows and cap at 60 fixtures — **the full public
   catalogue is never loaded for this page**. Three states render
   distinctly: nothing followed (with one-tap competition follows to fix
   it), nothing playing today, and the read failing — a failed read is
   never shown as an empty matchday.
2. **Shelves** — workspaces, saved fixtures, recently viewed, followed
   teams (pre-existing).
3. **Personal record** (`PersonalRecordPanel`) — see personal-record.md.
4. The account section, still labelled what it is: optional, never
   required.

`GuestMigrationBridge` runs the one-time guest-to-account merge when a
signed-in visitor arrives with device-local state.

## Follows in discovery

Follows feed ranking context (`discovery/filters.ts` reads followed teams
and competitions), and the "followed" filter narrows to them on demand —
follows **rank and filter, they never suppress**: the default board still
shows the full slate.

## Performance rules

- One prepared summary request per visit; every section bounded.
- Personal histories paginate client-side from local data (record pages of
  10) or cursor-paginate server-side (`readOfficialPublicationPage`).
- Nothing personal is cached publicly: all personal responses are
  `Cache-Control: private` or `no-store`.
