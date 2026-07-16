import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";

function client(result: { data: unknown; error: null | { code?: string } }) {
  return { rpc: vi.fn(async () => result) };
}

describe("authenticated write rate limits", () => {
  afterEach(() => vi.restoreAllMocks());

  it("allows requests with remaining quota", async () => {
    const db = client({ data: [{ allowed: true, remaining: 4, retry_after_seconds: 60 }], error: null });
    await expect(enforceUserRateLimit(db as never, "community_post")).resolves.toBeNull();
    expect(db.rpc).toHaveBeenCalledWith("op_consume_user_rate_limit", { p_action: "community_post" });
  });

  it("returns a bounded 429 with Retry-After when exhausted", async () => {
    const db = client({ data: [{ allowed: false, remaining: 0, retry_after_seconds: 37.2 }], error: null });
    const response = await enforceUserRateLimit(db as never, "forum_thread");
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("38");
  });

  it("fails closed when the limiter is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await enforceUserRateLimit(client({ data: null, error: { code: "PGRST000" } }) as never, "community_like");
    expect(response?.status).toBe(503);
  });

  it("uses fixed database policies with auth.uid and a pinned security-definer path", async () => {
    const source = await readFile("supabase/migrations/20260716212537_add_authenticated_write_rate_limits.sql", "utf8");
    expect(source).toContain("v_user_id uuid := auth.uid()");
    expect(source).toContain("security definer");
    expect(source).toContain("set search_path = pg_catalog, public");
    expect(source).toContain("from public, anon");
    expect(source).toContain("to authenticated, service_role");
    expect(source).not.toContain("p_user_id");
    expect(source).not.toContain("p_limit");
  });

  it("covers every authenticated account and community mutation", async () => {
    for (const route of [
      "src/app/api/account/profile/route.ts",
      "src/app/api/account/followed-teams/route.ts",
      "src/app/api/account/push-subscription/route.ts",
      "src/app/api/community/posts/route.ts",
      "src/app/api/community/likes/route.ts",
      "src/app/api/community/comments/route.ts",
      "src/app/api/community/threads/route.ts",
      "src/app/api/community/replies/route.ts"
    ]) {
      const source = await readFile(route, "utf8");
      const mutations = source.match(/export async function (?:POST|PUT|PATCH|DELETE)\(/g) ?? [];
      const guards = source.match(/enforceUserRateLimit\(/g) ?? [];
      expect(guards.length, route).toBe(mutations.length);
    }
  });
});
