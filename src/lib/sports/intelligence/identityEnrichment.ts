import type { SupabaseClient } from "@supabase/supabase-js";
import { oddsCompetitionCountry } from "@/lib/sports/providers/providerBackedProvider";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { finishProviderRun, startProviderRun } from "./repository";
import {
  type FixtureIdentityRow,
  identityKey,
  isApiFootballProvider,
  readUpcomingIdentitySnapshot,
  type StoredIdentityRow
} from "./identityStore";

const MAX_API_FOOTBALL_LEAGUES = 8;
const MAX_PROVIDER_BODY_BYTES = 2_000_000;
const PROVIDER_TIMEOUT_MS = 12_000;

type ApiFootballTeam = {
  id: string;
  name: string;
  country: string | null;
  logo: string | null;
};

type ApiFootballLeague = {
  id: string;
  name: string;
  country: string | null;
  logo: string | null;
  flag: string | null;
};

export type IdentityEnrichmentResult = {
  status: "completed" | "partial" | "empty" | "unavailable";
  fixturesInspected: number;
  competitionsInspected: number;
  teamRowsUpdated: number;
  leagueRowsUpdated: number;
  providerRequests: number;
  errors: string[];
};

type IdentityEnrichmentOptions = {
  client?: SupabaseClient | null;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
};

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstEnv(env: Record<string, string | undefined>, keys: string[]): string | null {
  for (const key of keys) {
    const value = clean(env[key]);
    if (value) return value;
  }
  return null;
}

function providerNumericId(value: string | null): string | null {
  const match = value?.match(/(?:^|:)(\d+)$/);
  return match?.[1] ?? null;
}

function validSeason(value: string | null): string | null {
  return value && /^\d{4}$/.test(value) ? value : null;
}

const NATIONAL_TEAM_COUNTRIES: Record<string, string> = {
  australia: "Australia",
  canada: "Canada",
  china: "China",
  colombia: "Colombia",
  "czech republic": "Czech Republic",
  czechia: "Czech Republic",
  egypt: "Egypt",
  germany: "Germany",
  italy: "Italy",
  "ivory coast": "Ivory Coast",
  japan: "Japan",
  latvia: "Latvia",
  mexico: "Mexico",
  "new zealand": "New Zealand",
  slovenia: "Slovenia",
  spain: "Spain",
  usa: "USA",
  "united states": "USA"
};

export function nationalTeamCountry(name: string): string | null {
  const normalized = name.trim().toLowerCase().replaceAll("_", " ").replaceAll("-", " ").replace(/\s+/g, " ");
  const marker = normalized.match(/\s+(?:u\s?\d{2}|under\s?\d{2})(?:\s+(?:women|men|w|m))?$/);
  if (!marker) return null;
  return NATIONAL_TEAM_COUNTRIES[normalized.slice(0, marker.index).trim()] ?? null;
}

function parseApiFootballTeams(value: unknown): ApiFootballTeam[] {
  const response = record(value).response;
  if (!Array.isArray(response)) return [];
  return response.flatMap((item) => {
    const team = record(record(item).team);
    const id = clean(String(team.id ?? ""));
    const name = clean(team.name);
    if (!id || !name) return [];
    return [{ id: `api-football:${id}`, name, country: clean(team.country), logo: clean(team.logo) }];
  });
}

