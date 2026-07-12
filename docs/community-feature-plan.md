# Community: accounts, feed & forums — build plan

This documents the accounts/feed/forums feature. The **data model + security (RLS)
foundation and application layer are ready against the live OddsPadi Supabase
project**. The remaining production step is to rebuild and deploy the local app;
the browser-safe Supabase variables and email-auth settings are already configured.

## Status

| Piece | State |
|---|---|
| DB schema + RLS (profiles, feed, forums) | ✅ `supabase/migrations/20260712050714_community_accounts_feed_forums.sql` |
| Auto-profile-on-signup trigger | ✅ in the migration |
| Auth wiring (`@supabase/ssr` clients + session middleware) | ✅ `src/lib/supabase/*`, `src/middleware.ts` |
| Auth UI (`/account` sign up/in/out + profile) | ✅ built |
| Community feed (`/community` read + post) + API | ✅ built |
| Forums (`/forums`, category, thread + replies) + API | ✅ built |
| Nav entry ("Community") | ✅ built |
| Migration **applied** to the live DB | ✅ `20260712050714_community_accounts_feed_forums` |
| Auth **enabled** in Supabase dashboard (email confirm / provider) | ✅ Email/password enabled; sign-up open; confirmation required |
| Netlify public Supabase variables | ✅ configured across deploy contexts |

**The whole app layer is built, compiles, builds, and renders graceful
"not switched on" states without a DB.** The database and Auth sides are active,
and Netlify now has `NEXT_PUBLIC_SUPABASE_URL` + the publishable key. Production
still needs a rebuild/deploy: as of this verification, `/community`, `/forums`, and
`/account` return 404 on `https://oddspadi.com` because the six local feature commits
have not been pushed or deployed.

## Live database status

The named `supabase_oddspadi` connector was verified against project ref
`wncwtzqipnoqwmqlznqn`, then the community migration and its foreign-key index
follow-up were applied as `20260712050714_community_accounts_feed_forums` and
`20260712050829_add_community_fk_indexes`. All seven community tables have RLS,
the four starter categories are seeded, and the Supabase security advisor reports
no findings for these tables.

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
