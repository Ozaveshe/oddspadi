import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(join(process.cwd(), ...relative.split("/")), "utf8");

describe("competition hub", () => {
  const hub = read("src/app/predictions/league/[slug]/page.tsx");

  it("assembles the intelligence sections from canonical reads", () => {
    expect(hub).toContain("readCompetitionFixtures");
    expect(hub).toContain("buildOfficialTable");
    expect(hub).toContain("summarisePublications");
    expect(hub).toContain("CommunitySubjectPanel");
    expect(hub).toContain("getNewsStories");
    expect(hub).toContain("seasonCoverageQueue");
  });

  it("links the track-record competition filter and the full official table", () => {
    expect(hub).toContain("/track-record?competition=");
    expect(hub).toContain("/table");
  });

  it("keeps simulations out of the official table section", () => {
    expect(hub).not.toMatch(/titleProbability/);
  });

  it("is canonical for known leagues and noindex for unknown slugs", () => {
    expect(hub).toContain("pageMetadata(");
    expect(hub).toContain("index: false");
  });
});

describe("entity fixture list", () => {
  const list = read("src/components/entities/EntityFixtureList.tsx");

  it("links teams and fixtures canonically, encoded", () => {
    expect(list).toContain("/predictions/team/${encodeURIComponent(");
    expect(list).toContain("/predictions/${encodeURIComponent(");
  });

  it("stamps a surface claim per fixture row", () => {
    expect(list).toContain("SurfaceClaimMarker");
    expect(list).toContain('"competition"');
  });

  it("marks model coverage and verified-result corrections", () => {
    expect(list).toContain("hasModelCoverage");
    expect(list).toContain("verified-result");
  });
});

describe("hub wiring", () => {
  it("the sitemap lists competition hubs", () => {
    expect(read("src/app/sitemap.ts")).toContain("/predictions/league/${league.slug}`");
  });

  it("the table page links up to the hub", () => {
    expect(read("src/app/predictions/league/[slug]/table/page.tsx")).toMatch(/predictions\/league\/\$\{encodeURIComponent\((slug|league\.slug)\)\}`/);
  });

  it("the route map documents the hub route", () => {
    expect(read("docs/route-map.md")).toContain("`/predictions/league/[slug]`");
  });
});
