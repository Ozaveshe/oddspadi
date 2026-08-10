# Demo and staff content

Community activity must never appear artificial or seeded. Every account is
typed, every non-organic account is visibly labelled, and the product prefers
honest empty states to artificial activity.

## Account provenance

`op_profiles.account_type` (migration
`20260808180000_community_provenance.sql`), service-role-only:

| Type | Meaning | On-site label |
|---|---|---|
| `organic` | real user | none |
| `staff` | OddsPadi employee | **OddsPadi staff** |
| `system` | automated OddsPadi account | **System** |
| `demo` | seeded persona | **Demo account** |

`<AccountBadge>` renders the label beside the author name on the feed,
comments, forums, tip cards, contextual panels, the leaderboard and profiles.

## The eight seed personas

`oddspadi_desk` is `staff` (and `is_admin`, so it can moderate). The seven fan
personas (`kunle_lagos`, `ama_kotoko`, `tunde_united`, `zainab_hoops`,
`chidi_naija`, `mariam_casa`, `sipho_amakhosi`) are `demo`. The migration
labels them by username; `npm run ops:audit-community` verifies no
`@community.oddspadi.com` auth account is left unlabelled.

## What demo content may never do

- **Masquerade as organic users** — the badge renders wherever the author
  embed does; reserved-handle rules stop organic accounts imitating staff.
- **Enter leaderboards** — `op_public_tipster_leaderboard` requires
  `account_type in ('organic','staff')`; demo and system accounts are never
  eligible regardless of record.
- **Count toward engagement** — the production canary (`site-health.mjs`)
  accepts an empty community feed as healthy, so no metric depends on seeded
  posts; the audit script reports demo posts/likes separately so they are
  never read as organic engagement.

## Seeding rules

`scripts/seed-community-posts.mjs`:

- Default invocation is a **dry-run** (prints what it would post, writes
  nothing).
- Posting requires the explicit `--post` flag.
- Posting refuses to run unless every persona carries the right
  `account_type` — unlabelled personas abort the script with exit 1.
- The daily routine treats seeding as optional and discouraged: an honest
  quiet feed beats artificial chatter.

## Staff role

The Social Media & Community Manager operates as a `staff` account:

- posts (desk notes, match threads, product answers) are automatically
  labelled "OddsPadi staff" — no unlabelled staff posting path exists;
- moderates via `/community/moderation` (requires `is_admin`), with every
  action audit-logged (see community-moderation.md);
- organizes match threads with canonical fixture subjects and escalates data
  issues through the ops scripts;
- may rank on the tipster leaderboard (labelled), since staff tips are held to
  the same immutable-settlement rules as everyone else's.
