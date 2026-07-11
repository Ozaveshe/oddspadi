import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";

type EnvMap = Record<string, string | undefined>;

export const HISTORICAL_TENNIS_STRENGTH_CACHE_TTL_MS = 15 * 60 * 1000;
export const HISTORICAL_TENNIS_MIN_MODEL_RATING = 60;
export const HISTORICAL_TENNIS_MAX_MODEL_RATING = 100;

const HISTORICAL_TENNIS_PAGE_SIZE = 1000;
const TENNIS_DATA_SOURCE = "tennis_data_xlsx";
const TENNIS_ELO_FLOOR = 1800;
const TENNIS_ELO_CEILING = 2450;

export type HistoricalTennisFixtureRow = {
  external_id?: unknown;
  provider?: unknown;
  sport?: unknown;
  status?: unknown;
  kickoff_at?: unknown;
  home_team_external_id?: unknown;
  away_team_external_id?: unknown;
  metadata?: unknown;
};

export type HistoricalTennisFeatureSnapshotRow = {
  id?: unknown;
  fixture_external_id?: unknown;
  sport?: unknown;
  model_key?: unknown;
  generated_at?: unknown;
  features?: unknown;
  split?: unknown;
  source?: unknown;
  feature_hash?: unknown;
};

export type HistoricalTennisStrengthBuildOptions = {
  beforeKickoff?: string | number | Date;
};

export type HistoricalTennisStrengthProvenance = Readonly<{
  fixtureExternalId: string;
  fixtureProvider: typeof TENNIS_DATA_SOURCE;
  snapshotId: string | null;
  snapshotGeneratedAt: string | null;
  featureHash: string | null;
  side: "home" | "away";
}>;

export type HistoricalTennisStrengthRating = Readonly<{
  playerKey: string;
  playerName: string;
  playerExternalId: string;
  scope: "overall" | "surface";
  modelRating: number;
  rawElo: number;
  surface: string | null;
  attackStrength: number | null;
  defenseStrength: number | null;
  restDays: number | null;
  recentFormPoints: number | null;
  rank: number | null;
  rankingPoints: number | null;
  sampleSize: number;
  asOf: string;
  source: typeof TENNIS_DATA_SOURCE;
  provenance: HistoricalTennisStrengthProvenance;
}>;

export type HistoricalTennisPlayerStrength = Readonly<{
  playerKey: string;
  playerName: string;
  playerExternalId: string;
  aliases: readonly string[];
  overall: HistoricalTennisStrengthRating;
  bySurface: ReadonlyMap<string, HistoricalTennisStrengthRating>;
}>;

export type HistoricalTennisStrengthMap = ReadonlyMap<string, HistoricalTennisPlayerStrength>;

type NormalizedFixture = {
  externalId: string;
  kickoffAt: string;
  kickoffTimestamp: number;
  homeExternalId: string;
  awayExternalId: string;
  surface: string | null;
  stableKey: string;
};

type NormalizedSnapshot = {
  fixtureExternalId: string;
  snapshotId: string | null;
  generatedAt: string | null;
  generatedTimestamp: number;
  featureHash: string | null;
  features: Record<string, unknown>;
  stableKey: string;
};

type PlayerObservation = {
  playerKey: string;
  playerName: string;
  playerExternalId: string;
  aliases: readonly string[];
  rawElo: number;
  surface: string | null;
  attackStrength: number | null;
  defenseStrength: number | null;
  restDays: number | null;
  recentFormPoints: number | null;
  rank: number | null;
  rankingPoints: number | null;
  kickoffAt: string;
  kickoffTimestamp: number;
  source: typeof TENNIS_DATA_SOURCE;
  provenance: HistoricalTennisStrengthProvenance;
  stableKey: string;
};

type PlayerObservationGroup = {
  aliases: Set<string>;
  observations: PlayerObservation[];
};

const cachedStrengthByTarget = new Map<
  string,
  { expiresAt: number; strengths: HistoricalTennisStrengthMap }
