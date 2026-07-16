import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Supabase session cache security", () => {
  it("propagates SSR no-store headers whenever refreshed auth cookies are set", async () => {
    const source = await readFile("src/middleware.ts", "utf8");

    expect(source).toContain("setAll(cookiesToSet, headers)");
    expect(source).toContain("Object.entries(headers)");
    expect(source).toContain("response.headers.set(name, value)");
  });

  it("refreshes sessions for cookie-authenticated API routes", async () => {
    const source = await readFile("src/middleware.ts", "utf8");

    expect(source).toContain('"/api/account/:path*"');
    expect(source).toContain('"/api/community/:path*"');
  });
});
