#!/usr/bin/env node
/**
 * Demo-content poster for the community feed. HONESTY RULES:
 *
 *   - Default invocation is a DRY-RUN: it prints what it would post and exits.
 *   - Posting requires the explicit `--post` flag.
 *   - Posting refuses to run unless every persona's profile is labelled with
 *     the right account_type ('staff' for oddspadi_desk, 'demo' for the fans),
 *     because demo content must carry a visible label on the site, never
 *     masquerade as organic users, and never count toward leaderboards.
 *   - Prefer an honest quiet feed: the production canary does NOT require a
 *     non-empty feed, so skipping this script entirely is always safe.
 *
 *   node scripts/seed-community-posts.mjs           # dry-run
 *   node scripts/seed-community-posts.mjs --post    # write labelled demo posts
 *
 * Env (required, service-role — server side only, never ship to the client):
 *   SUPABASE_URL          e.g. https://wncwtzqipnoqwmqlznqn.supabase.co
 *   SUPABASE_SECRET_KEY   service-role key (or SUPABASE_SERVICE_ROLE_KEY)
 *
 * Personas are matched by username; run the one-off account seed first if the
 * profiles don't exist yet (see docs/automations.md).
 */
import { createClient } from "@supabase/supabase-js";

const shouldPost = process.argv.includes("--post");

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY (service role) are required.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// A rotating pool per persona; the day-of-year picks the entry so reruns on
// the same day are stable and consecutive days differ.
const pools = {
  oddspadi_desk: [
    "Desk note: today's editions are up on the News page — previews, the value watch and the results recap, all generated from stored ledger rows.",
    "Reminder from the desk: a model lean is direction, not action. The value picks page shows when the numbers actually clear the bar.",
    "Results ledger updated overnight. Wins and losses both stay on the record — that's the whole point."
  ],
  kunle_lagos: [
    "Checked the morning slate with my coffee. The engine dey cautious today and honestly I respect it.",
    "Anybody else refresh the value picks page like it's social media? Just me? Okay.",
    "Arsenal news quiet today so I'm adopting whatever basketball game has the biggest edge. Don't judge me."
  ],
  ama_kotoko: [
    "Morning padis. Which match are we watching tonight? Drop your picks, let's compare with the engine after.",
    "Kotoko news slow today so I went digging in the results page. The transparency still surprises me, no site dey do am like this.",
    "Basketball slate looking busy — the live scores page has been my second screen all week."
  ],
  tunde_united: [
    "Pre-season form table is my guilty pleasure. Yes I know it means nothing. No I will not stop.",
    "The engine says no value on my team today. Painful but probably correct.",
    "One thing I rate about this app: when there's nothing worth picking, it says so. No forced 'sure banker' nonsense."
  ],
  zainab_hoops: [
    "Summer League rotations are pure chaos and the engine's caution flags are doing their job.",
    "Watched the late games so you don't have to: check the finished tab on live scores for the damage.",
    "Hoops question: who's your breakout pick this summer? The numbers have opinions but I want the eye-test takes."
  ],
  chidi_naija: [
    "Checked the ledger first thing as usual. The record keeps itself honest, win or lose.",
    "NPFL gist loading... meanwhile the multi-sport board is keeping me busy.",
    "The engine no send anybody — if the edge is not there, e no go show. That's why I trust the ones it does show."
  ],
  mariam_casa: [
    "Women's football coverage is growing here and I'm claiming credit for manifesting it.",
    "Raja in pre-season, me in pre-season. We move again this week.",
    "Petit rappel: check the news desk — the daily briefs explain which slates the engine can actually price."
  ],
  sipho_amakhosi: [
    "Joburg check-in. Who else keeps the live board open at work? The auto-refresh is dangerously convenient.",
    "Chiefs rumour mill is spinning again. I'll believe signings when the ink dries.",
    "Did my weekly results-page pilgrimage. Respect for showing the losses too — builds trust, that."
  ]
};

/** The label each persona MUST carry before this script will post as it. */
const requiredAccountType = (username) => (username === "oddspadi_desk" ? "staff" : "demo");

const dayIndex = Math.floor(Date.now() / 86_400_000);
const { data: profiles, error: profilesError } = await db
  .from("op_profiles")
  .select("id, username, account_type")
  .in("username", Object.keys(pools));
if (profilesError) {
  console.error(`Could not read profiles: ${profilesError.message}`);
  process.exit(1);
}
if (!profiles?.length) {
  console.error("No seed personas found — run the account seed first (docs/automations.md).");
  process.exit(1);
}

// Demo content may only be produced by accounts that are visibly labelled on
// the site. Refuse to post as anything unlabelled or mislabelled.
const mislabelled = profiles.filter((profile) => profile.account_type !== requiredAccountType(profile.username));
if (mislabelled.length) {
  console.error("Refusing to post: these personas are not labelled for demo/staff provenance:");
  for (const profile of mislabelled) {
    console.error(`  ${profile.username}: account_type=${profile.account_type ?? "null"} (needs '${requiredAccountType(profile.username)}')`);
  }
  console.error("Apply migration 20260808180000_community_provenance.sql first.");
  process.exit(1);
}

/** Stable per-persona offset so the rotation does not depend on run order. */
function personaOffset(username) {
  let hash = 0;
  for (const character of username) hash = (hash * 31 + character.charCodeAt(0)) % 997;
  return hash;
}

const cutoff = new Date(Date.now() - 20 * 3_600_000).toISOString();
let posted = 0;
let failed = 0;
for (const profile of profiles) {
  const { data: recent } = await db
    .from("op_feed_posts")
    .select("id")
    .eq("author_id", profile.id)
    .gte("created_at", cutoff)
    .limit(1);
  if (recent?.length) {
    console.log(`skip  ${profile.username} (already posted recently)`);
    continue;
  }
  const pool = pools[profile.username];
  // Indexed by day and by a stable hash of the username. It previously used the
  // running `posted` counter, so a skipped or failed persona shifted every
  // persona after it — contradicting the documented promise that a rerun on the
  // same day is stable.
  const body = pool[(dayIndex + personaOffset(profile.username)) % pool.length];
  if (!shouldPost) {
    console.log(`would post  ${profile.username} (${profile.account_type}): ${body.slice(0, 60)}...`);
    continue;
  }
  const { error } = await db.from("op_feed_posts").insert({ author_id: profile.id, body });
  if (error) {
    failed += 1;
    console.error(`FAIL  ${profile.username} — ${error.message}`);
    continue;
  }
  posted += 1;
  console.log(`post  ${profile.username}`);
}
if (!shouldPost) {
  console.log("\nDry-run only. Re-run with --post to write these labelled demo posts. An honest quiet feed is also fine.");
} else {
  console.log(`\n${posted} new post(s)${failed ? `, ${failed} failed` : ""}.`);
}
// Without this the script always exited 0, so `npm run ops:seed-feed` reported
// success even when every insert had been rejected.
process.exit(failed ? 1 : 0);
