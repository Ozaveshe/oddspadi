import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260808182000_community_moderation.sql"),
  "utf8"
);

describe("moderation migration", () => {
  it("creates the four moderation tables", () => {
    for (const table of ["op_content_reports", "op_user_blocks", "op_moderation_actions", "op_moderation_appeals"]) {
      expect(migration).toContain(`create table public.${table}`);
    }
  });

  it("keeps the audit log service-role-only (RLS on, no policies)", () => {
    expect(migration).toContain("alter table public.op_moderation_actions enable row level security");
    expect(migration).not.toMatch(/create policy[^;]*on public\.op_moderation_actions/);
  });

  it("hides moderated content from everyone except the author", () => {
    for (const table of ["op_feed_posts", "op_feed_comments", "op_forum_threads", "op_forum_replies"]) {
      expect(migration).toContain(`alter table public.${table} add column if not exists hidden_at timestamptz`);
    }
    expect(migration).toContain("hidden_at is null or author_id = auth.uid()");
  });

  it("extends rate limits and repairs the workspace_sync check omission", () => {
    for (const action of [
      "community_report",
      "community_block",
      "community_appeal",
      "community_moderation",
      "workspace_sync"
    ]) {
      expect(migration).toContain(`'${action}'`);
    }
    expect(migration).toContain("drop constraint op_user_rate_limits_action_check");
  });

  it("rebuilds the leaderboard with eligibility gates and sample-aware stats", () => {
    expect(migration).toContain("account_type in ('organic','staff')");
    expect(migration).toContain("integrity_flagged_at is null");
    expect(migration).toContain("interval '7 days'");
    expect(migration).toContain("deleted_tips * 4");
    expect(migration).toContain("average_settled_odds");
    expect(migration).toContain("sports_mix");
    expect(migration).toContain("markets_mix");
    expect(migration).toContain("+ 20)) * 100");
    expect(migration).toContain("settled_tips >= 5");
  });

  it("keeps one report per reporter per content item", () => {
    expect(migration).toContain("unique (reporter_id, content_type, content_id)");
  });

  it("never lets a user block themselves at the schema level", () => {
    expect(migration).toContain("check (blocker_id <> blocked_id)");
  });
});
