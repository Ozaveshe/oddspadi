import { describe, expect, it } from "vitest";
import { identityArtworkMetadata, storedFixtureArtwork } from "@/lib/sports/intelligence/repository";

describe("stored fixture artwork", () => {
  it("always produces non-null identity metadata for storage", () => {
    expect(identityArtworkMetadata()).toEqual({});
    expect(identityArtworkMetadata({ logo: "  ", flag: null })).toEqual({});
    expect(identityArtworkMetadata({ logo: "https://cdn.test/team.png", flag: "https://cdn.test/flag.svg" })).toEqual({
      logo: "https://cdn.test/team.png",
      flag: "https://cdn.test/flag.svg"
    });
  });

  it("rejoins league flags, crests, and team countries onto public slate fixtures", () => {
    const fixture = {
      sport: "football",
      provider: "api-football",
      league_external_id: "39",
      home_team_external_id: "40",
      away_team_external_id: "41",
      country: "England",
      metadata: { leagueLogo: "https://fallback.test/league.png" }
    };
    const artwork = storedFixtureArtwork({
      fixture,
      teams: [
        { sport: "football", provider: "api-football", external_id: "40", country: "England", metadata: { logo: "https://cdn.test/home.png" } },
        { sport: "football", provider: "api-football", external_id: "41", country: "Wales", metadata: { logo: "https://cdn.test/away.png" } }
      ],
      leagues: [
        { sport: "football", provider: "api-football", external_id: "39", name: "Premier League", country: "England", metadata: { logo: "https://cdn.test/league.png", flag: "https://cdn.test/england.svg" } }
      ]
    });

    expect(artwork).toEqual({
      leagueName: "Premier League",
      leagueCountry: "England",
      leagueLogo: "https://cdn.test/league.png",
      leagueFlag: "https://cdn.test/england.svg",
      homeLogo: "https://cdn.test/home.png",
      awayLogo: "https://cdn.test/away.png",
      homeCountry: "England",
      awayCountry: "Wales"
    });
  });

  it("uses persisted fixture artwork without inventing team crests", () => {
    expect(storedFixtureArtwork({
      fixture: { sport: "basketball", provider: "api-basketball", league_external_id: "12", home_team_external_id: "1", away_team_external_id: "2", country: "World", metadata: { leagueFlag: "https://cdn.test/world.svg" } },
      teams: [],
      leagues: []
    })).toMatchObject({ leagueFlag: "https://cdn.test/world.svg", homeLogo: null, awayLogo: null, homeCountry: "World", awayCountry: "World" });
  });
});
