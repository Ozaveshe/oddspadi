import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = "supabase/migrations/20260808130000_workspaces_and_shares.sql";

describe("workspace persistence migration", () => {
  it("keeps account workspaces private to their owner via RLS", async () => {
    const sql = (await readFile(migration, "utf8")).toLowerCase();

    expect(sql).toContain("create table if not exists public.op_workspaces");
    expect(sql).toContain("references auth.users(id) on delete cascade");
    expect(sql).toContain("unique (user_id, workspace_id)");
    expect(sql).toContain("alter table public.op_workspaces enable row level security");
    // Owner-only in every direction.
    expect(sql).toContain("for select to authenticated using (auth.uid() = user_id)");
    expect(sql).toContain("for insert to authenticated with check (auth.uid() = user_id)");
    expect(sql).toContain("for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)");
    expect(sql).toContain("for delete to authenticated using (auth.uid() = user_id)");
    expect(sql).toContain("revoke all on public.op_workspaces from public, anon");
    // Deleting the account deletes the workspaces — the cascade IS the
    // deletion right the privacy contract promises.
    expect(sql).toContain("workspace limit reached");
  });

  it("keeps shares server-only with expiry and revocation built in", async () => {
    const sql = (await readFile(migration, "utf8")).toLowerCase();

    expect(sql).toContain("create table if not exists public.op_workspace_shares");
    expect(sql).toContain("share_id text not null unique");
    expect(sql).toContain("expires_at timestamptz not null");
    expect(sql).toContain("revoked_at timestamptz");
    expect(sql).toContain("check (expires_at > created_at)");
    expect(sql).toContain("check (expires_at <= created_at + interval '90 days')");
    expect(sql).toContain("revoke all on public.op_workspace_shares from public, anon, authenticated");
    expect(sql).toContain("grant select, insert, update, delete on public.op_workspace_shares to service_role");
    expect(sql).toContain("alter table public.op_workspace_shares enable row level security");
  });

  it("never touches the official ledger", async () => {
    // Comments may (and do) explain the boundary; executable SQL must not
    // cross it. Strip comment lines before asserting.
    const sql = (await readFile(migration, "utf8"))
      .toLowerCase()
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(sql).not.toContain("op_publications");
    expect(sql).not.toContain("op_public_picks");
  });

  it("registers the workspace_sync rate-limit action", async () => {
    const sql = (await readFile(migration, "utf8")).toLowerCase();
    expect(sql).toContain("('workspace_sync'::text, 60, 3600)");
    // The redefinition must keep every pre-existing action, or deploying this
    // migration silently disables rate limiting for those writes.
    for (const action of [
      "profile_update",
      "follow_team",
      "push_subscription",
      "community_post",
      "community_comment",
      "community_like",
      "forum_thread",
      "forum_reply",
      "community_poll_vote",
      "community_tip"
    ]) {
      expect(sql).toContain(`('${action}'::text`);
    }
  });
});
