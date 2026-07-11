import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import {
  ingestHistoricalFootballFixtures,
  type HistoricalFootballFixtureInput,
  type HistoricalFootballIngestResult
} from "@/lib/sports/training/historicalIngestion";

type FetchHtml = (url: string) => Promise<string>;
type Ingest = typeof ingestHistoricalFootballFixtures;

export type BasketballReferenceIngestionStatus = "stored" | "dry-run" | "partial" | "failed" | "invalid-request";

export type BasketballReferenceIngestion = {
  mode: "basketball-reference-ingestion";
  generatedAt: string;
  status: BasketballReferenceIngestionStatus;
  summary: string;
  provider: {
    name: "Basketball-Reference";
    providerKey: "basketball_reference";
    leagueCode: "NBA";
  };
  request: {
    seasonFrom: number;
    seasonTo: number;
    maxSeasons: number;
    offset: number;
    limit: number | null;
    dryRun: boolean;
  };
  totals: {
    seasonsRequested: number;
    monthsLoaded: number;
    gamesPrepared: number;
    oddsRowsPrepared: number;
    featureSnapshotsPrepared: number;
    rowsWritten: number;
    failedMonths: number;
  };
  seasons: Array<{
    season: number;
    sourceMonths: number;
    gamesPrepared: number;
    status: "loaded" | "partial" | "failed";
    error: string | null;
  }>;
  ingestion: HistoricalFootballIngestResult | null;
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunDryRun: true;
    canWriteHistoricalRows: boolean;
    canRunBacktestAfterStore: boolean;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
  };
  locks: string[];
  proofUrls: string[];
};

type BasketballReferenceGame = {
  season: number;
  fixtureExternalId: string;
  kickoffAt: string;
  visitorTeam: string;
  visitorTeamId: string;
  visitorPoints: number;
  homeTeam: string;
  homeTeamId: string;
  homePoints: number;
  arena: string | null;
  notes: string | null;
  month: string;
};

type TeamState = {
  games: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  recent: Array<{ pointsFor: number; pointsAgainst: number; won: boolean }>;
  lastGameAt: number | null;
  rating: number;
};

const DEFAULT_SEASON_FROM = 2024;
const DEFAULT_SEASON_TO = 2024;
const DEFAULT_MAX_SEASONS = 1;
const MAX_GAMES = 15000;
const BASKETBALL_REFERENCE_MONTHS = [
  "october",
  "november",
  "december",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september"
];
const htmlCache = new Map<string, string>();

function sourceUrl(season: number, month: string): string {
  return `https://www.basketball-reference.com/leagues/NBA_${season}_games-${month}.html`;
}

async function defaultFetchHtml(url: string): Promise<string> {
  const cached = htmlCache.get(url);
  if (cached !== undefined) return cached;
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "user-agent": "OddsPadi historical training importer (local development; contact: operator)",
      accept: "text/html,application/xhtml+xml"
    }
  });
  if (response.status === 404) return "";
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  htmlCache.set(url, html);
  return html;
}

