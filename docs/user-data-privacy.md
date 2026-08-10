# User data privacy

Private user records stay private, and stay out of marketing analytics.

## Private by default (RLS)

`op_workspaces`, `op_follows`, `op_alert_preferences`, `op_followed_teams`,
`op_push_subscriptions` are owner-only via RLS (`auth.uid() = user_id`), revoked
from anon/authenticated except the owner's own rows. `op_workspace_shares` is
service-role only. The workspace sync route uses the user's own RLS client
throughout — no service-role path.

## Shared workspaces

- **Token:** HMAC-SHA256 over `shareId.expiresAtMs`
  (`src/lib/workspaceSync/shareToken.ts`), signature checked before any DB read;
  a missing/short `WORKSPACE_SHARE_SECRET` disables sharing (fail closed).
- **Expiry:** default 7d, max 30d, DB-capped 90d; inside the signed material and
  re-checked against the row.
- **Revocation:** by row (`revoked_at`), checked at read; account deletion
  revokes all owner shares. **Only a validly-signed token may revoke** — a
  malformed token is rejected (the earlier fall-through that let anyone revoke
  any share by uuid is fixed; `workspace-endpoint-security.test.ts`).
- **Frozen copy:** field-whitelisted (`sanitizeForShare`) — no email, no user id,
  no free-text notes; the sharer's identity is never in the payload. The page is
  `noindex,nofollow,noarchive`, `no-store`.
- **Anonymous endpoints:** share-create and the settle/recheck/convert compute
  routes are origin-guarded and device-key rate-limited
  (`op_consume_guest_rate_limit`).

## Export, deletion, session control

- **Export** (`/api/my/export`): RLS-scoped, `attachment`, `no-store`.
- **Deletion** (`/api/my/delete`): requires the literal confirmation phrase;
  deletes all `op_` personal rows and revokes shares. The auth identity is
  retained by design (documented on the route); full account removal is a
  support action.
- **Sessions:** "Sign out everywhere" (`supabase.auth.signOut({ scope: "global" })`)
  in `PrivacyControls`. No per-device listing (global revoke only).
- **Alerts:** closed vocabularies, validated timezone/quiet-hours, DELETE =
  consent withdrawal; all `privateJson`.

## Analytics redaction

`trackEvent` (`src/lib/analytics/events.ts`) applies a **per-event property
allowlist** before anything is sent, and replaces the beacon path with
`safeAnalyticsPath` (dynamic segments → `:id`). Consequences:

- **Personal slip contents** (`selection`, `decimal_odds`) are NOT sent on
  `betslip_pick_added` — only sport/league/source/match.
- **Private follows** — `team_followed`/`team_unfollowed` carry only `sport`,
  never team id/name/country.
- **Account details** — no email, user id, username, or post/comment body.
- **Path tokens** — a share token or profile handle never rides in the beacon
  path.

Enforced by `analytics-redaction.test.ts`; consent gating and GPC handling by
`analytics-taxonomy.test.ts` / `Analytics.tsx`.

## No uploads

No storage bucket, no file input; avatars are OAuth-provider URLs
(`upload-surface-absent.test.ts`).
