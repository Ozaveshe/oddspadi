import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/serverAuthClient", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock
}));

import { POST as createPost } from "@/app/api/community/posts/route";
import { POST as createThread } from "@/app/api/community/threads/route";
import { POST as createReply } from "@/app/api/community/replies/route";

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
    from
  });
  return { from, insert };
}

beforeEach(() => {
  createSupabaseServerClientMock.mockReset();
});

describe("community write routes", () => {
  it.each([
    ["post", createPost, "/api/community/posts", { body: "Hello" }, "Sign in to post."],
    ["thread", createThread, "/api/community/threads", { categoryId: "cat-1", title: "Hello", body: "Opening post" }, "Sign in to start a thread."],
    ["reply", createReply, "/api/community/replies", { threadId: "thread-1", body: "Reply" }, "Sign in to reply."]
  ])("rejects unauthenticated %s writes", async (_name, handler, path, body, message) => {
    const { from } = client(null);
    const response = await handler(request(path, body));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: message });
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    ["post", createPost, "/api/community/posts", { body: "x".repeat(2001) }, "A post must be between 1 and 2000 characters."],
    ["thread title", createThread, "/api/community/threads", { categoryId: "cat-1", title: "x".repeat(161), body: "Opening post" }, "Title must be 3–160 characters."],
    ["reply", createReply, "/api/community/replies", { threadId: "thread-1", body: "x".repeat(8001) }, "Reply must be 1–8000 characters."]
  ])("enforces the %s length cap", async (_name, handler, path, body, message) => {
    const { from } = client();
    const response = await handler(request(path, body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    ["post", createPost, "/api/community/posts", { body: "  Hello fans  ", matchId: "match-1" }, "op_feed_posts", { author_id: "user-1", body: "Hello fans", match_id: "match-1" }],
    ["thread", createThread, "/api/community/threads", { categoryId: "cat-1", title: "  Match talk  ", body: "  Opening post  " }, "op_forum_threads", { category_id: "cat-1", author_id: "user-1", title: "Match talk", body: "Opening post" }],
    ["reply", createReply, "/api/community/replies", { threadId: "thread-1", body: "  Good point  " }, "op_forum_replies", { thread_id: "thread-1", author_id: "user-1", body: "Good point" }]
  ])("creates a valid %s", async (_name, handler, path, body, table, inserted) => {
    const { from, insert } = client();
    const response = await handler(request(path, body));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "created-1" });
    expect(from).toHaveBeenCalledWith(table);
    expect(insert).toHaveBeenCalledWith(inserted);
  });
});
