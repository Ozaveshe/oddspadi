import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";

type EnvMap = Record<string, string | undefined>;

export const HISTORICAL_ELO_INITIAL_RATING = 1500;
export const HISTORICAL_ELO_CACHE_TTL_MS = 15 * 60 * 1000;

const HISTORICAL_ELO_PAGE_SIZE = 1000;
const FOOTBALL_DATA_PROVIDER = "football_data_csv";
const MIN_MODEL_RATING = 60;
const MAX_MODEL_RATING = 100;
const MAX_VALID_FOOTBALL_SCORE = 30;

export type HistoricalFootballEloRow = {
  external_id?: unknown;
  provider?: unknown;
  sport?: unknown;
  status?: unknown;
  kickoff_at?: unknown;
  season?: unknown;
  home_team_external_id?: unknown;
  away_team_external_id?: unknown;
  home_score?: unknown;
  away_score?: unknown;
  neutral_venue?: unknown;
  data_quality?: unknown;
  metadata?: unknown;
};

export type HistoricalFootballEloConfig = {
  seasonRetention?: number;
  homeAdvantageElo?: number;
  baseK?: number;
  minK?: number;
  maxK?: number;
  minimumDataQuality?: number;
  defaultDataQuality?: number;
  maximumGoalMarginScale?: number;
};

export type HistoricalFootballEloRating = Readonly<{
  teamKey: string;
  rawElo: number;
  modelRating: number;
  matchCount: number;
  asOf: string;
}>;

export type HistoricalFootballEloMap = ReadonlyMap<string, HistoricalFootballEloRating>;

type ResolvedConfig = Required<HistoricalFootballEloConfig>;

type NormalizedFixture = {
  externalId: string;
  kickoffAt: string;
  kickoffTimestamp: number;
  seasonKey: string;
  homeKey: string;
  awayKey: string;
  homeScore: number;
  awayScore: number;
  neutralVenue: boolean;
  dataQuality: number;
};

type MutableTeamRating = {
  rawElo: number;
  matchCount: number;
  lastMatchAt: string;
};

const DEFAULT_CONFIG: ResolvedConfig = {
  seasonRetention: 0.75,
  homeAdvantageElo: 65,
  baseK: 28,
  minK: 12,
  maxK: 40,
  minimumDataQuality: 0.5,
  defaultDataQuality: 0.72,
  maximumGoalMarginScale: 1.8
};

const TEAM_ALIAS_TO_CANONICAL: Readonly<Record<string, string>> = {
  mancity: "manchester-city",
  manchestercity: "manchester-city",
  manutd: "manchester-united",
  manunited: "manchester-united",
  manchesterutd: "manchester-united",
  manchesterunited: "manchester-united",
  newcastle: "newcastle-united",
  newcastleunited: "newcastle-united",
  nottmforest: "nottingham-forest",
  nottsforest: "nottingham-forest",
  nottingham: "nottingham-forest",
  nottinghamforest: "nottingham-forest",
  spurs: "tottenham-hotspur",
  tottenham: "tottenham-hotspur",
  tottenhamhotspur: "tottenham-hotspur",
  westham: "west-ham-united",
  westhamunited: "west-ham-united",
  wolves: "wolverhampton-wanderers",
  wolverhampton: "wolverhampton-wanderers",
  wolverhamptonwanderers: "wolverhampton-wanderers",
  brighton: "brighton-and-hove-albion",
  brightonandhovealbion: "brighton-and-hove-albion",
  brightonhovealbion: "brighton-and-hove-albion"
};

const cachedRatingsByTarget = new Map<string, { expiresAt: number; ratings: HistoricalFootballEloMap }>();
const pendingLoadsByTarget = new Map<string, Promise<HistoricalFootballEloMap>>();

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function withoutProviderPrefix(value: string): string {
  const parts = value.split(":").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : value;
}

export function canonicalFootballTeamKey(value: string): string {
  const providerless = withoutProviderPrefix(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bassociation football club\b|\bfootball club\b/g, " ");
  const tokens = providerless
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter((token) => token && token !== "fc" && token !== "afc" && token !== "cf" && token !== "sc");
  const slug = tokens.join("-");
  if (!slug) return "";
  return TEAM_ALIAS_TO_CANONICAL[tokens.join("")] ?? slug;
}

