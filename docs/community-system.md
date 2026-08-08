# Community system

OddsPadi keeps community and forums, but community activity must be contextual,
accountable, moderated and honest. This document is the map; the companions are
[community-tip-ledger.md](community-tip-ledger.md),
[community-moderation.md](community-moderation.md) and
[demo-and-staff-content.md](demo-and-staff-content.md).

## Two lanes

| Lane | Tables | Surfaces |
|---|---|---|
| **Conversation** (feed + forums) | `op_profiles`, `op_feed_posts`, `op_feed_comments`, `op_feed_post_likes`, `op_forum_categories/_threads/_replies` | `/community`, `/forums/*`, contextual panels |
| **Accountable tips** (immutable, settled) | `op_community_tips`, `op_community_tip_revisions`, `op_community_tip_settlements`, views `op_public_tipster_performance` / `op_public_tipster_leaderboard` | match desk on `/predictions/[matchId]`, `/community` leaderboard, `/community/u/[handle]` |

Both lanes are strictly community opinion. The truth-lane boundary is absolute:
community rows never touch `op_publications`, never influence model
probabilities, and never count as OddsPadi performance. API responses carry
`truthLane: "community-opinion"`.

## Canonical discussion subjects

Discussions attach to real product entities via `subject_type` + `subject_id`
on `op_feed_posts` and `op_forum_threads` (migration
`20260808180000_community_provenance.sql`), validated by
`src/lib/community/subjects.ts`:

| `subject_type` | `subject_id` convention |
|---|---|
| `fixture` | canonical provider external id (`api-football-…`), same shape as `/predictions/[matchId]` |
| `competition` | league slug (`premier-league`) |
| `team` | team slug/id |
| `player` | player slug/id |
| `publication` | official publication id from `op_publications` |
| `season_outlook` | outlook slug (`premier-league-2026`) |
| `strategy` | strategy topic slug |
| `product_feedback` | feedback topic slug |

Fixture discussion uses the canonical fixture ID — the same external id the
match page, workspace and publications use. A feed post created with `matchId`
is automatically a `fixture` subject.

The `?subject=type:id` query parameter on `/community` prefills the composer
(`parseSubjectParam` / `subjectHref`).

## Contextual surfaces

- **Match Intelligence** (`/predictions/[matchId]`): `MatchCommunityDesk` — fan
  pulse poll, accountable tip composer, tip list; plus a "Discuss match" link.
- **Competition hubs** (`/predictions/league/[slug]/table`):
  `CommunitySubjectPanel` with `subject_type='competition'`.
- **Official publication receipts** (`/track-record/publication/[id]`):
  `CommunitySubjectPanel` with `subject_type='publication'`.
- **Season outlooks** (`/season-outlooks`): static link module (the page is
  ISR-cached, so it links to `/community?subject=season_outlook:…` instead of
  reading the database).
- **General forums** (`/forums/*`) stay for longer discussion.

Every contextual module renders an honest empty state ("No discussion yet")
rather than filler.

## One sanitised text path

- **Write path:** every community write (posts, comments, threads, replies, tip
  commentary) runs `prepareCommunityText` (`src/lib/community/textContent.ts`):
  mojibake repair (UTF-8-as-cp1252, up to double-encoded), NFC normalisation,
  control/zero-width stripping, blank-run collapsing.
- **Render path:** every user-authored string renders through
  `<CommunityBody>` (`src/components/community/CommunityBody.tsx`): React
  text nodes only (auto-escaped — script injection is inert), no HTML, no
  embeds; links become anchors only when their host passes
  `isSafeLinkHost` and always carry `rel="nofollow ugc noopener noreferrer"`.
- **Stored rows:** `npm run ops:repair-community-encoding` (dry-run by
  default) repairs mojibake already persisted in the database;
  `npm run ops:audit-community` counts it.

## Content safety

`assessCommunityText` (`src/lib/community/contentSafety.ts`) rejects, before
any DB write: unsafe links (shorteners, raw-IP hosts, userinfo tricks, script
schemes), paid-tip solicitation (VIP groups, DM-for-tips, Telegram/WhatsApp
funnels), certainty claims ("guaranteed win", "100% sure", "fixed match"),
and link spam. See [community-moderation.md](community-moderation.md) for the
human-review half.

## Read paths and limits

Community pages read directly through the cookie (RLS) client; the composer's
fixture list comes from the `daily_fixture_slate` projection. Signed-in
viewers never see authors they blocked (filtered in `/api/community/posts`,
`/api/community/comments`, and the `/community` page). Hidden content is
excluded at the RLS layer (`hidden_at is null or author_id = auth.uid()`).

Per-user write rate limits (`op_consume_user_rate_limit`): posts 10/10min,
comments 30/10min, likes 120/10min, threads 5/h, replies 30/10min, poll votes
40/10min, tips 12/h, reports 10/h, blocks 30/h, appeals 5/day, moderation
actions 120/h.
