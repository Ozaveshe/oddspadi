import { beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/serverAuthClient", () => ({ createSupabaseServerClient: createSupabaseServerClientMock }));

import { DELETE as deletePost } from "@/app/api/community/posts/route";
import { DELETE as unlikePost, POST as likePost } from "@/app/api/community/likes/route";

function request(path: string, method: string, body?: object) { return new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); }
function client(userId: string | null = "user-1", insertError: { code: string; message: string } | null = null) {
  const insert = vi.fn(async () => ({ error: insertError }));
  const eq2 = vi.fn(async () => ({ error: null }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const remove = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ insert, delete: remove }));
  createSupabaseServerClientMock.mockResolvedValue({ auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null } })) }, from });
  return { from, insert, remove, eq1, eq2 };
}

beforeEach(() => createSupabaseServerClientMock.mockReset());

describe("community v2 routes", () => {
  it.each([["like", likePost, request("/api/community/likes", "POST", { postId: "post-1" })], ["unlike", unlikePost, request("/api/community/likes?postId=post-1", "DELETE")], ["delete", deletePost, request("/api/community/posts?postId=post-1", "DELETE")]])("rejects signed-out %s", async (_name, handler, req) => { const { from } = client(null); expect((await handler(req)).status).toBe(401); expect(from).not.toHaveBeenCalled(); });
  it("likes a post as the authenticated user", async () => { const { insert } = client(); expect((await likePost(request("/api/community/likes", "POST", { postId: "post-1" }))).status).toBe(201); expect(insert).toHaveBeenCalledWith({ post_id: "post-1", user_id: "user-1" }); });
  it("makes repeated likes idempotent", async () => { client("user-1", { code: "23505", message: "duplicate" }); expect((await likePost(request("/api/community/likes", "POST", { postId: "post-1" }))).status).toBe(201); });
  it("unlikes only the current user's row", async () => { const { remove, eq1, eq2 } = client(); expect((await unlikePost(request("/api/community/likes?postId=post-1", "DELETE"))).status).toBe(200); expect(remove).toHaveBeenCalled(); expect(eq1).toHaveBeenCalledWith("post_id", "post-1"); expect(eq2).toHaveBeenCalledWith("user_id", "user-1"); });
  it("deletes an owned post through the RLS-backed filter", async () => { const { eq1, eq2 } = client(); expect((await deletePost(request("/api/community/posts?postId=post-1", "DELETE"))).status).toBe(200); expect(eq1).toHaveBeenCalledWith("id", "post-1"); expect(eq2).toHaveBeenCalledWith("author_id", "user-1"); });
});
