import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import type { Match, OddsMarket, Sport } from "@/lib/sports/types";

type IngestStatus = "stored" | "dry-run" | "not-configured" | "failed";
type IngestSourceKind = "real" | "demo";
type FixtureStatus = "scheduled" | "live" | "finished" | "postponed" | "cancelled";
type WinnerSelection = "home" | "draw" | "away";
type NewsSignalType = "injury" | "lineup" | "weather" | "transfer" | "sentiment" | "tactical" | "other";
type AvailabilityStatus = "available" | "doubtful" | "injured" | "suspended" | "unknown";
type LineupStatus = "predicted" | "confirmed" | "unavailable";
type HistoricalTrainingSport = Extract<Sport, "football" | "basketball" | "tennis">;

export type HistoricalFootballTeamInput = {
  externalId: string;
  name: string;
  country?: string | null;
  metadata?: Record<string, unknown>;
};

export type HistoricalFootballLeagueInput = {
  externalId: string;
  name: string;
  country?: string | null;
  strength?: number | null;
  metadata?: Record<string, unknown>;
};

export type HistoricalFootballFeatureInput = {
  eloRating?: number | null;
  attackStrength?: number | null;
  defenseStrength?: number | null;
  recentFormPoints?: number | null;
  recentGoalsFor?: number | null;
  recentGoalsAgainst?: number | null;
  xgFor?: number | null;
  xgAgainst?: number | null;
  restDays?: number | null;
  injuriesCount?: number | null;
  suspensionsCount?: number | null;
  lineupConfirmed?: boolean | null;
  metadata?: Record<string, unknown>;
};

