import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Correction-aware fixture reads for entity pages (competition hubs, team and
 * player pages). Provider scores are the default; a CURRENT, VERIFIED row in
 * op_fixture_results overrides them, so a corrected result propagates to every
 * entity surface without any page keeping its own copy of the truth.
 *
 * A failed read is `availability: "unavailable"` with empty lists — never
 * zeros presented as facts.
 */

export type EntityFixture = {
  fixtureId: string;
  sport: "football" | "basketball" | "tennis";
  leagueExternalId: string | null;
  leagueName: string | null;
  country: string | null;
  season: string | null;
  kickoffAt: string;
  status: string;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  homeScore: number | null;
  awayScore: number | null;
  scoreSource: "verified-result" | "provider" | null;
  hasModelCoverage: boolean;
};

export type CompetitionFixtures = {
  availability: "live" | "unavailable";
  upcoming: EntityFixture[];
  liveNow: EntityFixture[];
  results: EntityFixture[];
};

export type CurrentResultRow = {
  isCurrent: boolean;
  verificationState: string;
  homeScore: number | null;
  awayScore: number | null;
};

const FIXTURE_SELECT =
  "id,external_id,sport,league_external_id,league_name,country,season,kickoff_at,status,home_team_external_id,home_team_name,away_team_external_id,away_team_name,home_score,away_score";

const DAY_MS = 24 * 3600_000;

type FixtureRow = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function score(value: unknown): number | null {
  const parsed = Number(value);
  return value === null || value === undefined || !Number.isFinite(parsed) ? null : parsed;
}

function toEntityFixture(row: FixtureRow): EntityFixture | null {
  const sport = text(row.sport);
  const fixtureId = text(row.external_id);
  const kickoffAt = text(row.kickoff_at);
  if (!fixtureId || !kickoffAt || !sport || !["football", "basketball", "tennis"].includes(sport)) return null;
  const homeScore = score(row.home_score);
  const awayScore = score(row.away_score);
  return {
    fixtureId,
    sport: sport as EntityFixture["sport"],
    leagueExternalId: text(row.league_external_id),
    leagueName: text(row.league_name),
    country: text(row.country),
    season: text(row.season),
    kickoffAt,
    status: text(row.status) ?? "scheduled",
    homeTeamId: text(row.home_team_external_id) ?? "home",
    homeTeamName: text(row.home_team_name) ?? "Home",
    awayTeamId: text(row.away_team_external_id) ?? "away",
    awayTeamName: text(row.away_team_name) ?? "Away",
    homeScore,
    awayScore,
    scoreSource: homeScore !== null && awayScore !== null ? "provider" : null,
    hasModelCoverage: false
  };
}

/**
 * Result-correction propagation: only the CURRENT, VERIFIED result revision
 * may replace a provider score. A superseded revision (isCurrent: false) or a
 * provisional row leaves the provider score in place.
 */
export function applyCurrentResult(fixture: EntityFixture, result: CurrentResultRow | null): EntityFixture {
  if (!result || !result.isCurrent || result.verificationState !== "verified") return fixture;
  if (result.homeScore === null || result.awayScore === null) return fixture;
  return { ...fixture, homeScore: result.homeScore, awayScore: result.awayScore, scoreSource: "verified-result" };
}

/** W/D/L from the team's perspective over already-newest-first results. */
export function deriveFormFromResults(teamExternalId: string, results: EntityFixture[], limit = 5): Array<"W" | "D" | "L"> {
  const form: Array<"W" | "D" | "L"> = [];
  for (const fixture of results) {
    if (form.length >= limit) break;
    if (fixture.homeScore === null || fixture.awayScore === null) continue;
    const isHome = fixture.homeTeamId === teamExternalId;
    const isAway = fixture.awayTeamId === teamExternalId;
    if (!isHome && !isAway) continue;
    const ours = isHome ? fixture.homeScore : fixture.awayScore;
    const theirs = isHome ? fixture.awayScore : fixture.homeScore;
    form.push(ours > theirs ? "W" : ours === theirs ? "D" : "L");
  }
  return form;
}

