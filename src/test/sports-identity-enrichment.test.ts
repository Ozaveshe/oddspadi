import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readUpcomingIdentityCoverage } from "@/lib/sports/intelligence/identityCoverage";
import { domesticCountryForFixture, enrichUpcomingFixtureIdentities, nationalTeamCountry } from "@/lib/sports/intelligence/identityEnrichment";
import { oddsCompetitionCountry } from "@/lib/sports/providers/providerBackedProvider";
import { flagEmoji, usableFlagUrl } from "@/components/odds/CountryFlag";

function fakeClient() {
  const fixtures = [
    {
      provider: "api_football", sport: "football", external_id: "api-football:1",
      league_external_id: "api-football:3", league_name: "UEFA Europa League", season: "2026",
      home_team_external_id: "api-football:670", away_team_external_id: "api-football:853"
    },
    {
      provider: "the-odds-api-events", sport: "football", external_id: "the-odds-api:2",
      league_external_id: "the-odds-api:soccer_brazil_campeonato", league_name: "Brazil Série A", season: "2026",
      home_team_external_id: "the-odds-api:flamengo", away_team_external_id: "the-odds-api:palmeiras"
    },
    {
      provider: "api-basketball", sport: "basketball", external_id: "api-basketball:3",
      league_external_id: "api-basketball:293", league_name: "World Championship U17 Women", season: "2025",
      home_team_external_id: "api-basketball:4271", away_team_external_id: "api-basketball:4270"
    }
  ];
  const teams = [
    { provider: "api_football", sport: "football", external_id: "api-football:670", name: "Derry City", country: "World", metadata: { source: "fixture" } },
    { provider: "api_football", sport: "football", external_id: "api-football:853", name: "CSKA Sofia", country: "World", metadata: {} },
    { provider: "the-odds-api-events", sport: "football", external_id: "the-odds-api:flamengo", name: "Flamengo", country: "World", metadata: {} },
    { provider: "the-odds-api-events", sport: "football", external_id: "the-odds-api:palmeiras", name: "Palmeiras", country: "World", metadata: {} },
    { provider: "api-basketball", sport: "basketball", external_id: "api-basketball:4271", name: "China U17 W", country: "World", metadata: {} },
    { provider: "api-basketball", sport: "basketball", external_id: "api-basketball:4270", name: "Canada U17 W", country: "World", metadata: {} }
  ];
  const leagues = [
    { provider: "api_football", sport: "football", external_id: "api-football:3", name: "UEFA Europa League", country: "World", metadata: {} },
    { provider: "the-odds-api-events", sport: "football", external_id: "the-odds-api:soccer_brazil_campeonato", name: "Brazil Série A", country: "World", metadata: {} }
  ];
  const writes: Record<string, unknown[][]> = { op_teams: [], op_leagues: [] };
  const rows: Record<string, unknown[]> = { op_fixtures: fixtures, op_teams: teams, op_leagues: leagues };

  const client = {
    from(table: string) {
      return {
        select() {
          const query = {
            gte: () => query,
            lt: () => query,
            in: () => query,
            order: () => query,
            limit: () => query,
            range: () => query,
            then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve({ data: rows[table] ?? [], error: null })); }
          };
          return query;
        },
        upsert(payload: unknown[]) {
          writes[table]?.push(payload);
          return Promise.resolve({ data: payload, error: null });
        }
      };
    }
  } as unknown as SupabaseClient;
  return { client, writes };
}

