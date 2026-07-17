import { getSupabaseServerClient } from "@/lib/supabase/server";
import { predictionFootballLeagues, predictionLeagueBySlug, footballLeagueById } from "@/lib/sports/footballLeagues";

export type LeagueStandingRow = { position: number; previousPosition: number | null; movement: number | null; teamId: string; teamName: string; teamLogo?: string | null; teamCountry?: string | null; played: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number; goalDifference: number; points: number; form: string };
export type LeagueTable = { slug: string; leagueId: string; leagueName: string; country: string; season: string; source: "api-football-standings" | "supabase-standings-snapshot"; updatedAt: string; rows: LeagueStandingRow[] };
export type ResolvedLeagueTable = { table: LeagueTable | null; requestedSeason: string; displaySeason: string; historicalFallback: boolean };
export const footballLeagues = predictionFootballLeagues;
export const featuredFootballLeagueTables = footballLeagues.filter((league) => league.tier === "top-five").slice(0, 5);
export function leagueBySlug(slug: string) { return predictionLeagueBySlug(slug); }
export function leagueSlugFromProviderId(id: string) { return footballLeagueById(id)?.predictions ? footballLeagueById(id)?.slug ?? null : null; }
export function currentFootballSeason(now = new Date()) { return String(now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1); }
export function previousFootballSeason(season: string) { return String(Number(season) - 1); }

export async function resolveVerifiedLeagueTable(
  slug: string,
  requestedSeason: string,
  getCurrentTable: (slug: string, season: string) => Promise<LeagueTable | null>,
  getStoredTable: (slug: string, season: string) => Promise<LeagueTable | null> = storedLeagueTable,
): Promise<ResolvedLeagueTable> {
  const current =
    (await getCurrentTable(slug, requestedSeason).catch(() => null)) ??
    (await getStoredTable(slug, requestedSeason).catch(() => null));

  if (current) {
    return { table: current, requestedSeason, displaySeason: current.season, historicalFallback: false };
  }

  const previousSeason = previousFootballSeason(requestedSeason);
  const historical = await getStoredTable(slug, previousSeason).catch(() => null);
  return {
    table: historical,
    requestedSeason,
    displaySeason: historical?.season ?? requestedSeason,
    historicalFallback: Boolean(historical),
  };
}

function formString(value: unknown): string { if (Array.isArray(value)) return value.map(String).join("").slice(-6).toUpperCase(); if (typeof value === "string") return value.replace(/[^WDL]/gi, "").slice(-6).toUpperCase(); return ""; }
export async function storedLeagueTable(slug: string, season: string): Promise<LeagueTable | null> {
  const league = leagueBySlug(slug); const db = getSupabaseServerClient(); if (!league || !db) return null;
  const { data } = await db.from("op_standings_snapshots").select("team_external_id,snapshot_at,position,played,points,wins,draws,losses,goals_for,goals_against,form").eq("sport", "football").eq("league_external_id", league.leagueId).eq("season", season).order("snapshot_at", { ascending: false }).limit(100);
  if (!data?.length) return null; const snapshots = [...new Set(data.map((row) => row.snapshot_at))].slice(0, 2); const latest = data.filter((row) => row.snapshot_at === snapshots[0]); const previous = new Map(data.filter((row) => row.snapshot_at === snapshots[1]).map((row) => [row.team_external_id, Number(row.position)]));
  const teamIds = latest.map((row) => row.team_external_id); const { data: teams } = await db.from("op_teams").select("external_id,name,country,metadata").eq("sport", "football").in("external_id", teamIds); const teamById = new Map((teams ?? []).map((team) => [team.external_id, team]));
  const rows = latest.map((row) => { const position = Number(row.position); const previousPosition = previous.get(row.team_external_id) ?? null; const gf = Number(row.goals_for ?? 0); const ga = Number(row.goals_against ?? 0); const team = teamById.get(row.team_external_id); const metadata = team?.metadata && typeof team.metadata === "object" && !Array.isArray(team.metadata) ? team.metadata as Record<string, unknown> : {}; return { position, previousPosition, movement: previousPosition === null ? null : previousPosition - position, teamId: row.team_external_id, teamName: team?.name ?? String(row.team_external_id).replace(/^api-football:/, "Team "), teamLogo: typeof metadata.logo === "string" ? metadata.logo : null, teamCountry: team?.country ?? league.country, played: Number(row.played ?? 0), wins: Number(row.wins ?? 0), draws: Number(row.draws ?? 0), losses: Number(row.losses ?? 0), goalsFor: gf, goalsAgainst: ga, goalDifference: gf - ga, points: Number(row.points ?? 0), form: formString(row.form) }; }).sort((a,b) => a.position-b.position);
  return rows.length ? { ...league, season, source: "supabase-standings-snapshot", updatedAt: snapshots[0], rows } : null;
}
