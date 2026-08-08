import { describe, expect, it } from "vitest";
import { competitionTier, toCardInput, toRankableFixture } from "@/lib/discovery/slateAdapter";
import { readViewerContext } from "@/lib/discovery/viewerContext";
import { curateBoard } from "@/lib/discovery/fixtureRanking";
import { buildTodayBoard } from "@/lib/discovery/todayBoard";
import type { SlateFixture } from "@/lib/sports/intelligence/types";

function row(overrides: Partial<SlateFixture> = {}, fixtureOverrides: Record<string, unknown> = {}): SlateFixture {
  return {
    fixture: {
      fixtureId: "fx-1",
      providerFixtureId: "af-1",
      sport: "football",
      league: "Premier League",
      leagueId: "epl",
      country: "England",
      season: "2026",
      kickoffAt: "2026-08-08T19:00:00.000Z",
      homeTeam: { id: "h", name: "Arsenal" },
      awayTeam: { id: "a", name: "Chelsea" },
      status: "scheduled",
      score: null,
      provider: "api-football",
      lastSyncedAt: "2026-08-08T17:00:00.000Z",
      dataQuality: 0.82,
      ...fixtureOverrides
    },
    odds: [],
    decisions: [],
    decisionSummary: { generatedAt: "2026-08-08T17:30:00.000Z" },
    publicStatus: "value_pick",
    bestDecision: null,
    ...overrides
  } as unknown as SlateFixture;
}

describe("slate to rankable", () => {
  it("carries identity, competition and kickoff across", () => {
    const rankable = toRankableFixture(row());
    expect(rankable).toMatchObject({
      fixtureId: "fx-1",
      sport: "football",
      competition: "Premier League",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      status: "scheduled"
    });
  });

  it("resolves the competition tier from the registry", () => {
    expect(competitionTier(row())).toBe("top-five");
  });

  it("treats an unclassified competition as unknown rather than mid-tier", () => {
    // A competition we have not classified is not thereby important; treating
    // unknown as mid would let every unrecognised feed dominate the board.
    expect(competitionTier(row({}, { league: "Regionalliga Nord", leagueId: "rl-nord" }))).toBe("unknown");
  });

  it("counts coverage from the existence of a decision, not its verdict", () => {
    // Relevance is not "the model likes a bet".
    const passed = row({ publicStatus: "no_clear_value", decisions: [{}] as never });
    expect(toRankableFixture(passed).hasModelCoverage).toBe(true);
    expect(toRankableFixture(passed).hasOfficialDecision).toBe(false);
  });

  it("marks only genuinely published statuses as official", () => {
    expect(toRankableFixture(row({ publicStatus: "value_pick" })).hasOfficialDecision).toBe(true);
    expect(toRankableFixture(row({ publicStatus: "lean" })).hasOfficialDecision).toBe(true);
    for (const status of ["watchlist", "no_clear_value", "preliminary", "stale", "needs_data"] as const) {
      expect(toRankableFixture(row({ publicStatus: status })).hasOfficialDecision).toBe(false);
    }
  });

  it("maps abandoned onto cancelled for ordering", () => {
    expect(toRankableFixture(row({}, { status: "abandoned" })).status).toBe("cancelled");
  });
});

