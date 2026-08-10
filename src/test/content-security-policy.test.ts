import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production content security policy", () => {
  it("blocks high-risk document sinks without weakening Next.js script execution", async () => {
    const [netlifyConfig, nextConfig] = await Promise.all([
      readFile("netlify.toml", "utf8"),
      readFile("next.config.mjs", "utf8")
    ]);
    const netlifyPolicy = netlifyConfig.match(/Content-Security-Policy = "([^"]+)"/)?.[1] ?? "";
    const nextPolicy = nextConfig.match(/const contentSecurityPolicy = "([^"]+)"/)?.[1] ?? "";

    const directives = [
      "base-uri 'self'",
      "object-src 'none'",
      "frame-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src-attr 'none'",
      // Connect/image/font sources are now bounded (was: unset, so anything).
      // script-src stays UNSET on purpose so Next's inline hydration runs
      // without 'unsafe-inline'; tightening scripts needs nonces (follow-up).
      "connect-src 'self' https:",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "upgrade-insecure-requests"
    ];
    for (const policy of [netlifyPolicy, nextPolicy]) {
      for (const directive of directives) expect(policy).toContain(directive);
      expect(policy).not.toContain("'unsafe-inline'");
      expect(policy).not.toContain("'unsafe-eval'");
    }
    expect(nextPolicy).toBe(netlifyPolicy);
    expect(nextConfig).toContain('source: "/:path*"');
    expect(nextConfig).toContain('{ key: "Content-Security-Policy", value: contentSecurityPolicy }');
  });
});
