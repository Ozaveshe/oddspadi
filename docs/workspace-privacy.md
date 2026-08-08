# Workspace privacy

The Bet Workspace holds a user's own analysis. Everything below exists so it
stays theirs.

## Private by default

- **Guest mode** keeps everything on the device (`localStorage`), sent
  nowhere. The interface states the trade-off: no backup, no cross-device
  continuity, gone if browser storage is cleared.
- **Account mode** syncs to `op_workspaces`, where row-level security scopes
  every row to `auth.uid()`. There is no admin view, no public listing, no
  cross-user query path — a bug in the API route cannot read another user's
  workspaces because the database refuses to.
- No workspace surface is indexable. The shared view sets
  `X-Robots-Tag: noindex, nofollow, noarchive` and `robots: { index: false }`.

## Share links

Sharing is opt-in, read-only, and capability-based:

- A share stores a **frozen, sanitised copy** — later edits never leak
  through an old link.
- Sanitisation is a field whitelist (`workspaceSync/sanitize.ts`). Free-text
  notes (the closest thing a workspace has to private notes) are stripped;
  prior share tokens are stripped; no account information exists in the
  payload at all, and the whitelist keeps that true even if a future field
  forgets.
- The link token is HMAC-signed with the expiry inside the signed material —
  editing the URL's lifetime breaks the signature. Missing signing secret
  means sharing is disabled, fail closed.
- Expiry is 7 days by default, 30 at most, 90 hard-capped in the database.
- **Revocation** works two ways: anyone holding the link can revoke it, and
  a signed-in owner can revoke by id without the link. A revoked share
  answers 410 with a plain sentence, not an error page.

## Deletion and export

- Deleting a workspace deletes its synced row (`DELETE /api/workspace/sync`).
- Deleting the account cascades: `op_workspaces` and `op_workspace_shares`
  rows reference `auth.users ON DELETE CASCADE`.
- Export produces a self-describing JSON document of exactly what is stored,
  readable without OddsPadi.

## Sensitive analytics redaction

Workspace analytics events carry surface names and market identifiers, never
the user's odds sources, stake intentions (which do not exist in the
product), free-text notes, or share tokens. The one add event
(`betslip_pick_added`) records fixture, sport, league, selection label, odds
and entry point — the same facts visible on any public fixture page.

## The official-ledger firewall

A workspace leg can never become an OddsPadi pick. `src/lib/workspace/*` has
no write path to any official table, and a test greps the module for
`op_publications` and insert/upsert calls. Personal settlement outcomes are
labelled with a fixed sentence separating them from the official track
record, and the record-class taxonomy files them as `community_selection`,
which `countsTowardRecord` ignores.