describe("slate to card", () => {
  it("maps each public status onto a consumer decision", () => {
    expect(toCardInput(row({ publicStatus: "value_pick" })).decision).toBe("pick");
    expect(toCardInput(row({ publicStatus: "lean" })).decision).toBe("lean");
    expect(toCardInput(row({ publicStatus: "watchlist" })).decision).toBe("watch");
    expect(toCardInput(row({ publicStatus: "no_clear_value" })).decision).toBe("pass");
    expect(toCardInput(row({ publicStatus: "stale" })).decision).toBe("withheld");
    expect(toCardInput(row({ publicStatus: "needs_data" })).decision).toBe("unavailable");
  });

  it("maps settled and needs-review to unavailable rather than a verdict", () => {
    // Neither is a conclusion about the market.
    expect(toCardInput(row({ publicStatus: "settled" })).decision).toBe("unavailable");
    expect(toCardInput(row({ publicStatus: "needs_review" })).decision).toBe("unavailable");
  });

  it("maps a suspended fixture to unknown rather than guessing live or cancelled", () => {
    expect(toCardInput(row({}, { status: "suspended" })).fixtureStatus).toBe("unknown");
  });

  it("calls odds current only for an actionable, still-scheduled fixture", () => {
    expect(toCardInput(row({ publicStatus: "value_pick" })).oddsAreCurrent).toBe(true);
    expect(toCardInput(row({ publicStatus: "no_clear_value" })).oddsAreCurrent).toBe(false);
    // Kickoff has passed: no price on this board is actionable.
    expect(toCardInput(row({ publicStatus: "value_pick" }, { status: "live" })).oddsAreCurrent).toBe(false);
    expect(toCardInput(row({ publicStatus: "value_pick" }, { status: "finished" })).oddsAreCurrent).toBe(false);
  });

  it("reports stored quotes as historical when none is current", () => {
    const stale = toCardInput(row({ publicStatus: "stale", odds: [{}] as never }));
    expect(stale.oddsAreCurrent).toBe(false);
    expect(stale.hasHistoricalOdds).toBe(true);
  });

  it("never passes the engine's own reason through", () => {
    // The card would replace engine vocabulary anyway; passing it is wasted
    // work that occasionally leaks.
    expect(toCardInput(row()).reason).toBeNull();
  });
});

describe("the board these feed", () => {
  const viewer = readViewerContext();

  it("ranks and splits a mixed slate", () => {
    const rows = [
      row({ publicStatus: "value_pick" }, { fixtureId: "upcoming", status: "scheduled" }),
      row({ publicStatus: "value_pick" }, { fixtureId: "played", status: "finished" }),
      row({ publicStatus: "no_clear_value" }, { fixtureId: "archived", status: "finished" })
    ];
    const board = buildTodayBoard(curateBoard(rows.map((entry) => toRankableFixture(entry)), viewer));

    expect(board.primary.map((entry) => entry.fixture.fixtureId)).toEqual(["upcoming"]);
    expect(board.recentResults.map((entry) => entry.fixture.fixtureId)).toEqual(["played"]);
    expect(board.evidenceArchive.map((entry) => entry.fixture.fixtureId)).toEqual(["archived"]);
  });

  it("keeps finished no-pick evidence off the primary board at scale", () => {
    const rows = [
      row({ publicStatus: "value_pick" }, { fixtureId: "live-one", status: "live" }),
      ...Array.from({ length: 60 }, (_, index) =>
        row({ publicStatus: "no_clear_value" }, { fixtureId: `old-${index}`, status: "finished" })
      )
    ];
    const board = buildTodayBoard(curateBoard(rows.map((entry) => toRankableFixture(entry)), viewer));
    expect(board.primary).toHaveLength(1);
    expect(board.counts.evidenceArchive).toBe(60);
  });
});

describe("the server-side viewer", () => {
  it("claims no follows or saves it cannot know about", () => {
    // Inventing follows would put fixtures at the top for reasons the reader
    // never asked for, with no way to tell.
    const viewer = readViewerContext();
    expect(viewer.followedTeams).toEqual([]);
    expect(viewer.savedFixtureIds).toEqual([]);
    expect(viewer.followedCompetitions).toEqual([]);
  });

  it("accepts a sport preference from the request", () => {
    expect(readViewerContext({ preferredSports: ["tennis"] }).preferredSports).toEqual(["tennis"]);
  });

  it("defaults the region rather than inferring it from a header", () => {
    // A VPN should not change which fixtures a reader is shown.
    expect(readViewerContext().region).toBe("africa");
  });
});
