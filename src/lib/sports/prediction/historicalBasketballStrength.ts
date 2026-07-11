import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";

type EnvMap = Record<string, string | undefined>;

export const HISTORICAL_BASKETBALL_STRENGTH_CACHE_TTL_MS = 15 * 60 * 1000;
export const HISTORICAL_BASKETBALL_INITIAL_RATING = 1500;

const HISTORICAL_BASKETBALL_PAGE_SIZE = 1000;
const MIN_MODEL_RATING = 60;
const MAX_MODEL_RATING = 100;
const MODEL_RATING_MIDPOINT = 80;
const RAW_RATING_POINTS_PER_MODEL_POINT = 15;
const REAL_BASKETBALL_SOURCES = ["basketball_reference", "nba_team_totals_csv"] as const;

export type HistoricalBasketballSource = (typeof REAL_BASKETBALL_SOURCES)[number];

export type HistoricalBasketballFixtureRow = {
  external_id?: unknown;
  provider?: unknown;
  sport?: unknown;
  status?: unknown;
  kickoff_at?: unknown;
  home_team_external_id?: unknown;
  away_team_external_id?: unknown;
  metadata?: unknown;
};

export type HistoricalBasketballFeatureSnapshotRow = {
  id?: unknown;
  sport?: unknown;
  fixture_external_id?: unknown;
  model_key?: unknown;
  generated_at?: unknown;
  features?: unknown;
  split?: unknown;
  source?: unknown;
  feature_hash?: unknown;
  created_at?: unknown;
};

export type HistoricalBasketballStrengthRating = Readonly<{
  teamKey: string;
  teamName: string;
  teamExternalId: string;
  rawRating: number;
  modelRating: number;
  pace: number | null;
  offensiveEfficiency: number | null;
  defensiveEfficiency: number | null;
  restDays: number | null;
  recentFormPoints: number | null;
  sampleSize: number;
  asOf: string;
  source: HistoricalBasketballSource;
  featureSource: string;
  fixtureExternalId: string;
  snapshotId: string;
  snapshotGeneratedAt: string;
}>;

export type HistoricalBasketballStrengthMap = ReadonlyMap<string, HistoricalBasketballStrengthRating>;

type NormalizedFixture = {
  source: HistoricalBasketballSource;
  externalId: string;
  kickoffAt: string;
  kickoffTimestamp: number;
  homeTeamExternalId: string;
  awayTeamExternalId: string;
};

type Candidate = HistoricalBasketballStrengthRating & {
  kickoffTimestamp: number;
  snapshotGeneratedTimestamp: number;
};

type NbaTeamAliases = Readonly<{
  canonical: string;
  aliases: readonly string[];
}>;

