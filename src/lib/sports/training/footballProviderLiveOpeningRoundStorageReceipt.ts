import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import { EPL_2026_FIXTURE_SOURCE_URL, EPL_2026_OPENING_WINDOW } from "@/lib/sports/prediction/decisionEpl2026Fixtures";
import { buildFootballProviderLiveFeatureMaterializer } from "@/lib/sports/training/footballProviderLiveFeatureMaterializer";
import {
  observeFootballProviderLiveFeatureStorageReceipt,
  type FootballProviderLiveFeatureSnapshotInsertRow,
  type FootballProviderLiveFeatureStorageReceipt,
  type FootballProviderLiveFeatureStorageReadbackRow
} from "@/lib/sports/training/footballProviderLiveFeatureStorageReceipt";
import { FOOTBALL_PROVIDER_RETEST_MODEL_KEY } from "@/lib/sports/training/footballDataProviderRetestBridge";
import { getFootballProviderLiveRuntimeSnapshot, type FootballProviderLiveRuntimeSnapshot } from "@/lib/sports/training/footballProviderLiveRuntime";

type EnvLike = Record<string, string | undefined>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const FEATURE_SNAPSHOT_TABLE = "op_training_feature_snapshots";

export type FootballProviderLiveOpeningRoundStorageStatus =
  | "readback-ready"
  | "stored"
  | "partial-readback"
  | "ready-to-store"
  | "waiting-provider-proof"
  | "waiting-supabase"
  | "waiting-admin"
  | "waiting-window-rows"
  | "failed";

export type FootballProviderLiveOpeningRoundCompactFixture = {
  date: string | null;
  fixtureExternalId: string;
  matchLabel: string;
  home: string | null;
  away: string | null;
  league: string | null;
  kickoffTime: string | null;
  source: string;
  fixtureProvider: string | null;
  oddsProvider: string | null;
  featureHash: string | null;
  stored: boolean;
  rawPayloadLinked: boolean;
  settlementStatus: string | null;
};

export type FootballProviderLiveOpeningRoundStorageReceipt = {
  mode: "football-provider-live-opening-round-storage-receipt";
  generatedAt: string;
  status: FootballProviderLiveOpeningRoundStorageStatus;
  receiptHash: string;
  summary: string;
  request: {
    runRequested: boolean;
    adminAuthorized: boolean;
    adminTokenConfigured: boolean;
    dryRun: boolean;
    dateWindow: string[];
    filters: {
      league: string | null;
      country: string | null;
      query: string | null;
    };
  };
  target: {
    table: typeof FEATURE_SNAPSHOT_TABLE;
    modelKey: typeof FOOTBALL_PROVIDER_RETEST_MODEL_KEY;
    split: "live";
    expectedFixtures: number;
    matchedExpectedFixtures: number;
    fixtureSourceUrl: typeof EPL_2026_FIXTURE_SOURCE_URL;
  };
  totals: {
    datesRequested: number;
    datesWithProviderRows: number;
    datesReadbackReady: number;
    failedDates: number;
    fixturesFetched: number;
    rowsPreviewed: number;
    providerBackedRows: number;
    pendingRows: number;
    rejectedFixtures: number;
    rowsInserted: number;
    readbackRows: number;
    readbackReadyRows: number;
  };
  days: Array<{
    date: string;
    status: FootballProviderLiveFeatureStorageReceipt["status"] | "runtime-failed";
    source: FootballProviderLiveRuntimeSnapshot["source"] | "unavailable";
    provider: string;
    fixturesFetched: number;
    rowsPreviewed: number;
    providerBackedRows: number;
    pendingRows: number;
    rejectedFixtures: number;
    rowsInserted: number;
    readbackRows: number;
    readbackEvidenceReady: boolean;
    proofMissing: string[];
    error: string | null;
  }>;
  fixtures: FootballProviderLiveOpeningRoundCompactFixture[];
  storage: {
    inserted: boolean;
    rowsInserted: number;
    insertedIds: string[];
    errors: string[];
  };
  readback: {
    checkedDates: number;
    evidenceReady: boolean;
    matchedRows: number;
    rows: FootballProviderLiveFeatureStorageReadbackRow[];
    errors: string[];
  };
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canPrepareOpeningRoundFeatureRows: boolean;
    canUseStoredMonitorEvidence: boolean;
    canUseFullOpeningRoundMonitorEvidence: boolean;
    canWriteLiveFeatureSnapshots: boolean;
    canFeedProviderRetestRunner: false;
    canTrainModels: false;
    canApplyThresholds: false;
    canPublishPicks: false;
    canStake: false;
  };
  locks: string[];
  proofUrls: string[];
};

