import type { SupabaseClient } from "@supabase/supabase-js";
import { oddsCompetitionCountry } from "@/lib/sports/providers/providerBackedProvider";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { finishProviderRun, startProviderRun } from "./repository";

const UPCOMING_DAYS = 8;
const MAX_API_FOOTBALL_LEAGUES = 8;
const MAX_PROVIDER_BODY_BYTES = 2_000_000;
const PROVIDER_TIMEOUT_MS = 12_000;

type FixtureIdentityRow = {
  provider: string;
  sport: string;
  external_id: string;
  league_external_id: string | null;
  league_name: string | null;
  season: string | null;
  home_team_external_id: string;
  away_team_external_id: string;
};

type StoredIdentityRow = {
  provider: string;
  sport: string;
  external_id: string;
  name: string;
  country: string | null;
  metadata: Record<string, unknown> | null;
};

type ApiFootballTeam = {
  id: string;
  name: string;
  country: string | null;
  logo: string | null;
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

function identityKey(row: Pick<StoredIdentityRow, "provider" | "sport" | "external_id">): string {
  return `${row.provider}:${row.sport}:${row.external_id}`;
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

  const until = new Date(now.getTime() + UPCOMING_DAYS * 86_400_000).toISOString();
  const { data: fixtureData, error: fixtureError } = await client
    .from("op_fixtures")
    .select("provider,sport,external_id,league_external_id,league_name,season,home_team_external_id,away_team_external_id")
    .gte("kickoff_at", now.toISOString())
    .lt("kickoff_at", until)
    .in("status", ["scheduled", "not_started"])
    .order("kickoff_at", { ascending: true })
    .limit(1000);
  if (fixtureError) return { ...emptyResult, status: "unavailable", errors: [`Upcoming fixture identity read failed: ${fixtureError.message}`] };

  const fixtures = (fixtureData ?? []) as FixtureIdentityRow[];
  if (!fixtures.length) return emptyResult;
  const teamIds = [...new Set(fixtures.flatMap((fixture) => [fixture.home_team_external_id, fixture.away_team_external_id]))];
  const leagueIds = [...new Set(fixtures.map((fixture) => fixture.league_external_id).filter((value): value is string => Boolean(value)))];
  const [{ data: teamData, error: teamError }, { data: leagueData, error: leagueError }] = await Promise.all([
    client.from("op_teams").select("provider,sport,external_id,name,country,metadata").in("external_id", teamIds).limit(2000),
    client.from("op_leagues").select("provider,sport,external_id,name,country,metadata").in("external_id", leagueIds).limit(1000)
  ]);
  if (teamError || leagueError) {
    return {
      ...emptyResult,
      status: "unavailable",
      fixturesInspected: fixtures.length,
      errors: [`Stored identity read failed: ${teamError?.message ?? leagueError?.message}`]
    };
  }

  const teams = (teamData ?? []) as StoredIdentityRow[];
  const leagues = (leagueData ?? []) as StoredIdentityRow[];
  const teamByKey = new Map(teams.map((team) => [identityKey(team), team]));
  const leagueByKey = new Map(leagues.map((league) => [identityKey(league), league]));
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

  const apiKey = firstEnv(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]);
  const groups = [...new Map(fixtures.flatMap((fixture) => {
    if (fixture.provider !== "api-football") return [];
    const league = providerNumericId(fixture.league_external_id);
    const season = validSeason(fixture.season);
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
          const stored = teamByKey.get(`api-football:football:${providerTeam.id}`);
          if (!stored) continue;
          teamUpdates.set(identityKey(stored), {
            ...stored,
            country: providerTeam.country ?? stored.country,
            metadata: {
              ...record(stored.metadata),
              ...(providerTeam.logo ? { logo: providerTeam.logo } : {})
            }
          });
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
