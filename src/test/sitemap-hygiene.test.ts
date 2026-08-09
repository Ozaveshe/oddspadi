import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const getFixturesMock = vi.hoisted(() => vi.fn(async () => []));
const getNewsStoriesMock = vi.hoisted(() => vi.fn(async () => []));

vi.mock("@/lib/sports/service", () => ({
  sportsProvider: { getFixtures: getFixturesMock },
  todayIsoDate: () => "2026-08-09"
}));
vi.mock("@/lib/editorial/news", () => ({ getNewsStories: getNewsStoriesMock }));

import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

const read = (relative: string) => readFileSync(join(process.cwd(), ...relative.split("/")), "utf8");

// The private/thin routes that must never be crawled — the noindex set plus the
// operator/API surfaces. Kept in sync with route-canonical-contract's NOINDEX.
const FORBIDDEN_PREFIXES = ["/my", "/account", "/offline", "/tips", "/community/u/", "/community/moderation", "/workspace/shared/", "/api/", "/live", "/ops"];

describe("sitemap hygiene", () => {
  afterEach(() => vi.clearAllMocks());

  it("emits no private, operator, or thin route", async () => {
    const entries = await sitemap();
    const paths = entries.map((entry) => new URL(entry.url).pathname);
    for (const path of paths) {
      for (const forbidden of FORBIDDEN_PREFIXES) {
        // /live-scores is allowed; only the /live API and the exact private
        // prefixes are forbidden.
        const hit = forbidden.endsWith("/") ? path.startsWith(forbidden) : path === forbidden || path.startsWith(`${forbidden}/`);
        expect(hit, `sitemap must not include ${path} (matched ${forbidden})`).toBe(false);
      }
    }
    // Sanity: the sitemap is not empty of legitimate routes.
    expect(paths).toContain("/");
    expect(paths).toContain("/track-record");
  });

  it("robots disallows the private prefixes and points at the sitemap", () => {
    const rules = robots();
    const rule = Array.isArray(rules.rules) ? rules.rules[0] : rules.rules;
    const disallow = Array.isArray(rule?.disallow) ? rule?.disallow : [rule?.disallow];
    for (const prefix of ["/api/", "/account", "/offline", "/tips", "/ops"]) {
      expect(disallow).toContain(prefix);
    }
    expect(rules.sitemap).toMatch(/\/sitemap\.xml$/);
  });
});

describe("structured-data hygiene", () => {
  it("breadcrumb JSON-LD always starts at Home (position 1)", () => {
    for (const file of [
      "src/app/predictions/[matchId]/page.tsx",
      "src/app/predictions/league/[slug]/page.tsx",
      "src/app/predictions/league/[slug]/table/page.tsx",
      "src/app/news/[slug]/page.tsx",
      "src/app/forums/[category]/page.tsx",
      "src/app/forums/[category]/[thread]/page.tsx"
    ]) {
      const source = read(file);
      if (!source.includes("BreadcrumbList")) continue;
      expect(source, `${file} breadcrumb must start at Home`).toMatch(/position:\s*1,\s*name:\s*"Home"/);
    }
  });

  it("emits SportsEvent only from the match page, which guards on a real fixture", () => {
    const match = read("src/app/predictions/[matchId]/page.tsx");
    expect(match).toContain("SportsEvent");
    // The page notFound()s a missing fixture before it can emit the schema.
    expect(match).toContain("notFound()");
  });
});
