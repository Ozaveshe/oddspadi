/**
 * Repair character-encoding defects (mojibake) in stored community text.
 *
 *   npm run ops:repair-community-encoding             # dry-run report
 *   npm run ops:repair-community-encoding -- --run    # apply repairs
 *
 * Scans op_feed_posts.body, op_feed_comments.body, op_forum_threads.title+body,
 * op_forum_replies.body and op_community_tips.rationale for UTF-8-as-cp1252
 * sequences and repairs them with the same `repairMojibake` the write path
 * uses, so stored rows converge on the one sanitised text path. Tip repairs
 * touch only `rationale`, which the freeze trigger permits.
 *
 * Env: SUPABASE_URL + SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).
 */
import { createClient } from "@supabase/supabase-js";
import { repairMojibake } from "@/lib/community/textContent";

const apply = process.argv.includes("--run");

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY (service role) are required.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const TARGETS: Array<{ table: string; columns: string[] }> = [
  { table: "op_feed_posts", columns: ["body"] },
  { table: "op_feed_comments", columns: ["body"] },
  { table: "op_forum_threads", columns: ["title", "body"] },
  { table: "op_forum_replies", columns: ["body"] },
  { table: "op_community_tips", columns: ["rationale"] }
];

const PAGE = 500;
let totalAffected = 0;
let totalRepaired = 0;
let failures = 0;

for (const target of TARGETS) {
  let offset = 0;
  let affected = 0;
  let repaired = 0;
  for (;;) {
    const { data, error } = await db
      .from(target.table)
      .select(["id", ...target.columns].join(","))
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error(`${target.table}: read failed — ${error.message}`);
      failures += 1;
      break;
    }
    const rows = (data ?? []) as unknown as Array<Record<string, string>>;
    for (const row of rows) {
      const patch: Record<string, string> = {};
      for (const column of target.columns) {
        const original = row[column];
        if (typeof original !== "string") continue;
        const fixed = repairMojibake(original);
        if (fixed !== original) patch[column] = fixed;
      }
      if (!Object.keys(patch).length) continue;
      affected += 1;
      const sampleColumn = Object.keys(patch)[0];
      console.log(`  ${target.table}/${row.id} ${sampleColumn}: ${JSON.stringify(row[sampleColumn].slice(0, 40))} -> ${JSON.stringify(patch[sampleColumn].slice(0, 40))}`);
      if (apply) {
        const { error: writeError } = await db.from(target.table).update(patch).eq("id", row.id);
        if (writeError) {
          console.error(`  ${target.table}/${row.id}: write failed — ${writeError.message}`);
          failures += 1;
        } else {
          repaired += 1;
        }
      }
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  totalAffected += affected;
  totalRepaired += repaired;
  console.log(`${target.table}: ${affected} row(s) with mojibake${apply ? `, ${repaired} repaired` : ""}`);
}

console.log(
  apply
    ? `\nRepaired ${totalRepaired}/${totalAffected} affected row(s).`
    : `\nDry-run: ${totalAffected} affected row(s). Re-run with --run to repair.`
);
process.exit(failures ? 1 : 0);
