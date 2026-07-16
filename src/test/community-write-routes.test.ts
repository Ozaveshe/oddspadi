import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/serverAuthClient", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock
}));

import { POST as createPost } from "@/app/api/community/posts/route";
import { POST as createThread } from "@/app/api/community/threads/route";
import { POST as createReply } from "@/app/api/community/replies/route";

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
});
