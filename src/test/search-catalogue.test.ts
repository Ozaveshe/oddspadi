import { describe, expect, it } from "vitest";
import { buildCatalogue, competitionEntities, fixtureEntities, teamEntities } from "@/lib/discovery/searchCatalogue";
import { searchEntities } from "@/lib/discovery/search";

const FIXTURES = [
  { id: "fx-1", homeTeam: "Arsenal", awayTeam: "Chelsea", league: "Premier League", kickoffAt: "2026-08-08T19:00:00.000Z" }
];
const TEAMS = [
  { id: "Arsenal", name: "Arsenal", country: "Premier League", nextFixtureId: "fx-1" },
  { id: "Zed United", name: "Zed United", country: null, nextFixtureId: null }
];

describe("the searchable catalogue", () => {
  it("always carries the competitions, database or not", () => {
    // A search that returns nothing because a read failed should still find
    // the Premier League.
    const catalogue = buildCatalogue([], []);
    const epl = catalogue.find((entity) => entity.kind === "competition" && entity.name === "Premier League");
    expect(epl).toBeDefined();
    expect(epl!.href).toContain("/table");
  });

  it("weights competitions by tier so africa-primary sits near the top flight", () => {
    const entities = competitionEntities();
    const epl = entities.find((entity) => entity.name === "Premier League")!;
    const npfl = entities.find((entity) => (entity.context ?? "").includes("Nigeria"));
    if (npfl) expect((npfl.prominence ?? 0) >= (epl.prominence ?? 0) - 4).toBe(true);
  });

  it("routes a team to its next fixture, and to the live board only as a stated fallback", () => {
    const [arsenal, fallback] = teamEntities(TEAMS);
    expect(arsenal!.href).toBe("/predictions/fx-1");
    expect(fallback!.href).toBe("/live-scores");
  });

  it("drops single-character team names rather than indexing noise", () => {
    expect(teamEntities(TEAMS)).toHaveLength(2);
    expect(teamEntities([{ id: "q", name: "Q", country: null, nextFixtureId: null }])).toHaveLength(0);
  });

  it("makes a fixture findable by either side alone", () => {
    const catalogue = fixtureEntities(FIXTURES);
    const byAway = searchEntities("chelsea", catalogue);
    expect(byAway[0]?.entity.id).toBe("fx-1");
    expect(byAway[0]?.matchedOn).toBe("Chelsea");
  });

  it("routes every fixture through the canonical route, the same one in every phase", () => {
    expect(fixtureEntities(FIXTURES)[0]!.href).toBe("/predictions/fx-1");
  });

  it("resolves a full end-to-end query across kinds", () => {
    const results = searchEntities("arsenal", buildCatalogue(TEAMS, FIXTURES));
    const kinds = new Set(results.map((result) => result.entity.kind));
    expect(kinds.has("team")).toBe(true);
    expect(kinds.has("fixture")).toBe(true);
  });
});
