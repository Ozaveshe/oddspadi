/**
 * Read-only audit of community records: who is organic, staff, system or demo,
 * how much content each cohort produced, whether any seeded account is still
 * unlabelled, and whether stored text carries encoding defects.
 *
 *   npm run ops:audit-community
 *
 * This is the operator half of "audit current community records": run it
 * against production after applying the provenance migration.
 *
 * Env: SUPABASE_URL + SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).
 */
import { createClient } from "@supabase/supabase-js";
import { repairMojibake } from "@/lib/community/textContent";

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY (service role) are required.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;

// 1) Profiles by provenance ---------------------------------------------------
const { data: profiles, error: profilesError } = await db
  .from("op_profiles")
  .select("id, username, account_type, integrity_flagged_at")
  .limit(10_000);
if (profilesError) {
  console.error(`profiles read failed: ${profilesError.message}`);
  process.exit(1);
}
const byType = new Map<string, string[]>();
for (const profile of profiles ?? []) {
  const type = profile.account_type ?? "unlabelled";
  byType.set(type, [...(byType.get(type) ?? []), profile.username]);
}
console.log("Accounts by provenance:");
for (const [type, names] of [...byType.entries()].sort()) {
  console.log(`  ${type}: ${names.length}${type !== "organic" ? ` (${names.join(", ")})` : ""}`);
}
const flagged = (profiles ?? []).filter((profile) => profile.integrity_flagged_at);
console.log(`  integrity-flagged: ${flagged.length}${flagged.length ? ` (${flagged.map((p) => p.username).join(", ")})` : ""}`);

// 2) Content volume per cohort ------------------------------------------------
const typeById = new Map((profiles ?? []).map((profile) => [profile.id, profile.account_type ?? "unlabelled"]));
for (const { table, authorColumn } of [
  { table: "op_feed_posts", authorColumn: "author_id" },
  { table: "op_feed_comments", authorColumn: "author_id" },
  { table: "op_feed_post_likes", authorColumn: "user_id" },
  { table: "op_forum_threads", authorColumn: "author_id" },
  { table: "op_forum_replies", authorColumn: "author_id" },
  { table: "op_community_tips", authorColumn: "author_id" }
]) {
  const { data, error } = await db.from(table).select(authorColumn).limit(50_000);
  if (error) {
    console.error(`${table} read failed: ${error.message}`);
    failures += 1;
    continue;
  }
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as unknown as Array<Record<string, string>>) {
    const type = typeById.get(row[authorColumn]) ?? "unknown-author";
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const summary = [...counts.entries()].sort().map(([type, count]) => `${type}=${count}`).join(", ") || "empty";
  console.log(`${table}: ${summary}`);
}

// 3) Seed-domain auth users that are not labelled ----------------------------
try {
  const { data: users, error: usersError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw usersError;
  const unlabelled = (users?.users ?? []).filter((user) => {
    if (!user.email?.endsWith("@community.oddspadi.com")) return false;
    const type = typeById.get(user.id);
    return type !== "demo" && type !== "staff" && type !== "system";
  });
  if (unlabelled.length) {
    failures += 1;
    console.error(`UNLABELLED seed-domain accounts (must be demo/staff/system): ${unlabelled.map((user) => user.email).join(", ")}`);
  } else {
    console.log("Seed-domain accounts: all labelled.");
  }
} catch (error) {
  failures += 1;
  console.error(`auth listUsers failed: ${error instanceof Error ? error.message : String(error)}`);
}

// 4) Encoding defects (count only; ops:repair-community-encoding fixes them) --
let mojibakeRows = 0;
for (const { table, columns } of [
  { table: "op_feed_posts", columns: ["body"] },
  { table: "op_feed_comments", columns: ["body"] },
  { table: "op_forum_threads", columns: ["title", "body"] },
  { table: "op_forum_replies", columns: ["body"] },
  { table: "op_community_tips", columns: ["rationale"] }
]) {
  const { data, error } = await db.from(table).select(["id", ...columns].join(",")).limit(20_000);
  if (error) {
    console.error(`${table} scan failed: ${error.message}`);
    failures += 1;
    continue;
  }
  for (const row of (data ?? []) as unknown as Array<Record<string, string>>) {
    if (columns.some((column) => typeof row[column] === "string" && repairMojibake(row[column]) !== row[column])) {
      mojibakeRows += 1;
    }
  }
}
console.log(`Rows with repairable encoding defects: ${mojibakeRows}${mojibakeRows ? " (run ops:repair-community-encoding)" : ""}`);

process.exit(failures ? 1 : 0);
