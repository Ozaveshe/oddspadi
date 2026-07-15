import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  normalizeApiFootballFixtures,
  normalizeApiFootballPlayerPerformancesForFixture
} from "../src/lib/sports/training/providerSync";
import type { PlayerMatchPerformance } from "../src/lib/sports/training/playerPerformance";

type JsonRecord = Record<string, unknown>;

type FixturePreparation = {
  fixtureExternalId: string;
  kickoffAt: string;
  homeTeam: string;
  awayTeam: string;
  homeActivePlayers: number;
  awayActivePlayers: number;
  rows: PlayerMatchPerformance[];
  error: string | null;
};

const API_ROOT = "https://v3.football.api-sports.io";
const MAX_FIXTURES = 400;
const MINIMUM_ACTIVE_PLAYERS_PER_TEAM = 11;

function cliValue(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix))?.slice(prefix.length).trim();
  return value || fallback;
}

function integerOption(name: string, fallback: number, min: number, max: number): number {
  const value = Number(cliValue(name));
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function requireDate(name: string): string {
  const value = cliValue(name);
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`--${name}=YYYY-MM-DD is required.`);
  }
  return value;
}

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null ? value as JsonRecord : {};
}

function providerErrors(payload: unknown): string[] {
  const errors = record(payload).errors;
  if (Array.isArray(errors)) return errors.map(String).filter(Boolean);
  if (typeof errors === "string" && errors.trim()) return [errors.trim()];
  if (!errors || typeof errors !== "object") return [];
  return Object.values(errors).flatMap((value) => Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
}

async function loadLocalEnv(): Promise<void> {
  const contents = await readFile(path.resolve(".env.local"), "utf8").catch(() => "");
  for (const sourceLine of contents.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    const value = raw.replace(/^(['"])(.*)\1$/, "$2");
    if (name && process.env[name] === undefined) process.env[name] = value;
  }
}

function apiKey(): string {
  for (const name of ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error("API_FOOTBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY is required.");
}

async function fetchProviderJson(endpoint: URL, key: string, attempts = 3): Promise<unknown> {
  let lastError = "Provider request failed.";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let rateLimited = false;
    try {
      const response = await fetch(endpoint, {
        headers: { "x-apisports-key": key },
        cache: "no-store"
      });
      const payload = await response.json().catch(() => null);
      const errors = providerErrors(payload);
      if (response.ok && errors.length === 0) return payload;
      lastError = errors[0] ?? `Provider returned HTTP ${response.status}.`;
      rateLimited = response.status === 429 || errors.some((error) => /too many requests|rate.?limit/i.test(error));
      if (!rateLimited && response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
    if (attempt < attempts) {
      const delayMs = rateLimited ? attempt * 20_000 : attempt * 750;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`${endpoint.pathname}: ${lastError}`);
}

async function quotaSnapshot(key: string) {
  const payload = record(await fetchProviderJson(new URL(`${API_ROOT}/status`), key));
  const response = record(payload.response);
  const subscription = record(response.subscription);
  const requests = record(response.requests);
  return {
    plan: typeof subscription.plan === "string" ? subscription.plan : null,
    active: subscription.active === true,
    current: typeof requests.current === "number" ? requests.current : null,
    limitDay: typeof requests.limit_day === "number" ? requests.limit_day : null
  };
}

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function requestPacer(requestsPerMinute: number): () => Promise<void> {
  const intervalMs = 60_000 / requestsPerMinute;
  let nextRequestAt = Date.now();
  return async () => {
    const scheduledAt = nextRequestAt;
    nextRequestAt = Math.max(nextRequestAt, Date.now()) + intervalMs;
    const waitMs = scheduledAt - Date.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  };
}

function activePlayerCount(rows: PlayerMatchPerformance[], teamExternalId: string): number {
  return rows.filter((row) => row.teamExternalId === teamExternalId && row.minutes > 0).length;
}

function storageRow(row: PlayerMatchPerformance, updatedAt: string) {
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
    updated_at: updatedAt
  };
}

function upsertSql(rows: PlayerMatchPerformance[], updatedAt: string): string {
  const payload = Buffer.from(JSON.stringify(rows.map((row) => storageRow(row, updatedAt))), "utf8").toString("base64");
  return `with payload as (\n  select convert_from(decode('${payload}', 'base64'), 'UTF8')::jsonb as rows\n)\ninsert into public.op_player_match_performances (\n  sport, provider, source_kind, fixture_external_id, fixture_kickoff_at, team_external_id, player_external_id,\n  player_name, position, shirt_number, minutes, started, captain, rating, goals, assists, shots_total,\n  shots_on_target, passes_total, key_passes, pass_accuracy, tackles, interceptions, saves, yellow_cards,\n  red_cards, data_quality, metrics, observed_at, updated_at\n)\nselect\n  r.sport, r.provider, r.source_kind, r.fixture_external_id, r.fixture_kickoff_at, r.team_external_id, r.player_external_id,\n  r.player_name, r.position, r.shirt_number, r.minutes, r.started, r.captain, r.rating, r.goals, r.assists, r.shots_total,\n  r.shots_on_target, r.passes_total, r.key_passes, r.pass_accuracy, r.tackles, r.interceptions, r.saves, r.yellow_cards,\n  r.red_cards, r.data_quality, r.metrics, r.observed_at, r.updated_at\nfrom payload\ncross join lateral jsonb_to_recordset(payload.rows) as r(\n  sport text, provider text, source_kind text, fixture_external_id text, fixture_kickoff_at timestamptz,\n  team_external_id text, player_external_id text, player_name text, position text, shirt_number smallint, minutes smallint,\n  started boolean, captain boolean, rating numeric, goals smallint, assists smallint, shots_total smallint,\n  shots_on_target smallint, passes_total smallint, key_passes smallint, pass_accuracy numeric, tackles smallint,\n  interceptions smallint, saves smallint, yellow_cards smallint, red_cards smallint, data_quality numeric, metrics jsonb,\n  observed_at timestamptz, updated_at timestamptz\n)\non conflict (provider, fixture_external_id, team_external_id, player_external_id) do update set\n  fixture_kickoff_at = excluded.fixture_kickoff_at, player_name = excluded.player_name, position = excluded.position,\n  shirt_number = excluded.shirt_number, minutes = excluded.minutes, started = excluded.started, captain = excluded.captain,\n  rating = excluded.rating, goals = excluded.goals, assists = excluded.assists, shots_total = excluded.shots_total,\n  shots_on_target = excluded.shots_on_target, passes_total = excluded.passes_total, key_passes = excluded.key_passes,\n  pass_accuracy = excluded.pass_accuracy, tackles = excluded.tackles, interceptions = excluded.interceptions,\n  saves = excluded.saves, yellow_cards = excluded.yellow_cards, red_cards = excluded.red_cards,\n  data_quality = excluded.data_quality, metrics = excluded.metrics, observed_at = excluded.observed_at,\n  updated_at = excluded.updated_at;\n`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  await loadLocalEnv();
  const key = apiKey();
  const league = cliValue("league", "39")!;
  const team = cliValue("team");
  if (team && !/^\d+$/.test(team)) throw new Error("--team must be a numeric API-Football team ID.");
  const season = cliValue("season", "2025")!;
  const from = requireDate("from");
  const to = requireDate("to");
  if (Date.parse(`${from}T00:00:00Z`) > Date.parse(`${to}T00:00:00Z`)) throw new Error("--from must not be after --to.");
  const maxFixtures = integerOption("max-fixtures", 40, 1, MAX_FIXTURES);
  const chunkSize = integerOption("chunk-size", 250, 50, 500);
  const concurrency = integerOption("concurrency", 5, 1, 10);
  const requestsPerMinute = integerOption("requests-per-minute", 180, 30, 240);
  const retryManifestPath = cliValue("retry-manifest");
  const generatedAt = new Date().toISOString();
  const defaultOutput = path.join("output", "player-history", `${generatedAt.replace(/[:.]/g, "-")}-${from}-${to}`);
  const outputDir = path.resolve(cliValue("output", defaultOutput)!);

  const quotaBefore = await quotaSnapshot(key);
  if (!quotaBefore.active) throw new Error("API-Football subscription is not active.");
  if (quotaBefore.current !== null && quotaBefore.limitDay !== null && quotaBefore.limitDay - quotaBefore.current < maxFixtures + 5) {
    throw new Error(`API-Football quota headroom is below the bounded request budget (${maxFixtures + 5}).`);
  }

  const fixtureEndpoint = new URL(`${API_ROOT}/fixtures`);
  fixtureEndpoint.searchParams.set("league", league);
  if (team) fixtureEndpoint.searchParams.set("team", team);
  fixtureEndpoint.searchParams.set("season", season);
  fixtureEndpoint.searchParams.set("from", from);
  fixtureEndpoint.searchParams.set("to", to);
  fixtureEndpoint.searchParams.set("timezone", "UTC");
  const fixturePayload = await fetchProviderJson(fixtureEndpoint, key);
  let fixtures = normalizeApiFootballFixtures(
    fixturePayload as Parameters<typeof normalizeApiFootballFixtures>[0],
    { limit: maxFixtures + 1 }
  ).filter((fixture) => fixture.status === "finished");
  let retryFixtureIds: Set<string> | null = null;
  if (retryManifestPath) {
    const retryManifest = JSON.parse(await readFile(path.resolve(retryManifestPath), "utf8")) as {
      incomplete?: Array<{ fixtureExternalId?: unknown }>;
    };
    retryFixtureIds = new Set((retryManifest.incomplete ?? [])
      .map((fixture) => typeof fixture.fixtureExternalId === "string" ? fixture.fixtureExternalId : "")
      .filter(Boolean));
    if (!retryFixtureIds.size) throw new Error("--retry-manifest did not contain any incomplete fixture IDs.");
    fixtures = fixtures.filter((fixture) => retryFixtureIds?.has(fixture.externalId));
    if (fixtures.length !== retryFixtureIds.size) {
      throw new Error(`Retry manifest requested ${retryFixtureIds.size} fixture(s), but the provider window returned ${fixtures.length}.`);
    }
  }
  if (fixtures.length > maxFixtures) throw new Error(`Provider returned more than --max-fixtures=${maxFixtures}; narrow the date window or raise the explicit cap.`);
  if (!fixtures.length) throw new Error("No finished fixtures were returned for the requested window.");

  const pacePlayerRequest = requestPacer(requestsPerMinute);
  const prepared = await mapConcurrent(fixtures, concurrency, async (fixture): Promise<FixturePreparation> => {
    try {
      const fixtureId = fixture.externalId.replace("api-football:", "");
      const endpoint = new URL(`${API_ROOT}/fixtures/players`);
      endpoint.searchParams.set("fixture", fixtureId);
      await pacePlayerRequest();
      const payload = await fetchProviderJson(endpoint, key);
      const rows = normalizeApiFootballPlayerPerformancesForFixture(
        payload as Parameters<typeof normalizeApiFootballPlayerPerformancesForFixture>[0],
        fixture,
        { observedAt: generatedAt }
      );
      const homeActivePlayers = activePlayerCount(rows, fixture.homeTeam.externalId);
      const awayActivePlayers = activePlayerCount(rows, fixture.awayTeam.externalId);
      const complete = homeActivePlayers >= MINIMUM_ACTIVE_PLAYERS_PER_TEAM && awayActivePlayers >= MINIMUM_ACTIVE_PLAYERS_PER_TEAM;
      return {
        fixtureExternalId: fixture.externalId,
        kickoffAt: fixture.kickoffAt,
        homeTeam: fixture.homeTeam.name,
        awayTeam: fixture.awayTeam.name,
        homeActivePlayers,
        awayActivePlayers,
        rows: complete ? rows : [],
        error: complete ? null : `Active-player coverage ${homeActivePlayers}-${awayActivePlayers}; ${MINIMUM_ACTIVE_PLAYERS_PER_TEAM} per team required.`
      };
    } catch (error) {
      return {
        fixtureExternalId: fixture.externalId,
        kickoffAt: fixture.kickoffAt,
        homeTeam: fixture.homeTeam.name,
        awayTeam: fixture.awayTeam.name,
        homeActivePlayers: 0,
        awayActivePlayers: 0,
        rows: [],
        error: error instanceof Error ? error.message : "Player history request failed."
      };
    }
  });

  const complete = prepared.filter((fixture) => fixture.error === null);
  const incomplete = prepared.filter((fixture) => fixture.error !== null);
  const rows = complete.flatMap((fixture) => fixture.rows);
  await mkdir(outputDir, { recursive: true });
  const chunks: Array<{ file: string; rows: number; sha256: string }> = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const sql = upsertSql(chunk, generatedAt);
    const file = `player-performance-${String(chunks.length + 1).padStart(3, "0")}.sql`;
    await writeFile(path.join(outputDir, file), sql, "utf8");
    chunks.push({ file, rows: chunk.length, sha256: sha256(sql) });
  }
  const quotaAfter = await quotaSnapshot(key);
  const manifest = {
    mode: "oddspadi-player-history-preparation",
    generatedAt,
    provider: "api-football",
    providerSecretIncluded: false,
    request: {
      league,
      team: team ?? null,
      season,
      from,
      to,
      maxFixtures,
      chunkSize,
      concurrency,
      requestsPerMinute,
      retryManifest: retryManifestPath ? path.resolve(retryManifestPath) : null,
      retryFixtureCount: retryFixtureIds?.size ?? 0
    },
    quotaBefore,
    quotaAfter,
    fixturesFetched: fixtures.length,
    fixturesComplete: complete.length,
    fixturesIncomplete: incomplete.length,
    rowsPrepared: rows.length,
    minimumActivePlayersPerTeam: MINIMUM_ACTIVE_PLAYERS_PER_TEAM,
    firstKickoff: complete[0]?.kickoffAt ?? null,
    lastKickoff: complete.at(-1)?.kickoffAt ?? null,
    incomplete: incomplete.map(({ rows: _rows, ...fixture }) => fixture),
    chunks
  };
  await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ outputDir, ...manifest }, null, 2)}\n`);
  if (incomplete.length) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Player history preparation failed."}\n`);
  process.exitCode = 1;
});
