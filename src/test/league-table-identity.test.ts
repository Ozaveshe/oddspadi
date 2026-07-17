import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("league table identity", () => {
  it("renders stored/provider crests and country context", async () => {
    const source = await readFile("src/app/predictions/league/[slug]/table/page.tsx", "utf8");

    expect(source).toContain("<CountryFlag country={league.country}");
    expect(source).toContain("<TeamCrest name={row.teamName} logo={row.teamLogo}");
    expect(source).toContain("aria-label=\"Major league tables\"");
    expect(source).toContain("featuredFootballLeagueTables.map");
    expect(source).toContain("Latest verified final table");
    expect(source).toContain("provider table is not yet published");
  });
});