const NBA_TEAM_ALIASES: readonly NbaTeamAliases[] = [
  { canonical: "atlanta-hawks", aliases: ["ATL", "Atlanta Hawks", "Hawks", "1610612737"] },
  { canonical: "boston-celtics", aliases: ["BOS", "Boston Celtics", "Celtics", "1610612738"] },
  { canonical: "brooklyn-nets", aliases: ["BKN", "BRK", "Brooklyn Nets", "Nets", "1610612751"] },
  { canonical: "charlotte-hornets", aliases: ["CHA", "CHO", "Charlotte Hornets", "Hornets", "1610612766"] },
  { canonical: "chicago-bulls", aliases: ["CHI", "Chicago Bulls", "Bulls", "1610612741"] },
  { canonical: "cleveland-cavaliers", aliases: ["CLE", "Cleveland Cavaliers", "Cavaliers", "Cavs", "1610612739"] },
  { canonical: "dallas-mavericks", aliases: ["DAL", "Dallas Mavericks", "Mavericks", "Mavs", "1610612742"] },
  { canonical: "denver-nuggets", aliases: ["DEN", "Denver Nuggets", "Nuggets", "1610612743"] },
  { canonical: "detroit-pistons", aliases: ["DET", "Detroit Pistons", "Pistons", "1610612765"] },
  {
    canonical: "golden-state-warriors",
    aliases: ["GS", "GSW", "Golden State", "Golden State Warriors", "Warriors", "Dubs", "1610612744"]
  },
  { canonical: "houston-rockets", aliases: ["HOU", "Houston Rockets", "Rockets", "1610612745"] },
  { canonical: "indiana-pacers", aliases: ["IND", "Indiana Pacers", "Pacers", "1610612754"] },
  {
    canonical: "los-angeles-clippers",
    aliases: ["LAC", "LA Clippers", "L.A. Clippers", "Los Angeles Clippers", "Clippers", "1610612746"]
  },
  {
    canonical: "los-angeles-lakers",
    aliases: ["LAL", "LA Lakers", "L.A. Lakers", "Los Angeles Lakers", "Lakers", "1610612747"]
  },
  { canonical: "memphis-grizzlies", aliases: ["MEM", "Memphis Grizzlies", "Grizzlies", "1610612763"] },
  { canonical: "miami-heat", aliases: ["MIA", "Miami Heat", "Heat", "1610612748"] },
  { canonical: "milwaukee-bucks", aliases: ["MIL", "Milwaukee Bucks", "Bucks", "1610612749"] },
  {
    canonical: "minnesota-timberwolves",
    aliases: ["MIN", "Minnesota Timberwolves", "Timberwolves", "T Wolves", "T-Wolves", "1610612750"]
  },
  {
    canonical: "new-orleans-pelicans",
    aliases: ["NOP", "NO", "New Orleans Pelicans", "Pelicans", "Pels", "1610612740"]
  },
  { canonical: "new-york-knicks", aliases: ["NY", "NYK", "New York", "New York Knicks", "NY Knicks", "Knicks", "1610612752"] },
  {
    canonical: "oklahoma-city-thunder",
    aliases: ["OKC", "Oklahoma City", "Oklahoma City Thunder", "Thunder", "1610612760"]
  },
  { canonical: "orlando-magic", aliases: ["ORL", "Orlando Magic", "Magic", "1610612753"] },
  {
    canonical: "philadelphia-76ers",
    aliases: ["PHI", "Philadelphia 76ers", "Philadelphia Sixers", "76ers", "Sixers", "1610612755"]
  },
  { canonical: "phoenix-suns", aliases: ["PHX", "PHO", "Phoenix Suns", "Suns", "1610612756"] },
  {
    canonical: "portland-trail-blazers",
    aliases: ["POR", "Portland", "Portland Trail Blazers", "Portland Trailblazers", "Trail Blazers", "Trailblazers", "Blazers", "1610612757"]
  },
  { canonical: "sacramento-kings", aliases: ["SAC", "Sacramento Kings", "Kings", "1610612758"] },
  { canonical: "san-antonio-spurs", aliases: ["SA", "SAS", "San Antonio Spurs", "Spurs", "1610612759"] },
  { canonical: "toronto-raptors", aliases: ["TOR", "Toronto Raptors", "Raptors", "1610612761"] },
  { canonical: "utah-jazz", aliases: ["UTA", "UTH", "Utah Jazz", "Jazz", "1610612762"] },
  { canonical: "washington-wizards", aliases: ["WAS", "WSH", "Washington Wizards", "Wizards", "1610612764"] }
];

const GENERIC_TEAM_TOKENS = new Set(["basketball", "basketballclub", "bc", "club", "nba", "team"]);
const NON_REAL_MARKER = /(^|[^a-z0-9])(demo|mock|synthetic|non[-_\s]?real|fake|placeholder)([^a-z0-9]|$)/i;
const NON_REAL_BOOLEAN_KEYS = new Set(["demo", "isdemo", "mock", "ismock", "synthetic", "issynthetic", "fake", "isfake"]);
const NBA_CANONICAL_KEYS = new Set(NBA_TEAM_ALIASES.map((team) => team.canonical));

const cachedStrengthByTarget = new Map<
  string,
  { expiresAt: number; strengths: HistoricalBasketballStrengthMap }
>();
const pendingLoadsByTarget = new Map<string, Promise<HistoricalBasketballStrengthMap>>();

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function normalizedAliasKey(value: string): string {
  const tokens = withoutProviderPrefix(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !GENERIC_TEAM_TOKENS.has(token));
  return tokens.join("");
}