export type HistoricalFootballOddsInput = {
  bookmaker?: string | null;
  market: "match_winner";
  selection: WinnerSelection;
  decimalOdds: number;
  isClosing?: boolean;
  observedAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type HistoricalFootballEventInput = {
  eventExternalId?: string | null;
  minute?: number | null;
  stoppageMinute?: number | null;
  teamExternalId?: string | null;
  playerExternalId?: string | null;
  eventType: string;
  eventValue?: number | null;
  observedAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type HistoricalFootballNewsInput = {
  sourceName?: string | null;
  sourceUrl?: string | null;
  publishedAt?: string | null;
  signalType?: NewsSignalType;
  sentiment?: number | null;
  confidence?: number | null;
  impactScore?: number | null;
  summary: string;
  entities?: unknown[];
  raw?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type HistoricalFootballStandingInput = {
  teamExternalId: string;
  snapshotAt?: string | null;
  position?: number | null;
  played?: number | null;
  points?: number | null;
  wins?: number | null;
  draws?: number | null;
  losses?: number | null;
  goalsFor?: number | null;
  goalsAgainst?: number | null;
  form?: unknown[];
  metadata?: Record<string, unknown>;
};

export type HistoricalFootballAvailabilityInput = {
  teamExternalId: string;
  playerExternalId?: string | null;
  playerName: string;
  status?: AvailabilityStatus;
  impactScore?: number | null;
  reason?: string | null;
  observedAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type HistoricalFootballLineupInput = {
  teamExternalId: string;
  lineupStatus?: LineupStatus;
  formation?: string | null;
  players?: unknown[];
  observedAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type HistoricalFootballWeatherInput = {
  observedFor?: string | null;
  temperatureC?: number | null;
  precipitationMm?: number | null;
  windKph?: number | null;
  humidity?: number | null;
  condition?: string | null;
  impactScore?: number | null;
  metadata?: Record<string, unknown>;
};

export type HistoricalFootballFixtureInput = {
  sport?: HistoricalTrainingSport;
  externalId: string;
  kickoffAt: string;
  league: HistoricalFootballLeagueInput;
  season?: string | null;
  round?: string | null;
  status?: FixtureStatus;
  homeTeam: HistoricalFootballTeamInput;
  awayTeam: HistoricalFootballTeamInput;
  homeScore?: number | null;
  awayScore?: number | null;
  homeXg?: number | null;
  awayXg?: number | null;
  neutralVenue?: boolean;
  venue?: string | null;
  country?: string | null;
  dataQuality?: number | null;
  homeFeatures?: HistoricalFootballFeatureInput;
  awayFeatures?: HistoricalFootballFeatureInput;
  odds?: HistoricalFootballOddsInput[];
  events?: HistoricalFootballEventInput[];
  news?: HistoricalFootballNewsInput[];
  standings?: HistoricalFootballStandingInput[];
  availability?: HistoricalFootballAvailabilityInput[];
  lineups?: HistoricalFootballLineupInput[];
  weather?: HistoricalFootballWeatherInput[];
  metadata?: Record<string, unknown>;
};

export type HistoricalFootballIngestPayload = {
  sport?: HistoricalTrainingSport;
  provider?: string;
  sourceKind?: IngestSourceKind;
  dryRun?: boolean;
  fixtures?: HistoricalFootballFixtureInput[];
};

export type HistoricalFootballIngestResult = {
  status: IngestStatus;
  sport: HistoricalTrainingSport;
  configured: boolean;
  dryRun: boolean;
  provider: string;
  sourceKind: IngestSourceKind;
  ingestionRunId?: string;
  rowsReceived: number;
  rowsWritten: number;
  counts: {
    leagues: number;
    teams: number;
    fixtures: number;
    featureRows: number;
    oddsRows: number;
    eventRows: number;
    newsRows: number;
    standingsRows: number;
    availabilityRows: number;
    lineupRows: number;
    weatherRows: number;
    featureSnapshots: number;
  };
  errors: string[];
};

type NormalizedFixture = Required<
  Pick<HistoricalFootballFixtureInput, "externalId" | "kickoffAt" | "league" | "homeTeam" | "awayTeam">
> &
  Omit<HistoricalFootballFixtureInput, "externalId" | "kickoffAt" | "league" | "homeTeam" | "awayTeam"> & {
    sport: HistoricalTrainingSport;
    status: FixtureStatus;
    dataQuality: number;
    odds: HistoricalFootballOddsInput[];
    events: HistoricalFootballEventInput[];
    news: HistoricalFootballNewsInput[];
    standings: HistoricalFootballStandingInput[];
    availability: HistoricalFootballAvailabilityInput[];
    lineups: HistoricalFootballLineupInput[];
    weather: HistoricalFootballWeatherInput[];
  };

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanProvider(value: unknown, fallback = "manual_import"): string {
  const text = cleanText(value).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  return text || fallback;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = finiteNumber(value);
  if (parsed === null) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function integerOrNull(value: unknown): number | null {
  const parsed = finiteNumber(value);
  if (parsed === null) return null;
  return Math.trunc(parsed);
}

function isFixtureStatus(value: unknown): value is FixtureStatus {
  return value === "scheduled" || value === "live" || value === "finished" || value === "postponed" || value === "cancelled";
}

function isWinnerSelection(value: unknown): value is WinnerSelection {
  return value === "home" || value === "draw" || value === "away";
}

function isNewsSignalType(value: unknown): value is NewsSignalType {
  return value === "injury" || value === "lineup" || value === "weather" || value === "transfer" || value === "sentiment" || value === "tactical" || value === "other";
}

function isAvailabilityStatus(value: unknown): value is AvailabilityStatus {
  return value === "available" || value === "doubtful" || value === "injured" || value === "suspended" || value === "unknown";
}

function isLineupStatus(value: unknown): value is LineupStatus {
  return value === "predicted" || value === "confirmed" || value === "unavailable";
}

function isHistoricalTrainingSport(value: unknown): value is HistoricalTrainingSport {
  return value === "football" || value === "basketball" || value === "tennis";
}

function modelKeyForSport(sport: HistoricalTrainingSport): string {
  if (sport === "basketball") return "basketball-efficiency-moneyline-v1";
  if (sport === "tennis") return "tennis-surface-elo-match-winner-v1";
  return "football-poisson-elo-v1";
}

function isValidIsoDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}

function normalizeFixture(input: HistoricalFootballFixtureInput, index: number): NormalizedFixture | { error: string } {
  const externalId = cleanText(input.externalId);
  if (!externalId) return { error: `fixtures[${index}].externalId is required.` };
  if (!cleanText(input.kickoffAt) || !isValidIsoDate(input.kickoffAt)) return { error: `fixtures[${index}].kickoffAt must be a valid date.` };
  if (!cleanText(input.league?.externalId)) return { error: `fixtures[${index}].league.externalId is required.` };
  if (!cleanText(input.league?.name)) return { error: `fixtures[${index}].league.name is required.` };
  if (!cleanText(input.homeTeam?.externalId)) return { error: `fixtures[${index}].homeTeam.externalId is required.` };
  if (!cleanText(input.homeTeam?.name)) return { error: `fixtures[${index}].homeTeam.name is required.` };
  if (!cleanText(input.awayTeam?.externalId)) return { error: `fixtures[${index}].awayTeam.externalId is required.` };
  if (!cleanText(input.awayTeam?.name)) return { error: `fixtures[${index}].awayTeam.name is required.` };

  const status = isFixtureStatus(input.status) ? input.status : "finished";
  const homeScore = integerOrNull(input.homeScore);
  const awayScore = integerOrNull(input.awayScore);
  if (status === "finished" && (homeScore === null || awayScore === null)) {
    return { error: `fixtures[${index}] finished fixtures require homeScore and awayScore.` };
  }

  const odds = input.odds ?? [];
  for (let oddsIndex = 0; oddsIndex < odds.length; oddsIndex += 1) {
    const quote = odds[oddsIndex];
    if (quote.market !== "match_winner") return { error: `fixtures[${index}].odds[${oddsIndex}].market is invalid.` };
    if (!isWinnerSelection(quote.selection)) return { error: `fixtures[${index}].odds[${oddsIndex}].selection is invalid.` };
    if (!Number.isFinite(quote.decimalOdds) || quote.decimalOdds <= 1) {
      return { error: `fixtures[${index}].odds[${oddsIndex}].decimalOdds must be greater than 1.` };
    }
    if (quote.observedAt && !isValidIsoDate(quote.observedAt)) {
      return { error: `fixtures[${index}].odds[${oddsIndex}].observedAt must be a valid date.` };
    }
  }

  const events = input.events ?? [];
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    if (!cleanText(event.eventType)) return { error: `fixtures[${index}].events[${eventIndex}].eventType is required.` };
    const minute = integerOrNull(event.minute);
    if (minute !== null && (minute < 0 || minute > 130)) return { error: `fixtures[${index}].events[${eventIndex}].minute must be between 0 and 130.` };
    const stoppageMinute = integerOrNull(event.stoppageMinute);
    if (stoppageMinute !== null && stoppageMinute < 0) return { error: `fixtures[${index}].events[${eventIndex}].stoppageMinute must be 0 or greater.` };
    if (event.observedAt && !isValidIsoDate(event.observedAt)) {
      return { error: `fixtures[${index}].events[${eventIndex}].observedAt must be a valid date.` };
    }
  }

  const news = input.news ?? [];
  for (let newsIndex = 0; newsIndex < news.length; newsIndex += 1) {
    const item = news[newsIndex];
    if (!cleanText(item.summary)) return { error: `fixtures[${index}].news[${newsIndex}].summary is required.` };
    if (item.signalType !== undefined && !isNewsSignalType(item.signalType)) return { error: `fixtures[${index}].news[${newsIndex}].signalType is invalid.` };
    if (item.publishedAt && !isValidIsoDate(item.publishedAt)) return { error: `fixtures[${index}].news[${newsIndex}].publishedAt must be a valid date.` };
    const confidence = finiteNumber(item.confidence);
    if (confidence !== null && (confidence < 0 || confidence > 1)) return { error: `fixtures[${index}].news[${newsIndex}].confidence must be between 0 and 1.` };
  }

  const standings = input.standings ?? [];
  for (let standingsIndex = 0; standingsIndex < standings.length; standingsIndex += 1) {
    const item = standings[standingsIndex];
    if (!cleanText(item.teamExternalId)) return { error: `fixtures[${index}].standings[${standingsIndex}].teamExternalId is required.` };
    if (item.snapshotAt && !isValidIsoDate(item.snapshotAt)) return { error: `fixtures[${index}].standings[${standingsIndex}].snapshotAt must be a valid date.` };
    const position = integerOrNull(item.position);
    if (position !== null && position <= 0) return { error: `fixtures[${index}].standings[${standingsIndex}].position must be greater than 0.` };
  }

  const availability = input.availability ?? [];
  for (let availabilityIndex = 0; availabilityIndex < availability.length; availabilityIndex += 1) {
    const item = availability[availabilityIndex];
    if (!cleanText(item.teamExternalId)) return { error: `fixtures[${index}].availability[${availabilityIndex}].teamExternalId is required.` };
    if (!cleanText(item.playerName)) return { error: `fixtures[${index}].availability[${availabilityIndex}].playerName is required.` };
    if (item.status !== undefined && !isAvailabilityStatus(item.status)) return { error: `fixtures[${index}].availability[${availabilityIndex}].status is invalid.` };
    if (item.observedAt && !isValidIsoDate(item.observedAt)) return { error: `fixtures[${index}].availability[${availabilityIndex}].observedAt must be a valid date.` };
  }

  const lineups = input.lineups ?? [];
  for (let lineupIndex = 0; lineupIndex < lineups.length; lineupIndex += 1) {
    const item = lineups[lineupIndex];
    if (!cleanText(item.teamExternalId)) return { error: `fixtures[${index}].lineups[${lineupIndex}].teamExternalId is required.` };
    if (item.lineupStatus !== undefined && !isLineupStatus(item.lineupStatus)) return { error: `fixtures[${index}].lineups[${lineupIndex}].lineupStatus is invalid.` };
    if (item.observedAt && !isValidIsoDate(item.observedAt)) return { error: `fixtures[${index}].lineups[${lineupIndex}].observedAt must be a valid date.` };
  }

  const weather = input.weather ?? [];
  for (let weatherIndex = 0; weatherIndex < weather.length; weatherIndex += 1) {
    const item = weather[weatherIndex];
    if (item.observedFor && !isValidIsoDate(item.observedFor)) return { error: `fixtures[${index}].weather[${weatherIndex}].observedFor must be a valid date.` };
    const humidity = finiteNumber(item.humidity);
    if (humidity !== null && (humidity < 0 || humidity > 100)) return { error: `fixtures[${index}].weather[${weatherIndex}].humidity must be between 0 and 100.` };
  }

  return {
    ...input,
    sport: isHistoricalTrainingSport(input.sport) ? input.sport : "football",
    externalId,
    kickoffAt: new Date(input.kickoffAt).toISOString(),
    league: {
      ...input.league,
      externalId: cleanText(input.league.externalId),
      name: cleanText(input.league.name),
      country: input.league.country ?? input.country ?? null,
      strength: finiteNumber(input.league.strength)
    },
    homeTeam: {
      ...input.homeTeam,
      externalId: cleanText(input.homeTeam.externalId),
      name: cleanText(input.homeTeam.name),
      country: input.homeTeam.country ?? input.country ?? null
    },
    awayTeam: {
      ...input.awayTeam,
      externalId: cleanText(input.awayTeam.externalId),
      name: cleanText(input.awayTeam.name),
      country: input.awayTeam.country ?? input.country ?? null
    },
    status,
    homeScore,
    awayScore,
    homeXg: finiteNumber(input.homeXg),
    awayXg: finiteNumber(input.awayXg),
    dataQuality: boundedNumber(input.dataQuality, 0, 1, odds.length ? 0.78 : 0.62),
    odds,
    events: events.map((event) => ({
      ...event,
      eventExternalId: cleanText(event.eventExternalId) || null,
      minute: integerOrNull(event.minute),
      stoppageMinute: integerOrNull(event.stoppageMinute),
      teamExternalId: cleanText(event.teamExternalId) || null,
      playerExternalId: cleanText(event.playerExternalId) || null,
      eventType: cleanText(event.eventType),
      eventValue: finiteNumber(event.eventValue),
      observedAt: event.observedAt ? new Date(event.observedAt).toISOString() : null,
      metadata: event.metadata ?? {}
    })),
    news: news.map((item) => ({
      ...item,
      sourceName: cleanText(item.sourceName) || null,
      sourceUrl: cleanText(item.sourceUrl) || null,
      publishedAt: item.publishedAt ? new Date(item.publishedAt).toISOString() : null,
      signalType: isNewsSignalType(item.signalType) ? item.signalType : "other",
      sentiment: finiteNumber(item.sentiment),
      confidence: finiteNumber(item.confidence),
      impactScore: finiteNumber(item.impactScore),
      summary: cleanText(item.summary),
      entities: Array.isArray(item.entities) ? item.entities : [],
      raw: item.raw ?? {},
      metadata: item.metadata ?? {}
    })),
    standings: standings.map((item) => ({
      ...item,
      teamExternalId: cleanText(item.teamExternalId),
      snapshotAt: item.snapshotAt ? new Date(item.snapshotAt).toISOString() : new Date(input.kickoffAt).toISOString(),
      position: integerOrNull(item.position),
      played: Math.max(0, integerOrNull(item.played) ?? 0),
      points: integerOrNull(item.points) ?? 0,
      wins: Math.max(0, integerOrNull(item.wins) ?? 0),
      draws: Math.max(0, integerOrNull(item.draws) ?? 0),
      losses: Math.max(0, integerOrNull(item.losses) ?? 0),
      goalsFor: integerOrNull(item.goalsFor) ?? 0,
      goalsAgainst: integerOrNull(item.goalsAgainst) ?? 0,
      form: Array.isArray(item.form) ? item.form : [],
      metadata: item.metadata ?? {}
    })),
    availability: availability.map((item) => ({
      ...item,
      teamExternalId: cleanText(item.teamExternalId),
      playerExternalId: cleanText(item.playerExternalId) || null,
      playerName: cleanText(item.playerName),
      status: isAvailabilityStatus(item.status) ? item.status : "unknown",
      impactScore: finiteNumber(item.impactScore),
      reason: cleanText(item.reason) || null,
      observedAt: item.observedAt ? new Date(item.observedAt).toISOString() : new Date(input.kickoffAt).toISOString(),
      metadata: item.metadata ?? {}
    })),
    lineups: lineups.map((item) => ({
      ...item,
      teamExternalId: cleanText(item.teamExternalId),
      lineupStatus: isLineupStatus(item.lineupStatus) ? item.lineupStatus : "unavailable",
      formation: cleanText(item.formation) || null,
      players: Array.isArray(item.players) ? item.players : [],
      observedAt: item.observedAt ? new Date(item.observedAt).toISOString() : new Date(input.kickoffAt).toISOString(),
      metadata: item.metadata ?? {}
    })),
    weather: weather.map((item) => ({
      ...item,
      observedFor: item.observedFor ? new Date(item.observedFor).toISOString() : new Date(input.kickoffAt).toISOString(),
      temperatureC: finiteNumber(item.temperatureC),
      precipitationMm: finiteNumber(item.precipitationMm),
      windKph: finiteNumber(item.windKph),
      humidity: finiteNumber(item.humidity),
      condition: cleanText(item.condition) || null,
      impactScore: finiteNumber(item.impactScore),
      metadata: item.metadata ?? {}
    }))
  };
}

export function parseHistoricalFootballIngestPayload(input: unknown): HistoricalFootballIngestPayload | { errors: string[] } {
  const payload = (input ?? {}) as HistoricalFootballIngestPayload;
  const provider = cleanProvider(payload.provider, payload.sourceKind === "demo" ? "demo_seed" : "manual_import");
  const sport = isHistoricalTrainingSport(payload.sport) ? payload.sport : "football";
  const sourceKind: IngestSourceKind = payload.sourceKind === "demo" ? "demo" : "real";
  const rawFixtures = Array.isArray(payload.fixtures) ? payload.fixtures : [];
  const errors: string[] = [];
  const fixtures: HistoricalFootballFixtureInput[] = [];

  if (!rawFixtures.length) errors.push("fixtures must contain at least one fixture.");

  rawFixtures.forEach((fixture, index) => {
    const normalized = normalizeFixture({ ...fixture, sport: fixture.sport ?? sport }, index);
    if ("error" in normalized) {
      errors.push(normalized.error);
    } else {
      fixtures.push(normalized);
    }
  });

  if (errors.length) return { errors };
  return {
    provider: sourceKind === "demo" ? "demo_seed" : provider,
    sport,
    sourceKind,
    dryRun: Boolean(payload.dryRun),
    fixtures
  };
}

function uniqueBy<T>(items: T[], keyForItem: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [keyForItem(item), item])).values()];
}

function sameExternalId(a: unknown, b: unknown): boolean {
  return cleanText(a) === cleanText(b);
}

function standingsForTeam(fixture: NormalizedFixture, teamExternalId: string): HistoricalFootballStandingInput | null {
  return fixture.standings.find((item) => sameExternalId(item.teamExternalId, teamExternalId)) ?? null;
}

function availabilityForTeam(fixture: NormalizedFixture, teamExternalId: string): HistoricalFootballAvailabilityInput[] {
  return fixture.availability.filter((item) => sameExternalId(item.teamExternalId, teamExternalId));
}

function lineupForTeam(fixture: NormalizedFixture, teamExternalId: string): HistoricalFootballLineupInput | null {
  return fixture.lineups.find((item) => sameExternalId(item.teamExternalId, teamExternalId)) ?? null;
}

function countAvailability(items: HistoricalFootballAvailabilityInput[], statuses: AvailabilityStatus[]): number {
  const statusSet = new Set(statuses);
  return items.filter((item) => statusSet.has(isAvailabilityStatus(item.status) ? item.status : "unknown")).length;
}

function featureRowsForFixture(fixtureId: string, fixture: NormalizedFixture) {
  return ([
    { side: "home" as const, team: fixture.homeTeam, features: fixture.homeFeatures },
    { side: "away" as const, team: fixture.awayTeam, features: fixture.awayFeatures }
  ] as const).map((item) => {
    const standing = standingsForTeam(fixture, item.team.externalId);
    const availability = availabilityForTeam(fixture, item.team.externalId);
    const lineup = lineupForTeam(fixture, item.team.externalId);
    const derivedInjuries = countAvailability(availability, ["injured", "doubtful"]);
    const derivedSuspensions = countAvailability(availability, ["suspended"]);

    return {
      fixture_id: fixtureId,
      side: item.side,
      team_external_id: item.team.externalId,
      elo_rating: finiteNumber(item.features?.eloRating),
      attack_strength: finiteNumber(item.features?.attackStrength),
      defense_strength: finiteNumber(item.features?.defenseStrength),
      recent_form_points: finiteNumber(item.features?.recentFormPoints),
      recent_goals_for: finiteNumber(item.features?.recentGoalsFor),
      recent_goals_against: finiteNumber(item.features?.recentGoalsAgainst),
      rest_days: finiteNumber(item.features?.restDays),
      injuries_count: Math.max(0, integerOrNull(item.features?.injuriesCount) ?? derivedInjuries),
      suspensions_count: Math.max(0, integerOrNull(item.features?.suspensionsCount) ?? derivedSuspensions),
      lineup_confirmed: item.features?.lineupConfirmed ?? lineup?.lineupStatus === "confirmed",
      metadata: {
        ...(item.features?.metadata ?? {}),
        xgFor: finiteNumber(item.features?.xgFor),
        xgAgainst: finiteNumber(item.features?.xgAgainst),
        standing: standing
          ? {
              position: standing.position ?? null,
              played: standing.played ?? null,
              points: standing.points ?? null,
              form: standing.form ?? []
            }
          : null,
        availabilitySnapshotCount: availability.length,
        lineupSnapshot: lineup
          ? {
              status: lineup.lineupStatus ?? null,
              formation: lineup.formation ?? null,
              playerCount: lineup.players?.length ?? 0
            }
          : null
      }
    };
  });
}

function oddsRowsForFixture(provider: string, fixture: NormalizedFixture) {
  return fixture.odds.map((quote) => ({
    fixture_external_id: fixture.externalId,
    sport: fixture.sport,
    provider,
    bookmaker: cleanText(quote.bookmaker) || provider,
    market: quote.market,
    selection: quote.selection,
    decimal_odds: quote.decimalOdds,
    implied_probability: Number((1 / quote.decimalOdds).toFixed(6)),
    margin_adjusted_probability: null as number | null,
    is_closing: Boolean(quote.isClosing),
    observed_at: quote.observedAt ? new Date(quote.observedAt).toISOString() : fixture.kickoffAt,
    metadata: quote.metadata ?? {}
  }));
}

function eventRowsForFixture(provider: string, fixture: NormalizedFixture) {
  return fixture.events.map((event, index) => {
    const eventExternalId =
      cleanText(event.eventExternalId) ||
      `generated:${stableHash({
        fixture: fixture.externalId,
        index,
        minute: event.minute ?? null,
        stoppageMinute: event.stoppageMinute ?? null,
        teamExternalId: event.teamExternalId ?? null,
        playerExternalId: event.playerExternalId ?? null,
        eventType: event.eventType,
        metadata: event.metadata ?? {}
      })}`;

    return {
      fixture_external_id: fixture.externalId,
      sport: fixture.sport,
      provider,
      event_external_id: eventExternalId,
      minute: integerOrNull(event.minute),
      stoppage_minute: integerOrNull(event.stoppageMinute),
      team_external_id: cleanText(event.teamExternalId) || null,
      player_external_id: cleanText(event.playerExternalId) || null,
      event_type: cleanText(event.eventType) || "unknown",
      event_value: finiteNumber(event.eventValue),
      metadata: event.metadata ?? {},
      observed_at: event.observedAt ? new Date(event.observedAt).toISOString() : fixture.kickoffAt
    };
  });
}

function newsRowsForFixture(provider: string, fixture: NormalizedFixture) {
  return fixture.news.map((item) => ({
    fixture_external_id: fixture.externalId,
    sport: fixture.sport,
    provider,
    source_name: cleanText(item.sourceName) || provider,
    source_url: cleanText(item.sourceUrl) || null,
    published_at: item.publishedAt ? new Date(item.publishedAt).toISOString() : null,
    signal_type: isNewsSignalType(item.signalType) ? item.signalType : "other",
    sentiment: finiteNumber(item.sentiment),
    confidence: finiteNumber(item.confidence),
    impact_score: finiteNumber(item.impactScore) ?? 0,
    summary: cleanText(item.summary),
    entities: item.entities ?? [],
    raw: {
      ...(item.raw ?? {}),
      metadata: item.metadata ?? {}
    }
  }));
}

function standingsRowsForFixture(provider: string, fixture: NormalizedFixture) {
  return fixture.standings.map((item) => ({
    sport: fixture.sport,
    provider,
    league_external_id: fixture.league.externalId,
    season: fixture.season ?? null,
    team_external_id: cleanText(item.teamExternalId),
    snapshot_at: item.snapshotAt ? new Date(item.snapshotAt).toISOString() : fixture.kickoffAt,
    position: integerOrNull(item.position),
    played: Math.max(0, integerOrNull(item.played) ?? 0),
    points: integerOrNull(item.points) ?? 0,
    wins: Math.max(0, integerOrNull(item.wins) ?? 0),
    draws: Math.max(0, integerOrNull(item.draws) ?? 0),
    losses: Math.max(0, integerOrNull(item.losses) ?? 0),
    goals_for: integerOrNull(item.goalsFor) ?? 0,
    goals_against: integerOrNull(item.goalsAgainst) ?? 0,
    form: Array.isArray(item.form) ? item.form : [],
    metadata: item.metadata ?? {}
  }));
}

function availabilityRowsForFixture(provider: string, fixture: NormalizedFixture) {
  return fixture.availability.map((item) => ({
    fixture_external_id: fixture.externalId,
    sport: fixture.sport,
    provider,
    team_external_id: cleanText(item.teamExternalId),
    player_external_id: cleanText(item.playerExternalId) || null,
    player_name: cleanText(item.playerName),
    status: isAvailabilityStatus(item.status) ? item.status : "unknown",
    impact_score: finiteNumber(item.impactScore) ?? 0,
    reason: cleanText(item.reason) || null,
    observed_at: item.observedAt ? new Date(item.observedAt).toISOString() : fixture.kickoffAt,
    metadata: item.metadata ?? {}
  }));
}

function lineupRowsForFixture(provider: string, fixture: NormalizedFixture) {
  return fixture.lineups.map((item) => ({
    fixture_external_id: fixture.externalId,
    sport: fixture.sport,
    provider,
    team_external_id: cleanText(item.teamExternalId),
    lineup_status: isLineupStatus(item.lineupStatus) ? item.lineupStatus : "unavailable",
    formation: cleanText(item.formation) || null,
    players: Array.isArray(item.players) ? item.players : [],
    observed_at: item.observedAt ? new Date(item.observedAt).toISOString() : fixture.kickoffAt,
    metadata: item.metadata ?? {}
  }));
}

function weatherRowsForFixture(provider: string, fixture: NormalizedFixture) {
  return fixture.weather.map((item) => ({
    fixture_external_id: fixture.externalId,
    sport: fixture.sport,
    provider,
    observed_for: item.observedFor ? new Date(item.observedFor).toISOString() : fixture.kickoffAt,
    temperature_c: finiteNumber(item.temperatureC),
    precipitation_mm: finiteNumber(item.precipitationMm),
    wind_kph: finiteNumber(item.windKph),
    humidity: finiteNumber(item.humidity),
    condition: cleanText(item.condition) || null,
    impact_score: finiteNumber(item.impactScore) ?? 0,
    metadata: item.metadata ?? {}
  }));
}

function trainingFeatureSnapshot(provider: string, fixture: NormalizedFixture) {
  const homeScore = fixture.homeScore ?? null;
  const awayScore = fixture.awayScore ?? null;
  const homeAvailability = availabilityForTeam(fixture, fixture.homeTeam.externalId);
  const awayAvailability = availabilityForTeam(fixture, fixture.awayTeam.externalId);
  const homeStanding = standingsForTeam(fixture, fixture.homeTeam.externalId);
  const awayStanding = standingsForTeam(fixture, fixture.awayTeam.externalId);
  const homeLineup = lineupForTeam(fixture, fixture.homeTeam.externalId);
  const awayLineup = lineupForTeam(fixture, fixture.awayTeam.externalId);

  return {
    sport: fixture.sport,
    fixture_external_id: fixture.externalId,
    model_key: modelKeyForSport(fixture.sport),
    generated_at: new Date().toISOString(),
    label: fixture.status === "finished" && homeScore !== null && awayScore !== null
      ? homeScore > awayScore
        ? "home"
        : homeScore < awayScore
          ? "away"
          : "draw"
      : null,
    features: {
      league: fixture.league,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      homeFeatures: fixture.homeFeatures ?? null,
      awayFeatures: fixture.awayFeatures ?? null,
      contextSnapshots: {
        standings: {
          home: homeStanding ?? null,
          away: awayStanding ?? null
        },
        availability: {
          home: {
            total: homeAvailability.length,
            injuries: countAvailability(homeAvailability, ["injured", "doubtful"]),
            suspensions: countAvailability(homeAvailability, ["suspended"])
          },
          away: {
            total: awayAvailability.length,
            injuries: countAvailability(awayAvailability, ["injured", "doubtful"]),
            suspensions: countAvailability(awayAvailability, ["suspended"])
          }
        },
        lineups: {
          home: homeLineup
            ? { status: homeLineup.lineupStatus ?? null, formation: homeLineup.formation ?? null, playerCount: homeLineup.players?.length ?? 0 }
            : null,
          away: awayLineup
            ? { status: awayLineup.lineupStatus ?? null, formation: awayLineup.formation ?? null, playerCount: awayLineup.players?.length ?? 0 }
            : null
        },
        weather: fixture.weather
      },
      neutralVenue: Boolean(fixture.neutralVenue),
      dataQuality: fixture.dataQuality
    },
    targets: {
      homeScore,
      awayScore,
      homeXg: fixture.homeXg ?? null,
      awayXg: fixture.awayXg ?? null,
      events: {
        total: fixture.events.length,
        goals: fixture.events.filter((event) => event.eventType.toLowerCase().includes("goal")).length,
        redCards: fixture.events.filter((event) => `${event.eventType} ${event.metadata?.detail ?? ""}`.toLowerCase().includes("red")).length
      },
      news: {
        total: fixture.news.length,
        adverse: fixture.news.filter((item) => (item.impactScore ?? 0) < 0).length,
        positive: fixture.news.filter((item) => (item.impactScore ?? 0) > 0).length
      },
      weather: {
        total: fixture.weather.length,
        adverse: fixture.weather.filter((item) => (item.impactScore ?? 0) < 0).length
      }
    },
    split: "train",
    source: provider,
    feature_hash: stableHash({
      fixture: fixture.externalId,
      homeFeatures: fixture.homeFeatures ?? null,
      awayFeatures: fixture.awayFeatures ?? null,
      oddsCount: fixture.odds.length,
      contextCounts: {
        standings: fixture.standings.length,
        availability: fixture.availability.length,
        lineups: fixture.lineups.length,
        weather: fixture.weather.length
      }
    })
  };
}

function marginAdjustedOddsRows(rows: ReturnType<typeof oddsRowsForFixture>) {
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.fixture_external_id}:${row.market}:${row.bookmaker}:${row.is_closing}:${row.observed_at}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  for (const groupRows of grouped.values()) {
    const selections = new Set(groupRows.map((row) => row.selection));
    if (!selections.has("home") || !selections.has("away")) continue;
    const margin = groupRows.reduce((sum, row) => sum + Number(row.implied_probability), 0);
    if (margin <= 0) continue;
    for (const row of groupRows) {
      row.margin_adjusted_probability = Number((Number(row.implied_probability) / margin).toFixed(6));
    }
  }

  return rows;
}

