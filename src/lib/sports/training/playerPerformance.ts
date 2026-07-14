import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { EvidenceQuality, MatchContextSignal } from "@/lib/sports/types";

export type PlayerMatchPerformance = {
  sport: "football";
  provider: string;
  sourceKind: "real" | "demo";
  fixtureExternalId: string;
  fixtureKickoffAt: string;
  teamExternalId: string;
  playerExternalId: string;
  playerName: string;
  position: string | null;
  shirtNumber: number | null;
  minutes: number;
  started: boolean;
  captain: boolean;
  rating: number | null;
  goals: number;
  assists: number;
  shotsTotal: number;
  shotsOnTarget: number;
  passesTotal: number;
  keyPasses: number;
  passAccuracy: number | null;
  tackles: number;
  interceptions: number;
  saves: number;
  yellowCards: number;
  redCards: number;
  dataQuality: number;
  metrics: Record<string, unknown>;
  observedAt: string;
};

export type PlayerFormFixture = {
  fixtureExternalId: string;
  kickoffAt: string;
  homeTeam: { externalId: string; name: string };
  awayTeam: { externalId: string; name: string };
};

export type PlayerPerformanceStoreResult = {
  status: "stored" | "dry-run" | "not-configured" | "failed";
  rowsReceived: number;
  rowsWritten: number;
  errors: string[];
};

type StoredPlayerPerformanceRow = {
  sport: string;
  provider: string;
  source_kind: string;
  fixture_external_id: string;
  fixture_kickoff_at: string;
  team_external_id: string;
  player_external_id: string;
  player_name: string;
  position: string | null;
  shirt_number: number | null;
  minutes: number;
  started: boolean;
  captain: boolean;
  rating: number | string | null;
  goals: number;
  assists: number;
  shots_total: number;
  shots_on_target: number;
  passes_total: number;
  key_passes: number;
  pass_accuracy: number | string | null;
  tackles: number;
  interceptions: number;
  saves: number;
  yellow_cards: number;
  red_cards: number;
  data_quality: number | string;
  metrics: Record<string, unknown> | null;
  observed_at: string;
};

type TeamPlayerForm = {
  sampleMatches: number;
  totalMinutes: number;
  averageRating: number | null;
  goals: number;
  assists: number;
  attackingContributionsPerMatch: number;
  defensiveActionsPerMatch: number;
  latestFixtureAt: string | null;
  score: number;
  leadingPlayers: Array<{ name: string; minutes: number; rating: number | null; goals: number; assists: number }>;
};

