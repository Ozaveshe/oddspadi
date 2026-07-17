import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  identityKey,
  providerSuppliesArtwork,
  readUpcomingIdentitySnapshot,
  UPCOMING_IDENTITY_DAYS
} from "./identityStore";

export type UpcomingIdentityCoverage = {
  status: "ready" | "empty" | "unavailable";
  complete: boolean;
  horizonDays: number;
  fixturesInspected: number;
  providers: Array<{
    provider: string;
    sport: string;
    fixtures: number;
    missingTeamRows: number;
    missingTeamCountries: number;
    missingTeamLogos: number;
    missingLeagueRows: number;
    missingLeagueNames: number;
    missingLeagueCountries: number;
    missingLeagueLogos: number;
    missingLeagueFlags: number;
  }>;
  errors: string[];
};

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function readUpcomingIdentityCoverage({
  client = getSupabaseServerClient(),
  now = new Date()
}: { client?: SupabaseClient | null; now?: Date } = {}): Promise<UpcomingIdentityCoverage> {
  const unavailable: UpcomingIdentityCoverage = {
    status: client ? "empty" : "unavailable",
    complete: false,
    horizonDays: UPCOMING_IDENTITY_DAYS,
    fixturesInspected: 0,
    providers: [],
    errors: client ? [] : ["OddsPadi Supabase server storage is not configured for identity coverage."]
  };
  if (!client) return unavailable;
  try {
    const { fixtures, teams, leagues } = await readUpcomingIdentitySnapshot(client, now);
    if (!fixtures.length) return { ...unavailable, status: "empty", complete: true };
    const teamByKey = new Map(teams.map((team) => [identityKey(team), team]));
    const leagueByKey = new Map(leagues.map((league) => [identityKey(league), league]));
    const groups = new Map<string, UpcomingIdentityCoverage["providers"][number]>();
    for (const fixture of fixtures) {
      const key = `${fixture.sport}:${fixture.provider}`;
      const current = groups.get(key) ?? {
        provider: fixture.provider,
        sport: fixture.sport,
        fixtures: 0,
        missingTeamRows: 0,
        missingTeamCountries: 0,
        missingTeamLogos: 0,
        missingLeagueRows: 0,
        missingLeagueNames: 0,
        missingLeagueCountries: 0,
        missingLeagueLogos: 0,
        missingLeagueFlags: 0
      };
      current.fixtures += 1;
      const artworkRequired = providerSuppliesArtwork(fixture.provider);
      for (const externalId of [fixture.home_team_external_id, fixture.away_team_external_id]) {
        const team = teamByKey.get(`${fixture.provider}:${fixture.sport}:${externalId}`);
        if (!team) current.missingTeamRows += 1;
        if (!clean(team?.country)) current.missingTeamCountries += 1;
        if (artworkRequired && !clean(record(team?.metadata).logo)) current.missingTeamLogos += 1;
      }
      const league = fixture.league_external_id
        ? leagueByKey.get(`${fixture.provider}:${fixture.sport}:${fixture.league_external_id}`)
        : null;
      if (!league) current.missingLeagueRows += 1;
      if (!clean(fixture.league_name) && !clean(league?.name)) current.missingLeagueNames += 1;
      if (!clean(league?.country)) current.missingLeagueCountries += 1;
      if (artworkRequired && !clean(record(league?.metadata).logo)) current.missingLeagueLogos += 1;
      const leagueCountry = clean(league?.country)?.toLowerCase();
      if (artworkRequired && leagueCountry && !["world", "europe", "unknown"].includes(leagueCountry) && !clean(record(league?.metadata).flag)) {
        current.missingLeagueFlags += 1;
      }
      groups.set(key, current);
    }
    const providers = [...groups.values()].sort((left, right) => `${left.sport}:${left.provider}`.localeCompare(`${right.sport}:${right.provider}`));
    const complete = providers.every((provider) => [
      provider.missingTeamRows,
      provider.missingTeamCountries,
      provider.missingTeamLogos,
      provider.missingLeagueRows,
      provider.missingLeagueNames,
      provider.missingLeagueCountries,
      provider.missingLeagueLogos,
      provider.missingLeagueFlags
    ].every((count) => count === 0));
    return { status: "ready", complete, horizonDays: UPCOMING_IDENTITY_DAYS, fixturesInspected: fixtures.length, providers, errors: [] };
  } catch (error) {
    return { ...unavailable, status: "unavailable", errors: [error instanceof Error ? error.message : "Upcoming identity coverage read failed."] };
  }
}
