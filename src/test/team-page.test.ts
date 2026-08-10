import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(join(process.cwd(), ...relative.split("/")), "utf8");

describe("team page", () => {
  const page = read("src/app/predictions/team/[teamId]/page.tsx");

  it("builds from canonical reads and honest adapters", () => {
    expect(page).toContain("readTeamFixtures");
    expect(page).toContain("teamSections");
    expect(page).toContain("deriveFormFromResults");
    expect(page).toContain("buildOfficialTable");
    expect(page).toContain("CommunitySubjectPanel");
    expect(page).toContain("FollowTeamButton");
  });

  it("gates indexability on durable data and noindexes unknown teams", () => {
    expect(page).toContain("index: false");
    expect(page).toMatch(/durable/);
  });

  it("never implies a pre-season rank", () => {
    expect(page).toContain("Season not started");
  });

  it("accepts both the colon and dash id forms", () => {
    expect(page).toContain("candidateTeamIds");
    expect(page).toMatch(/replace\(\/-\(\?=/);
  });
});

describe("team page wiring", () => {
  it("the product-shell contract can substitute the new segment", () => {
    expect(read("src/test/product-shell-contract.test.tsx")).toContain('[teamId]", "api-football-33');
  });

  it("the match page links both teams to their pages", () => {
    expect(read("src/app/predictions/[matchId]/page.tsx")).toContain("/predictions/team/${encodeURIComponent(");
  });

  it("search results route teams with canonical ids to the team page", () => {
    expect(read("src/lib/discovery/searchCatalogue.ts")).toContain("/predictions/team/${encodeURIComponent(row.id)}");
  });

  it("the route map documents the team route", () => {
    expect(read("docs/route-map.md")).toContain("`/predictions/team/[teamId]`");
  });
});
