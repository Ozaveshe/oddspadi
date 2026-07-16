import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/serverAuthClient", () => ({ createSupabaseServerClient: createSupabaseServerClientMock }));

import { DELETE as deletePost, GET as getPosts } from "@/app/api/community/posts/route";
import { DELETE as unlikePost, POST as likePost } from "@/app/api/community/likes/route";

const POST_ID = "123e4567-e89b-42d3-a456-426614174002";

function request(path: string, method: string, body?: object) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
}

function client(userId: string | null = "user-1", insertError: { code: string; message: string } | null = null) {
  const insert = vi.fn(async () => ({ error: insertError }));
  const eq2 = vi.fn(async () => ({ error: null }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const remove = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ insert, delete: remove }));
  createSupabaseServerClientMock.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null } })) },
    from
  });
  return { from, insert, remove, eq1, eq2 };
}

beforeEach(() => createSupabaseServerClientMock.mockReset());

describe("community v2 routes", () => {
  it("bounds public reads and keeps upstream HTML out of the fallback note", async () => {
    const abortSignal = vi.fn(async (_signal: AbortSignal) => ({ data: null, error: { message: "<!DOCTYPE html><title>522</title>" } }));
    const limit = vi.fn(() => ({ abortSignal }));
    const order = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ order }));
    createSupabaseServerClientMock.mockResolvedValue({ from: vi.fn(() => ({ select })) });

    const response = await getPosts(request("/api/community/posts", "GET"));
    const payload = await response.json() as { posts: unknown[]; note: string };

    expect(payload.posts).toEqual([]);
    expect(payload.note).toBe("Community posts are temporarily unavailable. Please try again shortly.");
    expect(payload.note).not.toContain("DOCTYPE");
    expect(abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["like", likePost, request("/api/community/likes", "POST", { postId: POST_ID })],
    ["unlike", unlikePost, request(`/api/community/likes?postId=${POST_ID}`, "DELETE")],
    ["delete", deletePost, request(`/api/community/posts?postId=${POST_ID}`, "DELETE")]
  ])("rejects signed-out %s", async (_name, handler, req) => {
    const { from } = client(null);
    expect((await handler(req)).status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("likes a post as the authenticated user", async () => {
    const { insert } = client();
    expect((await likePost(request("/api/community/likes", "POST", { postId: POST_ID }))).status).toBe(201);
    expect(insert).toHaveBeenCalledWith({ post_id: POST_ID, user_id: "user-1" });
  });

  it("makes repeated likes idempotent", async () => {
    client("user-1", { code: "23505", message: "duplicate" });
    expect((await likePost(request("/api/community/likes", "POST", { postId: POST_ID }))).status).toBe(201);
  });

  it("unlikes only the current user's row", async () => {
    const { remove, eq1, eq2 } = client();
    expect((await unlikePost(request(`/api/community/likes?postId=${POST_ID}`, "DELETE"))).status).toBe(200);
    expect(remove).toHaveBeenCalled();
    expect(eq1).toHaveBeenCalledWith("post_id", POST_ID);
    expect(eq2).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("deletes an owned post through the RLS-backed filter", async () => {
    const { eq1, eq2 } = client();
    expect((await deletePost(request(`/api/community/posts?postId=${POST_ID}`, "DELETE"))).status).toBe(200);
    expect(eq1).toHaveBeenCalledWith("id", POST_ID);
    expect(eq2).toHaveBeenCalledWith("author_id", "user-1");
  });
});
