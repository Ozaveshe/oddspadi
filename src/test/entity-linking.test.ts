import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(join(process.cwd(), ...relative.split("/")), "utf8");

describe("canonical entity linking", () => {
  it("fixture cards link the competition hub for prediction leagues", () => {
    const slate = read("src/components/odds/IntelligenceSlate.tsx");
    expect(slate).toContain("/predictions/league/${encodeURIComponent(hubLeague.slug)}");
    expect(slate).toContain("footballLeagueById");
  });

  it("the match page links both teams and marks postponed/cancelled events truthfully", () => {
    const page = read("src/app/predictions/[matchId]/page.tsx");
    expect(page).toContain("/predictions/team/${encodeURIComponent(");
    expect(page).toContain("EventPostponed");
    expect(page).toContain("EventCancelled");
    expect(page).toContain("SportsTeam");
    expect(page).toMatch(/SportsTeam", name: match\.homeTeam\.name, url:/);
  });

  it("news stories link their sport surface", () => {
    expect(read("src/app/news/[slug]/page.tsx")).toContain("/predictions?sport=");
  });

  it("the outlook links the official table and the hub links the outlook", () => {
    expect(read("src/app/season-outlooks/page.tsx")).toContain("/predictions/league/premier-league/table");
    expect(read("src/app/predictions/league/[slug]/page.tsx")).toContain("/season-outlooks");
  });

  it("community subject panels connect entity pages to canonical threads", () => {
    expect(read("src/app/predictions/team/[teamId]/page.tsx")).toContain('subjectType="team"');
    expect(read("src/app/predictions/player/[playerId]/page.tsx")).toContain('subjectType="player"');
    expect(read("src/app/predictions/league/[slug]/page.tsx")).toContain('subjectType="competition"');
  });
});