>();
const pendingLoadsByTarget = new Map<string, Promise<HistoricalTennisStrengthMap>>();

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

function nonNegativeNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

function sourceKey(value: unknown): string {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function isTennisDataSource(value: unknown): boolean {
  return sourceKey(value) === TENNIS_DATA_SOURCE;
}

function hasNonRealMarker(value: unknown): boolean {
  const text = cleanText(value);
  return /(^|[^a-z0-9])(demo|mock|synthetic|non[\s_-]?real|sample|fake|test)(?=$|[^a-z0-9])/i.test(text);
}

function metadataIsNonReal(value: unknown, depth = 0): boolean {
  if (!isRecord(value) || depth > 5) return false;

  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if ((normalizedKey === "sourcekind" || normalizedKey === "datakind") && cleanText(item)) {
      if (cleanText(item).toLowerCase() !== "real") return true;
    }
    if ((normalizedKey === "isreal" || normalizedKey === "real") && item === false) return true;
    if (
      ["demo", "isdemo", "mock", "ismock", "synthetic", "issynthetic", "fake", "isfake"].includes(
        normalizedKey
      ) &&
      item === true
    ) {
      return true;
    }
    if (typeof item === "string" && hasNonRealMarker(item)) return true;
    if (isRecord(item) && metadataIsNonReal(item, depth + 1)) return true;
    if (Array.isArray(item) && item.some((entry) => isRecord(entry) && metadataIsNonReal(entry, depth + 1))) {
      return true;
    }
  }

  return false;
}

function normalizePlayerText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0142\u0141]/g, "l")
    .replace(/[\u00f8\u00d8]/g, "o")
    .replace(/[\u0111\u0110\u00f0\u00d0]/g, "d")
    .replace(/[\u00fe\u00de]/g, "th")
    .replace(/[\u00e6\u00c6]/g, "ae")
    .replace(/[\u0153\u0152]/g, "oe")
    .replace(/\u00df/g, "ss")
    .toLowerCase();
}

function playerIdentityPart(value: string): string {
  const marker = value.toLowerCase().lastIndexOf(":player:");
  if (marker >= 0) return value.slice(marker + ":player:".length);
  return value;
}

