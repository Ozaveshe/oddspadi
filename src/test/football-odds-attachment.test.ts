import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/_archived/api-sports-decision/training/football-odds-attach/route";
import {
  filterClosingEligibleFootballOddsMatches,
  footballOddsRowsForMatches,
  matchFootballOddsEventsToFixtures,
  normalizeFootballOddsEvents,
  normalizeFootballTeamName
} from "@/lib/sports/training/footballOddsAttachment";

describe("football historical odds attachment", () => {
  afterEach(() => {
    delete process.env.ODDSPADI_ADMIN_TOKEN;
  });

  it("normalizes only coherent three-way bookmaker markets", () => {
    const events = normalizeFootballOddsEvents({
      timestamp: "2025-08-15T12:00:00.000Z",
      data: [
        {
          id: "odds-event-1",
          sport_key: "soccer_epl",
          commence_time: "2025-08-15T19:00:00.000Z",
          home_team: "Liverpool",
          away_team: "Bournemouth",
          bookmakers: [
            {
              key: "complete-book",
              title: "Complete Book",
              markets: [
                {
                  key: "h2h",
                  last_update: "2025-08-15T11:55:00.000Z",
                  outcomes: [
                    { name: "Liverpool", price: 1.48 },
                    { name: "Draw", price: 4.8 },
                    { name: "Bournemouth", price: 6.8 }
                  ]
                }
              ]
            },
            {
              key: "incomplete-book",
              title: "Incomplete Book",
              markets: [
                {
                  key: "h2h",
                  outcomes: [
                    { name: "Liverpool", price: 1.5 },
                    { name: "Bournemouth", price: 6.5 }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.quotes).toHaveLength(3);
    expect(new Set(events[0]?.quotes.map((quote) => quote.bookmaker))).toEqual(new Set(["Complete Book"]));
    expect(events[0]?.quotes.map((quote) => quote.selection).sort()).toEqual(["away", "draw", "home"]);
  });

  it("matches provider events to API-Football fixtures and creates no-vig rows", () => {
    const event = normalizeFootballOddsEvents({
      timestamp: "2025-08-15T12:00:00.000Z",
      data: [
        {
          id: "odds-event-1",
          commence_time: "2025-08-15T19:00:00.000Z",
          home_team: "Wolves",
          away_team: "Manchester United FC",
          bookmakers: [
            {
              key: "book",
              title: "Book",
              markets: [
                {
                  key: "h2h",
                  last_update: "2025-08-15T12:00:00.000Z",
                  outcomes: [
                    { name: "Wolves", price: 3.2 },
                    { name: "Draw", price: 3.4 },
                    { name: "Manchester United FC", price: 2.22 }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });
    const { matches, unmatchedEvents } = matchFootballOddsEventsToFixtures(event, [
      {
        fixtureExternalId: "api-football:1",
        provider: "api_football",
        kickoffAt: "2025-08-15T19:00:00.000Z",
        homeTeamExternalId: "wolves",
        awayTeamExternalId: "man-utd",
        homeTeamName: "Wolverhampton Wanderers",
        awayTeamName: "Manchester United"
      }
    ]);
    const rows = footballOddsRowsForMatches(matches);

    expect(normalizeFootballTeamName("Manchester United FC")).toBe("manchester united");
    expect(normalizeFootballTeamName("Newcastle")).toBe("newcastle united");
    expect(normalizeFootballTeamName("Tottenham")).toBe("tottenham hotspur");
    expect(normalizeFootballTeamName("Leeds")).toBe("leeds united");
    expect(matches).toHaveLength(1);
    expect(unmatchedEvents).toHaveLength(0);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.fixture_external_id === "api-football:1" && row.provider === "the_odds_api")).toBe(true);
    expect(rows.reduce((sum, row) => sum + (row.margin_adjusted_probability ?? 0), 0)).toBeCloseTo(1, 5);
  });

  it("labels only fixtures inside the returned snapshot closing window", () => {
    const events = normalizeFootballOddsEvents({
      timestamp: "2025-08-15T18:45:00.000Z",
      data: [
        {
          id: "near-kickoff",
          commence_time: "2025-08-15T19:00:00.000Z",
          home_team: "Liverpool",
          away_team: "Bournemouth",
          bookmakers: [{
            key: "book",
            title: "Book",
            markets: [{
              key: "h2h",
              outcomes: [
                { name: "Liverpool", price: 1.5 },
                { name: "Draw", price: 4.5 },
                { name: "Bournemouth", price: 6.5 }
              ]
            }]
          }]
        },
        {
          id: "future-fixture",
          commence_time: "2025-08-15T22:00:00.000Z",
          home_team: "Arsenal",
          away_team: "Chelsea",
          bookmakers: [{
            key: "book",
            title: "Book",
            markets: [{
              key: "h2h",
              outcomes: [
                { name: "Arsenal", price: 2.1 },
                { name: "Draw", price: 3.4 },
                { name: "Chelsea", price: 3.5 }
              ]
            }]
          }]
        }
      ]
    });
    const { matches } = matchFootballOddsEventsToFixtures(events, [
      {
        fixtureExternalId: "api-football:near",
        provider: "api_football",
        kickoffAt: "2025-08-15T19:00:00.000Z",
        homeTeamExternalId: "liverpool",
        awayTeamExternalId: "bournemouth",
        homeTeamName: "Liverpool",
        awayTeamName: "Bournemouth"
      },
      {
        fixtureExternalId: "api-football:future",
        provider: "api_football",
        kickoffAt: "2025-08-15T22:00:00.000Z",
        homeTeamExternalId: "arsenal",
        awayTeamExternalId: "chelsea",
        homeTeamName: "Arsenal",
        awayTeamName: "Chelsea"
      }
    ]);
    const eligibility = filterClosingEligibleFootballOddsMatches(matches, {
      snapshotAt: "2025-08-15T18:45:00.000Z",
      closingWindowMinutes: 90
    });
    const rows = footballOddsRowsForMatches(eligibility.eligibleMatches, { isClosing: true });

    expect(eligibility.eligibleMatches.map((match) => match.fixture.fixtureExternalId)).toEqual(["api-football:near"]);
    expect(eligibility.rejectedEvents).toEqual([
      expect.objectContaining({
        fixtureExternalId: "api-football:future",
        minutesToKickoff: 195,
        reason: "outside-closing-window"
      })
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.fixture_external_id === "api-football:near" && row.is_closing)).toBe(true);
  });

  it("requires admin authorization before spending historical odds credits", async () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "test-admin-token";
    const response = await POST(
      new Request("http://127.0.0.1:3025/api/sports/decision/training/football-odds-attach?date=2025-08-15T12:00:00.000Z", {
        method: "POST"
      })
    );
    expect(response.status).toBe(401);
  });
});