function parseApiFootballLeague(value: unknown): ApiFootballLeague | null {
  const response = record(value).response;
  const item = Array.isArray(response) ? record(response[0]) : {};
  const league = record(item.league);
  const country = record(item.country);
  const id = clean(String(league.id ?? ""));
  const name = clean(league.name);
  if (!id || !name) return null;
  return {
    id: `api-football:${id}`,
    name,
    country: clean(country.name),
    logo: clean(league.logo),
    flag: clean(country.flag)
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const advertised = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertised) && advertised > MAX_PROVIDER_BODY_BYTES) {
    throw new Error(`API-Football identity response exceeded ${MAX_PROVIDER_BODY_BYTES} bytes.`);
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_PROVIDER_BODY_BYTES) {
    throw new Error(`API-Football identity response exceeded ${MAX_PROVIDER_BODY_BYTES} bytes.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("API-Football identity response was not valid JSON.");
  }
}

async function fetchLeagueTeams({
  league,
  season,
  apiKey,
  fetchImpl
}: {
  league: string;
  season: string;
  apiKey: string;
  fetchImpl: typeof fetch;
}): Promise<ApiFootballTeam[]> {
  const endpoint = new URL("https://v3.football.api-sports.io/teams");
  endpoint.searchParams.set("league", league);
  endpoint.searchParams.set("season", season);
  const response = await fetchImpl(endpoint, {
    headers: { "x-apisports-key": apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`API-Football identity request returned HTTP ${response.status}.`);
  return parseApiFootballTeams(await readBoundedJson(response));
}

async function fetchLeagueIdentity({
  league,
  season,
  apiKey,
  fetchImpl
}: {
  league: string;
  season: string;
  apiKey: string;
  fetchImpl: typeof fetch;
}): Promise<ApiFootballLeague | null> {
  const endpoint = new URL("https://v3.football.api-sports.io/leagues");
  endpoint.searchParams.set("id", league);
  endpoint.searchParams.set("season", season);
  const response = await fetchImpl(endpoint, {
    headers: { "x-apisports-key": apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`API-Football league identity request returned HTTP ${response.status}.`);
  return parseApiFootballLeague(await readBoundedJson(response));
}

export function domesticCountryForFixture(fixture: Pick<FixtureIdentityRow, "provider" | "league_external_id" | "league_name">): string | null {
  if (fixture.provider !== "the-odds-api-events") return null;
  const sportKey = fixture.league_external_id?.replace(/^the-odds-api:/, "") ?? "";
  const country = oddsCompetitionCountry(sportKey, fixture.league_name ?? "");
  return country === "World" ? null : country;
}

export async function enrichUpcomingFixtureIdentities({
  client = getSupabaseServerClient(),
  env = process.env,
  fetchImpl = fetch,
  now = new Date()
}: IdentityEnrichmentOptions = {}): Promise<IdentityEnrichmentResult> {
  const emptyResult: IdentityEnrichmentResult = {
    status: client ? "empty" : "unavailable",
    fixturesInspected: 0,
    competitionsInspected: 0,
    teamRowsUpdated: 0,
    leagueRowsUpdated: 0,
    providerRequests: 0,
    errors: client ? [] : ["OddsPadi Supabase server storage is not configured for identity enrichment."]
  };
  if (!client) return emptyResult;

  let snapshot: Awaited<ReturnType<typeof readUpcomingIdentitySnapshot>>;
  try {
    snapshot = await readUpcomingIdentitySnapshot(client, now);
  } catch (error) {
    return { ...emptyResult, status: "unavailable", errors: [error instanceof Error ? error.message : "Upcoming fixture identity read failed."] };
  }
  const { fixtures, teams, leagues } = snapshot;
  if (!fixtures.length) return emptyResult;
  const teamByKey = new Map(teams.map((team) => [identityKey(team), team]));
  const leagueByKey = new Map(leagues.map((league) => [identityKey(league), league]));
  const teamsByExternalId = new Map<string, StoredIdentityRow[]>();
  for (const team of teams) teamsByExternalId.set(team.external_id, [...(teamsByExternalId.get(team.external_id) ?? []), team]);
  const leaguesByExternalId = new Map<string, StoredIdentityRow[]>();
  for (const league of leagues) leaguesByExternalId.set(league.external_id, [...(leaguesByExternalId.get(league.external_id) ?? []), league]);
  const teamUpdates = new Map<string, StoredIdentityRow>();
  const leagueUpdates = new Map<string, StoredIdentityRow>();
  const errors: string[] = [];

  for (const fixture of fixtures) {
    const country = domesticCountryForFixture(fixture);
    if (!country) continue;
    const league = fixture.league_external_id
      ? leagueByKey.get(`${fixture.provider}:${fixture.sport}:${fixture.league_external_id}`)
      : null;
    if (league) leagueUpdates.set(identityKey(league), { ...league, country, metadata: record(league.metadata) });
    for (const externalId of [fixture.home_team_external_id, fixture.away_team_external_id]) {
      const team = teamByKey.get(`${fixture.provider}:${fixture.sport}:${externalId}`);
      if (team) teamUpdates.set(identityKey(team), { ...team, country, metadata: record(team.metadata) });
    }
  }

  for (const team of teams) {
    if (team.country && !["world", "europe", "unknown"].includes(team.country.trim().toLowerCase())) continue;
    const country = nationalTeamCountry(team.name);
    if (country) teamUpdates.set(identityKey(team), { ...team, country, metadata: record(team.metadata) });
  }

  const apiKey = firstEnv(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]);
  const groups = [...new Map(fixtures.flatMap((fixture) => {
    if (!isApiFootballProvider(fixture.provider)) return [];
    const league = providerNumericId(fixture.league_external_id);
    const season = validSeason(fixture.season);
    const storedLeague = fixture.league_external_id
      ? leagueByKey.get(`${fixture.provider}:${fixture.sport}:${fixture.league_external_id}`)
      : null;
    const leagueCountry = clean(storedLeague?.country)?.toLowerCase();
    const leagueNeedsIdentity = !storedLeague
      || !clean(storedLeague.name)
      || !clean(storedLeague.country)
      || !clean(record(storedLeague.metadata).logo)
      || Boolean(leagueCountry && !["world", "europe", "unknown"].includes(leagueCountry) && !clean(record(storedLeague.metadata).flag));
    const teamNeedsIdentity = [fixture.home_team_external_id, fixture.away_team_external_id].some((externalId) => {
      const stored = teamByKey.get(`${fixture.provider}:${fixture.sport}:${externalId}`);
      return !stored || !clean(stored.country) || !clean(record(stored.metadata).logo);
    });
    if (!leagueNeedsIdentity && !teamNeedsIdentity) return [];
    return league && season ? [[`${league}:${season}`, { league, season }]] as const : [];
  })).values()].slice(0, MAX_API_FOOTBALL_LEAGUES);
  let providerRequests = 0;

  if (groups.length && !apiKey) {
    errors.push("API-Football identity enrichment is configured without a server API key.");
  } else if (apiKey) {
    for (const group of groups) {
      providerRequests += 1;
      try {
        const providerTeams = await fetchLeagueTeams({ ...group, apiKey, fetchImpl });
        for (const providerTeam of providerTeams) {
          for (const stored of teamsByExternalId.get(providerTeam.id) ?? []) {
            if (stored.sport !== "football" || !isApiFootballProvider(stored.provider)) continue;
            teamUpdates.set(identityKey(stored), {
              ...stored,
              country: providerTeam.country ?? stored.country,
              metadata: {
                ...record(stored.metadata),
                ...(providerTeam.logo ? { logo: providerTeam.logo } : {})
              }
            });
          }
        }
        const providerLeague = await fetchLeagueIdentity({ ...group, apiKey, fetchImpl });
        providerRequests += 1;
        if (providerLeague) {
          for (const stored of leaguesByExternalId.get(providerLeague.id) ?? []) {
            if (stored.sport !== "football" || !isApiFootballProvider(stored.provider)) continue;
            leagueUpdates.set(identityKey(stored), {
              ...stored,
              name: providerLeague.name,
              country: providerLeague.country ?? stored.country,
              metadata: {
                ...record(stored.metadata),
                ...(providerLeague.logo ? { logo: providerLeague.logo } : {}),
                ...(providerLeague.flag ? { flag: providerLeague.flag } : {})
              }
            });
          }
        }
      } catch (error) {
        errors.push(`${group.league}/${group.season}: ${error instanceof Error ? error.message : "identity request failed"}`);
      }
    }
  }

  if (teamUpdates.size) {
    const { error } = await client.from("op_teams").upsert([...teamUpdates.values()], { onConflict: "provider,sport,external_id" });
    if (error) errors.push(`Team identity persistence failed: ${error.message}`);
  }
  if (leagueUpdates.size) {
    const { error } = await client.from("op_leagues").upsert([...leagueUpdates.values()], { onConflict: "provider,sport,external_id" });
    if (error) errors.push(`League identity persistence failed: ${error.message}`);
  }

  return {
    status: errors.length ? "partial" : "completed",
    fixturesInspected: fixtures.length,
    competitionsInspected: groups.length + leagueUpdates.size,
    teamRowsUpdated: teamUpdates.size,
    leagueRowsUpdated: leagueUpdates.size,
    providerRequests,
    errors
  };
}

export async function runUpcomingIdentityEnrichment(options: IdentityEnrichmentOptions = {}) {
  const now = options.now ?? new Date();
  const client = options.client === undefined ? getSupabaseServerClient() : options.client;
  const claim = await startProviderRun({
    providerName: "api-sports-identity",
    jobType: "enrich-fixture-identities",
    startedAt: now.toISOString(),
    sport: "multi",
    client
  });
  if (!claim.acquired) return { success: false, skippedOverlap: true, result: null, run: claim.run };

  try {
    const result = await enrichUpcomingFixtureIdentities({ ...options, client, now });
    const status = result.status === "completed" || result.status === "empty"
      ? result.status
      : result.status === "partial"
        ? "partial"
        : "failed";
    const run = await finishProviderRun(claim.run, {
      status,
      finishedAt: new Date().toISOString(),
      fixturesFound: result.fixturesInspected,
      oddsFound: 0,
      predictionsGenerated: 0,
      valuePicksPublished: 0,
      errors: result.errors
    }, client);
    return { success: status === "completed" || status === "empty", skippedOverlap: false, result, run };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sports identity enrichment failed.";
    const run = await finishProviderRun(claim.run, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      fixturesFound: 0,
      oddsFound: 0,
      predictionsGenerated: 0,
      valuePicksPublished: 0,
      errors: [message]
    }, client);
    return { success: false, skippedOverlap: false, result: null, run };
  }
}