function hasNonRealMarker(value: unknown): boolean {
  const text = cleanText(value);
  return /(^|[^a-z0-9])(demo|mock|sample|synthetic|test)([^a-z0-9]|$)/i.test(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function metadataIsNonReal(value: unknown): boolean {
  if (!isRecord(value)) return false;

  const sourceKind = cleanText(value.sourceKind ?? value.source_kind).toLowerCase();
  if (sourceKind && sourceKind !== "real") return true;
  if (value.demo === true || value.isDemo === true || value.is_demo === true || value.synthetic === true) return true;

  return [value.source, value.kind, value.dataset, value.warning].some(hasNonRealMarker);
}

function validFootballScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return null;
  return value >= 0 && value <= MAX_VALID_FOOTBALL_SCORE ? value : null;
}

function normalizedSeasonKey(value: unknown, kickoffTimestamp: number): string {
  const season = cleanText(value);
  const seasonYear = season.match(/(?:19|20)\d{2}/)?.[0];
  if (seasonYear) return seasonYear;

  const kickoff = new Date(kickoffTimestamp);
  const startYear = kickoff.getUTCMonth() >= 6 ? kickoff.getUTCFullYear() : kickoff.getUTCFullYear() - 1;
  return String(startYear);
}

function resolveConfig(config: HistoricalFootballEloConfig): ResolvedConfig {
  const minK = clamp(finiteNumber(config.minK) ?? DEFAULT_CONFIG.minK, 1, 100);
  const maxK = clamp(finiteNumber(config.maxK) ?? DEFAULT_CONFIG.maxK, minK, 100);

  return {
    seasonRetention: clamp(finiteNumber(config.seasonRetention) ?? DEFAULT_CONFIG.seasonRetention, 0, 1),
    homeAdvantageElo: clamp(finiteNumber(config.homeAdvantageElo) ?? DEFAULT_CONFIG.homeAdvantageElo, 0, 150),
    baseK: clamp(finiteNumber(config.baseK) ?? DEFAULT_CONFIG.baseK, minK, maxK),
    minK,
    maxK,
    minimumDataQuality: clamp(finiteNumber(config.minimumDataQuality) ?? DEFAULT_CONFIG.minimumDataQuality, 0.1, 1),
    defaultDataQuality: clamp(finiteNumber(config.defaultDataQuality) ?? DEFAULT_CONFIG.defaultDataQuality, 0.1, 1),
    maximumGoalMarginScale: clamp(
      finiteNumber(config.maximumGoalMarginScale) ?? DEFAULT_CONFIG.maximumGoalMarginScale,
      1,
      3
    )
  };
}

function normalizeFixture(row: HistoricalFootballEloRow, config: ResolvedConfig): NormalizedFixture | null {
  if (cleanText(row.provider).toLowerCase() !== FOOTBALL_DATA_PROVIDER) return null;
  if (cleanText(row.sport).toLowerCase() !== "football") return null;
  if (cleanText(row.status).toLowerCase() !== "finished") return null;

  const externalId = cleanText(row.external_id);
  const homeTeamExternalId = cleanText(row.home_team_external_id);
  const awayTeamExternalId = cleanText(row.away_team_external_id);
  if (
    hasNonRealMarker(externalId) ||
    hasNonRealMarker(row.season) ||
    hasNonRealMarker(homeTeamExternalId) ||
    hasNonRealMarker(awayTeamExternalId) ||
    metadataIsNonReal(row.metadata)
  ) {
    return null;
  }

  const kickoffAt = cleanText(row.kickoff_at);
  const kickoffTimestamp = Date.parse(kickoffAt);
  const homeScore = validFootballScore(row.home_score);
  const awayScore = validFootballScore(row.away_score);
  const homeKey = canonicalFootballTeamKey(homeTeamExternalId);
  const awayKey = canonicalFootballTeamKey(awayTeamExternalId);
  if (!Number.isFinite(kickoffTimestamp) || homeScore === null || awayScore === null || !homeKey || !awayKey || homeKey === awayKey) {
    return null;
  }

  const quality = finiteNumber(row.data_quality);
  return {
    externalId,
    kickoffAt: new Date(kickoffTimestamp).toISOString(),
    kickoffTimestamp,
    seasonKey: normalizedSeasonKey(row.season, kickoffTimestamp),
    homeKey,
    awayKey,
    homeScore,
    awayScore,
    neutralVenue: row.neutral_venue === true,
    dataQuality: clamp(quality ?? config.defaultDataQuality, 0, 1)
  };
}

function compareFixtures(left: NormalizedFixture, right: NormalizedFixture): number {
  return (
    left.kickoffTimestamp - right.kickoffTimestamp ||
    compareText(left.externalId, right.externalId) ||
    compareText(left.homeKey, right.homeKey) ||
    compareText(left.awayKey, right.awayKey) ||
    left.homeScore - right.homeScore ||
    left.awayScore - right.awayScore
  );
}

function fixtureDeduplicationKey(fixture: NormalizedFixture): string {
  if (fixture.externalId) return `external:${fixture.externalId.toLowerCase()}`;
  return [fixture.kickoffAt, fixture.homeKey, fixture.awayKey, fixture.homeScore, fixture.awayScore].join(":");
}

function expectedHomeScore(homeElo: number, awayElo: number, homeAdvantageElo: number): number {
  return 1 / (1 + 10 ** ((awayElo - homeElo - homeAdvantageElo) / 400));
}

function actualHomeScore(homeScore: number, awayScore: number): number {
  if (homeScore > awayScore) return 1;
  if (homeScore < awayScore) return 0;
  return 0.5;
}

function effectiveKFactor(fixture: NormalizedFixture, config: ResolvedConfig): number {
  const goalMargin = Math.abs(fixture.homeScore - fixture.awayScore);
  const goalMarginScale = Math.min(config.maximumGoalMarginScale, 1 + Math.log2(Math.max(1, goalMargin)) * 0.35);
  const qualityScale = clamp(fixture.dataQuality, config.minimumDataQuality, 1);
  return clamp(config.baseK * goalMarginScale * qualityScale, config.minK, config.maxK);
}

export function footballModelRatingFromElo(rawElo: number): number {
  return Math.round(clamp(80 + (rawElo - HISTORICAL_ELO_INITIAL_RATING) / 15, MIN_MODEL_RATING, MAX_MODEL_RATING));
}

function getOrCreateRating(ratings: Map<string, MutableTeamRating>, teamKey: string): MutableTeamRating {
  const existing = ratings.get(teamKey);
  if (existing) return existing;
  const created = { rawElo: HISTORICAL_ELO_INITIAL_RATING, matchCount: 0, lastMatchAt: "" };
  ratings.set(teamKey, created);
  return created;
}

function regressRatings(ratings: Map<string, MutableTeamRating>, seasonRetention: number): void {
  for (const rating of ratings.values()) {
    rating.rawElo = HISTORICAL_ELO_INITIAL_RATING + (rating.rawElo - HISTORICAL_ELO_INITIAL_RATING) * seasonRetention;
  }
}

export function buildHistoricalFootballElo(
  rows: readonly HistoricalFootballEloRow[],
  config: HistoricalFootballEloConfig = {}
): HistoricalFootballEloMap {
  const resolvedConfig = resolveConfig(config);
  const fixtures = rows
    .map((row) => normalizeFixture(row, resolvedConfig))
    .filter((row): row is NormalizedFixture => row !== null)
    .sort(compareFixtures);
  const ratings = new Map<string, MutableTeamRating>();
  const seenFixtures = new Set<string>();
  let activeSeason: string | null = null;

  for (const fixture of fixtures) {
    const deduplicationKey = fixtureDeduplicationKey(fixture);
    if (seenFixtures.has(deduplicationKey)) continue;
    seenFixtures.add(deduplicationKey);

    if (activeSeason !== null && fixture.seasonKey !== activeSeason) {
      regressRatings(ratings, resolvedConfig.seasonRetention);
    }
    activeSeason = fixture.seasonKey;

    const home = getOrCreateRating(ratings, fixture.homeKey);
    const away = getOrCreateRating(ratings, fixture.awayKey);
    const expectedHome = expectedHomeScore(
      home.rawElo,
      away.rawElo,
      fixture.neutralVenue ? 0 : resolvedConfig.homeAdvantageElo
    );
    const kFactor = effectiveKFactor(fixture, resolvedConfig);
    const adjustment = kFactor * (actualHomeScore(fixture.homeScore, fixture.awayScore) - expectedHome);

    home.rawElo += adjustment;
    away.rawElo -= adjustment;
    home.matchCount += 1;
    away.matchCount += 1;
    home.lastMatchAt = fixture.kickoffAt;
    away.lastMatchAt = fixture.kickoffAt;
  }

  const output = new Map<string, HistoricalFootballEloRating>();
  for (const teamKey of [...ratings.keys()].sort(compareText)) {
    const rating = ratings.get(teamKey);
    if (!rating || !rating.lastMatchAt) continue;
    const rawElo = round(rating.rawElo);
    output.set(
      teamKey,
      Object.freeze({
        teamKey,
        rawElo,
        modelRating: footballModelRatingFromElo(rawElo),
        matchCount: rating.matchCount,
        asOf: rating.lastMatchAt
      })
    );
  }

  return output;
}

export function getHistoricalFootballElo(
  ratings: HistoricalFootballEloMap,
  teamNameOrExternalId: string
): HistoricalFootballEloRating | undefined {
  const teamKey = canonicalFootballTeamKey(teamNameOrExternalId);
  return teamKey ? ratings.get(teamKey) : undefined;
}

async function readHistoricalFootballRows(client: SupabaseClient): Promise<HistoricalFootballEloRow[]> {
  const rows: HistoricalFootballEloRow[] = [];

  for (let offset = 0; ; offset += HISTORICAL_ELO_PAGE_SIZE) {
    const { data, error } = await client
      .from("op_fixtures")
      .select(
        "external_id, provider, sport, status, kickoff_at, season, home_team_external_id, away_team_external_id, home_score, away_score, neutral_venue, data_quality, metadata"
      )
      .eq("provider", FOOTBALL_DATA_PROVIDER)
      .eq("sport", "football")
      .eq("status", "finished")
      .not("home_score", "is", null)
      .not("away_score", "is", null)
      .order("kickoff_at", { ascending: true })
      .order("external_id", { ascending: true })
      .range(offset, offset + HISTORICAL_ELO_PAGE_SIZE - 1);

    if (error) throw new Error("Historical football Elo corpus is unavailable.");
    const page = (data ?? []) as unknown as HistoricalFootballEloRow[];
    rows.push(...page);
    if (page.length < HISTORICAL_ELO_PAGE_SIZE) break;
  }

  return rows;
}

function cloneRatings(ratings: HistoricalFootballEloMap): HistoricalFootballEloMap {
  return new Map(ratings);
}

export function clearHistoricalFootballEloCache(): void {
  cachedRatingsByTarget.clear();
  pendingLoadsByTarget.clear();
}

function ratingsCacheTarget(env: EnvMap): string {
  const runtime = getSupabaseRuntimeStatus(env);
  return runtime.serverWriteReady && runtime.projectRef ? runtime.projectRef : "unconfigured";
}

export async function loadHistoricalFootballElo(env: EnvMap = process.env): Promise<HistoricalFootballEloMap> {
  const target = ratingsCacheTarget(env);
  const now = Date.now();
  const cached = cachedRatingsByTarget.get(target);
  if (cached && cached.expiresAt > now) return cloneRatings(cached.ratings);
  const pending = pendingLoadsByTarget.get(target);
  if (pending) return cloneRatings(await pending);

  const load = (async () => {
    let ratings: HistoricalFootballEloMap = new Map();
    try {
      const client = getSupabaseServerClient(env);
      if (client) ratings = buildHistoricalFootballElo(await readHistoricalFootballRows(client));
    } catch {
      ratings = new Map();
    }

    cachedRatingsByTarget.set(target, {
      expiresAt: Date.now() + HISTORICAL_ELO_CACHE_TTL_MS,
      ratings
    });
    return ratings;
  })();
  pendingLoadsByTarget.set(target, load);

  try {
    return cloneRatings(await load);
  } finally {
    if (pendingLoadsByTarget.get(target) === load) pendingLoadsByTarget.delete(target);
  }
}
