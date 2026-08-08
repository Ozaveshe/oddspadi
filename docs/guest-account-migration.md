# Guest-to-account migration

How device-local state becomes account state on sign-in, without duplicates
and without guessing.

## What migrates, and how

| Guest state | Store | Migration path |
|---|---|---|
| Bet Workspaces | `oddspadi-workspaces-v1` | `PUT /api/workspace/sync` — merge by workspace id, newer `updatedAt` wins |
| Team follows (names) | `oddspadi-personal-preferences-v1` | `POST /api/my/migrate` — resolved against the team catalogue by **exact normalised name match only** |
| Sport / competition / player follows | same | `POST /api/my/migrate` → `op_follows`, keyed on normalised names |
| Saved / recent fixtures | `oddspadi-saved-fixtures-v1` / `-recent-` | stay device-local (they are browsing context, not durable preferences) |
| Timezone, odds format, filters | various | stay device-local; alert timezone is captured into `op_alert_preferences` when the user saves alert settings |

`GuestMigrationBridge` (mounted on `/my`) runs the merge once per browser
after sign-in, records a completion flag, and reports what happened in
plain sentences.

## The no-duplicates guarantee

Three layers make re-running the migration a no-op:

- Database uniqueness: `op_followed_teams (user_id, team_id)` primary key
  and `op_follows (user_id, entity_type, entity_key)` unique — duplicate
  inserts are `23505`, treated as "already followed", never an error.
- Normalised keys: `entity_key` is lowercased and trimmed, so "Premier
  League" and "premier league" are one follow. The pure merge
  (`mergeFollowLists`) applies the same rule client-side and keeps the
  first spelling seen.
- Workspace sync upserts on `(user_id, workspace_id)`.

## The no-guessing rule

A guest team name that matches zero or **more than one** catalogue team is
not migrated. It stays on the device, and the bridge names it: "need
picking by hand". Fuzzy-matching a follow means following the wrong club
silently — a worse outcome than asking. Everything that did migrate is
cleared from the guest store; everything that did not, remains.

## Failure behaviour

Migration failing (offline, rate-limited, unconfigured) leaves guest state
untouched and says it will retry next visit. There is no state where the
device copy is cleared before the account copy is confirmed.