const TEAM_ALIAS_TO_CANONICAL: ReadonlyMap<string, string> = new Map(
  NBA_TEAM_ALIASES.flatMap((team) =>
    [team.canonical, ...team.aliases].map((alias) => [normalizedAliasKey(alias), team.canonical] as const)
  )
);

export function canonicalBasketballTeamKey(value: string): string {
  const aliasKey = normalizedAliasKey(value);
  if (!aliasKey) return "";
  const nbaTeam = TEAM_ALIAS_TO_CANONICAL.get(aliasKey);
  if (nbaTeam) return nbaTeam;

  return withoutProviderPrefix(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizedSource(value: unknown): HistoricalBasketballSource | null {
  const source = cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return (REAL_BASKETBALL_SOURCES as readonly string[]).includes(source)
    ? (source as HistoricalBasketballSource)
    : null;
}

function hasNonRealMarker(value: unknown): boolean {
  return NON_REAL_MARKER.test(cleanText(value));
}

function metadataIsNonReal(value: unknown, depth = 0): boolean {
  if (!isRecord(value) || depth > 4) return false;

  for (const [rawKey, item] of Object.entries(value)) {
    const key = rawKey.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (key === "isreal" && item === false) return true;
    if (NON_REAL_BOOLEAN_KEYS.has(key) && item === true) return true;
    if (key === "sourcekind") {
      const sourceKind = cleanText(item).toLowerCase();
      if (sourceKind && sourceKind !== "real") return true;
    }
    if (typeof item === "string" && hasNonRealMarker(item)) return true;
    if (isRecord(item) && metadataIsNonReal(item, depth + 1)) return true;
  }

  return false;
}

function fixtureJoinKey(source: HistoricalBasketballSource, fixtureExternalId: string): string {
  return `${source}:${fixtureExternalId.trim().toLowerCase()}`;
}

function normalizeFixture(row: HistoricalBasketballFixtureRow): NormalizedFixture | null {
  const source = normalizedSource(row.provider);
  if (!source || cleanText(row.sport).toLowerCase() !== "basketball") return null;
  if (cleanText(row.status).toLowerCase() !== "finished") return null;

  const externalId = cleanText(row.external_id);
  const homeTeamExternalId = cleanText(row.home_team_external_id);
  const awayTeamExternalId = cleanText(row.away_team_external_id);
  if (
    !externalId ||
    !homeTeamExternalId ||
    !awayTeamExternalId ||
    hasNonRealMarker(externalId) ||
    hasNonRealMarker(homeTeamExternalId) ||
    hasNonRealMarker(awayTeamExternalId) ||
    metadataIsNonReal(row.metadata)
  ) {
    return null;
  }

  const kickoffTimestamp = Date.parse(cleanText(row.kickoff_at));
  if (!Number.isFinite(kickoffTimestamp)) return null;

  return {
    source,
    externalId,
    kickoffAt: new Date(kickoffTimestamp).toISOString(),
    kickoffTimestamp,
    homeTeamExternalId,
    awayTeamExternalId
  };
}

function teamKeyForCandidate(teamName: string, teamExternalId: string, fixtureTeamExternalId: string): string {
  const nameKey = canonicalBasketballTeamKey(teamName);
  const featureExternalKey = canonicalBasketballTeamKey(teamExternalId);
  const fixtureExternalKey = canonicalBasketballTeamKey(fixtureTeamExternalId);
  const knownKeys = [nameKey, featureExternalKey, fixtureExternalKey].filter((key) => NBA_CANONICAL_KEYS.has(key));
  if (knownKeys.length && knownKeys.some((key) => key !== knownKeys[0])) return "";
  if (knownKeys[0]) return knownKeys[0];
  return nameKey || featureExternalKey || fixtureExternalKey;
}

function nullableMetric(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = finiteNumber(value);
    if (parsed !== null) return round(parsed);
  }
  return null;
}

function sampleSizeFromFeature(feature: Record<string, unknown>, metadata: Record<string, unknown>): number {
  const value = finiteNumber(metadata.gamesPlayedBeforeTip ?? metadata.sampleSize ?? feature.sampleSize);
  return value === null ? 0 : Math.max(0, Math.floor(value));
}

function modelRatingFromRaw(rawRating: number): number {
  return Math.round(
    clamp(
      MODEL_RATING_MIDPOINT + (rawRating - HISTORICAL_BASKETBALL_INITIAL_RATING) / RAW_RATING_POINTS_PER_MODEL_POINT,
      MIN_MODEL_RATING,
      MAX_MODEL_RATING
    )
  );
}

function candidateForSide(
  snapshot: HistoricalBasketballFeatureSnapshotRow,
  fixture: NormalizedFixture,
  side: "home" | "away"
): Candidate | null {
  const features = isRecord(snapshot.features) ? snapshot.features : null;
  const teamValue = features?.[`${side}Team`];
  const featureValue = features?.[`${side}Features`];
  const team: Record<string, unknown> | null = isRecord(teamValue) ? teamValue : null;
  const feature: Record<string, unknown> | null = isRecord(featureValue) ? featureValue : null;
  if (!features || !team || !feature || metadataIsNonReal(features)) return null;

  const teamName = cleanText(team.name);
  const teamExternalId = cleanText(team.externalId ?? team.external_id ?? team.id);
  const fixtureTeamExternalId = side === "home" ? fixture.homeTeamExternalId : fixture.awayTeamExternalId;
  if (
    !teamName ||
    hasNonRealMarker(teamName) ||
    hasNonRealMarker(teamExternalId) ||
    metadataIsNonReal(team.metadata) ||
    metadataIsNonReal(feature.metadata)
  ) {
    return null;
  }

  const teamKey = teamKeyForCandidate(teamName, teamExternalId, fixtureTeamExternalId);
  const metadata = isRecord(feature.metadata) ? feature.metadata : {};
  const rawRating = finiteNumber(feature.eloRating ?? feature.rawRating ?? metadata.rating);
  if (!teamKey || rawRating === null) return null;

  const snapshotId = cleanText(snapshot.id);
  const snapshotGeneratedTimestamp = Date.parse(cleanText(snapshot.generated_at ?? snapshot.created_at));
  if (!Number.isFinite(snapshotGeneratedTimestamp)) return null;

  const source = fixture.source;
  return {
    teamKey,
    teamName,
    teamExternalId: teamExternalId || fixtureTeamExternalId,
    rawRating: round(rawRating),
    modelRating: modelRatingFromRaw(rawRating),
    pace: nullableMetric(metadata.pace, feature.pace),
    offensiveEfficiency: nullableMetric(metadata.offensiveEfficiency, feature.offensiveEfficiency, feature.attackStrength),
    defensiveEfficiency: nullableMetric(metadata.defensiveEfficiency, feature.defensiveEfficiency, feature.defenseStrength),
    restDays: nullableMetric(feature.restDays, metadata.restDays),
    recentFormPoints: nullableMetric(feature.recentFormPoints, metadata.recentFormPoints),
    sampleSize: sampleSizeFromFeature(feature, metadata),
    asOf: fixture.kickoffAt,
    source,
    featureSource: cleanText(metadata.source) || source,
    fixtureExternalId: fixture.externalId,
    snapshotId,
    snapshotGeneratedAt: new Date(snapshotGeneratedTimestamp).toISOString(),
    kickoffTimestamp: fixture.kickoffTimestamp,
    snapshotGeneratedTimestamp
  };
}

function sourcePriority(source: HistoricalBasketballSource): number {
  return source === "nba_team_totals_csv" ? 2 : 1;
}

function compareCandidates(left: Candidate, right: Candidate): number {
  return (
    left.kickoffTimestamp - right.kickoffTimestamp ||
    left.snapshotGeneratedTimestamp - right.snapshotGeneratedTimestamp ||
    left.sampleSize - right.sampleSize ||
    sourcePriority(left.source) - sourcePriority(right.source) ||
    compareText(left.fixtureExternalId, right.fixtureExternalId) ||
    compareText(left.snapshotId, right.snapshotId) ||
    compareText(left.teamExternalId, right.teamExternalId) ||
    left.rawRating - right.rawRating ||
    (left.pace ?? Number.NEGATIVE_INFINITY) - (right.pace ?? Number.NEGATIVE_INFINITY) ||
    (left.offensiveEfficiency ?? Number.NEGATIVE_INFINITY) - (right.offensiveEfficiency ?? Number.NEGATIVE_INFINITY) ||
    (left.defensiveEfficiency ?? Number.NEGATIVE_INFINITY) - (right.defensiveEfficiency ?? Number.NEGATIVE_INFINITY) ||
    (left.restDays ?? Number.NEGATIVE_INFINITY) - (right.restDays ?? Number.NEGATIVE_INFINITY) ||
    (left.recentFormPoints ?? Number.NEGATIVE_INFINITY) - (right.recentFormPoints ?? Number.NEGATIVE_INFINITY) ||
    compareText(left.teamName, right.teamName) ||
    compareText(left.featureSource, right.featureSource)
  );
}

function fixtureMap(rows: readonly HistoricalBasketballFixtureRow[]): Map<string, NormalizedFixture> {
  const normalized = rows
    .map(normalizeFixture)
    .filter((fixture): fixture is NormalizedFixture => fixture !== null)
    .sort(
      (left, right) =>
        left.kickoffTimestamp - right.kickoffTimestamp ||
        compareText(left.source, right.source) ||
        compareText(left.externalId, right.externalId)
    );
  const fixtures = new Map<string, NormalizedFixture>();
  for (const fixture of normalized) fixtures.set(fixtureJoinKey(fixture.source, fixture.externalId), fixture);
  return fixtures;
}

export function buildHistoricalBasketballStrength(
  fixtureRows: readonly HistoricalBasketballFixtureRow[],
  snapshotRows: readonly HistoricalBasketballFeatureSnapshotRow[]
): HistoricalBasketballStrengthMap {
  const fixtures = fixtureMap(fixtureRows);
  const latestByTeam = new Map<string, Candidate>();

  for (const snapshot of snapshotRows) {
    const source = normalizedSource(snapshot.source);
    const fixtureExternalId = cleanText(snapshot.fixture_external_id);
    if (
      !source ||
      cleanText(snapshot.sport).toLowerCase() !== "basketball" ||
      !fixtureExternalId ||
      hasNonRealMarker(snapshot.id) ||
      hasNonRealMarker(fixtureExternalId) ||
      hasNonRealMarker(snapshot.model_key) ||
      hasNonRealMarker(snapshot.source)
    ) {
      continue;
    }

    const fixture = fixtures.get(fixtureJoinKey(source, fixtureExternalId));
    if (!fixture) continue;

    for (const side of ["home", "away"] as const) {
      const candidate = candidateForSide(snapshot, fixture, side);
      if (!candidate) continue;
      const current = latestByTeam.get(candidate.teamKey);
      if (!current || compareCandidates(candidate, current) > 0) latestByTeam.set(candidate.teamKey, candidate);
    }
  }

  const output = new Map<string, HistoricalBasketballStrengthRating>();
  for (const teamKey of [...latestByTeam.keys()].sort(compareText)) {
    const candidate = latestByTeam.get(teamKey);
    if (!candidate) continue;
    const { kickoffTimestamp: _kickoffTimestamp, snapshotGeneratedTimestamp: _snapshotGeneratedTimestamp, ...rating } = candidate;
    output.set(teamKey, Object.freeze(rating));
  }
  return output;
}

export function getHistoricalBasketballStrength(
  strengths: HistoricalBasketballStrengthMap,
  teamNameOrExternalId: string
): HistoricalBasketballStrengthRating | undefined {
  const teamKey = canonicalBasketballTeamKey(teamNameOrExternalId);
  return teamKey ? strengths.get(teamKey) : undefined;
}

async function readHistoricalBasketballFixtures(client: SupabaseClient): Promise<HistoricalBasketballFixtureRow[]> {
  const rows: HistoricalBasketballFixtureRow[] = [];

  for (let offset = 0; ; offset += HISTORICAL_BASKETBALL_PAGE_SIZE) {
    const { data, error } = await client
      .from("op_fixtures")
      .select(
        "external_id, provider, sport, status, kickoff_at, home_team_external_id, away_team_external_id, metadata"
      )
      .eq("sport", "basketball")
      .eq("status", "finished")
      .in("provider", [...REAL_BASKETBALL_SOURCES])
      .order("kickoff_at", { ascending: true })
      .order("provider", { ascending: true })
      .order("external_id", { ascending: true })
      .range(offset, offset + HISTORICAL_BASKETBALL_PAGE_SIZE - 1);

    if (error) throw new Error("Historical basketball fixtures are unavailable.");
    const page = (data ?? []) as unknown as HistoricalBasketballFixtureRow[];
    rows.push(...page);
    if (page.length < HISTORICAL_BASKETBALL_PAGE_SIZE) break;
  }

  return rows;
}

async function readHistoricalBasketballSnapshots(
  client: SupabaseClient
): Promise<HistoricalBasketballFeatureSnapshotRow[]> {
  const rows: HistoricalBasketballFeatureSnapshotRow[] = [];

  for (let offset = 0; ; offset += HISTORICAL_BASKETBALL_PAGE_SIZE) {
    const { data, error } = await client
      .from("op_training_feature_snapshots")
      .select(
        "id, sport, fixture_external_id, model_key, generated_at, features, split, source, feature_hash, created_at"
      )
      .eq("sport", "basketball")
      .in("source", [...REAL_BASKETBALL_SOURCES])
      .order("fixture_external_id", { ascending: true })
      .order("source", { ascending: true })
      .order("generated_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + HISTORICAL_BASKETBALL_PAGE_SIZE - 1);

    if (error) throw new Error("Historical basketball feature snapshots are unavailable.");
    const page = (data ?? []) as unknown as HistoricalBasketballFeatureSnapshotRow[];
    rows.push(...page);
    if (page.length < HISTORICAL_BASKETBALL_PAGE_SIZE) break;
  }

  return rows;
}

function cloneStrengths(strengths: HistoricalBasketballStrengthMap): HistoricalBasketballStrengthMap {
  return new Map(strengths);
}

export function clearHistoricalBasketballStrengthCache(): void {
  cachedStrengthByTarget.clear();
  pendingLoadsByTarget.clear();
}

function strengthCacheTarget(env: EnvMap): string {
  const runtime = getSupabaseRuntimeStatus(env);
  const configuredRef = runtime.urlProjectRef ?? runtime.projectRef ?? "unconfigured";
  return `${runtime.expectedProjectRef}:${configuredRef}:${runtime.projectHost ?? "unconfigured"}`;
}

function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error("Historical basketball strength can only be loaded on the server.");
  }
}