const PLAYER_FORM_MATCH_WINDOW = 5;
const PLAYER_FORM_CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; signals: Map<string, MatchContextSignal[]> }>();

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function integer(value: unknown, fallback = 0): number {
  const number = finite(value);
  return number === null ? fallback : Math.trunc(number);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toStoredRow(row: PlayerMatchPerformance) {
  return {
    sport: row.sport,
    provider: row.provider,
    source_kind: row.sourceKind,
    fixture_external_id: row.fixtureExternalId,
    fixture_kickoff_at: row.fixtureKickoffAt,
    team_external_id: row.teamExternalId,
    player_external_id: row.playerExternalId,
    player_name: row.playerName,
    position: row.position,
    shirt_number: row.shirtNumber,
    minutes: row.minutes,
    started: row.started,
    captain: row.captain,
    rating: row.rating,
    goals: row.goals,
    assists: row.assists,
    shots_total: row.shotsTotal,
    shots_on_target: row.shotsOnTarget,
    passes_total: row.passesTotal,
    key_passes: row.keyPasses,
    pass_accuracy: row.passAccuracy,
    tackles: row.tackles,
    interceptions: row.interceptions,
    saves: row.saves,
    yellow_cards: row.yellowCards,
    red_cards: row.redCards,
    data_quality: row.dataQuality,
    metrics: row.metrics,
    observed_at: row.observedAt,
    updated_at: new Date().toISOString()
  };
}

function fromStoredRow(row: StoredPlayerPerformanceRow): PlayerMatchPerformance {
  return {
    sport: "football",
    provider: text(row.provider),
    sourceKind: row.source_kind === "demo" ? "demo" : "real",
    fixtureExternalId: text(row.fixture_external_id),
    fixtureKickoffAt: row.fixture_kickoff_at,
    teamExternalId: text(row.team_external_id),
    playerExternalId: text(row.player_external_id),
    playerName: text(row.player_name),
    position: text(row.position) || null,
    shirtNumber: finite(row.shirt_number),
    minutes: integer(row.minutes),
    started: row.started === true,
    captain: row.captain === true,
    rating: finite(row.rating),
    goals: integer(row.goals),
    assists: integer(row.assists),
    shotsTotal: integer(row.shots_total),
    shotsOnTarget: integer(row.shots_on_target),
    passesTotal: integer(row.passes_total),
    keyPasses: integer(row.key_passes),
    passAccuracy: finite(row.pass_accuracy),
    tackles: integer(row.tackles),
    interceptions: integer(row.interceptions),
    saves: integer(row.saves),
    yellowCards: integer(row.yellow_cards),
    redCards: integer(row.red_cards),
    dataQuality: finite(row.data_quality) ?? 0,
    metrics: row.metrics ?? {},
    observedAt: row.observed_at
  };
}

function chunks<T>(rows: T[], size = 400): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

export async function storePlayerMatchPerformances(
  rows: PlayerMatchPerformance[],
  { dryRun = true }: { dryRun?: boolean } = {}
): Promise<PlayerPerformanceStoreResult> {
  if (dryRun) return { status: "dry-run", rowsReceived: rows.length, rowsWritten: 0, errors: [] };
  if (!rows.length) return { status: "stored", rowsReceived: 0, rowsWritten: 0, errors: [] };
  const client = getSupabaseServerClient();
  if (!client) return { status: "not-configured", rowsReceived: rows.length, rowsWritten: 0, errors: ["Supabase server writes are not configured."] };

  try {
    let written = 0;
    for (const batch of chunks(rows.map(toStoredRow))) {
      const { error } = await client
        .from("op_player_match_performances")
        .upsert(batch, { onConflict: "provider,fixture_external_id,team_external_id,player_external_id" });
      if (error) throw new Error(error.message);
      written += batch.length;
    }
    cache.clear();
    return { status: "stored", rowsReceived: rows.length, rowsWritten: written, errors: [] };
  } catch (error) {
    return {
      status: "failed",
      rowsReceived: rows.length,
      rowsWritten: 0,
      errors: [error instanceof Error ? error.message : "Player-performance storage failed."]
    };
  }
}

function rowsBeforeFixture(rows: PlayerMatchPerformance[], teamExternalId: string, kickoffAt: string): PlayerMatchPerformance[] {
  const kickoffMs = Date.parse(kickoffAt);
  const eligible = rows
    .filter((row) => row.sourceKind === "real" && row.teamExternalId === teamExternalId && row.minutes > 0 && Date.parse(row.fixtureKickoffAt) < kickoffMs)
    .sort((a, b) => Date.parse(b.fixtureKickoffAt) - Date.parse(a.fixtureKickoffAt));
  const fixtureIds: string[] = [];
  for (const row of eligible) {
    if (!fixtureIds.includes(row.fixtureExternalId)) fixtureIds.push(row.fixtureExternalId);
    if (fixtureIds.length >= PLAYER_FORM_MATCH_WINDOW) break;
  }
  const allowed = new Set(fixtureIds);
  return eligible.filter((row) => allowed.has(row.fixtureExternalId));
}

function summarizeTeam(rows: PlayerMatchPerformance[]): TeamPlayerForm {
  const sampleMatches = new Set(rows.map((row) => row.fixtureExternalId)).size;
  const totalMinutes = rows.reduce((sum, row) => sum + row.minutes, 0);
  const rated = rows.filter((row) => row.rating !== null && row.minutes > 0);
  const ratedMinutes = rated.reduce((sum, row) => sum + row.minutes, 0);
  const averageRating = ratedMinutes
    ? rated.reduce((sum, row) => sum + (row.rating ?? 0) * row.minutes, 0) / ratedMinutes
    : null;
  const goals = rows.reduce((sum, row) => sum + row.goals, 0);
  const assists = rows.reduce((sum, row) => sum + row.assists, 0);
  const tackles = rows.reduce((sum, row) => sum + row.tackles, 0);
  const interceptions = rows.reduce((sum, row) => sum + row.interceptions, 0);
  const saves = rows.reduce((sum, row) => sum + row.saves, 0);
  const matchMinutes = totalMinutes > 0 ? totalMinutes / 990 : 0;
  const attackingContributionsPerMatch = matchMinutes > 0 ? (goals + assists * 0.7) / matchMinutes : 0;
  const defensiveActionsPerMatch = matchMinutes > 0 ? (tackles + interceptions + saves * 0.6) / matchMinutes : 0;
  const byPlayer = new Map<string, { name: string; minutes: number; ratingMinutes: number; ratedMinutes: number; goals: number; assists: number }>();
  for (const row of rows) {
    const current = byPlayer.get(row.playerExternalId) ?? { name: row.playerName, minutes: 0, ratingMinutes: 0, ratedMinutes: 0, goals: 0, assists: 0 };
    current.minutes += row.minutes;
    current.goals += row.goals;
    current.assists += row.assists;
    if (row.rating !== null) {
      current.ratingMinutes += row.rating * row.minutes;
      current.ratedMinutes += row.minutes;
    }
    byPlayer.set(row.playerExternalId, current);
  }
  const leadingPlayers = [...byPlayer.values()]
    .map((row) => ({ name: row.name, minutes: row.minutes, rating: row.ratedMinutes ? row.ratingMinutes / row.ratedMinutes : null, goals: row.goals, assists: row.assists }))
    .sort((a, b) => ((b.rating ?? 0) - (a.rating ?? 0)) || (b.goals + b.assists - a.goals - a.assists) || (b.minutes - a.minutes))
    .slice(0, 3);
  const score = (averageRating === null ? 0 : (averageRating - 6.5) * 0.45) + attackingContributionsPerMatch * 0.16 + defensiveActionsPerMatch * 0.012;
  return {
    sampleMatches,
    totalMinutes,
    averageRating,
    goals,
    assists,
    attackingContributionsPerMatch,
    defensiveActionsPerMatch,
    latestFixtureAt: rows[0]?.fixtureKickoffAt ?? null,
    score,
    leadingPlayers
  };
}

function qualityFor(home: TeamPlayerForm, away: TeamPlayerForm): EvidenceQuality {
  const matches = Math.min(home.sampleMatches, away.sampleMatches);
  const minutes = Math.min(home.totalMinutes, away.totalMinutes);
  if (matches >= 5 && minutes >= 3_500) return "strong";
  if (matches >= 3 && minutes >= 2_000) return "acceptable";
  return matches > 0 ? "thin" : "missing";
}

function formattedRating(value: number | null): string {
  return value === null ? "unrated" : value.toFixed(2);
}

export function buildPlayerFormSignal(
  fixture: PlayerFormFixture,
  rows: PlayerMatchPerformance[]
): MatchContextSignal | null {
  const home = summarizeTeam(rowsBeforeFixture(rows, fixture.homeTeam.externalId, fixture.kickoffAt));
  const away = summarizeTeam(rowsBeforeFixture(rows, fixture.awayTeam.externalId, fixture.kickoffAt));
  if (!home.sampleMatches || !away.sampleMatches) return null;

  const quality = qualityFor(home, away);
  const difference = home.score - away.score;
  const magnitude = Math.abs(difference);
  const confidence = quality === "strong" ? 0.76 : quality === "acceptable" ? 0.66 : 0.5;
  const weight = quality === "thin" ? 0 : clamp(magnitude * 0.022, 0, 0.018);
  const impact = weight < 0.002 ? "neutral" : difference > 0 ? "home-positive" : "away-positive";
  const latestFixtureAt = [home.latestFixtureAt, away.latestFixtureAt]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const items = [
    ...home.leadingPlayers.map((player) => ({ team: fixture.homeTeam.name, player: player.name, reason: `${formattedRating(player.rating)} rating · ${player.goals}G ${player.assists}A`, status: "Recent form" })),
    ...away.leadingPlayers.map((player) => ({ team: fixture.awayTeam.name, player: player.name, reason: `${formattedRating(player.rating)} rating · ${player.goals}G ${player.assists}A`, status: "Recent form" }))
  ];

  return {
    id: `${fixture.fixtureExternalId}-historical-player-form`,
    category: "player-form",
    label: impact === "home-positive" ? `${fixture.homeTeam.name} player-form edge` : impact === "away-positive" ? `${fixture.awayTeam.name} player-form edge` : "Player form is balanced",
    detail: `${fixture.homeTeam.name}: ${home.sampleMatches} matches, ${formattedRating(home.averageRating)} minute-weighted rating, ${home.goals}G/${home.assists}A. ${fixture.awayTeam.name}: ${away.sampleMatches} matches, ${formattedRating(away.averageRating)} rating, ${away.goals}G/${away.assists}A. Only fixtures before this kickoff are included.`,
    quality,
    impact,
    confidence,
    weight,
    source: "supabase-player-performance",
    publishedAt: latestFixtureAt,
    items
  };
}

function cacheKey(fixtures: PlayerFormFixture[]): string {
  return fixtures.map((fixture) => `${fixture.fixtureExternalId}:${fixture.kickoffAt}`).sort().join("|");
}

export async function loadPlayerFormSignalsForFixtures(
  fixtures: PlayerFormFixture[]
): Promise<Map<string, MatchContextSignal[]>> {
  if (!fixtures.length) return new Map();
  const key = cacheKey(fixtures);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.signals;
  const client = getSupabaseServerClient();
  if (!client) return new Map();
  const teamIds = [...new Set(fixtures.flatMap((fixture) => [fixture.homeTeam.externalId, fixture.awayTeam.externalId]))];
  const maxKickoff = fixtures.map((fixture) => fixture.kickoffAt).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const storedRows: StoredPlayerPerformanceRow[] = [];
  const pageSize = 1_000;
  for (let page = 0; page < 6; page += 1) {
    const { data, error } = await client
      .from("op_player_match_performances")
      .select("sport,provider,source_kind,fixture_external_id,fixture_kickoff_at,team_external_id,player_external_id,player_name,position,shirt_number,minutes,started,captain,rating,goals,assists,shots_total,shots_on_target,passes_total,key_passes,pass_accuracy,tackles,interceptions,saves,yellow_cards,red_cards,data_quality,metrics,observed_at")
      .eq("sport", "football")
      .eq("source_kind", "real")
      .in("team_external_id", teamIds)
      .lt("fixture_kickoff_at", maxKickoff)
      .gt("minutes", 0)
      .order("fixture_kickoff_at", { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) return new Map();
    const pageRows = (data ?? []) as StoredPlayerPerformanceRow[];
    storedRows.push(...pageRows);
    const teamFixtureCoverage = new Map<string, Set<string>>();
    for (const row of storedRows) {
      const fixtureIds = teamFixtureCoverage.get(row.team_external_id) ?? new Set<string>();
      fixtureIds.add(row.fixture_external_id);
      teamFixtureCoverage.set(row.team_external_id, fixtureIds);
    }
    if (pageRows.length < pageSize || teamIds.every((teamId) => (teamFixtureCoverage.get(teamId)?.size ?? 0) >= PLAYER_FORM_MATCH_WINDOW)) break;
  }
  const rows = storedRows.map(fromStoredRow);
  const signals = new Map<string, MatchContextSignal[]>();
  for (const fixture of fixtures) {
    const signal = buildPlayerFormSignal(fixture, rows);
    if (signal) signals.set(fixture.fixtureExternalId, [signal]);
  }
  cache.set(key, { expiresAt: Date.now() + PLAYER_FORM_CACHE_MS, signals });
  if (cache.size > 16) cache.delete(cache.keys().next().value as string);
  return signals;
}
