import type { SupabaseClient } from "@supabase/supabase-js";

export const UPCOMING_IDENTITY_DAYS = 400;
const FIXTURE_PAGE_SIZE = 1_000;
const MAX_UPCOMING_FIXTURES = 10_000;
const IDENTITY_BATCH_SIZE = 200;

export type FixtureIdentityRow = {
  provider: string;
  sport: string;
  external_id: string;
  league_external_id: string | null;
  league_name: string | null;
  season: string | null;
  home_team_external_id: string;
  away_team_external_id: string;
};

export type StoredIdentityRow = {
  provider: string;
  sport: string;
  external_id: string;
  name: string;
  country: string | null;
  metadata: Record<string, unknown> | null;
};

export function identityKey(row: Pick<StoredIdentityRow, "provider" | "sport" | "external_id">): string {
  return `${row.provider}:${row.sport}:${row.external_id}`;
}

export function isApiFootballProvider(provider: string): boolean {
  return provider.trim().toLowerCase().replaceAll("-", "_") === "api_football";
}

export function providerSuppliesArtwork(provider: string): boolean {
  const normalized = provider.trim().toLowerCase().replaceAll("-", "_");
  return normalized === "api_football" || normalized === "api_basketball";
}

function chunks<T>(values: T[], size = IDENTITY_BATCH_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function readUpcomingFixtures(client: SupabaseClient, now: Date): Promise<FixtureIdentityRow[]> {
  const until = new Date(now.getTime() + UPCOMING_IDENTITY_DAYS * 86_400_000).toISOString();
  const fixtures: FixtureIdentityRow[] = [];
  for (let from = 0; from < MAX_UPCOMING_FIXTURES; from += FIXTURE_PAGE_SIZE) {
    const { data, error } = await client
      .from("op_fixtures")
      .select("provider,sport,external_id,league_external_id,league_name,season,home_team_external_id,away_team_external_id")
      .gte("kickoff_at", now.toISOString())
      .lt("kickoff_at", until)
      .in("status", ["scheduled", "not_started"])
      .order("kickoff_at", { ascending: true })
      .order("external_id", { ascending: true })
      .range(from, from + FIXTURE_PAGE_SIZE - 1);
    if (error) throw new Error(`Upcoming fixture identity read failed: ${error.message}`);
    const page = (data ?? []) as FixtureIdentityRow[];
    fixtures.push(...page);
    if (page.length < FIXTURE_PAGE_SIZE) return fixtures;
  }
  throw new Error(`Upcoming fixture identity read exceeded the ${MAX_UPCOMING_FIXTURES}-fixture safety limit.`);
}

async function readStoredIdentities(
  client: SupabaseClient,
  table: "op_teams" | "op_leagues",
  externalIds: string[]
): Promise<StoredIdentityRow[]> {
  const rows: StoredIdentityRow[] = [];
  for (const batch of chunks(externalIds)) {
    const { data, error } = await client
      .from(table)
      .select("provider,sport,external_id,name,country,metadata")
      .in("external_id", batch)
      .limit(1_000);
    if (error) throw new Error(`Stored ${table === "op_teams" ? "team" : "league"} identity read failed: ${error.message}`);
    rows.push(...((data ?? []) as StoredIdentityRow[]));
  }
  return rows;
}

export async function readUpcomingIdentitySnapshot(client: SupabaseClient, now: Date) {
  const fixtures = await readUpcomingFixtures(client, now);
  const teamIds = [...new Set(fixtures.flatMap((fixture) => [fixture.home_team_external_id, fixture.away_team_external_id]))];
  const leagueIds = [...new Set(fixtures.map((fixture) => fixture.league_external_id).filter((value): value is string => Boolean(value)))];
  const [teams, leagues] = await Promise.all([
    readStoredIdentities(client, "op_teams", teamIds),
    readStoredIdentities(client, "op_leagues", leagueIds)
  ]);
  return { fixtures, teams, leagues };
}