type SupabaseWriteClient = NonNullable<ReturnType<typeof getSupabaseServerClient>>;

function chunkItems<T>(items: T[], size = 400): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isMissingOnConflictConstraint(message: string): boolean {
  return message.toLowerCase().includes("no unique or exclusion constraint matching the on conflict specification");
}

async function insertRowsInChunks(client: SupabaseWriteClient, table: string, rows: Array<Record<string, unknown>>, chunkSize = 100) {
  for (const chunk of chunkItems(rows, chunkSize)) {
    const { error } = await client.from(table).insert(chunk);
    if (error) throw new Error(error.message);
  }
}

async function deleteByValuesInChunks(
  client: SupabaseWriteClient,
  table: string,
  column: string,
  values: string[],
  chunkSize = 250,
  applyBaseFilters?: (query: any) => any
) {
  for (const chunk of chunkItems(values, chunkSize)) {
    let query = client.from(table).delete();
    if (applyBaseFilters) {
      query = applyBaseFilters(query) as typeof query;
    }
    const { error } = await query.in(column, chunk);
    if (error) throw new Error(error.message);
  }
}

async function writeDimensionRowsWithSchemaFallback(
  client: SupabaseWriteClient,
  table: "op_leagues" | "op_teams",
  rows: Array<Record<string, unknown> & { external_id: string }>,
  provider: string,
  sport: HistoricalTrainingSport
) {
  const { error } = await client.from(table).upsert(rows, { onConflict: "provider,sport,external_id" });
  if (!error) return;
  if (!isMissingOnConflictConstraint(error.message)) throw new Error(error.message);

  const externalIds = rows.map((row) => row.external_id);
  const { data: existingRows, error: selectError } = await client
    .from(table)
    .select("external_id")
    .eq("provider", provider)
    .eq("sport", sport)
    .in("external_id", externalIds);
  if (selectError) throw new Error(selectError.message);

  const existingExternalIds = new Set((existingRows ?? []).map((row) => String(row.external_id)));
  const missingRows = rows.filter((row) => !existingExternalIds.has(row.external_id));
  if (!missingRows.length) return;

  const { error: insertError } = await client.from(table).insert(missingRows);
  if (insertError) throw new Error(insertError.message);
}

