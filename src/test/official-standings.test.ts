import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildOfficialTable, classifyTableFreshness, type StandingRow } from "@/lib/discovery/tableState";

const row = (name: string, extra: Partial<StandingRow> = {}): StandingRow => ({
  teamId: name.toLowerCase(),
  teamName: name,
  played: 0,
  won: 0,
  drawn: 0,
  lost: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  points: 0,
  ...extra
});

describe("official table", () => {
  it("pre-season zero table is alphabetical with no positions and says so", () => {
    const table = buildOfficialTable([row("Wolves"), row("Arsenal")]);
    expect(table.state).toBe("season-not-started");
    if (table.state !== "season-not-started") return;
    expect(table.rows.map((r) => r.teamName)).toEqual(["Arsenal", "Wolves"]);
    expect(table.rows[0]).not.toHaveProperty("position");
    expect(table.label).toBe("Season not started");
  });

  it("in-season table ranks by net points and keeps positions", () => {
    const table = buildOfficialTable([
      row("Arsenal", { played: 3, won: 3, points: 9, goalsFor: 7, goalsAgainst: 2 }),
      row("Wolves", { played: 3, won: 1, points: 3, goalsFor: 3, goalsAgainst: 5 })
    ]);
    expect(table.state).toBe("in-progress");
    if (table.state !== "in-progress") return;
    expect(table.rows[0]).toMatchObject({ teamName: "Arsenal", position: 1 });
    expect(table.matchesPlayed).toBe(6);
  });

  it("carries a points deduction annotation without inventing points", () => {
    const table = buildOfficialTable([
      row("Everton", { played: 10, won: 6, points: 12, pointsAdjustment: -6, adjustmentNote: "points deduction" }),
      row("Arsenal", { played: 10, won: 5, points: 15 })
    ]);
    expect(table.state).toBe("in-progress");
    if (table.state !== "in-progress") return;
    const everton = table.rows.find((r) => r.teamName === "Everton");
    expect(everton?.pointsAdjustment).toBe(-6);
    expect(everton?.adjustmentNote).toBe("points deduction");
    expect(everton?.position).toBe(2);
  });

  it("classifies provider-table freshness honestly", () => {
    const now = new Date("2026-08-09T12:00:00Z");
    expect(classifyTableFreshness("2026-08-09T11:00:00Z", now).status).toBe("current");
    expect(classifyTableFreshness("2026-08-07T11:00:00Z", now).status).toBe("delayed");
    expect(classifyTableFreshness(null, now).status).toBe("unavailable");
    expect(classifyTableFreshness("2026-08-07T11:00:00Z", now).note).toMatch(/24 hours/);
  });
});

describe("the table page renders the official-table builder, not raw provider rows", () => {
  const page = readFileSync(
    join(process.cwd(), "src", "app", "predictions", "league", "[slug]", "table", "page.tsx"),
    "utf8"
  );

  it("maps rows through buildOfficialTable and renders its output", () => {
    expect(page).toContain("toStandingRows");
    expect(page).toContain("officialTable.rows");
    expect(page).not.toMatch(/\btable\.rows\.map\(/);
  });

  it("shows freshness and keeps simulations out", () => {
    expect(page).toContain("classifyTableFreshness");
    expect(page).not.toMatch(/titleProbability|simulat/i);
  });
});

describe("the match page never implies a rank before the season starts", () => {
  const page = readFileSync(join(process.cwd(), "src", "app", "predictions", "[matchId]", "page.tsx"), "utf8");
  it("guards the inline standings position on total matches played", () => {
    expect(page).toMatch(/seasonNotStarted|matchesPlayed === 0|tableHasPlay/);
  });
});