describe("sports identity enrichment", () => {
  it("rejects provider flag URLs whose filename is blank", () => {
    expect(usableFlagUrl("https://media.api-sports.io/flags/%20.svg")).toBeNull();
    expect(usableFlagUrl("https://media.api-sports.io/flags/gb.svg")).toBe("https://media.api-sports.io/flags/gb.svg");
  });

  it("maps domestic competition keys without assigning a country to continental cups", () => {
    expect(oddsCompetitionCountry("soccer_brazil_campeonato", "Brazil Série A")).toBe("Brazil");
    expect(oddsCompetitionCountry("soccer_usa_mls", "MLS")).toBe("United States");
    expect(oddsCompetitionCountry("soccer_uefa_europa_league", "UEFA Europa League")).toBe("World");
    expect(domesticCountryForFixture({ provider: "the-odds-api-events", league_external_id: "the-odds-api:soccer_brazil_campeonato", league_name: "Brazil Série A" })).toBe("Brazil");
  });

  it("renders deterministic country flags without depending on remote artwork", () => {
    expect(flagEmoji("Brazil")).toBe("🇧🇷");
    expect(flagEmoji("Ukraine")).toBe("🇺🇦");
    expect(flagEmoji("World")).toBe("🌍");
    expect(flagEmoji(null)).toBe("🌍");
    expect(flagEmoji("Puerto-Rico")).toBe("🇵🇷");
    expect(flagEmoji("Northern-Ireland")).toBe("🇬🇧");
    expect(flagEmoji("Vietnam")).toBe("🇻🇳");
  });

  it("infers only clearly labelled provider national youth teams", () => {
    expect(nationalTeamCountry("China U17 W")).toBe("China");
    expect(nationalTeamCountry("Czech-Republic U17 Women")).toBe("Czech Republic");
    expect(nationalTeamCountry("New Zealand U17 W")).toBe("New Zealand");
    expect(nationalTeamCountry("China Dragons")).toBeNull();
    expect(nationalTeamCountry("Canada FC")).toBeNull();
  });

  it("enriches API-Football teams and domestic odds-only identities in one bounded run", async () => {
    const { client, writes } = fakeClient();
    const result = await enrichUpcomingFixtureIdentities({
      client,
      env: { API_FOOTBALL_KEY: "server-only-test-key" },
      now: new Date("2026-07-17T00:00:00.000Z"),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        const response = url.pathname.endsWith("/leagues")
          ? { response: [{ league: { id: 3, name: "UEFA Europa League", logo: "https://media.api-sports.io/football/leagues/3.png" }, country: { name: "Europe", flag: null } }] }
          : { response: [
              { team: { id: 670, name: "Derry City", country: "Ireland", logo: "https://media.api-sports.io/football/teams/670.png" } },
              { team: { id: 853, name: "CSKA Sofia", country: "Bulgaria", logo: "https://media.api-sports.io/football/teams/853.png" } }
            ] };
        return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    expect(result).toMatchObject({ status: "completed", fixturesInspected: 3, providerRequests: 2, teamRowsUpdated: 6, leagueRowsUpdated: 2 });
    const teamRows = writes.op_teams.flat() as Array<{ external_id: string; country: string; metadata: Record<string, unknown> }>;
    expect(teamRows.find((row) => row.external_id === "api-football:670")).toMatchObject({ country: "Ireland", metadata: { source: "fixture", logo: "https://media.api-sports.io/football/teams/670.png" } });
    expect(teamRows.find((row) => row.external_id === "api-football:853")).toMatchObject({ country: "Bulgaria" });
    expect(teamRows.find((row) => row.external_id === "the-odds-api:flamengo")).toMatchObject({ country: "Brazil" });
    expect(teamRows.find((row) => row.external_id === "api-basketball:4271")).toMatchObject({ country: "China" });
    expect(teamRows.find((row) => row.external_id === "api-basketball:4270")).toMatchObject({ country: "Canada" });
    expect((writes.op_leagues.flat() as Array<{ country: string }>)[0]?.country).toBe("Brazil");
    expect(writes.op_leagues.flat()).toContainEqual(expect.objectContaining({
      provider: "api_football",
      external_id: "api-football:3",
      metadata: { logo: "https://media.api-sports.io/football/leagues/3.png" }
    }));
  });

  it("reports full-horizon provider artwork gaps instead of only checking the visible week", async () => {
    const { client } = fakeClient();
    const coverage = await readUpcomingIdentityCoverage({ client, now: new Date("2026-07-17T00:00:00.000Z") });

    expect(coverage).toMatchObject({ status: "ready", complete: false, horizonDays: 400, fixturesInspected: 3 });
    expect(coverage.providers.find((provider) => provider.provider === "api_football")).toMatchObject({
      missingTeamLogos: 2,
      missingLeagueLogos: 1
    });
  });
});