async function annotate(
  client: SupabaseClient,
  buckets: { rows: FixtureRow[]; fixtures: EntityFixture[] }[]
): Promise<void> {
  const externalIds = buckets.flatMap((bucket) => bucket.fixtures.map((fixture) => fixture.fixtureId));
  const dbIdByExternal = new Map<string, string>();
  for (const bucket of buckets) {
    for (const row of bucket.rows) {
      const external = text(row.external_id);
      const dbId = text(row.id);
      if (external && dbId) dbIdByExternal.set(external, dbId);
    }
  }
  if (!externalIds.length) return;

  const [{ data: coverage }, { data: currentResults }] = await Promise.all([
    client
      .from("op_fixture_decision_summaries")
      .select("fixture_external_id")
      .in("fixture_external_id", externalIds)
      .is("superseded_by", null),
    client
      .from("op_fixture_results")
      .select("fixture_id,regulation_home,regulation_away,extra_time_home,extra_time_away,verification_state,is_current")
      .in("fixture_id", [...dbIdByExternal.values()])
      .eq("is_current", true)
  ]);

  const covered = new Set(((coverage ?? []) as Array<Record<string, unknown>>).map((row) => String(row.fixture_external_id)));
  const resultByDbId = new Map<string, CurrentResultRow>();
  for (const row of (currentResults ?? []) as Array<Record<string, unknown>>) {
    const regulationHome = score(row.regulation_home);
    const regulationAway = score(row.regulation_away);
    resultByDbId.set(String(row.fixture_id), {
      isCurrent: Boolean(row.is_current),
      verificationState: text(row.verification_state) ?? "provisional",
      homeScore: regulationHome === null ? null : regulationHome + (score(row.extra_time_home) ?? 0),
      awayScore: regulationAway === null ? null : regulationAway + (score(row.extra_time_away) ?? 0)
    });
  }

  for (const bucket of buckets) {
    bucket.fixtures = bucket.fixtures.map((fixture) => {
      const withCoverage = covered.has(fixture.fixtureId) ? { ...fixture, hasModelCoverage: true } : fixture;
      const dbId = dbIdByExternal.get(fixture.fixtureId);
      return applyCurrentResult(withCoverage, dbId ? resultByDbId.get(dbId) ?? null : null);
    });
  }
}

function mapRows(rows: FixtureRow[] | null): { rows: FixtureRow[]; fixtures: EntityFixture[] } {
  const safeRows = rows ?? [];
  return {
    rows: safeRows,
    fixtures: safeRows.map(toEntityFixture).filter((value): value is EntityFixture => value !== null)
  };
}

export async function readCompetitionFixtures(
  leagueExternalId: string,
  { now = new Date(), client = getSupabaseServerClient() }: { now?: Date; client?: SupabaseClient | null } = {}
): Promise<CompetitionFixtures> {
  if (!client) return { availability: "unavailable", upcoming: [], liveNow: [], results: [] };
  const nowIso = now.toISOString();
  try {
    const [upcomingRead, liveRead, resultsRead] = await Promise.all([
      client
        .from("op_fixtures")
        .select(FIXTURE_SELECT)
        .eq("league_external_id", leagueExternalId)
        .eq("status", "scheduled")
        .gte("kickoff_at", nowIso)
        .lte("kickoff_at", new Date(now.getTime() + 14 * DAY_MS).toISOString())
        .order("kickoff_at", { ascending: true })
        .limit(30),
      client
        .from("op_fixtures")
        .select(FIXTURE_SELECT)
        .eq("league_external_id", leagueExternalId)
        .eq("status", "live")
        .order("kickoff_at", { ascending: true })
        .limit(20),
      client
        .from("op_fixtures")
        .select(FIXTURE_SELECT)
        .eq("league_external_id", leagueExternalId)
        .in("status", ["finished", "abandoned"])
        .gte("kickoff_at", new Date(now.getTime() - 14 * DAY_MS).toISOString())
        .lte("kickoff_at", nowIso)
        .order("kickoff_at", { ascending: false })
        .limit(30)
    ]);
    if (upcomingRead.error || liveRead.error || resultsRead.error) {
      return { availability: "unavailable", upcoming: [], liveNow: [], results: [] };
    }
    const upcoming = mapRows(upcomingRead.data as FixtureRow[] | null);
    const liveNow = mapRows(liveRead.data as FixtureRow[] | null);
    const results = mapRows(resultsRead.data as FixtureRow[] | null);
    await annotate(client, [upcoming, liveNow, results]);
    return { availability: "live", upcoming: upcoming.fixtures, liveNow: liveNow.fixtures, results: results.fixtures };
  } catch {
    return { availability: "unavailable", upcoming: [], liveNow: [], results: [] };
  }
}

