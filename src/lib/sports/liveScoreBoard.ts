/**
 * Lightweight real-time live-score board backed by API-Football.
 *
 * This module is intentionally separate from the heavy prediction provider:
 * it makes at most two upstream requests (live=all + today's fixtures),
 * caches the merged board in memory for a short TTL, and returns a compact
 * payload safe to poll from the browser.
 */

import { isConfiguredSecretValue } from "@/lib/env";
import { providerBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";
import type { Match, Sport } from "@/lib/sports/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { configuredPredictionLeagueIds, footballLeaguePriority } from "@/lib/sports/footballLeagues";
import { isStoredFixtureFresh, STORED_LIVE_STATUS_MAX_AGE_MS } from "@/lib/sports/intelligence/canonical";

export type LiveFixturePhase = "live" | "upcoming" | "finished" | "other";

export interface LiveBoardSide {
  id: number | null;
  name: string;
  logo: string | null;
  winner: boolean | null;
}

export interface LiveBoardFixture {
  id: number | string;
  sport: Extract<Sport, "football" | "basketball" | "tennis">;
  matchId: string;
  kickoff: string;
  phase: LiveFixturePhase;
  statusShort: string;
  statusLabel: string;
  elapsed: number | null;
  league: {
    id: number;
    name: string;
    country: string;
    logo: string | null;
    flag: string | null;
    round: string | null;
  };
  home: LiveBoardSide;
  away: LiveBoardSide;
  goals: {
    home: number | null;
    away: number | null;
  };
  analysis: boolean;
}

export interface LiveScoreBoard {
  generatedAt: string;
  date: string;
  source: "multi-provider" | "api-football" | "repository" | "none";
  counts: {
    live: number;
    upcoming: number;
    finished: number;
    other: number;
  };
  sportCounts: Record<Extract<Sport, "football" | "basketball" | "tennis">, number>;
  availableSports: Array<Extract<Sport, "football" | "basketball" | "tennis">>;
  fixtures: LiveBoardFixture[];
  note?: string;
}

type ApiFootballLiveFixture = {
  fixture?: {
    id?: number;
    date?: string;
    status?: { long?: string; short?: string; elapsed?: number | null; extra?: number | null };
  };
  league?: {
    id?: number;
    name?: string;
    country?: string;
    logo?: string;
    flag?: string | null;
    round?: string;
  };
  teams?: {
    home?: { id?: number; name?: string; logo?: string; winner?: boolean | null };
    away?: { id?: number; name?: string; logo?: string; winner?: boolean | null };
  };
  goals?: { home?: number | null; away?: number | null };
};

const LIVE_STATUS = new Set(["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"]);
const UPCOMING_STATUS = new Set(["TBD", "NS"]);
const FINISHED_STATUS = new Set(["FT", "AET", "PEN", "AWD", "WO", "ABD"]);

const STATUS_LABELS: Record<string, string> = {
  HT: "HT",
  BT: "Break",
  P: "Pens",
  SUSP: "Susp.",
  INT: "Int.",
  FT: "FT",
  AET: "AET",
  PEN: "Pens",
  PST: "Postponed",
  CANC: "Cancelled",
  ABD: "Abandoned",
  AWD: "Awarded",
  WO: "Walkover",
  TBD: "TBD"
};

/** Competitions pinned to the top of the board, in rough order of pull. */
const PRIORITY_LEAGUE_IDS = new Map<number, number>([
  [1, 0], // FIFA World Cup
  [6, 1], // Africa Cup of Nations
  [2, 2], // UEFA Champions League
  [12, 3], // CAF Champions League
  [39, 4], // Premier League
  [140, 5], // La Liga
  [135, 6], // Serie A
  [78, 7], // Bundesliga
  [61, 8], // Ligue 1
  [3, 9], // UEFA Europa League
  [848, 10], // UEFA Conference League
  [20, 11], // CAF Confederation Cup
  [399, 12], // NPFL (Nigeria)
  [288, 13], // Premier Soccer League (South Africa)
  [233, 14], // Egyptian Premier League
  [200, 15], // Botola Pro (Morocco)
  [570, 16], // Ghana Premier League
  [276, 17], // FKF Premier League (Kenya)
  [88, 20], // Eredivisie
  [94, 21], // Primeira Liga
  [203, 22] // Süper Lig
]);

const AFRICAN_COUNTRIES = new Set(
  [
    "Nigeria",
    "Ghana",
    "South-Africa",
    "South Africa",
    "Egypt",
    "Morocco",
    "Algeria",
    "Tunisia",
    "Senegal",
    "Ivory-Coast",
    "Ivory Coast",
    "Cameroon",
    "Kenya",
    "Tanzania",
    "Uganda",
    "Zambia",
    "Zimbabwe",
    "Congo-DR",
    "DR Congo",
    "Congo",
    "Angola",
    "Mali",
    "Burkina-Faso",
    "Burkina Faso",
    "Guinea",
    "Ethiopia",
    "Sudan",
    "Libya",
    "Gabon",
    "Benin",
    "Togo",
    "Mozambique",
    "Botswana",
    "Namibia",
    "Rwanda",
    "Malawi",
    "Niger",
    "Gambia",
    "Sierra-Leone",
    "Sierra Leone",
    "Liberia",
    "Mauritania",
    "Madagascar",
    "Cape-Verde",
    "Cape Verde",
    "Burundi",
    "Somalia",
    "Eswatini",
    "Lesotho"
  ].map((name) => name.toLowerCase())
);

const INTERNATIONAL_NAME_PATTERN = /world cup|champions league|europa|conference league|caf|afcon|africa|cosafa|wafu|cecafa|nations/i;
const EXCLUDED_NAME_PATTERN = /friendl/i;

const BOARD_TTL_MS = 30_000;
const MAX_FIXTURES = 500;
const REPOSITORY_COVERAGE_TIMEOUT_MS = 5_000;
const STORED_COVERAGE_SPORTS = ["football", "basketball", "tennis"] as const;

/** NaN from an invalid kickoff makes Array.sort's comparator inconsistent
 *  (order becomes engine-dependent); park unparseable dates at the end. */
function safeKickoffMs(iso: string): number {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

const boardCache = new Map<string, { expiresAt: number; board: LiveScoreBoard }>();
const inFlightByDate = new Map<string, Promise<LiveScoreBoard>>();
const multiSportBoardCache = new Map<string, { expiresAt: number; board: LiveScoreBoard }>();
const multiSportInFlightByDate = new Map<string, Promise<LiveScoreBoard>>();
const storedFixturesCache = new Map<string, { expiresAt: number; fixtures: LiveBoardFixture[] }>();
const storedFixturesInFlight = new Map<string, Promise<LiveBoardFixture[]>>();

function apiKey(): string | null {
  // Filter placeholder / whitespace-only values so a stub key isn't sent
  // upstream (which would just 401), matching the main provider's behaviour.
  const candidate = [process.env.API_FOOTBALL_KEY, process.env.APISPORTS_KEY, process.env.SPORTS_API_KEY].find(
    isConfiguredSecretValue
  );
  return candidate ? candidate.trim() : null;
}

const LIVE_BOARD_REQUEST_TIMEOUT_MS = 4_000;

function analysisLeagueIds(): Set<number> {
  return new Set([...configuredPredictionLeagueIds(process.env.API_FOOTBALL_LEAGUE_IDS)].map(Number));
}

function utcTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchApiFootball(path: string, params: Record<string, string>, key: string): Promise<ApiFootballLiveFixture[]> {
  const endpoint = new URL(`https://v3.football.api-sports.io/${path}`);
  for (const [name, value] of Object.entries(params)) endpoint.searchParams.set(name, value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIVE_BOARD_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      headers: { "x-apisports-key": key },
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) {
      console.warn(`[live-board] ${endpoint.host}/${path} — HTTP ${response.status}`);
      return [];
    }
    const payload = (await response.json()) as { response?: ApiFootballLiveFixture[] };
    return Array.isArray(payload.response) ? payload.response : [];
  } catch {
    console.warn(`[live-board] ${endpoint.host}/${path} — ${controller.signal.aborted ? "timed out" : "request failed"}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function phaseFor(statusShort: string): LiveFixturePhase {
  if (LIVE_STATUS.has(statusShort)) return "live";
  if (UPCOMING_STATUS.has(statusShort)) return "upcoming";
  if (FINISHED_STATUS.has(statusShort)) return "finished";
  return "other";
}

function statusLabelFor(statusShort: string, elapsed: number | null, extra: number | null): string {
  if (statusShort === "1H" || statusShort === "2H" || statusShort === "ET" || statusShort === "LIVE") {
    if (typeof elapsed === "number") {
      return typeof extra === "number" && extra > 0 ? `${elapsed}+${extra}'` : `${elapsed}'`;
    }
    return "Live";
  }
  return STATUS_LABELS[statusShort] ?? statusShort;
}

function leagueRank(leagueId: number, country: string, name: string): number {
  const pinned = footballLeaguePriority(leagueId) ?? PRIORITY_LEAGUE_IDS.get(leagueId);
  if (pinned !== undefined) return pinned;
  if (INTERNATIONAL_NAME_PATTERN.test(name) && !EXCLUDED_NAME_PATTERN.test(name)) return 20;
  if (AFRICAN_COUNTRIES.has(country.toLowerCase())) return 30;
  return 60;
}

function phaseOrder(phase: LiveFixturePhase): number {
  if (phase === "live") return 0;
  if (phase === "upcoming") return 1;
  if (phase === "finished") return 2;
  return 3;
}

function toBoardFixture(raw: ApiFootballLiveFixture, analysisLeagues: Set<number>): LiveBoardFixture | null {
  const id = raw.fixture?.id;
  const kickoff = raw.fixture?.date;
  const homeName = raw.teams?.home?.name;
  const awayName = raw.teams?.away?.name;
  if (!id || !kickoff || !homeName || !awayName) return null;

  const statusShort = raw.fixture?.status?.short ?? "NS";
  const elapsed = raw.fixture?.status?.elapsed ?? null;
  const extra = raw.fixture?.status?.extra ?? null;
  const leagueId = raw.league?.id ?? 0;

  return {
    id,
    sport: "football",
    matchId: `api-football:${id}`,
    kickoff,
    phase: phaseFor(statusShort),
    statusShort,
    statusLabel: statusLabelFor(statusShort, elapsed, extra),
    elapsed,
    league: {
      id: leagueId,
      name: raw.league?.name ?? "Unknown league",
      country: raw.league?.country ?? "World",
      logo: raw.league?.logo ?? null,
      flag: raw.league?.flag ?? null,
      round: raw.league?.round ?? null
    },
    home: {
      id: raw.teams?.home?.id ?? null,
      name: homeName,
      logo: raw.teams?.home?.logo ?? null,
      winner: raw.teams?.home?.winner ?? null
    },
    away: {
      id: raw.teams?.away?.id ?? null,
      name: awayName,
      logo: raw.teams?.away?.logo ?? null,
      winner: raw.teams?.away?.winner ?? null
    },
    goals: {
      home: raw.goals?.home ?? null,
      away: raw.goals?.away ?? null
    },
    analysis: analysisLeagues.has(leagueId)
  };
}

export function buildFootballBoardFromPayloads(rawLive: ApiFootballLiveFixture[], rawToday: ApiFootballLiveFixture[], boardDate: string): LiveScoreBoard {
  const analysisLeagues = analysisLeagueIds();
  const byId = new Map<LiveBoardFixture["id"], LiveBoardFixture>();

  for (const raw of rawToday) {
    const fixture = toBoardFixture(raw, analysisLeagues);
    if (!fixture) continue;
    byId.set(fixture.id, fixture);
  }

  // Live fixtures are always included (worldwide) and win over the schedule copy.
  for (const raw of rawLive) {
    const fixture = toBoardFixture(raw, analysisLeagues);
    if (!fixture) continue;
    byId.set(fixture.id, fixture);
  }

  const fixtures = Array.from(byId.values())
    .sort((a, b) => {
      const rankDiff =
        leagueRank(a.league.id, a.league.country, a.league.name) -
        leagueRank(b.league.id, b.league.country, b.league.name);
      if (rankDiff !== 0) return rankDiff;
      const leagueDiff = a.league.name.localeCompare(b.league.name);
      if (leagueDiff !== 0) return leagueDiff;
      const phaseDiff = phaseOrder(a.phase) - phaseOrder(b.phase);
      if (phaseDiff !== 0) return phaseDiff;
      return safeKickoffMs(a.kickoff) - safeKickoffMs(b.kickoff);
    })
    .slice(0, MAX_FIXTURES);

  const counts = { live: 0, upcoming: 0, finished: 0, other: 0 };
  for (const fixture of fixtures) counts[fixture.phase] += 1;

  return {
    generatedAt: new Date().toISOString(),
    date: boardDate,
    source: "api-football",
    counts,
    sportCounts: { football: fixtures.length, basketball: 0, tennis: 0 },
    availableSports: fixtures.length ? ["football"] : [],
    fixtures
  };
}

async function fetchFootballLiveScoreBoard(dateArg?: string): Promise<LiveScoreBoard> {
  const today = utcTodayIsoDate();
  const date = dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : today;
  const isToday = date === today;

  const key = apiKey();
  if (!key) {
    return {
      generatedAt: new Date().toISOString(),
      date,
      source: "none",
      counts: { live: 0, upcoming: 0, finished: 0, other: 0 },
      sportCounts: { football: 0, basketball: 0, tennis: 0 },
      availableSports: [],
      fixtures: [],
      note: "Live scores are warming up. Add an API-Football key to switch them on."
    };
  }

  const cached = boardCache.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached.board;
  const existing = inFlightByDate.get(date);
  if (existing) return existing;

  const promise = (async () => {
    try {
      // Only "today" pulls the in-play feed; other days are fixtures/results.
      const [rawLive, rawDate] = await Promise.all([
        isToday ? fetchApiFootball("fixtures", { live: "all", timezone: "UTC" }, key) : Promise.resolve([]),
        fetchApiFootball("fixtures", { date, timezone: "UTC" }, key)
      ]);
      const board = buildFootballBoardFromPayloads(rawLive, rawDate, date);
      // Non-today boards change slowly; cache them longer than the live board.
      const ttl = isToday ? BOARD_TTL_MS : 5 * 60_000;
      if (board.fixtures.length || !boardCache.get(date)) {
        boardCache.set(date, { expiresAt: Date.now() + ttl, board });
        if (boardCache.size > 16) boardCache.delete(boardCache.keys().next().value as string);
      }
      return boardCache.get(date)?.board ?? board;
    } finally {
      inFlightByDate.delete(date);
    }
  })();

  inFlightByDate.set(date, promise);
  return promise;
}

const MULTI_SPORTS = ["basketball", "tennis"] as const;

function genericFixturePhase(match: Match): LiveFixturePhase {
  if (match.status === "live") return "live";
  if (match.status === "finished") return "finished";
  if (match.status === "scheduled") return "upcoming";
  return "other";
}

export function liveBoardFixtureFromMatch(match: Match): LiveBoardFixture | null {
  if (match.sport !== "basketball" && match.sport !== "tennis") return null;
  if (match.dataSource?.kind !== "provider") return null;
  const phase = genericFixturePhase(match);
  const minute = match.score?.minute;
  return {
    id: match.id,
    matchId: match.id,
    sport: match.sport,
    kickoff: match.kickoffTime,
    phase,
    statusShort: phase === "live" ? "LIVE" : phase === "finished" ? "FT" : "NS",
    statusLabel: phase === "live" ? (typeof minute === "number" ? `${minute}'` : "Live") : phase === "finished" ? "FT" : "NS",
    elapsed: typeof minute === "number" ? minute : null,
    league: {
      id: Number.parseInt(match.league.id.replace(/\D+/g, ""), 10) || 0,
      name: match.league.name,
      country: match.league.country,
      logo: match.league.logo ?? null,
      flag: match.league.flag ?? null,
      round: null
    },
    home: { id: null, name: match.homeTeam.name, logo: match.homeTeam.logo ?? null, winner: phase === "finished" && match.score ? match.score.home > match.score.away : null },
    away: { id: null, name: match.awayTeam.name, logo: match.awayTeam.logo ?? null, winner: phase === "finished" && match.score ? match.score.away > match.score.home : null },
    goals: { home: match.score?.home ?? null, away: match.score?.away ?? null },
    analysis: true
  };
}

function timedFixtures(date: string, sport: (typeof MULTI_SPORTS)[number]): Promise<Match[]> {
  return Promise.race([
    providerBackedSportsDataProvider.getFixtures(date, sport).catch(() => []),
    new Promise<Match[]>((resolve) => setTimeout(() => resolve([]), 6_000))
  ]);
}

type RepositoryFixture = {
  id: string; sport: string; external_id: string; league_external_id: string | null; kickoff_at: string; status: string;
  home_team_external_id: string; away_team_external_id: string; home_score: number | null; away_score: number | null;
  country: string | null; last_synced_at: string | null; metadata: Record<string, unknown> | null;
};

type RepositoryNamedEntity = { external_id: string; name: string; country?: string | null; metadata: Record<string, unknown> | null };

function metadataText(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function readStoredFixtureRowsForDate(
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  date: string
): Promise<RepositoryFixture[]> {
  const from = `${date}T00:00:00.000Z`;
  const untilDate = new Date(from);
  untilDate.setUTCDate(untilDate.getUTCDate() + 1);
  const until = untilDate.toISOString();
  const sportPages = await Promise.all(STORED_COVERAGE_SPORTS.map(async (sport) => {
    const { data, error } = await client.from("op_fixtures")
      .select("id,sport,external_id,league_external_id,kickoff_at,status,home_team_external_id,away_team_external_id,home_score,away_score,country,last_synced_at,metadata")
      .eq("sport", sport)
      .gte("kickoff_at", from)
      .lt("kickoff_at", until)
      .order("kickoff_at")
      .limit(MAX_FIXTURES);
    if (error) throw new Error(`Stored ${sport} fixture read failed: ${error.message}`);
    return (data ?? []) as RepositoryFixture[];
  }));
  return sportPages.flat();
}

export function normalizeStoredLiveBoardState(
  fixture: Pick<RepositoryFixture, "status" | "last_synced_at" | "home_score" | "away_score"> & { elapsed: number | null },
  now = new Date(),
  maxLiveAgeMs = STORED_LIVE_STATUS_MAX_AGE_MS
): Pick<LiveBoardFixture, "phase" | "statusShort" | "statusLabel" | "elapsed" | "goals"> {
  const status = fixture.status.toLowerCase();
  const live = status === "live" || status === "in_play";
  if (live && !isStoredFixtureFresh(fixture.last_synced_at, now, maxLiveAgeMs)) {
    return {
      phase: "other",
      statusShort: "STALE",
      statusLabel: "Awaiting update",
      elapsed: null,
      goals: { home: null, away: null }
    };
  }

  const phase: LiveFixturePhase = live
    ? "live"
    : status === "finished" || status === "ft"
      ? "finished"
      : status === "scheduled" || status === "not_started"
        ? "upcoming"
        : "other";
  return {
    phase,
    statusShort: phase === "live" ? "LIVE" : phase === "finished" ? "FT" : phase === "upcoming" ? "NS" : fixture.status,
    statusLabel:
      phase === "live"
        ? (typeof fixture.elapsed === "number" ? `${fixture.elapsed}'` : "Live")
        : phase === "finished"
          ? "FT"
          : phase === "upcoming"
            ? "NS"
            : fixture.status,
    elapsed: fixture.elapsed,
    goals: { home: fixture.home_score, away: fixture.away_score }
  };
}

async function readStoredFixturesForDate(date: string): Promise<LiveBoardFixture[]> {
  const client = getSupabaseServerClient();
  if (!client) throw new Error("Supabase server client is unavailable.");
  const data = await readStoredFixtureRowsForDate(client, date);
  if (!data?.length) return [];
  const rows = (data as RepositoryFixture[]).filter((row) => row.sport === "football" || row.sport === "basketball" || row.sport === "tennis");
  const leagueIds = [...new Set(rows.map((row) => row.league_external_id).filter((id): id is string => Boolean(id)))];
  const teamIds = [...new Set(rows.flatMap((row) => [row.home_team_external_id, row.away_team_external_id]))];
  const [{ data: leagues, error: leagueError }, { data: teams, error: teamError }] = await Promise.all([
    leagueIds.length ? client.from("op_leagues").select("external_id,name,country,metadata").in("external_id", leagueIds) : Promise.resolve({ data: [], error: null }),
    teamIds.length ? client.from("op_teams").select("external_id,name,country,metadata").in("external_id", teamIds) : Promise.resolve({ data: [], error: null })
  ]);
  if (leagueError) throw new Error(`Stored league read failed: ${leagueError.message}`);
  if (teamError) throw new Error(`Stored team read failed: ${teamError.message}`);
  const leagueMap = new Map((leagues as RepositoryNamedEntity[] | null ?? []).map((row) => [row.external_id, row]));
  const teamMap = new Map((teams as RepositoryNamedEntity[] | null ?? []).map((row) => [row.external_id, row]));
  const now = new Date();
  return rows.flatMap((row) => {
    const sport = row.sport as LiveBoardFixture["sport"];
    const home = teamMap.get(row.home_team_external_id);
    const away = teamMap.get(row.away_team_external_id);
    if (!home?.name || !away?.name) return [];
    const league = row.league_external_id ? leagueMap.get(row.league_external_id) : undefined;
    const elapsed = typeof row.metadata?.elapsed === "number" ? row.metadata.elapsed : null;
    const state = normalizeStoredLiveBoardState({ ...row, elapsed }, now);
    return [{
      id: row.id, matchId: row.external_id, sport, kickoff: row.kickoff_at, phase: state.phase,
      statusShort: state.statusShort,
      statusLabel: state.statusLabel,
      elapsed: state.elapsed,
      league: { id: Number.parseInt((row.league_external_id ?? "").replace(/\D+/g, ""), 10) || 0, name: league?.name ?? "Competition", country: league?.country ?? row.country ?? "World", logo: metadataText(league?.metadata ?? null, "logo"), flag: metadataText(league?.metadata ?? null, "flag"), round: metadataText(row.metadata, "round") },
      home: { id: null, name: home.name, logo: metadataText(home.metadata, "logo"), winner: state.phase === "finished" && state.goals.home !== null && state.goals.away !== null ? state.goals.home > state.goals.away : null },
      away: { id: null, name: away.name, logo: metadataText(away.metadata, "logo"), winner: state.phase === "finished" && state.goals.home !== null && state.goals.away !== null ? state.goals.away > state.goals.home : null },
      goals: state.goals, analysis: true
    } satisfies LiveBoardFixture];
  });
}

async function storedFixturesForDate(date: string): Promise<LiveBoardFixture[]> {
  const cached = storedFixturesCache.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached.fixtures;
  const existing = storedFixturesInFlight.get(date);
  if (existing) return existing;

  const promise = readStoredFixturesForDate(date).then((fixtures) => {
    storedFixturesCache.set(date, { expiresAt: Date.now() + 60_000, fixtures });
    if (storedFixturesCache.size > 16) storedFixturesCache.delete(storedFixturesCache.keys().next().value as string);
    return fixtures;
  }).finally(() => storedFixturesInFlight.delete(date));
  storedFixturesInFlight.set(date, promise);
  return promise;
}

export type RepositoryCoverageResult = {
  fixtures: LiveBoardFixture[];
  unavailableReason: "timeout" | "error" | null;
};

export async function resolveRepositoryCoverage(
  source: Promise<LiveBoardFixture[]>,
  timeoutMs = REPOSITORY_COVERAGE_TIMEOUT_MS
): Promise<RepositoryCoverageResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const guardedSource = source
    .then((fixtures) => ({ fixtures, unavailableReason: null }) satisfies RepositoryCoverageResult)
    .catch((error: unknown) => {
      console.warn(`[live-board] stored fixture supplement failed — ${error instanceof Error ? error.message : "unknown error"}`);
      return { fixtures: [], unavailableReason: "error" } satisfies RepositoryCoverageResult;
    });
  const timedOut = new Promise<RepositoryCoverageResult>((resolve) => {
    timeout = setTimeout(() => resolve({ fixtures: [], unavailableReason: "timeout" }), timeoutMs);
  });

  try {
    return await Promise.race([guardedSource, timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function mergeLiveBoardCoverage(
  providerFixtures: LiveBoardFixture[],
  repositoryFixtures: LiveBoardFixture[]
): LiveBoardFixture[] {
  const providerSports = new Set(providerFixtures.map((fixture) => fixture.sport));
  return [
    ...providerFixtures,
    ...repositoryFixtures.filter((fixture) => !providerSports.has(fixture.sport))
  ];
}

async function fetchLiveScoreBoardUncached(date: string): Promise<LiveScoreBoard> {
  const [football, basketballMatches, tennisMatches, repositoryCoverage] = await Promise.all([
    fetchFootballLiveScoreBoard(date),
    timedFixtures(date, "basketball"),
    timedFixtures(date, "tennis"),
    resolveRepositoryCoverage(storedFixturesForDate(date))
  ]);
  const extraFixtures = [...basketballMatches, ...tennisMatches]
    .map(liveBoardFixtureFromMatch)
    .filter((fixture): fixture is LiveBoardFixture => Boolean(fixture));
  const providerFixtures = [...football.fixtures, ...extraFixtures];
  const repositoryFixtures = repositoryCoverage.fixtures;
  const fixtures = mergeLiveBoardCoverage(providerFixtures, repositoryFixtures).sort((a, b) => {
    const phaseDiff = phaseOrder(a.phase) - phaseOrder(b.phase);
    if (phaseDiff !== 0) return phaseDiff;
    const sportDiff = a.sport.localeCompare(b.sport);
    if (sportDiff !== 0) return sportDiff;
    return safeKickoffMs(a.kickoff) - safeKickoffMs(b.kickoff);
  });
  const counts = { live: 0, upcoming: 0, finished: 0, other: 0 };
  const sportCounts = { football: 0, basketball: 0, tennis: 0 };
  for (const fixture of fixtures) {
    counts[fixture.phase] += 1;
    sportCounts[fixture.sport] += 1;
  }
  const availableSports = (["football", "basketball", "tennis"] as const).filter((sport) => sportCounts[sport] > 0);
  return {
    generatedAt: new Date().toISOString(),
    date,
    source: providerFixtures.length ? "multi-provider" : repositoryFixtures.length ? "repository" : "none",
    counts,
    sportCounts,
    availableSports,
    fixtures,
    note: repositoryCoverage.unavailableReason
      ? providerFixtures.length
        ? `Showing provider coverage only; the stored fixture supplement ${repositoryCoverage.unavailableReason === "timeout" ? "timed out" : "is temporarily unavailable"}.`
        : `Live providers returned no fixtures and the stored fixture fallback ${repositoryCoverage.unavailableReason === "timeout" ? "timed out" : "is temporarily unavailable"}.`
      : repositoryFixtures.some((fixture) => !providerFixtures.some((provider) => provider.sport === fixture.sport))
        ? providerFixtures.length
          ? "Live provider coverage is supplemented with normalized stored fixtures for unavailable sports."
          : "Showing the latest normalized fixtures stored by the OddsPadi ingestion engine."
        : fixtures.length ? undefined : "No provider-backed or stored score feeds returned fixtures for this date."
  };
}

export async function fetchLiveScoreBoard(dateArg?: string): Promise<LiveScoreBoard> {
  const today = utcTodayIsoDate();
  const date = dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg) ? dateArg : today;
  const cached = multiSportBoardCache.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached.board;
  const existing = multiSportInFlightByDate.get(date);
  if (existing) return existing;

  const promise = fetchLiveScoreBoardUncached(date).then((board) => {
    const ttl = date === today ? BOARD_TTL_MS : 5 * 60_000;
    multiSportBoardCache.set(date, { expiresAt: Date.now() + ttl, board });
    if (multiSportBoardCache.size > 16) multiSportBoardCache.delete(multiSportBoardCache.keys().next().value as string);
    return board;
  }).finally(() => multiSportInFlightByDate.delete(date));
  multiSportInFlightByDate.set(date, promise);
  return promise;
}