export function epl2026OpeningRoundDates(): string[] {
  return Array.from(new Set(EPL_2026_OPENING_WINDOW.map((fixture) => fixture.date))).sort();
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function adminTokenConfigured(env: EnvLike): boolean {
  return Boolean(env.ODDSPADI_ADMIN_TOKEN?.trim());
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function textFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function boolFrom(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizedTeam(value: string | null): string {
  return (value ?? "").toLowerCase().replace(/\b(fc|cf|afc|sc|ac|city|united|town|and)\b/g, "").replace(/[^a-z0-9]+/g, "");
}

function queryString(params: Record<string, string | string[] | null | undefined>): string {
  return Object.entries(params)
    .flatMap(([key, value]) => {
      if (Array.isArray(value)) return value.map((item) => [key, item] as const);
      return typeof value === "string" && value.length > 0 ? ([[key, value]] as const) : [];
    })
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function compactFixtureFromPayload(row: FootballProviderLiveFeatureSnapshotInsertRow): FootballProviderLiveOpeningRoundCompactFixture {
  const features = record(row.features);
  const homeTeam = record(features.homeTeam);
  const awayTeam = record(features.awayTeam);
  const league = record(features.league);
  const evidence = record(features.evidence);
  const dataSource = record(features.dataSource);
  const targets = record(row.targets);
  const home = textFrom(homeTeam.name);
  const away = textFrom(awayTeam.name);
  const kickoffTime = textFrom(features.kickoffAt);
  return {
    date: kickoffTime?.slice(0, 10) ?? null,
    fixtureExternalId: row.fixture_external_id,
    matchLabel: `${home ?? "Home"} vs ${away ?? "Away"}`,
    home,
    away,
    league: textFrom(league.name),
    kickoffTime,
    source: row.source,
    fixtureProvider: textFrom(dataSource.fixtureProvider),
    oddsProvider: textFrom(dataSource.oddsProvider),
    featureHash: row.feature_hash,
    stored: false,
    rawPayloadLinked: boolFrom(evidence.rawPayloadLinked),
    settlementStatus: textFrom(targets.settlementStatus)
  };
}

function compactFixtureFromReadback(row: FootballProviderLiveFeatureStorageReadbackRow): FootballProviderLiveOpeningRoundCompactFixture {
  const [home = null, away = null] = row.matchLabel.split(" vs ");
  return {
    date: null,
    fixtureExternalId: row.fixtureExternalId,
    matchLabel: row.matchLabel,
    home,
    away,
    league: row.league,
    kickoffTime: null,
    source: row.source,
    fixtureProvider: row.fixtureProvider,
    oddsProvider: row.oddsProvider,
    featureHash: row.featureHash,
    stored: true,
    rawPayloadLinked: row.rawPayloadLinked,
    settlementStatus: row.settlementStatus
  };
}

function mergeFixtures(receipts: FootballProviderLiveFeatureStorageReceipt[]): FootballProviderLiveOpeningRoundCompactFixture[] {
  const byFixture = new Map<string, FootballProviderLiveOpeningRoundCompactFixture>();

  for (const receipt of receipts) {
    for (const row of receipt.payload.rows) {
      const compact = compactFixtureFromPayload(row);
      byFixture.set(`${compact.fixtureExternalId}:${compact.source}`, compact);
    }
    for (const row of receipt.readback.rows) {
      const compact = compactFixtureFromReadback(row);
      const key = `${compact.fixtureExternalId}:${compact.source}`;
      const preview = byFixture.get(key);
      byFixture.set(key, {
        ...compact,
        ...(preview ?? {}),
        stored: true,
        rawPayloadLinked: compact.rawPayloadLinked,
        settlementStatus: compact.settlementStatus,
        fixtureProvider: compact.fixtureProvider ?? preview?.fixtureProvider ?? null,
        oddsProvider: compact.oddsProvider ?? preview?.oddsProvider ?? null,
        featureHash: compact.featureHash ?? preview?.featureHash ?? null
      });
    }
  }

  return Array.from(byFixture.values()).sort((a, b) => `${a.date ?? ""}${a.matchLabel}`.localeCompare(`${b.date ?? ""}${b.matchLabel}`));
}

function expectedFixturesForDates(dates: string[]) {
  const dateSet = new Set(dates);
  return EPL_2026_OPENING_WINDOW.filter((fixture) => dateSet.has(fixture.date));
}

function countMatchedExpectedFixtures(fixtures: FootballProviderLiveOpeningRoundCompactFixture[], dates: string[]): number {
  const observed = new Set(
    fixtures
      .filter((fixture) => !fixture.date || dates.includes(fixture.date))
      .map((fixture) => `${fixture.date ?? ""}:${normalizedTeam(fixture.home)}:${normalizedTeam(fixture.away)}`)
  );
  return expectedFixturesForDates(dates).filter((fixture) => observed.has(`${fixture.date}:${normalizedTeam(fixture.home)}:${normalizedTeam(fixture.away)}`)).length;
}

function statusFor({
  runRequested,
  adminAuthorized,
  rowsPreviewed,
  providerBackedRows,
  pendingRows,
  serverWriteReady,
  rowsInserted,
  readbackRows,
  readbackReadyRows,
  failedDates
}: {
  runRequested: boolean;
  adminAuthorized: boolean;
  rowsPreviewed: number;
  providerBackedRows: number;
  pendingRows: number;
  serverWriteReady: boolean;
  rowsInserted: number;
  readbackRows: number;
  readbackReadyRows: number;
  failedDates: number;
}): FootballProviderLiveOpeningRoundStorageStatus {
  if (failedDates > 0) return "failed";
  if (runRequested && !adminAuthorized) return "waiting-admin";
  if (rowsPreviewed === 0) return "waiting-window-rows";
  if (pendingRows === 0 || providerBackedRows < pendingRows) return "waiting-provider-proof";
  if (!serverWriteReady) return "waiting-supabase";
  if (readbackReadyRows >= rowsPreviewed) return rowsInserted > 0 ? "stored" : "readback-ready";
  if (readbackRows > 0) return "partial-readback";
  return "ready-to-store";
}

function summaryFor(status: FootballProviderLiveOpeningRoundStorageStatus, rows: number, readbackRows: number, expected: number, matched: number): string {
  if (status === "stored") return `Stored or updated ${rows} opening-round EPL live feature row(s) and read them back as monitor evidence; training and public picks remain locked.`;
  if (status === "readback-ready") return `${readbackRows} opening-round EPL live feature row(s) are already stored and read back for monitor evidence; ${matched}/${expected} scheduled fixtures are provider-matched.`;
  if (status === "partial-readback") return `${readbackRows}/${rows} opening-round EPL live row(s) have storage readback; finish storing the remaining provider-backed rows before full-slate monitoring.`;
  if (status === "ready-to-store") return `${rows} provider-backed opening-round EPL live feature row(s) are ready to store; admin write lock is still required.`;
  if (status === "waiting-provider-proof") return "Opening-round rows are not storage-ready until every pending live row has provider raw payload proof.";
  if (status === "waiting-supabase") return "Opening-round provider rows exist, but OddsPadi Supabase server-write readiness is missing.";
  if (status === "waiting-admin") return "Opening-round provider rows are prepared, but storage writes require x-oddspadi-admin-token.";
  if (status === "failed") return "Opening-round provider storage receipt failed for at least one date.";
  return "Opening-round provider storage is waiting for provider-backed rows in the requested date window.";
}

function nextLabel(status: FootballProviderLiveOpeningRoundStorageStatus): string {
  if (status === "stored" || status === "readback-ready") return "Use stored opening-round monitor evidence";
  if (status === "partial-readback") return "Store the remaining opening-round rows";
  if (status === "ready-to-store") return "Store opening-round live feature snapshots";
  if (status === "waiting-admin") return "Retry with admin token";
  if (status === "waiting-supabase") return "Fix Supabase server-write readiness";
  return "Collect provider-backed opening-round proof";
}

export async function buildFootballProviderLiveOpeningRoundStorageReceipt({
  dates = epl2026OpeningRoundDates(),
  runRequested = false,
  adminAuthorized = false,
  filters = { league: "Premier League", country: "England", query: null },
  env = process.env,
  origin,
  now = new Date(),
  fetchImpl
}: {
  dates?: string[];
  runRequested?: boolean;
  adminAuthorized?: boolean;
  filters?: {
    league?: string | null;
    country?: string | null;
    query?: string | null;
  };
  env?: EnvLike;
  origin: string;
  now?: Date;
  fetchImpl?: FetchLike;
}): Promise<FootballProviderLiveOpeningRoundStorageReceipt> {
  const generatedAt = now.toISOString();
  const dateWindow = Array.from(new Set(dates)).sort();
  const receipts: FootballProviderLiveFeatureStorageReceipt[] = [];
  const days: FootballProviderLiveOpeningRoundStorageReceipt["days"] = [];

  for (const date of dateWindow) {
    try {
      const runtime = await getFootballProviderLiveRuntimeSnapshot({
        targetDate: date,
        league: filters.league,
        country: filters.country,
        query: filters.query,
        env,
        fetchImpl
      });
      const materializer = buildFootballProviderLiveFeatureMaterializer({
        provider: runtime.providerLabel,
        matches: runtime.matches,
        targetDate: runtime.targetDate,
        now
      });
      const receipt = await observeFootballProviderLiveFeatureStorageReceipt({
        materializer,
        runRequested,
        adminAuthorized,
        filters,
        env,
        origin,
        now
      });
      receipts.push(receipt);
      days.push({
        date,
        status: receipt.status,
        source: runtime.source,
        provider: runtime.providerLabel,
        fixturesFetched: runtime.matches.length,
        rowsPreviewed: receipt.materializer.rowsPreviewed,
        providerBackedRows: receipt.materializer.providerBackedRows,
        pendingRows: receipt.materializer.pendingRows,
        rejectedFixtures: receipt.materializer.rejectedFixtures,
        rowsInserted: receipt.storage.rowsInserted,
        readbackRows: receipt.readback.matchedRows,
        readbackEvidenceReady: receipt.readback.evidenceReady,
        proofMissing: runtime.proof.missing,
        error: receipt.storage.error ?? receipt.readback.error
      });
    } catch (error) {
      days.push({
        date,
        status: "runtime-failed",
        source: "unavailable",
        provider: "unavailable",
        fixturesFetched: 0,
        rowsPreviewed: 0,
        providerBackedRows: 0,
        pendingRows: 0,
        rejectedFixtures: 0,
        rowsInserted: 0,
        readbackRows: 0,
        readbackEvidenceReady: false,
        proofMissing: ["provider runtime failed"],
        error: error instanceof Error ? error.message : "Opening-round provider runtime failed."
      });
    }
  }

  const fixtures = mergeFixtures(receipts);
  const expectedFixtures = expectedFixturesForDates(dateWindow).length;
  const matchedExpectedFixtures = countMatchedExpectedFixtures(fixtures, dateWindow);
  const totals = {
    datesRequested: dateWindow.length,
    datesWithProviderRows: days.filter((day) => day.providerBackedRows > 0).length,
    datesReadbackReady: days.filter((day) => day.readbackEvidenceReady).length,
    failedDates: days.filter((day) => day.status === "failed" || day.status === "runtime-failed").length,
    fixturesFetched: days.reduce((sum, day) => sum + day.fixturesFetched, 0),
    rowsPreviewed: days.reduce((sum, day) => sum + day.rowsPreviewed, 0),
    providerBackedRows: days.reduce((sum, day) => sum + day.providerBackedRows, 0),
    pendingRows: days.reduce((sum, day) => sum + day.pendingRows, 0),
    rejectedFixtures: days.reduce((sum, day) => sum + day.rejectedFixtures, 0),
    rowsInserted: days.reduce((sum, day) => sum + day.rowsInserted, 0),
    readbackRows: days.reduce((sum, day) => sum + day.readbackRows, 0),
    readbackReadyRows: receipts.filter((receipt) => receipt.readback.evidenceReady).reduce((sum, receipt) => sum + receipt.readback.matchedRows, 0)
  };
  const serverWriteReady = receipts.length > 0 && receipts.every((receipt) => receipt.target.serverWriteReady);
  const status = statusFor({
    runRequested,
    adminAuthorized,
    rowsPreviewed: totals.rowsPreviewed,
    providerBackedRows: totals.providerBackedRows,
    pendingRows: totals.pendingRows,
    serverWriteReady,
    rowsInserted: totals.rowsInserted,
    readbackRows: totals.readbackRows,
    readbackReadyRows: totals.readbackReadyRows,
    failedDates: totals.failedDates
  });
  const readbackRows = receipts.flatMap((receipt) => receipt.readback.rows);
  const storageErrors = receipts.flatMap((receipt) => (receipt.storage.error ? [receipt.storage.error] : []));
  const readbackErrors = receipts.flatMap((receipt) => (receipt.readback.error ? [receipt.readback.error] : []));
  const insertedIds = Array.from(new Set(receipts.flatMap((receipt) => receipt.storage.insertedIds)));
  const verifyQuery = queryString({
    dates: dateWindow.join(","),
    dryRun: "1",
    league: filters.league,
    country: filters.country,
    query: filters.query
  });
  const writeQuery = queryString({
    dates: dateWindow.join(","),
    dryRun: "0",
    run: "1",
    league: filters.league,
    country: filters.country,
    query: filters.query
  });
  const verifyUrl = `/api/sports/decision/training/football-provider-live-opening-round-storage?${verifyQuery}`;
  const writeUrl = `/api/sports/decision/training/football-provider-live-opening-round-storage?${writeQuery}`;
  const command = `${decisionCurlCommand(`${origin}${writeUrl}`)} -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`;
  const fullOpeningRoundReady = totals.readbackReadyRows >= totals.rowsPreviewed && matchedExpectedFixtures >= expectedFixtures && expectedFixtures > 0;
  const receiptHash = stableHash({
    status,
    dateWindow,
    filters,
    totals,
    fixtures: fixtures.map((fixture) => [fixture.fixtureExternalId, fixture.matchLabel, fixture.featureHash, fixture.stored]),
    matchedExpectedFixtures,
    storageErrors,
    readbackErrors
  });

  return {
    mode: "football-provider-live-opening-round-storage-receipt",
    generatedAt,
    status,
    receiptHash,
    summary: summaryFor(status, totals.rowsPreviewed, totals.readbackRows, expectedFixtures, matchedExpectedFixtures),
    request: {
      runRequested,
      adminAuthorized,
      adminTokenConfigured: adminTokenConfigured(env),
      dryRun: !runRequested,
      dateWindow,
      filters: {
        league: filters.league ?? null,
        country: filters.country ?? null,
        query: filters.query ?? null
      }
    },
    target: {
      table: FEATURE_SNAPSHOT_TABLE,
      modelKey: FOOTBALL_PROVIDER_RETEST_MODEL_KEY,
      split: "live",
      expectedFixtures,
      matchedExpectedFixtures,
      fixtureSourceUrl: EPL_2026_FIXTURE_SOURCE_URL
    },
    totals,
    days,
    fixtures,
    storage: {
      inserted: totals.rowsInserted > 0,
      rowsInserted: totals.rowsInserted,
      insertedIds,
      errors: storageErrors
    },
    readback: {
      checkedDates: receipts.filter((receipt) => receipt.readback.checked).length,
      evidenceReady: totals.readbackReadyRows >= totals.rowsPreviewed && totals.rowsPreviewed > 0,
      matchedRows: totals.readbackRows,
      rows: readbackRows,
      errors: readbackErrors
    },
    nextAction: {
      label: nextLabel(status),
      command,
      verifyUrl,
      expectedEvidence:
        "Every opening-round row has split=live, label=null, pending settlement targets, provider raw payload links, storage readback, and no training/publish/stake unlocks."
    },
    controls: {
      canInspectReadOnly: true,
      canPrepareOpeningRoundFeatureRows: totals.rowsPreviewed > 0,
      canUseStoredMonitorEvidence: totals.readbackRows > 0,
      canUseFullOpeningRoundMonitorEvidence: fullOpeningRoundReady,
      canWriteLiveFeatureSnapshots: Boolean(runRequested && adminAuthorized && serverWriteReady && totals.rowsPreviewed > 0 && totals.providerBackedRows >= totals.pendingRows),
      canFeedProviderRetestRunner: false,
      canTrainModels: false,
      canApplyThresholds: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Opening-round live rows are monitor evidence only until fixtures settle and labels exist.",
      "Storage writes require dryRun=0, run=1, x-oddspadi-admin-token, provider raw payload links, and OddsPadi Supabase service-role readiness.",
      "Provider-backed rows may support AI monitoring, but learned weights, public picks, and staking remain locked.",
      "The 2026 EPL opening window is treated as future-fixture evidence; incomplete provider coverage must be shown as partial, not filled with mock rows."
    ],
    proofUrls: [
      "/api/sports/decision/training/football-provider-live-opening-round-storage",
      "/api/sports/decision/training/football-provider-live-feature-storage-receipt",
      "/api/sports/decision/training/football-provider-live-decision-cycle",
      "/api/sports/decision/epl-fixture-intake",
      "/api/sports/decision/supabase-proof-binder"
    ]
  };
}
