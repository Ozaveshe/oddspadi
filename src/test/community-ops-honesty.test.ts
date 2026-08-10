import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(join(process.cwd(), ...relative.split("/")), "utf8");

describe("ops honesty", () => {
  it("seed script defaults to dry-run and only posts as verified demo-labelled personas", () => {
    const script = read("scripts/seed-community-posts.mjs");
    expect(script).toContain("--post");
    expect(script).toContain("account_type");
    expect(script).toMatch(/dry[- ]run/i);
    expect(script).toContain("'demo'");
  });

  it("site health accepts an honest empty community feed", () => {
    const script = read("scripts/site-health.mjs");
    expect(script).not.toContain('"feed is empty"');
    expect(script).toContain("api community feed");
  });

  it("daily routine no longer instructs unconditional seeding", () => {
    const automations = read("docs/automations.md");
    expect(automations).not.toContain("keep the feed moving");
    expect(automations).toContain("Demo account");
  });

  it("wires the encoding repair and provenance audit scripts into package.json", () => {
    const pkg = read("package.json");
    expect(pkg).toContain("ops:repair-community-encoding");
    expect(pkg).toContain("ops:audit-community");
  });
});
