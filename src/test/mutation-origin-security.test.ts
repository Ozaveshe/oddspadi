import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { isTrustedMutationRequest, rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";

function mutation(headers: HeadersInit = {}) {
  return new Request("https://oddspadi.com/api/community/posts", {
    method: "POST",
    headers
  });
}

describe("cookie mutation origin security", () => {
  it("accepts an exact same-origin browser request", () => {
    expect(isTrustedMutationRequest(mutation({ origin: "https://oddspadi.com" }), "production")).toBe(true);
  });

  it("rejects cross-origin and deceptive-origin requests", async () => {
    for (const origin of ["https://evil.example", "https://oddspadi.com.evil.example", "null"]) {
      const response = rejectCrossSiteMutation(mutation({ origin }));
      expect(response?.status).toBe(403);
      await expect(response?.json()).resolves.toEqual({ error: "Cross-site request blocked." });
    }
  });

  it("uses Fetch Metadata when Origin is unavailable", () => {
    expect(isTrustedMutationRequest(mutation({ "sec-fetch-site": "same-origin" }), "production")).toBe(true);
    expect(isTrustedMutationRequest(mutation({ "sec-fetch-site": "same-site" }), "production")).toBe(false);
    expect(isTrustedMutationRequest(mutation({ "sec-fetch-site": "cross-site" }), "production")).toBe(false);
  });

  it("fails closed for headerless production writes while preserving tests and development", () => {
    expect(isTrustedMutationRequest(mutation(), "production")).toBe(false);
    expect(isTrustedMutationRequest(mutation(), "test")).toBe(true);
    expect(isTrustedMutationRequest(mutation(), "development")).toBe(true);
  });

  it("does not interfere with safe read methods", () => {
    const request = new Request("https://oddspadi.com/api/community/posts", { method: "GET" });
    expect(isTrustedMutationRequest(request, "production")).toBe(true);
  });

  it("guards every cookie-authenticated account and community mutation route", async () => {
    const routes = [
      "src/app/api/account/profile/route.ts",
      "src/app/api/account/followed-teams/route.ts",
      "src/app/api/account/push-subscription/route.ts",
      "src/app/api/community/posts/route.ts",
      "src/app/api/community/likes/route.ts",
      "src/app/api/community/comments/route.ts",
      "src/app/api/community/threads/route.ts",
      "src/app/api/community/replies/route.ts"
    ];

    for (const route of routes) {
      const source = await readFile(route, "utf8");
      const mutations = source.match(/export async function (?:POST|PUT|PATCH|DELETE)\(/g) ?? [];
      const guards = source.match(/rejectCrossSiteMutation\(request\)/g) ?? [];
      expect(guards.length, route).toBe(mutations.length);
    }
  });
});
