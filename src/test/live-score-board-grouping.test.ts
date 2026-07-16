import { describe, expect, it } from "vitest";
import { groupByLeague } from "@/components/live/LiveScoreBoard";
import type { LiveBoardFixture } from "@/lib/sports/liveScoreBoard";

function fixture(id: number, leagueId: number, leagueName: string, phase: LiveBoardFixture["phase"]): LiveBoardFixture {
  return {
    id,
    matchId: `api-football:${id}`,
    sport: "football",
    kickoff: `2026-07-16T${String(id).padStart(2, "0")}:00:00Z`,
    phase,
    statusShort: phase === "live" ? "1H" : "NS",
    statusLabel: phase === "live" ? "20'" : "NS",
    elapsed: phase === "live" ? 20 : null,
    league: {
      id: leagueId,
      name: leagueName,
      country: "World",
      logo: null,
      flag: null,
      round: null
    },
    home: { id: id * 2, name: `Home ${id}`, logo: null, winner: null },
    away: { id: id * 2 + 1, name: `Away ${id}`, logo: null, winner: null },
    goals: { home: null, away: null },
    analysis: false
  };
}

describe("live-score league grouping", () => {
  it("merges a league that reappears after another phase or competition", () => {
    const conferenceLeague = fixture(1, 848, "UEFA Europa Conference League", "live");
    const europaLeague = fixture(2, 3, "UEFA Europa League", "upcoming");
    const laterConferenceLeague = fixture(3, 848, "UEFA Europa Conference League", "upcoming");

    const groups = groupByLeague([conferenceLeague, europaLeague, laterConferenceLeague]);

    expect(groups).toHaveLength(2);
    expect(groups[0].fixtures.map((row) => row.id)).toEqual([1, 3]);
    expect(groups[0].liveCount).toBe(1);
    expect(groups[1].fixtures.map((row) => row.id)).toEqual([2]);
  });
});
