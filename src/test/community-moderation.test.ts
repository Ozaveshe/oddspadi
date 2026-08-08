import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClientMock = vi.hoisted(() => vi.fn());
const getSupabaseServerClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/serverAuthClient", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: getSupabaseServerClientMock
}));

import { POST as fileReport } from "@/app/api/community/reports/route";
import { POST as createBlock, DELETE as removeBlock } from "@/app/api/community/blocks/route";
import { GET as readQueue, POST as applyAction } from "@/app/api/community/moderation/route";
import { POST as fileAppeal } from "@/app/api/community/appeals/route";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260808182000_community_moderation.sql"),
  "utf8"
);

const CONTENT_ID = "123e4567-e89b-42d3-a456-426614174001";
const REPORT_ID = "123e4567-e89b-42d3-a456-426614174002";
const ACTION_ID = "123e4567-e89b-42d3-a456-426614174003";
const OTHER_USER = "123e4567-e89b-42d3-a456-426614174009";

function jsonRequest(path: string, body: Record<string, unknown>, method = "POST") {
  return new Request(`http://127.0.0.1:3025${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

type ChainResult = { data?: unknown; error?: unknown };

/** Generic PostgREST chain: every builder returns itself, terminals resolve. */
function chain(listResult: ChainResult = { data: null, error: null }, rowResult: ChainResult = { data: { id: "created-1" }, error: null }) {
  const c: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "limit", "update", "insert", "delete"]) c[method] = vi.fn(() => c);
  c.maybeSingle = vi.fn(async () => rowResult);
  c.single = vi.fn(async () => rowResult);
  (c as { then: unknown }).then = (resolve: (value: ChainResult) => unknown) => Promise.resolve(listResult).then(resolve);
  return c as Record<string, ReturnType<typeof vi.fn>> & { then: unknown };
}

function cookieClient({
  userId = "user-1",
  isAdmin = false,
  tables = {} as Record<string, unknown>
} = {}) {
  const profileChain = chain({ data: null, error: null }, { data: { is_admin: isAdmin }, error: null });
  const from = vi.fn((table: string) => (tables as Record<string, unknown>)[table] ?? (table === "op_profiles" ? profileChain : chain()));
  createSupabaseServerClientMock.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null } })) },
    rpc: vi.fn(async () => ({ data: [{ allowed: true, remaining: 10, retry_after_seconds: 60 }], error: null })),
    from
  });
  return { from };
}

function adminClient(tables: Record<string, unknown> = {}) {
  const from = vi.fn((table: string) => tables[table] ?? chain());
  getSupabaseServerClientMock.mockReturnValue({ from });
  return { from };
}

beforeEach(() => {
  createSupabaseServerClientMock.mockReset();
  getSupabaseServerClientMock.mockReset();
  getSupabaseServerClientMock.mockReturnValue(null);
});

describe("moderation routes", () => {
  it("rejects unauthenticated reports", async () => {
    const { from } = cookieClient({ userId: null as unknown as string });
    const response = await fileReport(jsonRequest("/api/community/reports", { contentType: "feed_post", contentId: CONTENT_ID, category: "spam" }));
    expect(response.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("files a report", async () => {
    const reports = chain();
    const { from } = cookieClient({ tables: { op_content_reports: reports } });
    const response = await fileReport(
      jsonRequest("/api/community/reports", { contentType: "feed_post", contentId: CONTENT_ID, category: "spam", note: "obvious bot" })
    );
    expect(response.status).toBe(201);
    expect(from).toHaveBeenCalledWith("op_content_reports");
    expect(reports.insert).toHaveBeenCalledWith(
      expect.objectContaining({ reporter_id: "user-1", content_type: "feed_post", content_id: CONTENT_ID, category: "spam" })
    );
  });

  it("treats a duplicate report as already filed", async () => {
    const reports = chain({ data: null, error: null }, { data: null, error: { code: "23505", message: "duplicate" } });
    cookieClient({ tables: { op_content_reports: reports } });
    const response = await fileReport(
      jsonRequest("/api/community/reports", { contentType: "feed_post", contentId: CONTENT_ID, category: "spam" })
    );
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });

  it("rejects an unknown report category before any write", async () => {
    const { from } = cookieClient();
    const response = await fileReport(
      jsonRequest("/api/community/reports", { contentType: "feed_post", contentId: CONTENT_ID, category: "did-not-like-it" })
    );
    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("blocks and unblocks a user, refusing self-blocks", async () => {
    const blocks = chain();
    const { from } = cookieClient({ tables: { op_user_blocks: blocks } });
    const created = await createBlock(jsonRequest("/api/community/blocks", { blockedId: OTHER_USER }));
    expect(created.status).toBe(201);
    expect(blocks.insert).toHaveBeenCalledWith({ blocker_id: "user-1", blocked_id: OTHER_USER });

    cookieClient({ tables: { op_user_blocks: chain() } });
    const self = await createBlock(jsonRequest("/api/community/blocks", { blockedId: "user-1" }));
    expect(self.status).toBe(400);

    cookieClient({ tables: { op_user_blocks: blocks } });
    const removed = await removeBlock(
      new Request(`http://127.0.0.1:3025/api/community/blocks?blockedId=${OTHER_USER}`, { method: "DELETE" })
    );
    expect(removed.status).toBe(200);
  });

  it("refuses the moderation queue to non-admins without touching the service client", async () => {
    cookieClient({ isAdmin: false });
    const response = await readQueue();
    expect(response.status).toBe(403);
    expect(getSupabaseServerClientMock).not.toHaveBeenCalled();
  });

  it("hides content and writes exactly one audit row", async () => {
    cookieClient({ isAdmin: true });
    const posts = chain();
    const audit = chain();
    const { from } = adminClient({ op_feed_posts: posts, op_moderation_actions: audit });
    const response = await applyAction(
      jsonRequest("/api/community/moderation", {
        action: "hide",
        contentType: "feed_post",
        contentId: CONTENT_ID,
        reason: "scam link farm"
      })
    );
    expect(response.status).toBe(201);
    expect(from).toHaveBeenCalledWith("op_feed_posts");
    expect(posts.update).toHaveBeenCalledWith(expect.objectContaining({ hidden_reason: "scam link farm" }));
    expect(audit.insert).toHaveBeenCalledTimes(1);
    expect(audit.insert).toHaveBeenCalledWith(
      expect.objectContaining({ actor_id: "user-1", action: "hide", content_type: "feed_post", content_id: CONTENT_ID, reason: "scam link farm" })
    );
  });

  it("locks a thread and resolves the linked report", async () => {
    cookieClient({ isAdmin: true });
    const threads = chain();
    const reports = chain();
    const audit = chain();
    adminClient({ op_forum_threads: threads, op_content_reports: reports, op_moderation_actions: audit });
    const response = await applyAction(
      jsonRequest("/api/community/moderation", {
        action: "lock_thread",
        contentType: "forum_thread",
        contentId: CONTENT_ID,
        reportId: REPORT_ID,
        reason: "escalating harassment thread"
      })
    );
    expect(response.status).toBe(201);
    expect(threads.update).toHaveBeenCalledWith({ is_locked: true });
    expect(reports.update).toHaveBeenCalledWith(expect.objectContaining({ status: "actioned" }));
    expect(audit.insert).toHaveBeenCalledTimes(1);
  });

  it("moderates a tip by tombstone only, never touching tracked values", async () => {
    cookieClient({ isAdmin: true });
    const tips = chain();
    const audit = chain();
    adminClient({ op_community_tips: tips, op_moderation_actions: audit });
    const response = await applyAction(
      jsonRequest("/api/community/moderation", {
        action: "moderate_tip",
        contentType: "community_tip",
        contentId: CONTENT_ID,
        reason: "solicitation in rationale"
      })
    );
    expect(response.status).toBe(201);
    const updated = (tips.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(updated).sort()).toEqual(["moderated_at", "moderated_reason"]);
  });

  it("rejects an appeal for an action that did not target the caller", async () => {
    cookieClient();
    const actions = chain({ data: null, error: null }, { data: null, error: null });
    adminClient({ op_moderation_actions: actions });
    const response = await fileAppeal(jsonRequest("/api/community/appeals", { actionId: ACTION_ID, body: "This decision was wrong, here is why." }));
    expect(response.status).toBe(404);
  });

  it("files an appeal once and treats a duplicate as already filed", async () => {
    cookieClient();
    const actions = chain({ data: null, error: null }, { data: { id: ACTION_ID }, error: null });
    const appeals = chain();
    adminClient({ op_moderation_actions: actions, op_moderation_appeals: appeals });
    const created = await fileAppeal(jsonRequest("/api/community/appeals", { actionId: ACTION_ID, body: "This decision was wrong, here is why." }));
    expect(created.status).toBe(201);
    expect(appeals.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action_id: ACTION_ID, appellant_id: "user-1" })
    );

    cookieClient();
    adminClient({
      op_moderation_actions: chain({ data: null, error: null }, { data: { id: ACTION_ID }, error: null }),
      op_moderation_appeals: chain({ data: null, error: null }, { data: null, error: { code: "23505", message: "duplicate" } })
    });
    const duplicate = await fileAppeal(jsonRequest("/api/community/appeals", { actionId: ACTION_ID, body: "This decision was wrong, here is why." }));
    expect(duplicate.status).toBe(200);
  });
});

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