async function writeFixtureRowsWithSchemaFallback(
  client: SupabaseWriteClient,
  rows: Array<Record<string, unknown> & { external_id: string }>,
  provider: string,
  sport: HistoricalTrainingSport
): Promise<Array<{ id: string; external_id: string }>> {
  const { data, error } = await client
    .from("op_fixtures")
    .upsert(rows, { onConflict: "provider,sport,external_id" })
    .select("id, external_id");
  if (!error) return (data ?? []).map((row) => ({ id: String(row.id), external_id: String(row.external_id) }));
  if (!isMissingOnConflictConstraint(error.message)) throw new Error(error.message);

  const externalIds = rows.map((row) => row.external_id);
  const { data: existingRows, error: selectError } = await client
    .from("op_fixtures")
    .select("id, external_id")
    .eq("provider", provider)
    .eq("sport", sport)
    .in("external_id", externalIds);
  if (selectError) throw new Error(selectError.message);

  const existing = (existingRows ?? []).map((row) => ({ id: String(row.id), external_id: String(row.external_id) }));
  const existingExternalIds = new Set(existing.map((row) => row.external_id));
  const missingRows = rows.filter((row) => !existingExternalIds.has(row.external_id));
  if (!missingRows.length) return existing;

  const { data: insertedRows, error: insertError } = await client
    .from("op_fixtures")
    .insert(missingRows)
    .select("id, external_id");
  if (insertError) throw new Error(insertError.message);

  return [
    ...existing,
    ...((insertedRows ?? []).map((row) => ({ id: String(row.id), external_id: String(row.external_id) })))
  ];
}

