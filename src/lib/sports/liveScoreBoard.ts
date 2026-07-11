/**
 * Lightweight real-time live-score board backed by API-Football.
 *
 * This module is intentionally separate from the heavy prediction provider:
 * it makes at most two upstream requests (live=all + today's fixtures),
 * caches the merged board in memory for a short TTL, and returns a compact
 * payload safe to poll from the browser.
 */

export type LiveFixturePhase = "live" | "upcoming" | "finished" | "other";

export interface LiveBoardSide {
  id: number | null;
  name: string;
  logo: string | null;
  winner: boolean | null;
}

export interface LiveBoardFixture {
  id: number;
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
  source: "api-football" | "none";
  counts: {
    live: number;
    upcoming: number;
    finished: number;
    other: number;
  };
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
const FINISHED_STATUS = new Set(["FT", "AET", "PEN"]);

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
  [88, 14], // Eredivisie
  [94, 15], // Primeira Liga
  [203, 16] // Süper Lig
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

let cachedBoard: { expiresAt: number; board: LiveScoreBoard } | null = null;
let inFlight: Promise<LiveScoreBoard> | null = null;

function apiKey(): string | null {
  return process.env.API_FOOTBALL_KEY || process.env.APISPORTS_KEY || process.env.SPORTS_API_KEY || null;
}

function analysisLeagueIds(): Set<number> {
  const raw = process.env.API_FOOTBALL_LEAGUE_IDS ?? "39";
  return new Set(
    raw
      .split(",")
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value))
  );
}

function utcTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchApiFootball(path: string, params: Record<string, string>, key: string): Promise<ApiFootballLiveFixture[]> {
  const endpoint = new URL(`https://v3.football.api-sports.io/${path}`);
  for (const [name, value] of Object.entries(params)) endpoint.searchParams.set(name, value);
  try {
    const response = await fetch(endpoint, {
      headers: { "x-apisports-key": key },
      cache: "no-store"
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { response?: ApiFootballLiveFixture[] };
    return Array.isArray(payload.response) ? payload.response : [];
  } catch {
    return [];
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
  const pinned = PRIORITY_LEAGUE_IDS.get(leagueId);
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

function isRelevantForSchedule(leagueId: number, country: string, name: string): boolean {
  if (PRIORITY_LEAGUE_IDS.has(leagueId)) return true;
  if (AFRICAN_COUNTRIES.has(country.toLowerCase())) return true;
  const international = country.toLowerCase() === "world" || country.toLowerCase() === "europe";
  if (international && INTERNATIONAL_NAME_PATTERN.test(name) && !EXCLUDED_NAME_PATTERN.test(name)) return true;
  return false;
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

function buildBoard(rawLive: ApiFootballLiveFixture[], rawToday: ApiFootballLiveFixture[]): LiveScoreBoard {
  const analysisLeagues = analysisLeagueIds();
  const byId = new Map<number, LiveBoardFixture>();

  for (const raw of rawToday) {
    const fixture = toBoardFixture(raw, analysisLeagues);
    if (!fixture) continue;
    if (!isRelevantForSchedule(fixture.league.id, fixture.league.country, fixture.league.name)) continue;
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
      return new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime();
    })
    .slice(0, MAX_FIXTURES);

  const counts = { live: 0, upcoming: 0, finished: 0, other: 0 };
  for (const fixture of fixtures) counts[fixture.phase] += 1;

  return {
    generatedAt: new Date().toISOString(),
    date: utcTodayIsoDate(),
    source: "api-football",
    counts,
    fixtures
  };
}

export async function fetchLiveScoreBoard(): Promise<LiveScoreBoard> {
  const key = apiKey();
  if (!key) {
    return {
      generatedAt: new Date().toISOString(),
      date: utcTodayIsoDate(),
      source: "none",
      counts: { live: 0, upcoming: 0, finished: 0, other: 0 },
      fixtures: [],
      note: "Live scores are warming up. Add an API-Football key to switch them on."
    };
  }

  if (cachedBoard && cachedBoard.expiresAt > Date.now()) return cachedBoard.board;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const today = utcTodayIsoDate();
      const [rawLive, rawToday] = await Promise.all([
        fetchApiFootball("fixtures", { live: "all", timezone: "UTC" }, key),
        fetchApiFootball("fixtures", { date: today, timezone: "UTC" }, key)
      ]);
      const board = buildBoard(rawLive, rawToday);
      if (board.fixtures.length || !cachedBoard) {
        cachedBoard = { expiresAt: Date.now() + BOARD_TTL_MS, board };
      }
      return cachedBoard?.board ?? board;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