function playerTokens(value: string): string[] {
  return normalizePlayerText(playerIdentityPart(value))
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function aliasKey(surnameTokens: readonly string[], initialToken: string): string {
  const surname = surnameTokens.filter(Boolean).join("-");
  const initial = initialToken.charAt(0);
  return surname && initial ? `${surname}:${initial}` : "";
}

const SURNAME_PARTICLES = new Set([
  "al",
  "bin",
  "da",
  "das",
  "de",
  "del",
  "della",
  "den",
  "der",
  "di",
  "do",
  "dos",
  "la",
  "le",
  "saint",
  "st",
  "van",
  "von"
]);

export function tennisPlayerAliasKeys(value: string): readonly string[] {
  const text = cleanText(value);
  if (!text) return [];

  const aliases: string[] = [];
  const addAlias = (surname: readonly string[], initial: string) => {
    const alias = aliasKey(surname, initial);
    if (alias && !aliases.includes(alias)) aliases.push(alias);
  };
  const identity = playerIdentityPart(text);
  const commaIndex = identity.indexOf(",");

  if (commaIndex >= 0) {
    const surname = playerTokens(identity.slice(0, commaIndex));
    const given = playerTokens(identity.slice(commaIndex + 1));
    if (surname.length && given.length) addAlias(surname, given[0]);
  }

  const tokens = playerTokens(text);
  if (tokens.length < 2) return aliases;

  if (tokens[tokens.length - 1].length === 1) {
    addAlias(tokens.slice(0, -1), tokens[tokens.length - 1]);
    return aliases;
  }

  if (tokens[0].length === 1) {
    addAlias(tokens.slice(1), tokens[0]);
    return aliases;
  }

  const firstInitial = tokens[0];
  const surnameTokens = tokens.slice(1);
  addAlias(surnameTokens, firstInitial);

  const particleIndex = surnameTokens.findIndex((token) => SURNAME_PARTICLES.has(token));
  if (particleIndex >= 0) addAlias(surnameTokens.slice(particleIndex), firstInitial);
  addAlias([surnameTokens[surnameTokens.length - 1]], firstInitial);

  return aliases;
}

export function canonicalTennisPlayerKey(value: string): string {
  return tennisPlayerAliasKeys(value)[0] ?? "";
}

export function canonicalTennisSurface(value: string): string {
  const normalized = normalizePlayerText(cleanText(value)).replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return "";
  if (/\bindoor\b/.test(normalized)) return "indoor";
  if (/\bclay\b/.test(normalized)) return "clay";
  if (/\bgrass\b/.test(normalized)) return "grass";
  if (/\bcarpet\b/.test(normalized)) return "carpet";
  if (/\bhard(?:\s*court)?\b/.test(normalized)) return "hard";
  return normalized.replace(/\s+/g, "-");
}

export function tennisModelRatingFromElo(rawElo: number): number {
  const scaled =
    HISTORICAL_TENNIS_MIN_MODEL_RATING +
    ((rawElo - TENNIS_ELO_FLOOR) / (TENNIS_ELO_CEILING - TENNIS_ELO_FLOOR)) *
      (HISTORICAL_TENNIS_MAX_MODEL_RATING - HISTORICAL_TENNIS_MIN_MODEL_RATING);
  return Math.round(clamp(scaled, HISTORICAL_TENNIS_MIN_MODEL_RATING, HISTORICAL_TENNIS_MAX_MODEL_RATING));
}

function optionalIsoTimestamp(value: unknown): { iso: string | null; timestamp: number } {
  const timestamp = Date.parse(cleanText(value));
  return Number.isFinite(timestamp)
    ? { iso: new Date(timestamp).toISOString(), timestamp }
    : { iso: null, timestamp: Number.NEGATIVE_INFINITY };
}

function fixtureSurface(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null;
  const surface = canonicalTennisSurface(cleanText(metadata.surface));
  return surface || null;
}

function normalizeFixture(row: HistoricalTennisFixtureRow): NormalizedFixture | null {
  if (!isTennisDataSource(row.provider)) return null;
  if (cleanText(row.sport).toLowerCase() !== "tennis") return null;
  if (cleanText(row.status).toLowerCase() !== "finished") return null;

  const externalId = cleanText(row.external_id);
  const homeExternalId = cleanText(row.home_team_external_id);
  const awayExternalId = cleanText(row.away_team_external_id);
  const kickoff = optionalIsoTimestamp(row.kickoff_at);
  if (!externalId || !kickoff.iso || !homeExternalId || !awayExternalId || homeExternalId === awayExternalId) {
    return null;
  }
  if (
    hasNonRealMarker(externalId) ||
    hasNonRealMarker(homeExternalId) ||
    hasNonRealMarker(awayExternalId) ||
    metadataIsNonReal(row.metadata)
  ) {
    return null;
  }

  const metadataSource = isRecord(row.metadata) ? cleanText(row.metadata.source) : "";
  if (metadataSource && !isTennisDataSource(metadataSource)) return null;

  return {
    externalId,
    kickoffAt: kickoff.iso,
    kickoffTimestamp: kickoff.timestamp,
    homeExternalId,
    awayExternalId,
    surface: fixtureSurface(row.metadata),
    stableKey: stableStringify(row)
  };
}

function normalizeSnapshot(row: HistoricalTennisFeatureSnapshotRow): NormalizedSnapshot | null {
  if (!isTennisDataSource(row.source)) return null;
  if (cleanText(row.sport).toLowerCase() !== "tennis") return null;
  const fixtureExternalId = cleanText(row.fixture_external_id);
  if (
    !fixtureExternalId ||
    hasNonRealMarker(fixtureExternalId) ||
    !isRecord(row.features) ||
    metadataIsNonReal(row.features)
  ) {
    return null;
  }

  const generated = optionalIsoTimestamp(row.generated_at);
  const snapshotId = cleanText(row.id) || null;
  const featureHash = cleanText(row.feature_hash) || null;
  return {
    fixtureExternalId,
    snapshotId,
    generatedAt: generated.iso,
    generatedTimestamp: generated.timestamp,
    featureHash,
    features: row.features,
    stableKey: stableStringify(row)
  };
}

function compareFixtures(left: NormalizedFixture, right: NormalizedFixture): number {
  return (
    left.kickoffTimestamp - right.kickoffTimestamp ||
    compareText(left.externalId, right.externalId) ||
    compareText(left.stableKey, right.stableKey)
  );
}

function compareSnapshots(left: NormalizedSnapshot, right: NormalizedSnapshot): number {
  return (
    left.generatedTimestamp - right.generatedTimestamp ||
    compareText(left.snapshotId ?? "", right.snapshotId ?? "") ||
    compareText(left.featureHash ?? "", right.featureHash ?? "") ||
    compareText(left.stableKey, right.stableKey)
  );
}

function snapshotSurface(
  features: Record<string, unknown>,
  sideFeatures: Record<string, unknown>,
  fixture: NormalizedFixture
): string | null {
  const league = isRecord(features.league) ? features.league : null;
  const leagueMetadata = league && isRecord(league.metadata) ? league.metadata : null;
  const featureMetadata = isRecord(sideFeatures.metadata) ? sideFeatures.metadata : null;
  const value = cleanText(leagueMetadata?.surface) || cleanText(featureMetadata?.surface);
  return canonicalTennisSurface(value) || fixture.surface;
}

function sourceMetadataIsAllowed(metadata: unknown): boolean {
  if (metadata === undefined || metadata === null) return true;
  if (!isRecord(metadata) || metadataIsNonReal(metadata)) return false;
  const source = cleanText(metadata.source);
  return !source || isTennisDataSource(source);
}

function observationForSide(
  fixture: NormalizedFixture,
  snapshot: NormalizedSnapshot,
  side: "home" | "away"
): PlayerObservation | null {
  const teamValue = snapshot.features[side === "home" ? "homeTeam" : "awayTeam"];
  const featureValue = snapshot.features[side === "home" ? "homeFeatures" : "awayFeatures"];
  if (!isRecord(teamValue) || !isRecord(featureValue)) return null;

  const fixtureExternalId = side === "home" ? fixture.homeExternalId : fixture.awayExternalId;
  const playerExternalId = cleanText(teamValue.externalId) || fixtureExternalId;
  const playerName = cleanText(teamValue.name) || playerExternalId;
  if (
    hasNonRealMarker(playerExternalId) ||
    hasNonRealMarker(playerName) ||
    !sourceMetadataIsAllowed(teamValue.metadata) ||
    !sourceMetadataIsAllowed(featureValue.metadata)
  ) {
    return null;
  }

  const league = isRecord(snapshot.features.league) ? snapshot.features.league : null;
  if (league && isRecord(league.metadata) && !sourceMetadataIsAllowed(league.metadata)) return null;

  const aliases = [
    ...tennisPlayerAliasKeys(playerExternalId),
    ...tennisPlayerAliasKeys(playerName),
    ...tennisPlayerAliasKeys(fixtureExternalId)
  ].filter((alias, index, values) => values.indexOf(alias) === index);
  const playerKey = aliases[0] ?? "";
  const rawElo = finiteNumber(featureValue.eloRating);
  if (!playerKey || rawElo === null) return null;

  const surface = snapshotSurface(snapshot.features, featureValue, fixture);
  const metadata = isRecord(featureValue.metadata) ? featureValue.metadata : {};
  const provenance = Object.freeze({
    fixtureExternalId: fixture.externalId,
    fixtureProvider: TENNIS_DATA_SOURCE,
    snapshotId: snapshot.snapshotId,
    snapshotGeneratedAt: snapshot.generatedAt,
    featureHash: snapshot.featureHash,
    side
  });

  return {
    playerKey,
    playerName,
    playerExternalId,
    aliases,
    rawElo,
    surface,
    attackStrength: finiteNumber(featureValue.attackStrength),
    defenseStrength: finiteNumber(featureValue.defenseStrength),
    restDays: nonNegativeNumber(featureValue.restDays),
    recentFormPoints: finiteNumber(featureValue.recentFormPoints),
    rank: positiveInteger(metadata.rank),
    rankingPoints: nonNegativeNumber(metadata.rankingPoints),
    kickoffAt: fixture.kickoffAt,
    kickoffTimestamp: fixture.kickoffTimestamp,
    source: TENNIS_DATA_SOURCE,
    provenance,
    stableKey: [
      fixture.externalId,
      side,
      snapshot.generatedAt ?? "",
      snapshot.snapshotId ?? "",
      snapshot.featureHash ?? "",
      playerExternalId,
      stableStringify(featureValue)
    ].join(":")
  };
}

function compareObservations(left: PlayerObservation, right: PlayerObservation): number {
  return (
    left.kickoffTimestamp - right.kickoffTimestamp ||
    compareText(left.provenance.fixtureExternalId, right.provenance.fixtureExternalId) ||
    compareText(left.stableKey, right.stableKey)
  );
}

function buildCutoffTimestamp(value: HistoricalTennisStrengthBuildOptions["beforeKickoff"]): number {
  if (value === undefined) return Number.POSITIVE_INFINITY;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : Number.POSITIVE_INFINITY;
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function strengthRating(
  observation: PlayerObservation,
  sampleSize: number,
  scope: HistoricalTennisStrengthRating["scope"]
): HistoricalTennisStrengthRating {
  return Object.freeze({
    playerKey: observation.playerKey,
    playerName: observation.playerName,
    playerExternalId: observation.playerExternalId,
    scope,
    modelRating: tennisModelRatingFromElo(observation.rawElo),
    rawElo: round(observation.rawElo),
    surface: observation.surface,
    attackStrength:
      observation.attackStrength === null ? null : round(observation.attackStrength, 6),
    defenseStrength:
      observation.defenseStrength === null ? null : round(observation.defenseStrength, 6),
    restDays: observation.restDays === null ? null : round(observation.restDays),
    recentFormPoints:
      observation.recentFormPoints === null ? null : round(observation.recentFormPoints),
    rank: observation.rank,
    rankingPoints:
      observation.rankingPoints === null ? null : round(observation.rankingPoints),
    sampleSize,
    asOf: observation.kickoffAt,
    source: observation.source,
    provenance: observation.provenance
  });
}

export function buildHistoricalTennisStrength(
  fixtureRows: readonly HistoricalTennisFixtureRow[],
  snapshotRows: readonly HistoricalTennisFeatureSnapshotRow[],
  options: HistoricalTennisStrengthBuildOptions = {}
): HistoricalTennisStrengthMap {
  const cutoffTimestamp = buildCutoffTimestamp(options.beforeKickoff);
  const fixtures = fixtureRows
    .map(normalizeFixture)
    .filter((fixture): fixture is NormalizedFixture => fixture !== null)
    .filter((fixture) => fixture.kickoffTimestamp < cutoffTimestamp)
    .sort(compareFixtures);
  const fixtureByExternalId = new Map<string, NormalizedFixture>();
  for (const fixture of fixtures) fixtureByExternalId.set(fixture.externalId, fixture);

  const snapshots = snapshotRows
    .map(normalizeSnapshot)
    .filter((snapshot): snapshot is NormalizedSnapshot => snapshot !== null)
    .filter((snapshot) => fixtureByExternalId.has(snapshot.fixtureExternalId))
    .sort(compareSnapshots);
  const snapshotByFixture = new Map<string, NormalizedSnapshot>();
  for (const snapshot of snapshots) snapshotByFixture.set(snapshot.fixtureExternalId, snapshot);

  const observations: PlayerObservation[] = [];
  for (const fixture of [...fixtureByExternalId.values()].sort(compareFixtures)) {
    const snapshot = snapshotByFixture.get(fixture.externalId);
    if (!snapshot) continue;
    const home = observationForSide(fixture, snapshot, "home");
    const away = observationForSide(fixture, snapshot, "away");
    if (home) observations.push(home);
    if (away) observations.push(away);
  }
  observations.sort(compareObservations);

  const groups = new Map<string, PlayerObservationGroup>();
  for (const observation of observations) {
    const group = groups.get(observation.playerKey) ?? {
      aliases: new Set<string>(),
      observations: []
    };
    for (const alias of observation.aliases) group.aliases.add(alias);
    group.observations.push(observation);
    groups.set(observation.playerKey, group);
  }

  const output = new Map<string, HistoricalTennisPlayerStrength>();
  for (const playerKey of [...groups.keys()].sort(compareText)) {
    const group = groups.get(playerKey);
    if (!group?.observations.length) continue;
    const playerObservations = [...group.observations].sort(compareObservations);
    const latest = playerObservations[playerObservations.length - 1];
    const surfaceGroups = new Map<string, PlayerObservation[]>();
    for (const observation of playerObservations) {
      if (!observation.surface) continue;
      const surfaceRows = surfaceGroups.get(observation.surface) ?? [];
      surfaceRows.push(observation);
      surfaceGroups.set(observation.surface, surfaceRows);
    }

    const bySurface = new Map<string, HistoricalTennisStrengthRating>();
    for (const surface of [...surfaceGroups.keys()].sort(compareText)) {
      const surfaceRows = surfaceGroups.get(surface) ?? [];
      const latestSurface = surfaceRows[surfaceRows.length - 1];
      if (latestSurface) bySurface.set(surface, strengthRating(latestSurface, surfaceRows.length, "surface"));
    }

    const aliases = [playerKey, ...[...group.aliases].filter((alias) => alias !== playerKey).sort(compareText)];
    output.set(
      playerKey,
      Object.freeze({
        playerKey,
        playerName: latest.playerName,
        playerExternalId: latest.playerExternalId,
        aliases: Object.freeze(aliases),
        overall: strengthRating(latest, playerObservations.length, "overall"),
        bySurface
      })
    );
  }

  return output;
}

export function getHistoricalTennisPlayerStrength(
  strengths: HistoricalTennisStrengthMap,
  playerNameOrExternalId: string
): HistoricalTennisPlayerStrength | undefined {
  const aliases = tennisPlayerAliasKeys(playerNameOrExternalId);
  for (const alias of aliases) {
    const direct = strengths.get(alias);
    if (direct) return direct;
  }

  const aliasSet = new Set(aliases);
  for (const player of strengths.values()) {
    if (player.aliases.some((alias) => aliasSet.has(alias))) return player;
  }
  return undefined;
}

export function getHistoricalTennisStrength(
  strengths: HistoricalTennisStrengthMap,
  playerNameOrExternalId: string,
  surface?: string
): HistoricalTennisStrengthRating | undefined {
  const player = getHistoricalTennisPlayerStrength(strengths, playerNameOrExternalId);
  if (!player) return undefined;
  if (surface === undefined) return player.overall;
  const surfaceKey = canonicalTennisSurface(surface);
  return surfaceKey ? player.bySurface.get(surfaceKey) : undefined;
}

async function readHistoricalTennisFixtures(client: SupabaseClient): Promise<HistoricalTennisFixtureRow[]> {
  const rows: HistoricalTennisFixtureRow[] = [];
  for (let offset = 0; ; offset += HISTORICAL_TENNIS_PAGE_SIZE) {
    const { data, error } = await client
      .from("op_fixtures")
      .select(
        "external_id, provider, sport, status, kickoff_at, home_team_external_id, away_team_external_id, metadata"
      )
      .eq("provider", TENNIS_DATA_SOURCE)
      .eq("sport", "tennis")
      .eq("status", "finished")
      .order("kickoff_at", { ascending: true })
      .order("external_id", { ascending: true })
      .range(offset, offset + HISTORICAL_TENNIS_PAGE_SIZE - 1);

    if (error) throw new Error("Historical tennis fixtures are unavailable.");
    const page = (data ?? []) as unknown as HistoricalTennisFixtureRow[];
    rows.push(...page);
    if (page.length < HISTORICAL_TENNIS_PAGE_SIZE) break;
  }
  return rows;
}

async function readHistoricalTennisSnapshots(
  client: SupabaseClient
): Promise<HistoricalTennisFeatureSnapshotRow[]> {
  const rows: HistoricalTennisFeatureSnapshotRow[] = [];
  for (let offset = 0; ; offset += HISTORICAL_TENNIS_PAGE_SIZE) {
    const { data, error } = await client
      .from("op_training_feature_snapshots")
      .select(
        "id, fixture_external_id, sport, model_key, generated_at, features, split, source, feature_hash"
      )
      .eq("source", TENNIS_DATA_SOURCE)
      .eq("sport", "tennis")
      .order("fixture_external_id", { ascending: true })
      .order("generated_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + HISTORICAL_TENNIS_PAGE_SIZE - 1);

    if (error) throw new Error("Historical tennis feature snapshots are unavailable.");
    const page = (data ?? []) as unknown as HistoricalTennisFeatureSnapshotRow[];
    rows.push(...page);
    if (page.length < HISTORICAL_TENNIS_PAGE_SIZE) break;
  }
  return rows;
}

function cloneStrengths(strengths: HistoricalTennisStrengthMap): HistoricalTennisStrengthMap {
  return new Map(strengths);
}

function strengthCacheTarget(env: EnvMap): string {
  const runtime = getSupabaseRuntimeStatus(env);
  return [
    runtime.expectedProjectRef,
    runtime.projectRef ?? "unconfigured",
    runtime.urlProjectRef ?? "unconfigured",
    runtime.projectHost ?? "unconfigured",
    runtime.serverWriteReady ? "server-ready" : "unavailable"
  ].join(":");
}

export function clearHistoricalTennisStrengthCache(): void {
  cachedStrengthByTarget.clear();
  pendingLoadsByTarget.clear();
}

export async function loadHistoricalTennisStrength(
  env: EnvMap = process.env
): Promise<HistoricalTennisStrengthMap> {
  if (typeof window !== "undefined") return new Map();

  const target = strengthCacheTarget(env);
  const now = Date.now();
  const cached = cachedStrengthByTarget.get(target);
  if (cached && cached.expiresAt > now) return cloneStrengths(cached.strengths);
  const pending = pendingLoadsByTarget.get(target);
  if (pending) return cloneStrengths(await pending);

  const load = (async () => {
    let strengths: HistoricalTennisStrengthMap = new Map();
    try {
      const runtime = getSupabaseRuntimeStatus(env);
      const client = runtime.serverWriteReady ? getSupabaseServerClient(env) : null;
      if (client) {
        const [fixtures, snapshots] = await Promise.all([
          readHistoricalTennisFixtures(client),
          readHistoricalTennisSnapshots(client)
        ]);
        strengths = buildHistoricalTennisStrength(fixtures, snapshots);
      }
    } catch {
      strengths = new Map();
    }

    cachedStrengthByTarget.set(target, {
      expiresAt: Date.now() + HISTORICAL_TENNIS_STRENGTH_CACHE_TTL_MS,
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