function stableHashText(value: string): string {
  return value.toLowerCase().replace(/&amp;/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function statValue(rowHtml: string, stat: string): string {
  const match = rowHtml.match(new RegExp(`<(?:td|th)[^>]*data-stat=["']${stat}["'][^>]*>([\\s\\S]*?)</(?:td|th)>`, "i"));
  return match ? decodeHtml(match[1] ?? "") : "";
}

function statCsk(rowHtml: string, stat: string): string | null {
  const match = rowHtml.match(new RegExp(`<(?:td|th)[^>]*data-stat=["']${stat}["'][^>]*csk=["']([^"']+)["'][^>]*>`, "i"));
  return match?.[1] ?? null;
}

function parseInteger(value: string): number | null {
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function dateToIso(value: string): string | null {
  const parsed = new Date(`${value} 12:00:00 UTC`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString();
}

function teamId(teamName: string): string {
  return `basketball-reference:nba:team:${stableHashText(teamName)}`;
}

function fixtureId(season: number, csk: string | null, date: string, visitor: string, home: string): string {
  const key = csk || `${date}:${visitor}:${home}`;
  return `basketball-reference:nba:${season}:${stableHashText(key)}`;
}

export function parseBasketballReferenceSchedule(html: string, season: number, month: string): BasketballReferenceGame[] {
  if (!html.trim()) return [];
  const rows = Array.from(html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)).map((match) => match[0]);
  return rows.flatMap((rowHtml) => {
    const date = statValue(rowHtml, "date_game");
    const visitorTeam = statValue(rowHtml, "visitor_team_name");
    const homeTeam = statValue(rowHtml, "home_team_name");
    const visitorPoints = parseInteger(statValue(rowHtml, "visitor_pts"));
    const homePoints = parseInteger(statValue(rowHtml, "home_pts"));
    if (!date || !visitorTeam || !homeTeam || visitorPoints === null || homePoints === null) return [];
    const kickoffAt = dateToIso(date);
    if (!kickoffAt) return [];
    const csk = statCsk(rowHtml, "date_game");
    const arena = statValue(rowHtml, "arena_name") || null;
    const notes = statValue(rowHtml, "game_remarks") || null;
    return [
      {
        season,
        fixtureExternalId: fixtureId(season, csk, date, visitorTeam, homeTeam),
        kickoffAt,
        visitorTeam,
        visitorTeamId: teamId(visitorTeam),
        visitorPoints,
        homeTeam,
        homeTeamId: teamId(homeTeam),
        homePoints,
        arena,
        notes,
        month
      }
    ];
  });
}

function round(value: number | null | undefined, digits = 6): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stateFor(map: Map<string, TeamState>, teamIdValue: string): TeamState {
  const existing = map.get(teamIdValue);
  if (existing) return existing;
  const created: TeamState = {
    games: 0,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    recent: [],
    lastGameAt: null,
    rating: 1500
  };
  map.set(teamIdValue, created);
  return created;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function restDays(state: TeamState, kickoffAt: string): number | null {
  if (!state.lastGameAt) return null;
  const days = (new Date(kickoffAt).getTime() - state.lastGameAt) / 86400000;
  return Number.isFinite(days) ? Math.max(0, Math.min(14, days)) : null;
}

function featuresFor(state: TeamState, kickoffAt: string) {
  const recent = state.recent.slice(-5);
  const recentPointsFor = average(recent.map((game) => game.pointsFor));
  const recentPointsAgainst = average(recent.map((game) => game.pointsAgainst));
  const recentFormPoints = recent.reduce((sum, game) => sum + (game.won ? 2 : 0), 0);
  const offensiveEfficiency = recentPointsFor ?? (state.games ? state.pointsFor / state.games : 112);
  const defensiveEfficiency = recentPointsAgainst ?? (state.games ? state.pointsAgainst / state.games : 112);
  const pace = 96 + Math.max(-6, Math.min(8, ((recentPointsFor ?? offensiveEfficiency) + (recentPointsAgainst ?? defensiveEfficiency) - 224) / 5));
  return {
    eloRating: round(state.rating, 3),
    attackStrength: round(offensiveEfficiency, 3),
    defenseStrength: round(defensiveEfficiency, 3),
    recentFormPoints: round(recentFormPoints, 3),
    recentGoalsFor: round(recentPointsFor),
    recentGoalsAgainst: round(recentPointsAgainst),
    restDays: round(restDays(state, kickoffAt), 3),
    injuriesCount: null,
    suspensionsCount: null,
    lineupConfirmed: false,
    metadata: {
      source: "basketball-reference",
      featureMethod: "rolling-score-efficiency-rest-rating",
      rating: round(state.rating, 3),
      pace: round(pace, 3),
      offensiveEfficiency: round(offensiveEfficiency, 3),
      defensiveEfficiency: round(defensiveEfficiency, 3),
      gamesPlayedBeforeTip: state.games
    }
  };
}

function updateState(state: TeamState, scored: number, allowed: number): void {
  const won = scored > allowed;
  state.games += 1;
  state.wins += won ? 1 : 0;
  state.losses += won ? 0 : 1;
  state.pointsFor += scored;
  state.pointsAgainst += allowed;
  state.recent = [...state.recent, { pointsFor: scored, pointsAgainst: allowed, won }].slice(-8);
}

function updateRatings(home: TeamState, away: TeamState, homeScore: number, awayScore: number): void {
  const expectedHome = 1 / (1 + 10 ** ((away.rating - home.rating - 45) / 400));
  const actualHome = homeScore > awayScore ? 1 : 0;
  const marginFactor = Math.max(0.7, Math.min(1.8, Math.abs(homeScore - awayScore) / 12));
  const k = 18 * marginFactor;
  home.rating += k * (actualHome - expectedHome);
  away.rating += k * ((1 - actualHome) - (1 - expectedHome));
}

function toIngestFixtures(games: BasketballReferenceGame[], offset = 0, limit?: number): HistoricalFootballFixtureInput[] {
  const sorted = [...games].sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime());
  const teamStates = new Map<string, TeamState>();
  const prepared: HistoricalFootballFixtureInput[] = [];

  sorted.forEach((game, index) => {
    const home = stateFor(teamStates, game.homeTeamId);
    const away = stateFor(teamStates, game.visitorTeamId);
    const include = index >= offset && prepared.length < (limit && limit > 0 ? Math.min(limit, MAX_GAMES) : MAX_GAMES);
    if (include) {
      prepared.push({
        sport: "basketball",
        externalId: game.fixtureExternalId,
        kickoffAt: game.kickoffAt,
        league: {
          externalId: "basketball-reference:nba",
          name: "National Basketball Association",
          country: "USA",
          strength: 0.96,
          metadata: {
            source: "basketball-reference",
            sourceSeason: game.season
          }
        },
        season: String(game.season),
        round: null,
        status: "finished",
        homeTeam: {
          externalId: game.homeTeamId,
          name: game.homeTeam,
          country: "USA"
        },
        awayTeam: {
          externalId: game.visitorTeamId,
          name: game.visitorTeam,
          country: "USA"
        },
        homeScore: game.homePoints,
        awayScore: game.visitorPoints,
        neutralVenue: Boolean(game.notes?.toLowerCase().includes("neutral")),
        venue: game.arena,
        country: "USA",
        dataQuality: 0.7,
        homeFeatures: featuresFor(home, game.kickoffAt),
        awayFeatures: featuresFor(away, game.kickoffAt),
        odds: [],
        metadata: {
          source: "basketball-reference",
          sourceSeason: game.season,
          sourceMonth: game.month,
          notes: game.notes,
          oddsCoverage: "not-in-public-basketball-reference-schedule"
        }
      });
    }
    updateRatings(home, away, game.homePoints, game.visitorPoints);
    updateState(home, game.homePoints, game.visitorPoints);
    updateState(away, game.visitorPoints, game.homePoints);
    const gameTime = new Date(game.kickoffAt).getTime();
    home.lastGameAt = gameTime;
    away.lastGameAt = gameTime;
  });

  return prepared;
}

function statusFor(ingestion: HistoricalFootballIngestResult | null, failedMonths: number): BasketballReferenceIngestionStatus {
  if (!ingestion) return failedMonths > 0 ? "failed" : "invalid-request";
  if (ingestion.status === "stored" && failedMonths === 0) return "stored";
  if (ingestion.status === "dry-run" && failedMonths === 0) return "dry-run";
  if (ingestion.status === "stored" || ingestion.status === "dry-run") return "partial";
  return "failed";
}

function summaryFor(status: BasketballReferenceIngestionStatus, games: number, rowsWritten: number): string {
  if (status === "stored") return `Stored ${rowsWritten} Basketball-Reference NBA historical row(s) across ${games} game(s); odds and publishing remain locked.`;
  if (status === "dry-run") return `Prepared ${games} Basketball-Reference NBA game(s) as a dry-run; no rows were written.`;
  if (status === "partial") return `Basketball-Reference ingestion partially completed for ${games} game(s); inspect failed months before expanding.`;
  if (status === "invalid-request") return "Basketball-Reference ingestion did not receive a valid season range.";
  return "Basketball-Reference ingestion failed before reliable NBA rows could be prepared.";
}

function nextActionFor(status: BasketballReferenceIngestionStatus, dryRun: boolean, offset: number, limit: number | null): BasketballReferenceIngestion["nextAction"] {
  const query = new URLSearchParams({ seasonFrom: "2024", seasonTo: "2024", maxSeasons: "1", dryRun: dryRun ? "0" : "1" });
  if (offset > 0) query.set("offset", String(offset));
  if (limit) query.set("limit", String(limit));
  const verifyUrl = dryRun
    ? `/api/sports/decision/training/basketball-reference-ingest?${query.toString()}`
    : "/api/sports/decision/training/provider-corpus-dry-run-queue?sport=basketball";
  return {
    label: dryRun ? "Store this NBA history batch" : "Attach paid basketball odds/provider proof",
    command: `${decisionCurlCommand(verifyUrl)}${dryRun ? ' -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"' : ""}`,
    verifyUrl,
    expectedEvidence:
      status === "stored"
        ? "Training snapshot shows real NBA finished games and rolling basketball feature rows; moneyline value remains locked until bookmaker odds are attached."
        : "Dry-run counts show prepared NBA games, feature rows, and zero writes before storage."
  };
}

export async function buildBasketballReferenceIngestion({
  seasonFrom = DEFAULT_SEASON_FROM,
  seasonTo = DEFAULT_SEASON_TO,
  maxSeasons = DEFAULT_MAX_SEASONS,
  offset = 0,
  limit,
  dryRun = true,
  fetchHtml = defaultFetchHtml,
  ingest = ingestHistoricalFootballFixtures,
  now = new Date()
}: {
  seasonFrom?: number;
  seasonTo?: number;
  maxSeasons?: number;
  offset?: number;
  limit?: number;
  dryRun?: boolean;
  fetchHtml?: FetchHtml;
  ingest?: Ingest;
  now?: Date;
} = {}): Promise<BasketballReferenceIngestion> {
  const start = Math.max(1947, Math.min(seasonFrom, seasonTo));
  const end = Math.min(2026, Math.max(seasonFrom, seasonTo));
  const seasons = Array.from({ length: end - start + 1 }, (_, index) => start + index).slice(0, Math.max(1, Math.min(maxSeasons, 10)));

  const allGames: BasketballReferenceGame[] = [];
  const seasonReceipts: BasketballReferenceIngestion["seasons"] = [];
  let monthsLoaded = 0;
  let failedMonths = 0;

  for (const season of seasons) {
    const seasonGames: BasketballReferenceGame[] = [];
    let seasonFailedMonths = 0;
    for (const month of BASKETBALL_REFERENCE_MONTHS) {
      try {
        const html = await fetchHtml(sourceUrl(season, month));
        const games = parseBasketballReferenceSchedule(html, season, month);
        if (!games.length) continue;
        seasonGames.push(...games);
        monthsLoaded += 1;
      } catch (error) {
        seasonFailedMonths += 1;
        failedMonths += 1;
      }
    }
    const uniqueSeasonGames = Array.from(new Map(seasonGames.map((game) => [game.fixtureExternalId, game])).values());
    allGames.push(...uniqueSeasonGames);
    seasonReceipts.push({
      season,
      sourceMonths: uniqueSeasonGames.length ? new Set(uniqueSeasonGames.map((game) => game.month)).size : 0,
      gamesPrepared: uniqueSeasonGames.length,
      status: uniqueSeasonGames.length ? (seasonFailedMonths ? "partial" : "loaded") : "failed",
      error: uniqueSeasonGames.length ? null : "No finished Basketball-Reference schedule rows were loaded."
    });
  }

  const safeOffset = Math.max(0, Math.trunc(offset || 0));
  const safeLimit = limit && limit > 0 ? Math.min(limit, MAX_GAMES) : undefined;
  const preparedFixtures = toIngestFixtures(allGames, safeOffset, safeLimit);
  const ingestion = await ingest({
    sport: "basketball",
    provider: "basketball_reference",
    sourceKind: "real",
    dryRun,
    fixtures: preparedFixtures
  });
  const status = statusFor(ingestion, failedMonths);
  const rowsWritten = ingestion?.rowsWritten ?? 0;

  return {
    mode: "basketball-reference-ingestion",
    generatedAt: now.toISOString(),
    status,
    summary: summaryFor(status, preparedFixtures.length, rowsWritten),
    provider: {
      name: "Basketball-Reference",
      providerKey: "basketball_reference",
      leagueCode: "NBA"
    },
    request: {
      seasonFrom: start,
      seasonTo: end,
      maxSeasons: seasons.length,
      offset: safeOffset,
      limit: safeLimit ?? null,
      dryRun
    },
    totals: {
      seasonsRequested: seasons.length,
      monthsLoaded,
      gamesPrepared: preparedFixtures.length,
      oddsRowsPrepared: 0,
      featureSnapshotsPrepared: preparedFixtures.length,
      rowsWritten,
      failedMonths
    },
    seasons: seasonReceipts,
    ingestion,
    nextAction: nextActionFor(status, dryRun, safeOffset, safeLimit ?? null),
    controls: {
      canInspectReadOnly: true,
      canRunDryRun: true,
      canWriteHistoricalRows: !dryRun && status === "stored",
      canRunBacktestAfterStore: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Basketball-Reference schedule rows do not include bookmaker moneyline odds; value-edge backtests remain locked until odds are attached.",
      "Stored rows can feed basketball feature/readiness checks only; learned weights, public picks, and staking stay locked.",
      "Live basketball recommendations still require paid provider fixtures, injuries, rest confirmation, and bookmaker odds proof."
    ],
    proofUrls: [
      "/api/sports/decision/training/basketball-reference-ingest",
      "/api/sports/decision/training/provider-corpus-dry-run-queue?sport=basketball",
      "/api/sports/decision/training/multi-sport-backtest-run",
      "/api/sports/decision/training/supabase-training-corpus-census"
    ]
  };
}
