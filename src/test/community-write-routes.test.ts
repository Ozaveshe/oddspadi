import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/serverAuthClient", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock
}));

import { POST as createPost, GET as readPosts } from "@/app/api/community/posts/route";
import { POST as createThread } from "@/app/api/community/threads/route";
import { POST as createReply } from "@/app/api/community/replies/route";
import { POST as createComment } from "@/app/api/community/comments/route";
import { POST as createTip } from "@/app/api/community/tips/route";

const CATEGORY_ID = "123e4567-e89b-42d3-a456-426614174003";
const THREAD_ID = "123e4567-e89b-42d3-a456-426614174004";

function request(path: string, body: Record<string, unknown>) {
  return new Request(`http://127.0.0.1:3025${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function client(userId: string | null = "user-1") {
  const insert = vi.fn((values: Record<string, unknown>) => ({
    select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: "created-1" }, error: null })) }))
  }));
  const from = vi.fn(() => ({ insert }));
  createSupabaseServerClientMock.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null } })) },
    rpc: vi.fn(async () => ({ data: [{ allowed: true, remaining: 10, retry_after_seconds: 60 }], error: null })),
    from
  });
  return { from, insert };
}

beforeEach(() => createSupabaseServerClientMock.mockReset());

describe("community write routes", () => {
  it.each([
    ["post", createPost, "/api/community/posts", { body: "Hello" }, "Sign in to post."],
    ["thread", createThread, "/api/community/threads", { categoryId: CATEGORY_ID, title: "Hello", body: "Opening post" }, "Sign in to start a thread."],
    ["reply", createReply, "/api/community/replies", { threadId: THREAD_ID, body: "Reply" }, "Sign in to reply."]
  ])("rejects unauthenticated %s writes", async (_name, handler, route, body, message) => {
    const { from } = client(null);
    const response = await handler(request(route, body));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: message });
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    ["post", createPost, "/api/community/posts", { body: "x".repeat(2001) }, "A post must be between 1 and 2000 characters."],
    ["thread title", createThread, "/api/community/threads", { categoryId: CATEGORY_ID, title: "x".repeat(161), body: "Opening post" }, "Title must be 3–160 characters."],
    ["reply", createReply, "/api/community/replies", { threadId: THREAD_ID, body: "x".repeat(8001) }, "Reply must be 1–8000 characters."]
  ])("enforces the %s length cap", async (_name, handler, route, body, message) => {
    const { from } = client();
    const response = await handler(request(route, body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    ["post", createPost, "/api/community/posts", { body: "  Hello fans  ", matchId: "match-1" }, "op_feed_posts", { author_id: "user-1", body: "Hello fans", match_id: "match-1" }],
    ["thread", createThread, "/api/community/threads", { categoryId: CATEGORY_ID, title: "  Match talk  ", body: "  Opening post  " }, "op_forum_threads", { category_id: CATEGORY_ID, author_id: "user-1", title: "Match talk", body: "Opening post" }],
    ["reply", createReply, "/api/community/replies", { threadId: THREAD_ID, body: "  Good point  " }, "op_forum_replies", { thread_id: THREAD_ID, author_id: "user-1", body: "Good point" }]
  ])("creates a valid %s", async (_name, handler, route, body, table, inserted) => {
    const { from, insert } = client();
    const response = await handler(request(route, body));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "created-1" });
    expect(from).toHaveBeenCalledWith(table);
    expect(insert).toHaveBeenCalledWith(inserted);
  });

  it.each([
    ["post solicitation", createPost, "/api/community/posts", { body: "DM me for tips tonight, big odds waiting" }],
    ["comment shortener link", createComment, "/api/community/comments", { postId: THREAD_ID, body: "join https://bit.ly/xyz now" }],
    ["thread certainty claim", createThread, "/api/community/threads", { categoryId: CATEGORY_ID, title: "Weekend value", body: "guaranteed win tonight, trust me" }],
    ["reply paid-tips channel", createReply, "/api/community/replies", { threadId: THREAD_ID, body: "my VIP group is on t.me/bigwins" }],
    [
      "tip rationale solicitation",
      createTip,
      "/api/community/tips",
      {
        fixtureId: "api-football-1234",
        sport: "football",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        kickoffAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
        market: "match_winner",
        selection: "home",
        selectionLabel: "Arsenal to win",
        tippedOdds: 2.1,
        stakeUnits: 1,
        rationale: "Pay for sure tips from my private channel, fixed matches available every single weekend here."
      }
    ]
  ])("rejects unsafe content (%s) before any DB write", async (_name, handler, route, body) => {
    const { insert } = client();
    const response = await handler(request(route, body));
    expect(response.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("filters blocked authors out of the posts feed for the signed-in viewer", async () => {
    const rows = [
      { id: "p1", author_id: "user-2", body: "ok", match_id: null, created_at: "2026-08-08T10:00:00.000Z", author: null, likes: [], comments: [] },
      { id: "p2", author_id: "user-3", body: "noise", match_id: null, created_at: "2026-08-08T09:00:00.000Z", author: null, likes: [], comments: [] }
    ];
    const postsChain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "order", "limit", "lt"]) postsChain[method] = vi.fn(() => postsChain);
    postsChain.abortSignal = vi.fn(async () => ({ data: rows, error: null }));
    const blocksChain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "limit"]) blocksChain[method] = vi.fn(() => blocksChain);
    (blocksChain as { then: unknown }).then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [{ blocked_id: "user-3" }], error: null }).then(resolve);
    createSupabaseServerClientMock.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })) },
      rpc: vi.fn(async () => ({ data: [{ allowed: true, remaining: 10, retry_after_seconds: 60 }], error: null })),
      from: vi.fn((table: string) => (table === "op_user_blocks" ? blocksChain : postsChain))
    });
    const response = await readPosts(new Request("http://127.0.0.1:3025/api/community/posts"));
    const payload = await response.json();
    expect(payload.posts.map((post: { id: string }) => post.id)).toEqual(["p1"]);
  });
});