export async function loadHistoricalBasketballStrength(
  env: EnvMap = process.env
): Promise<HistoricalBasketballStrengthMap> {
  assertServerRuntime();
  const target = strengthCacheTarget(env);
  const now = Date.now();
  const cached = cachedStrengthByTarget.get(target);
  if (cached && cached.expiresAt > now) return cloneStrengths(cached.strengths);
  const pending = pendingLoadsByTarget.get(target);
  if (pending) return cloneStrengths(await pending);

  const load = (async () => {
    let strengths: HistoricalBasketballStrengthMap = new Map();
    try {
      const runtime = getSupabaseRuntimeStatus(env);
      const client = runtime.serverWriteReady ? getSupabaseServerClient(env) : null;
      if (client) {
        const [fixtures, snapshots] = await Promise.all([
          readHistoricalBasketballFixtures(client),
          readHistoricalBasketballSnapshots(client)
        ]);
        strengths = buildHistoricalBasketballStrength(fixtures, snapshots);
      }
    } catch {
      strengths = new Map();
    }

    cachedStrengthByTarget.set(target, {
      expiresAt: Date.now() + HISTORICAL_BASKETBALL_STRENGTH_CACHE_TTL_MS,
      strengths
    });
    return strengths;
  })();
  pendingLoadsByTarget.set(target, load);

  try {
    return cloneStrengths(await load);
  } finally {
    if (pendingLoadsByTarget.get(target) === load) pendingLoadsByTarget.delete(target);
  }
}
