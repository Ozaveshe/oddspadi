import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { groupResults, isAmbiguous, searchEntities } from "@/lib/discovery/search";
import { buildCatalogue, type FixtureRow, type TeamRow } from "@/lib/discovery/searchCatalogue";

export const dynamic = "force-dynamic";

/**
 * Unified search: teams, competitions and fixtures to canonical routes.
 *
 * The catalogue is cached in module scope for five minutes because search is
 * per-keystroke and the underlying rows change on a sweep cadence, not a
 * keystroke one. Degradation is honest and layered: if the database cannot be
 * read, competitions still resolve from the registry, and the response says
 * which sources it is missing rather than presenting a partial catalogue as
 * the whole one.
 */

const CATALOGUE_TTL_MS = 5 * 60_000;

let cached: { at: number; teams: TeamRow[]; fixtures: FixtureRow[]; missing: string[] } | null = null;

async function readCatalogue(): Promise<{ teams: TeamRow[]; fixtures: FixtureRow[]; missing: string[] }> {
  if (cached && Date.now() - cached.at < CATALOGUE_TTL_MS) return cached;

  const missing: string[] = [];
  let teams: TeamRow[] = [];
  let fixtures: FixtureRow[] = [];

  const client = getSupabaseServerClient();
  if (!client) {
    missing.push("teams", "fixtures");
    cached = { at: Date.now(), teams, fixtures, missing };
    return cached;
  }

  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const dayBack = new Date(now.getTime() - 86_400_000).toISOString();

  const { data: fixtureData, error: fixtureError } = await client
    .from("op_fixtures")
    .select("id,home_team_name,away_team_name,league_name,kickoff_at,status")
    .gte("kickoff_at", dayBack)
    .lte("kickoff_at", weekOut)
    .order("kickoff_at", { ascending: true })
    .limit(600);

  if (fixtureError) {
    missing.push("fixtures");
  } else {
    fixtures = ((fixtureData ?? []) as Array<Record<string, unknown>>)
      .filter((row) => row.home_team_name && row.away_team_name)
      .map((row) => ({
        id: String(row.id),
        homeTeam: String(row.home_team_name),
        awayTeam: String(row.away_team_name),
        league: String(row.league_name ?? ""),
        kickoffAt: String(row.kickoff_at)
      }));

    // Teams are derived from the same window rather than read from op_teams:
    // a team you can find is a team with something to open, and the fixture
    // supplies both the name and the destination in one read.
    const seen = new Map<string, TeamRow>();
    for (const fixture of fixtures) {
      for (const name of [fixture.homeTeam, fixture.awayTeam]) {
        if (!seen.has(name)) {
          seen.set(name, { id: name, name, country: fixture.league || null, nextFixtureId: fixture.id });
        }
      }
    }
    teams = [...seen.values()];
  }

  cached = { at: Date.now(), teams, fixtures, missing };
  return cached;
}

export const GET = withApiHandler(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").slice(0, 80);
  if (query.trim().length < 2) {
    return apiError("A query of at least 2 characters is required.");
  }

  const { teams, fixtures, missing } = await readCatalogue();
  const results = searchEntities(query, buildCatalogue(teams, fixtures), { limit: 12 });

  return apiSuccess({
    query,
    groups: groupResults(results).map((group) => ({
      kind: group.kind,
      results: group.results.map((result) => ({
        id: result.entity.id,
        name: result.entity.name,
        context: result.entity.context,
        href: (result.entity as { href?: string }).href ?? null,
        matchedOn: result.matchedOn
      }))
    })),
    ambiguous: isAmbiguous(results),
    // A partial catalogue says so rather than presenting itself as the whole.
    missingSources: missing
  });
});