async function createIngestionRun(provider: string, sourceKind: IngestSourceKind, rowsReceived: number, sport: HistoricalTrainingSport) {
  const client = getSupabaseServerClient();
  if (!client) return { error: "Supabase client could not be created." };
  const { data, error } = await client
    .from("op_provider_ingestion_runs")
    .insert({
      provider,
      sport,
      ingestion_type: sourceKind === "demo" ? "demo_historical_seed" : "historical_fixtures",
      status: "running",
      started_at: new Date().toISOString(),
      rows_received: rowsReceived,
      metadata: { sourceKind }
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: String(data.id) };
}

function rawProviderPayloadFor(fixtures: NormalizedFixture[], sourceKind: IngestSourceKind) {
  if (fixtures.length <= 500) {
    return {
      sourceKind,
      fixtures
    };
  }

  return {
    sourceKind,
    fixtureCount: fixtures.length,
    fixtureHash: stableHash(fixtures),
    sample: {
      first: fixtures.slice(0, 10),
      last: fixtures.slice(-10)
    },
    note: "Large historical batch compacted to avoid oversized Supabase REST payloads; normalized fixture rows, odds rows, and feature snapshots are stored in dedicated op_ tables."
  };
}

async function finishIngestionRun(id: string, status: "completed" | "failed", rowsWritten: number, errorMessage?: string) {
  const client = getSupabaseServerClient();
  if (!client) return;
  await client
    .from("op_provider_ingestion_runs")
    .update({
      status,
      completed_at: new Date().toISOString(),
      rows_written: rowsWritten,
      error_message: errorMessage ?? null
    })
    .eq("id", id);
}

export async function ingestHistoricalFootballFixtures(payload: HistoricalFootballIngestPayload): Promise<HistoricalFootballIngestResult> {
  const parsed = parseHistoricalFootballIngestPayload(payload);
  const provider = cleanProvider(payload.provider, payload.sourceKind === "demo" ? "demo_seed" : "manual_import");
  const sport = isHistoricalTrainingSport(payload.sport) ? payload.sport : "football";
  const sourceKind: IngestSourceKind = payload.sourceKind === "demo" ? "demo" : "real";

  if ("errors" in parsed) {
    return {
      status: "failed",
      sport,
      configured: true,
      dryRun: Boolean(payload.dryRun),
      provider: sourceKind === "demo" ? "demo_seed" : provider,
      sourceKind,
      rowsReceived: Array.isArray(payload.fixtures) ? payload.fixtures.length : 0,
      rowsWritten: 0,
      counts: {
        leagues: 0,
        teams: 0,
        fixtures: 0,
        featureRows: 0,
        oddsRows: 0,
        eventRows: 0,
        newsRows: 0,
        standingsRows: 0,
        availabilityRows: 0,
        lineupRows: 0,
        weatherRows: 0,
        featureSnapshots: 0
      },
      errors: parsed.errors
    };
  }

  const fixtures = parsed.fixtures as NormalizedFixture[];
  const safeProvider = parsed.provider ?? provider;
  const leagues = uniqueBy(fixtures.map((fixture) => fixture.league), (league) => league.externalId);
  const teams = uniqueBy(
    fixtures.flatMap((fixture) => [fixture.homeTeam, fixture.awayTeam]),
    (team) => team.externalId
  );
  const featureRowCount = fixtures.length * 2;
  const oddsRowCount = fixtures.reduce((sum, fixture) => sum + fixture.odds.length, 0);
  const eventRowCount = fixtures.reduce((sum, fixture) => sum + fixture.events.length, 0);
  const newsRowCount = fixtures.reduce((sum, fixture) => sum + fixture.news.length, 0);
  const standingsRowCount = fixtures.reduce((sum, fixture) => sum + fixture.standings.length, 0);
  const availabilityRowCount = fixtures.reduce((sum, fixture) => sum + fixture.availability.length, 0);
  const lineupRowCount = fixtures.reduce((sum, fixture) => sum + fixture.lineups.length, 0);
  const weatherRowCount = fixtures.reduce((sum, fixture) => sum + fixture.weather.length, 0);
  const counts = {
    leagues: leagues.length,
    teams: teams.length,
    fixtures: fixtures.length,
    featureRows: featureRowCount,
    oddsRows: oddsRowCount,
    eventRows: eventRowCount,
    newsRows: newsRowCount,
    standingsRows: standingsRowCount,
    availabilityRows: availabilityRowCount,
    lineupRows: lineupRowCount,
    weatherRows: weatherRowCount,
    featureSnapshots: fixtures.length
  };

  if (parsed.dryRun) {
    return {
      status: "dry-run",
      sport: parsed.sport ?? sport,
      configured: true,
      dryRun: true,
      provider: safeProvider,
      sourceKind: parsed.sourceKind ?? "real",
      rowsReceived: fixtures.length,
      rowsWritten: 0,
      counts,
      errors: []
    };
  }

  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return {
      status: "not-configured",
      sport: parsed.sport ?? sport,
      configured: false,
      dryRun: false,
      provider: safeProvider,
      sourceKind: parsed.sourceKind ?? "real",
      rowsReceived: fixtures.length,
      rowsWritten: 0,
      counts,
      errors: [`Supabase server writes are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`]
    };
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return {
      status: "failed",
      sport: parsed.sport ?? sport,
      configured: true,
      dryRun: false,
      provider: safeProvider,
      sourceKind: parsed.sourceKind ?? "real",
      rowsReceived: fixtures.length,
      rowsWritten: 0,
      counts,
      errors: ["Supabase client could not be created."]
    };
  }

  const ingestionRun = await createIngestionRun(safeProvider, parsed.sourceKind ?? "real", fixtures.length, parsed.sport ?? sport);
  if ("error" in ingestionRun) {
    return {
      status: "failed",
      sport: parsed.sport ?? sport,
      configured: true,
      dryRun: false,
      provider: safeProvider,
      sourceKind: parsed.sourceKind ?? "real",
      rowsReceived: fixtures.length,
      rowsWritten: 0,
      counts,
      errors: [String(ingestionRun.error)]
    };
  }

  try {
    const leagueRows = leagues.map((league) => ({
      sport: parsed.sport ?? sport,
      provider: safeProvider,
      external_id: league.externalId,
      name: league.name,
      country: league.country ?? null,
      strength: finiteNumber(league.strength),
      metadata: league.metadata ?? {}
    }));
    if (leagueRows.length) {
      await writeDimensionRowsWithSchemaFallback(client, "op_leagues", leagueRows, safeProvider, parsed.sport ?? sport);
    }

    const teamRows = teams.map((team) => ({
      sport: parsed.sport ?? sport,
      provider: safeProvider,
      external_id: team.externalId,
      name: team.name,
      country: team.country ?? null,
      metadata: team.metadata ?? {}
    }));
    if (teamRows.length) {
      await writeDimensionRowsWithSchemaFallback(client, "op_teams", teamRows, safeProvider, parsed.sport ?? sport);
    }

    const fixtureRows = fixtures.map((fixture) => ({
      sport: fixture.sport,
      provider: safeProvider,
      external_id: fixture.externalId,
      league_external_id: fixture.league.externalId,
      season: fixture.season ?? null,
      round: fixture.round ?? null,
      kickoff_at: fixture.kickoffAt,
      status: fixture.status,
      home_team_external_id: fixture.homeTeam.externalId,
      away_team_external_id: fixture.awayTeam.externalId,
      home_score: fixture.homeScore ?? null,
      away_score: fixture.awayScore ?? null,
      home_xg: fixture.homeXg ?? null,
      away_xg: fixture.awayXg ?? null,
      neutral_venue: Boolean(fixture.neutralVenue),
      venue: fixture.venue ?? null,
      country: fixture.country ?? fixture.league.country ?? null,
      data_quality: fixture.dataQuality,
      metadata: {
        ...(fixture.metadata ?? {}),
        sourceKind: parsed.sourceKind
      }
    }));
    const writtenFixtures = await writeFixtureRowsWithSchemaFallback(client, fixtureRows, safeProvider, parsed.sport ?? sport);

    const fixtureIdByExternalId = new Map((writtenFixtures ?? []).map((row) => [String(row.external_id), String(row.id)]));
    const fixtureExternalIds = fixtures.map((fixture) => fixture.externalId);
    const fixtureIds = [...fixtureIdByExternalId.values()];
    if (fixtureExternalIds.length) {
      if (fixtureIds.length) {
        await deleteByValuesInChunks(client, "op_fixture_team_features", "fixture_id", fixtureIds);
      }
      await deleteByValuesInChunks(client, "op_odds_snapshots", "fixture_external_id", fixtureExternalIds, 250, (query) => query.eq("provider", safeProvider));
      await deleteByValuesInChunks(
        client,
        "op_live_match_events",
        "fixture_external_id",
        fixtureExternalIds,
        250,
        (query) => query.eq("sport", parsed.sport ?? sport).eq("provider", safeProvider)
      );
      await deleteByValuesInChunks(
        client,
        "op_news_signals",
        "fixture_external_id",
        fixtureExternalIds,
        250,
        (query) => query.eq("sport", parsed.sport ?? sport).eq("provider", safeProvider)
      );
      await deleteByValuesInChunks(
        client,
        "op_player_availability_snapshots",
        "fixture_external_id",
        fixtureExternalIds,
        250,
        (query) => query.eq("sport", parsed.sport ?? sport).eq("provider", safeProvider)
      );
      await deleteByValuesInChunks(
        client,
        "op_lineup_snapshots",
        "fixture_external_id",
        fixtureExternalIds,
        250,
        (query) => query.eq("sport", parsed.sport ?? sport).eq("provider", safeProvider)
      );
      await deleteByValuesInChunks(
        client,
        "op_weather_snapshots",
        "fixture_external_id",
        fixtureExternalIds,
        250,
        (query) => query.eq("sport", parsed.sport ?? sport).eq("provider", safeProvider)
      );
      await deleteByValuesInChunks(
        client,
        "op_training_feature_snapshots",
        "fixture_external_id",
        fixtureExternalIds,
        250,
        (query) => query.eq("sport", parsed.sport ?? sport).eq("model_key", modelKeyForSport(parsed.sport ?? sport)).eq("source", safeProvider)
      );
    }

    const featureRows = fixtures.flatMap((fixture) => {
      const fixtureId = fixtureIdByExternalId.get(fixture.externalId);
      return fixtureId ? featureRowsForFixture(fixtureId, fixture) : [];
    });
    if (featureRows.length) {
      await insertRowsInChunks(client, "op_fixture_team_features", featureRows);
    }

    const standingsRows = fixtures.flatMap((fixture) => standingsRowsForFixture(safeProvider, fixture));
    if (standingsRows.length) {
      const leagueExternalIds = uniqueBy(standingsRows.map((row) => row.league_external_id), (value) => value);
      const snapshotTimes = uniqueBy(standingsRows.map((row) => row.snapshot_at), (value) => value);
      await client
        .from("op_standings_snapshots")
        .delete()
        .eq("sport", parsed.sport ?? sport)
        .eq("provider", safeProvider)
        .in("league_external_id", leagueExternalIds)
        .in("snapshot_at", snapshotTimes);
      const { error } = await client.from("op_standings_snapshots").insert(standingsRows);
      if (error) throw new Error(error.message);
    }

    const oddsRows = marginAdjustedOddsRows(fixtures.flatMap((fixture) => oddsRowsForFixture(safeProvider, fixture)));
    if (oddsRows.length) {
      await insertRowsInChunks(client, "op_odds_snapshots", oddsRows);
    }

    const eventRows = fixtures.flatMap((fixture) => eventRowsForFixture(safeProvider, fixture));
    if (eventRows.length) {
      await insertRowsInChunks(client, "op_live_match_events", eventRows);
    }

    const newsRows = fixtures.flatMap((fixture) => newsRowsForFixture(safeProvider, fixture));
    if (newsRows.length) {
      await insertRowsInChunks(client, "op_news_signals", newsRows);
    }

    const availabilityRows = fixtures.flatMap((fixture) => availabilityRowsForFixture(safeProvider, fixture));
    if (availabilityRows.length) {
      await insertRowsInChunks(client, "op_player_availability_snapshots", availabilityRows);
    }

    const lineupRows = fixtures.flatMap((fixture) => lineupRowsForFixture(safeProvider, fixture));
    if (lineupRows.length) {
      await insertRowsInChunks(client, "op_lineup_snapshots", lineupRows);
    }

    const weatherRows = fixtures.flatMap((fixture) => weatherRowsForFixture(safeProvider, fixture));
    if (weatherRows.length) {
      await insertRowsInChunks(client, "op_weather_snapshots", weatherRows);
    }

    const featureSnapshots = fixtures.map((fixture) => trainingFeatureSnapshot(safeProvider, fixture));
    if (featureSnapshots.length) {
      await insertRowsInChunks(client, "op_training_feature_snapshots", featureSnapshots);
    }

    const { error: rawError } = await client.from("op_raw_provider_payloads").insert({
      ingestion_run_id: ingestionRun.id,
      provider: safeProvider,
      sport: parsed.sport ?? sport,
      payload_type: parsed.sourceKind === "demo" ? "demo_historical_fixture_batch" : "historical_fixture_batch",
      external_id: `${safeProvider}:${fixtures.length}:${stableHash(fixtures).slice(-8)}`,
      payload: rawProviderPayloadFor(fixtures, parsed.sourceKind ?? "real"),
      payload_hash: stableHash(fixtures)
    });
    if (rawError) throw new Error(rawError.message);

    const rowsWritten =
      counts.leagues +
      counts.teams +
      counts.fixtures +
      counts.featureRows +
      counts.oddsRows +
      counts.eventRows +
      counts.newsRows +
      counts.standingsRows +
      counts.availabilityRows +
      counts.lineupRows +
      counts.weatherRows +
      counts.featureSnapshots;
    await finishIngestionRun(ingestionRun.id, "completed", rowsWritten);

    return {
      status: "stored",
      sport: parsed.sport ?? sport,
      configured: true,
      dryRun: false,
      provider: safeProvider,
      sourceKind: parsed.sourceKind ?? "real",
      ingestionRunId: ingestionRun.id,
      rowsReceived: fixtures.length,
      rowsWritten,
      counts,
      errors: []
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Historical ingestion failed.";
    await finishIngestionRun(ingestionRun.id, "failed", 0, message);
    return {
      status: "failed",
      sport: parsed.sport ?? sport,
      configured: true,
      dryRun: false,
      provider: safeProvider,
      sourceKind: parsed.sourceKind ?? "real",
      ingestionRunId: ingestionRun.id,
      rowsReceived: fixtures.length,
      rowsWritten: 0,
      counts,
      errors: [message]
    };
  }
}

function seedFromText(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function scoreFromMatch(match: Match, dayIndex: number) {
  const seed = seedFromText(`${match.id}:${dayIndex}`);
  const ratingEdge = Math.round((match.homeTeam.rating - match.awayTeam.rating) / 8);
  const home = Math.max(0, Math.min(5, 1 + ((seed + ratingEdge) % 3)));
  const away = Math.max(0, Math.min(4, 1 + ((seed + 2 - ratingEdge) % 3)));
  return { home, away };
}

function marketWinnerOdds(markets: OddsMarket[]) {
  return markets.find((market) => market.id === "match_winner")?.selections ?? [];
}

export async function buildDemoHistoricalFootballFixtures({
  days = 3,
  startDate = "2025-08-01"
}: {
  days?: number;
  startDate?: string;
} = {}): Promise<HistoricalFootballFixtureInput[]> {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const fixtures: HistoricalFootballFixtureInput[] = [];

  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + dayIndex);
    const isoDate = date.toISOString().slice(0, 10);
    const matches = await mockSportsDataProvider.getFixtures(isoDate, "football");

    for (const match of matches) {
      const score = scoreFromMatch(match, dayIndex);
      const openingObservedAt = new Date(match.kickoffTime);
      openingObservedAt.setUTCHours(openingObservedAt.getUTCHours() - 8);
      const closingObservedAt = new Date(match.kickoffTime);
      closingObservedAt.setUTCMinutes(closingObservedAt.getUTCMinutes() - 10);
      const selections = marketWinnerOdds(match.oddsMarkets);
      const odds = selections.flatMap((selection) => {
        if (!isWinnerSelection(selection.id)) return [];
        const closingMultiplier = selection.id === (score.home > score.away ? "home" : score.home < score.away ? "away" : "draw") ? 0.94 : 1.04;
        return [
          {
            bookmaker: "demo-book",
            market: "match_winner" as const,
            selection: selection.id,
            decimalOdds: selection.decimalOdds,
            observedAt: openingObservedAt.toISOString()
          },
          {
            bookmaker: "demo-book",
            market: "match_winner" as const,
            selection: selection.id,
            decimalOdds: Number(Math.max(1.02, selection.decimalOdds * closingMultiplier).toFixed(2)),
            observedAt: closingObservedAt.toISOString(),
            isClosing: true
          }
        ];
      });

      fixtures.push({
        externalId: `demo-${isoDate}-${match.id}`,
        kickoffAt: match.kickoffTime,
        league: {
          externalId: match.league.id,
          name: match.league.name,
          country: match.league.country,
          strength: match.league.strength
        },
        season: "demo-2025",
        round: `demo-day-${dayIndex + 1}`,
        status: "finished",
        homeTeam: {
          externalId: match.homeTeam.id,
          name: match.homeTeam.name,
          country: match.league.country
        },
        awayTeam: {
          externalId: match.awayTeam.id,
          name: match.awayTeam.name,
          country: match.league.country
        },
        homeScore: score.home,
        awayScore: score.away,
        dataQuality: Math.min(0.9, Math.max(0.62, match.dataQualityScore)),
        homeFeatures: {
          eloRating: 1500 + (match.homeTeam.rating - 75) * 18,
          attackStrength: match.homeForm.attackStrength,
          defenseStrength: match.homeForm.defenseStrength,
          recentFormPoints: match.homeForm.recentResults.reduce((sum, result) => sum + (result === "W" ? 3 : result === "D" ? 1 : 0), 0),
          recentGoalsFor: match.homeForm.goalsFor,
          recentGoalsAgainst: match.homeForm.goalsAgainst,
          restDays: 5 + (seedFromText(match.homeTeam.id) % 4),
          injuriesCount: seedFromText(match.homeTeam.id) % 3,
          suspensionsCount: seedFromText(match.homeTeam.name) % 2,
          metadata: { source: "mockProvider" }
        },
        awayFeatures: {
          eloRating: 1500 + (match.awayTeam.rating - 75) * 18,
          attackStrength: match.awayForm.attackStrength,
          defenseStrength: match.awayForm.defenseStrength,
          recentFormPoints: match.awayForm.recentResults.reduce((sum, result) => sum + (result === "W" ? 3 : result === "D" ? 1 : 0), 0),
          recentGoalsFor: match.awayForm.goalsFor,
          recentGoalsAgainst: match.awayForm.goalsAgainst,
          restDays: 5 + (seedFromText(match.awayTeam.id) % 4),
          injuriesCount: seedFromText(match.awayTeam.id) % 3,
          suspensionsCount: seedFromText(match.awayTeam.name) % 2,
          metadata: { source: "mockProvider" }
        },
        odds,
        metadata: {
          source: "demo_seed",
          warning: "Synthetic demo data for pipeline testing only. Do not use as real model training evidence."
        }
      });
    }
  }

  return fixtures;
}
