import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(join(process.cwd(), ...relative.split("/")), "utf8");

describe("player page", () => {
  const page = read("src/app/predictions/player/[playerId]/page.tsx");

  it("builds from canonical reads, tennis strength and honest adapters", () => {
    expect(page).toContain("readTeamFixtures");
    expect(page).toContain("playerSections");
    expect(page).toContain("loadHistoricalTennisStrength");
    expect(page).toContain("personNamesAlign");
    expect(page).toContain("CommunitySubjectPanel");
  });

  it("enforces the thin-page rule: noindex unless five stored matches and a rating", () => {
    expect(page).toContain("index: false");
    expect(page).toContain("matches >= 5 && strength !== null");
  });

  it("warns on small samples instead of hiding them", () => {
    expect(page).toContain("small sample");
    expect(page).toContain("SMALL_SAMPLE");
  });

  it("keeps head-to-head as sample-warned context, never a fabricated table", () => {
    expect(page).toMatch(/head-to-head/i);
    expect(page).not.toContain("HeadToHeadTable");
  });
});

describe("player page wiring", () => {
  it("the product-shell contract can substitute the new segment", () => {
    expect(read("src/test/product-shell-contract.test.tsx")).toContain('[playerId]", "api-tennis-501');
  });

  it("the route map documents the player route", () => {
    expect(read("docs/route-map.md")).toContain("`/predictions/player/[playerId]`");
  });
});