export async function readTeamFixtures(
  teamExternalId: string,
  { now = new Date(), client = getSupabaseServerClient() }: { now?: Date; client?: SupabaseClient | null } = {}
): Promise<CompetitionFixtures & { teamName: string | null }> {
  if (!client) return { availability: "unavailable", upcoming: [], liveNow: [], results: [], teamName: null };
  const nowIso = now.toISOString();
  const upcomingWindow = { from: new Date(now.getTime() - 6 * 3600_000).toISOString(), to: new Date(now.getTime() + 30 * DAY_MS).toISOString() };
  const resultsWindow = { from: new Date(now.getTime() - 60 * DAY_MS).toISOString(), to: nowIso };

  const sideQuery = (column: "home_team_external_id" | "away_team_external_id", statuses: string[], window: { from: string; to: string }, ascending: boolean) =>
    client
      .from("op_fixtures")
      .select(FIXTURE_SELECT)
      .eq(column, teamExternalId)
      .in("status", statuses)
      .gte("kickoff_at", window.from)
      .lte("kickoff_at", window.to)
      .order("kickoff_at", { ascending })
      .limit(20);

  try {
    const [homeUpcoming, awayUpcoming, homeResults, awayResults, teamRead] = await Promise.all([
      sideQuery("home_team_external_id", ["scheduled", "live"], upcomingWindow, true),
      sideQuery("away_team_external_id", ["scheduled", "live"], upcomingWindow, true),
      sideQuery("home_team_external_id", ["finished", "abandoned"], resultsWindow, false),
      sideQuery("away_team_external_id", ["finished", "abandoned"], resultsWindow, false),
      client.from("op_teams").select("name").eq("external_id", teamExternalId).limit(1)
    ]);
    if (homeUpcoming.error || awayUpcoming.error || homeResults.error || awayResults.error) {
      return { availability: "unavailable", upcoming: [], liveNow: [], results: [], teamName: null };
    }
    const dedupe = (rows: FixtureRow[], ascending: boolean) => {
      const byId = new Map<string, FixtureRow>();
      for (const row of rows) byId.set(String(row.external_id), row);
      return [...byId.values()].sort((left, right) => {
        const delta = Date.parse(String(left.kickoff_at)) - Date.parse(String(right.kickoff_at));
        return ascending ? delta : -delta;
      });
    };
    const upcomingAll = mapRows(dedupe([...(homeUpcoming.data ?? []), ...(awayUpcoming.data ?? [])] as FixtureRow[], true));
    const resultsAll = mapRows(dedupe([...(homeResults.data ?? []), ...(awayResults.data ?? [])] as FixtureRow[], false));
    await annotate(client, [upcomingAll, resultsAll]);
    const liveNow = upcomingAll.fixtures.filter((fixture) => fixture.status === "live");
    const teamRow = ((teamRead.data ?? []) as Array<Record<string, unknown>>)[0];
    return {
      availability: "live",
      upcoming: upcomingAll.fixtures.filter((fixture) => fixture.status !== "live"),
      liveNow,
      results: resultsAll.fixtures,
      teamName: teamRow ? text(teamRow.name) : null
    };
  } catch {
    return { availability: "unavailable", upcoming: [], liveNow: [], results: [], teamName: null };
  }
}
