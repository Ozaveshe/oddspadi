# Community moderation

Production abuse controls for the community. Schema:
`supabase/migrations/20260808182000_community_moderation.sql`.

## Automatic gates (before any write)

`assessCommunityText` (`src/lib/community/contentSafety.ts`) runs in every
write route (posts, comments, threads, replies, tip commentary) and rejects:

- **Unsafe links** — URL shorteners, raw-IP hosts, credential/userinfo tricks,
  `javascript:`/`data:` schemes.
- **Scam / paid-tip solicitation** — VIP tip groups, "DM me for tips",
  Telegram/WhatsApp funnel links, "pay for sure odds".
- **Certainty claims** — "guaranteed win", "can't lose", "100% sure",
  "fixed match".
- **Spam** — more than five links, or the same link repeated.

The render path (`CommunityBody`) refuses to linkify anything failing the same
host check, so even text that predates the gates never becomes a live unsafe
link. Rate limits bound every write (see community-system.md).

**Impersonation protection:** organic accounts cannot register or change to
staff-looking handles (`oddspadi*`, `admin*`, `moderator*`, `staff*`,
`support*`, `official*`) — CHECK constraint `op_profiles_reserved_handles`.
Staff accounts are visibly badged instead.

## Reports

`POST /api/community/reports` — any signed-in user, 10/hour, one report per
person per content item (duplicates are answered "already filed"). Categories:
`spam`, `scam_or_paid_tips`, `guaranteed_win_claim`, `harassment`,
`impersonation`, `unsafe_link`, `other`. Open reports form the queue.

## Blocks and mutes

`op_user_blocks` — self-service, RLS-owned. `POST/DELETE
/api/community/blocks`. A signed-in viewer's feed, comment threads and the
community page silently exclude blocked authors. No private messaging exists
anywhere in the product, and none may be added before these abuse controls
have operated in production ("no DMs before abuse controls" is policy).

## Moderator queue and actions

`/community/moderation` (staff-only page, noindex) lists open reports;
`GET/POST /api/community/moderation` is `is_admin`-gated on the caller's
profile, and effects run on the service-role client because moderation columns
carry no authenticated grants. Actions:

| Action | Effect |
|---|---|
| `hide` / `unhide` | `hidden_at`/`hidden_reason` on posts, comments, threads, replies — hidden content disappears for everyone except its author (who needs it to appeal) |
| `lock_thread` / `unlock_thread` | `op_forum_threads.is_locked` (RLS already blocks replies on locked threads) |
| `moderate_tip` | `moderated_at`/`moderated_reason` tombstone — display only; the settled result stays in statistics |
| `flag_account` / `unflag_account` | `op_profiles.integrity_flagged_at` — flagged accounts cannot rank on the leaderboard |
| `dismiss_report` | closes a report without action |
| `note` | audit-only entry |

Any action carrying a `reportId` also resolves that report (`actioned` /
`dismissed`, with `resolved_by`).

## Audit log

`op_moderation_actions` is append-only and service-role-only (RLS enabled,
zero policies): **every successful moderator action writes exactly one row**
— actor, action, content reference, target user, linked report, reason,
timestamp. Guaranteed-win claims and paid-tip solicitation that slip past the
automatic gates are handled here via report categories + `hide`/`moderate_tip`
+ `flag_account` for repeat offenders; harassment likewise.

## Appeals

`GET /api/community/appeals` shows a user the moderation actions that targeted
them and their appeals; `POST` files one appeal per action (10–1000 chars,
5/day) after server-side verification that the action targeted the caller.
Appeals are reviewed by a moderator who did not take the original action;
resolution (`upheld`/`overturned` + note) is recorded on the appeal row.
Overturning means reversing the effect (`unhide`, `unflag_account`, clearing
`moderated_at`) — each reversal writes its own audit row.

## Tests

`src/test/community-moderation.test.ts` (schema invariants + route behavior),
`community-content-safety.test.ts` (automatic gates),
`community-write-routes.test.ts` (gates wired into writes, block-aware reads),
plus the repo-wide security meta-tests (origin guard, rate limits, bounded
JSON) whose route lists include every moderation route.
