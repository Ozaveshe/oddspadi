import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyShareToken, signShareToken } from "@/lib/workspaceSync/shareToken";

const read = (relative: string) => readFileSync(join(process.cwd(), ...relative.split("/")), "utf8");

describe("anonymous workspace endpoints are rate-limited", () => {
  it("the migration defines the device-keyed guest limiter", () => {
    const migration = read("supabase/migrations/20260809140000_guest_rate_limits.sql");
    expect(migration).toContain("op_consume_guest_rate_limit");
    expect(migration).toContain("'workspace_share'");
    expect(migration).toContain("'workspace_compute'");
    expect(migration).toMatch(/revoke all on function public\.op_consume_guest_rate_limit/);
  });

  it("share create and the three compute routes enforce the guest limit", () => {
    expect(read("src/app/api/workspace/share/route.ts")).toContain("enforceGuestRateLimit");
    for (const route of ["settle", "recheck", "convert"]) {
      expect(read(`src/app/api/workspace/${route}/route.ts`)).toContain("enforceGuestRateLimit");
    }
  });
});

describe("share revoke cannot be triggered by a malformed token", () => {
  const secret = "test-share-secret-1234567890";

  it("a malformed token is rejected, never used to revoke by extracted id", () => {
    const route = read("src/app/api/workspace/share/route.ts");
    // The bypass was: fall through to a raw regex id-extraction when the token
    // failed verification. That extraction must be gone.
    expect(route).not.toMatch(/\/\^\(\[a-z0-9-\]\{8,64\}\)\\\.\/\.exec\(token\)/);
    expect(route).toContain("verifyShareToken");
  });

  it("verifyShareToken still rejects malformed and bad-signature tokens", () => {
    expect(verifyShareToken("not-a-token", secret, Date.now())).toEqual({ ok: false, reason: "malformed" });
    expect(verifyShareToken("abcdefgh.9999999999999.badsignaturebadsignature", secret, Date.now()).ok).toBe(false);
    const valid = signShareToken("abcdefgh-1234", Date.now() + 10_000, secret);
    expect(verifyShareToken(valid, secret, Date.now()).ok).toBe(true);
    // A validly-signed but expired token still recovers its id when expiry is
    // ignored — that is the only fallback the revoke path may use.
    const expired = signShareToken("abcdefgh-1234", Date.now() - 10_000, secret);
    expect(verifyShareToken(expired, secret, Date.now())).toEqual({ ok: false, reason: "expired" });
    expect(verifyShareToken(expired, secret, 0).ok).toBe(true);
  });
});
