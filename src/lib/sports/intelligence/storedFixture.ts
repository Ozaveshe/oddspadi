import type { DecisionSummary, MatchStatus, Sport } from "@/lib/sports/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_STORED_FIXTURE_MAX_AGE_MS, isStoredFixtureFresh, reconcileStoredFixtureStatus } from "./canonical";
import { readFixtureOddsHistory, readLatestDecisionSummary, storedFixtureArtwork } from "./repository";
import type { FixtureOddsHistory } from "./types";

export type StoredFixtureAnalysis = {
  fixtureId: string;
  sport: Sport;
  league: { id: string; name: string; country: string; logo: string | null; flag: string | null };
  kickoffAt: string;
  homeTeam: { id: string; name: string; logo: string | null; country: string | null };
  awayTeam: { id: string; name: string; logo: string | null; country: string | null };
  status: MatchStatus;
  score: { home: number; away: number } | null;
  provider: string;
  lastSyncedAt: string;
  dataQuality: number;
  stale: boolean;
  summary: DecisionSummary | null;
  oddsHistory: FixtureOddsHistory;
};

export type StoredFixtureAnalysisRead =
  | { status: "ready"; analysis: StoredFixtureAnalysis; reason: null }
  | { status: "missing" | "unavailable"; analysis: null; reason: string };

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sport(value: unknown): Sport | null {
  return value === "football" || value === "basketball" || value === "tennis" ? value : null;
}

export async function readStoredFixtureAnalysis(
  fixtureId: string,
  { now = new Date(), maxAgeMs = DEFAULT_STORED_FIXTURE_MAX_AGE_MS }: { now?: Date; maxAgeMs?: number } = {}
): Promise<StoredFixtureAnalysisRead> {
  const client = getSupabaseServerClient();
  if (!client) return { status: "unavailable", analysis: null, reason: "Stored fixture analysis is unavailable because server-side storage is not configured." };

  const { data, error } = await client
    .from("op_fixtures")
    .select("sport,provider,external_id,provider_fixture_id,league_external_id,league_name,kickoff_at,status,home_team_external_id,away_team_external_id,home_team_name,away_team_name,home_score,away_score,country,data_quality,last_synced_at,metadata")
    .eq("external_id", fixtureId)
    .limit(1)
    .maybeSingle();
  if (error) return { status: "unavailable", analysis: null, reason: `Stored fixture analysis could not be read: ${error.message}` };
  if (!data) return { status: "missing", analysis: null, reason: "No stored provider fixture exists for this analysis link." };

  const row = data as Record<string, unknown>;
  const rowSport = sport(row.sport);
  const kickoffAt = cleanText(row.kickoff_at);
  const lastSyncedAt = cleanText(row.last_synced_at);
  const homeName = cleanText(row.home_team_name);
  const awayName = cleanText(row.away_team_name);
  const provider = cleanText(row.provider);
  if (!rowSport || !kickoffAt || !lastSyncedAt || !homeName || !awayName || !provider || provider.toLowerCase().includes("mock")) {
    return { status: "unavailable", analysis: null, reason: "The stored fixture receipt is incomplete or non-production and cannot support a public analysis page." };
  }

  const homeTeamId = cleanText(row.home_team_external_id) ?? `${fixtureId}:home`;
  const awayTeamId = cleanText(row.away_team_external_id) ?? `${fixtureId}:away`;
  const leagueId = cleanText(row.league_external_id) ?? "unknown";
  const [{ data: teams, error: teamError }, { data: leagues, error: leagueError }, summary, oddsHistory] = await Promise.all([
    client.from("op_teams").select("sport,provider,external_id,country,metadata").in("external_id", [homeTeamId, awayTeamId]).limit(10),
    client.from("op_leagues").select("sport,provider,external_id,country,metadata").eq("external_id", leagueId).limit(5),
    readLatestDecisionSummary(fixtureId, client),
    readFixtureOddsHistory(fixtureId, client)
  ]);
  if (teamError || leagueError) console.warn("[sports-intelligence] stored fixture identity enrichment unavailable; using fixture receipt fallbacks");
  const artwork = storedFixtureArtwork({
    fixture: row,
    teams: (teamError ? [] : teams ?? []) as Array<Record<string, unknown> & { sport: string; provider: string; external_id: string }>,
    leagues: (leagueError ? [] : leagues ?? []) as Array<Record<string, unknown> & { sport: string; provider: string; external_id: string }>
  });
  const homeScore = finiteNumber(row.home_score);
  const awayScore = finiteNumber(row.away_score);
  const rawStatus = cleanText(row.status) as MatchStatus | null;
  const status = reconcileStoredFixtureStatus({
    status: rawStatus ?? "scheduled",
    kickoffAt,
    lastSyncedAt,
    homeScore,
    awayScore
  }, now, maxAgeMs);

  return {
    status: "ready",
    reason: null,
    analysis: {
      fixtureId,
      sport: rowSport,
      league: {
        id: leagueId,
        name: cleanText(row.league_name) ?? "Competition",
        country: cleanText(row.country) ?? "World",
        logo: artwork.leagueLogo,
        flag: artwork.leagueFlag
      },
      kickoffAt,
      homeTeam: { id: homeTeamId, name: homeName, logo: artwork.homeLogo, country: artwork.homeCountry },
      awayTeam: { id: awayTeamId, name: awayName, logo: artwork.awayLogo, country: artwork.awayCountry },
      status,
      score: homeScore !== null && awayScore !== null ? { home: homeScore, away: awayScore } : null,
      provider,
      lastSyncedAt,
      dataQuality: finiteNumber(row.data_quality) ?? 0,
      stale: !isStoredFixtureFresh(lastSyncedAt, now, maxAgeMs),
      summary,
      oddsHistory
    }
  };
}
