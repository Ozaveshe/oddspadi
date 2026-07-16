import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production content security policy", () => {
  it("blocks high-risk document sinks without weakening Next.js script execution", async () => {
    const config = await readFile("netlify.toml", "utf8");
    const policy = config.match(/Content-Security-Policy = "([^"]+)"/)?.[1] ?? "";

    for (const directive of [
      "base-uri 'self'",
      "object-src 'none'",
      "frame-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src-attr 'none'",
      "upgrade-insecure-requests"
    ]) expect(policy).toContain(directive);
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
  });
});
