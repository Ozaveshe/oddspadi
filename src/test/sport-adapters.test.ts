import { describe, expect, it } from "vitest";
import { competitionSections, teamSections, playerSections, type SectionSupport } from "@/lib/entities/sportSections";

const SPORTS = ["football", "basketball", "tennis"] as const;

function assertHonest(sections: SectionSupport[]) {
  for (const section of sections) {
    if (!section.supported) {
      expect(section.note, `${section.key} is unsupported and must say why`).toBeTruthy();
    }
  }
}

describe("sport adapters declare honest section support", () => {
  it("every unsupported section carries a reason", () => {
    for (const sport of SPORTS) {
      assertHonest(competitionSections(sport));
      assertHonest(teamSections(sport));
      assertHonest(playerSections(sport));
    }
  });

  it("football: table, fixtures, goals/form supported; squad honestly absent; projection linked", () => {
    const sections = new Map(teamSections("football").map((s) => [s.key, s]));
    expect(sections.get("table")?.supported).toBe(true);
    expect(sections.get("fixtures")?.supported).toBe(true);
    expect(sections.get("form")?.supported).toBe(true);
    expect(sections.get("squad")?.supported).toBe(false);
    expect(sections.get("squad")?.note).toMatch(/provider feed/i);
    expect(new Map(competitionSections("football").map((s) => [s.key, s])).get("projection")?.supported).toBe(true);
  });

  it("basketball: schedule and efficiency supported; standings and roster honestly absent", () => {
    const sections = new Map(competitionSections("basketball").map((s) => [s.key, s]));
    expect(sections.get("fixtures")?.supported).toBe(true);
    expect(sections.get("efficiency")?.supported).toBe(true);
    expect(sections.get("table")?.supported).toBe(false);
    expect(sections.get("table")?.note).toMatch(/standings/i);
    expect(new Map(teamSections("basketball").map((s) => [s.key, s])).get("roster")?.supported).toBe(false);
  });

  it("tennis: player, surface ratings and form supported; H2H carries a sample warning; draw honestly absent", () => {
    const sections = new Map(playerSections("tennis").map((s) => [s.key, s]));
    expect(sections.get("surface_ratings")?.supported).toBe(true);
    expect(sections.get("form")?.supported).toBe(true);
    expect(sections.get("head_to_head")?.supported).toBe(true);
    expect(sections.get("head_to_head")?.note).toMatch(/sample/i);
    expect(sections.get("tournament_draw")?.supported).toBe(false);
  });
});
