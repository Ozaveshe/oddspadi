# Community: accounts, feed & forums — build plan

This documents the accounts/feed/forums feature. The **data model + security (RLS)
foundation is done** as a migration; the rest is a focused follow-up that needs the
Supabase connector authorized.

## Status

| Piece | State |
|---|---|
| DB schema + RLS (profiles, feed, forums) | ✅ `supabase/migrations/20260712000000_community_accounts_feed_forums.sql` |
| Auto-profile-on-signup trigger | ✅ in the migration |
| Auth wiring (`@supabase/ssr` clients + session middleware) | ✅ `src/lib/supabase/*`, `src/middleware.ts` |
| Auth UI (`/account` sign up/in/out + profile) | ✅ built |
| Community feed (`/community` read + post) + API | ✅ built |
| Forums (`/forums`, category, thread + replies) + API | ✅ built |
| Nav entry ("Community") | ✅ built |
| Migration **applied** to the live DB | ⛔ still blocked — needs `supabase_oddspadi` connector authorized |
| Auth **enabled** in Supabase dashboard (email confirm / provider) | ⛔ needs dashboard config |

**The whole app layer is built, compiles, builds, and renders graceful
"not switched on" states without a DB.** It goes live the moment (a) the
migration is applied and (b) `NEXT_PUBLIC_SUPABASE_URL` + a publishable/anon key
are set and email auth is enabled in the Supabase dashboard. Everything below the
first divider was the plan; it is now done except the two ⛔ steps.

## Blocker: apply the migration

The migration is **not applied yet**. Applying it requires the `supabase_oddspadi`
MCP connector (project ref `wncwtzqipnoqwmqlznqn` — per AGENTS.md). That connector is
currently unauthenticated in the agent session, so migrations can't be run from here.

To apply: authorize the connector (via `claude mcp` / `/mcp` in an interactive
session, or the Supabase CLI `supabase db push`), then apply
`20260712000000_community_accounts_feed_forums.sql`. Verify `get_project_url` returns
`https://wncwtzqipnoqwmqlznqn.supabase.co` first.

## Data model (in the migration)

- **`op_profiles`** — 1:1 with `auth.users`, auto-created on signup by the
  `op_handle_new_user` trigger (unique handle derived from email). Read-open,
  update-own.
- **`op_feed_posts` / `op_feed_comments` / `op_feed_post_likes`** — short posts
  (optionally tied to a `match_id`), comments, likes. Read-open, write-own.
- **`op_forum_categories`** (curated, seeded) **/ `op_forum_threads` /
  `op_forum_replies`** — replies blocked on locked threads via RLS; `reply_count` +
  `last_activity_at` maintained by trigger. Read-open, write-own.

Every table has RLS enabled: **anyone can read; only the authenticated owner can
write their own rows.** Categories are service-role-only for writes.

## Remaining build (next session)

1. **Auth wiring.** Add `@supabase/ssr`; create browser + server Supabase clients that
   read `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; add
   middleware to refresh the session cookie. Enable Email (magic link or
   password) + optionally Google OAuth in the Supabase dashboard.
2. **Auth UI.** `/account` (sign up / sign in / sign out), profile edit. Never have
   the agent enter real credentials — build the forms only.
3. **Feed.** `/community` feed page + `POST /api/community/posts`, likes, comments
   (RLS enforces ownership; keep server routes thin).
4. **Forums.** `/forums`, `/forums/[category]`, `/forums/[category]/[thread]` with
   reply composer.
5. **Nav.** Add "Community" to the nav + mobile tab bar; show the signed-in avatar.
6. **Moderation.** `is_admin` flag exists; add report + hide later.

## Notes

- Keep the model honest: community posts are user opinion, distinct from the
  engine's analysis. Label them clearly.
- Rate-limit post/reply creation at the API layer.
- The `18+ / responsible play` framing should extend to any tipping discussion.
