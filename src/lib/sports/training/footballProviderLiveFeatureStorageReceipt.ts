import { getSupabaseRuntimeStatus, getSupabaseServerClient, ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import { FOOTBALL_PROVIDER_RETEST_MODEL_KEY, type FootballDataProviderRetestFeatureRow } from "@/lib/sports/training/footballDataProviderRetestBridge";
import type { FootballProviderLiveFeatureMaterializerReceipt } from "@/lib/sports/training/footballProviderLiveFeatureMaterializer";
import type { SupabaseClient } from "@supabase/supabase-js";

type EnvLike = Record<string, string | undefined>;
const FEATURE_SNAPSHOT_UPSERT_CONFLICT_TARGET = "sport,fixture_external_id,model_key,split,source";
const FEATURE_SNAPSHOT_TABLE = "op_training_feature_snapshots";

export type FootballProviderLiveFeatureStorageStatus =
  | "preview-ready"
  | "stored"
  | "waiting-provider-proof"
  | "waiting-admin"
  | "waiting-supabase"
  | "waiting-live-preview"
  | "failed";

export type FootballProviderLiveFeatureSnapshotInsertRow = Pick<
  FootballDataProviderRetestFeatureRow,
  "sport" | "fixture_external_id" | "model_key" | "generated_at" | "label" | "features" | "targets" | "split" | "source" | "feature_hash" | "created_at"
>;

export type FootballProviderLiveFeatureStorageReadbackRow = {
  id: string;
  fixtureExternalId: string;
  modelKey: string;
  split: "live";
  source: string;
  label: string | null;
  featureHash: string | null;
  settlementStatus: string | null;
  rawPayloadLinked: boolean;
  fixtureProvider: string | null;
  oddsProvider: string | null;
  matchLabel: string;
  league: string | null;
  generatedAt: string | null;
  createdAt: string | null;
};

export type FootballProviderLiveFeatureStorageReceipt = {
  mode: "football-provider-live-feature-storage-receipt";
  generatedAt: string;
  status: FootballProviderLiveFeatureStorageStatus;
  receiptHash: string;
  summary: string;
  request: {
    runRequested: boolean;
    adminAuthorized: boolean;
    adminTokenConfigured: boolean;
    dryRun: boolean;
    filters: {
      league: string | null;
      country: string | null;
      query: string | null;
    };
  };
  target: {
    projectRef: string;
    table: "op_training_feature_snapshots";
    expectedProjectRef: string;
    modelKey: typeof FOOTBALL_PROVIDER_RETEST_MODEL_KEY;
    split: "live";
    upsertConflictTarget: typeof FEATURE_SNAPSHOT_UPSERT_CONFLICT_TARGET;
    serverWriteReady: boolean;
    serverReadbackReady: boolean;
    targetMatchesExpected: boolean;
  };
  materializer: {
    status: FootballProviderLiveFeatureMaterializerReceipt["status"];
    materializerHash: string;
    provider: string;
    rowsPreviewed: number;
    rejectedFixtures: number;
    providerBackedRows: number;
    pendingRows: number;
  };
  payload: {
    table: "op_training_feature_snapshots";
    rows: FootballProviderLiveFeatureSnapshotInsertRow[];
    sourceMaterializerHash: string;
  };
  storage: {
    inserted: boolean;
    rowsInserted: number;
    insertedIds: string[];
    error: string | null;
  };
  readback: {
    checked: boolean;
    evidenceReady: boolean;
    matchedRows: number;
    rows: FootballProviderLiveFeatureStorageReadbackRow[];
    error: string | null;
  };
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canPrepareLiveFeatureRows: boolean;
    canUseStoredMonitorEvidence: boolean;
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

function boolFrom(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function textFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isProviderBackedLiveRow(row: FootballDataProviderRetestFeatureRow): boolean {
  if (row.split !== "live") return false;
  if (row.label !== null) return false;
  const features = record(row.features);
  const evidence = record(features.evidence);
  const dataSource = record(features.dataSource);
  return dataSource.kind === "provider" && boolFrom(evidence.rawPayloadLinked);
}

function isPendingLiveRow(row: FootballDataProviderRetestFeatureRow): boolean {
  const targets = record(row.targets);
  return row.split === "live" && row.label === null && targets.settlementStatus === "pending";
}

function payloadRowsFromMaterializer(materializer: FootballProviderLiveFeatureMaterializerReceipt): FootballProviderLiveFeatureSnapshotInsertRow[] {
  return materializer.previewRows.filter(isPendingLiveRow).map((row) => ({
    sport: row.sport,
    fixture_external_id: row.fixture_external_id,
    model_key: row.model_key,
    generated_at: row.generated_at,
    label: row.label,
    features: row.features,
    targets: row.targets,
    split: row.split,
    source: row.source,
    feature_hash: row.feature_hash,
    created_at: row.created_at
  }));
}

function idsFromSelectData(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    const id = record(item).id;
    return typeof id === "string" ? [id] : [];
  });
}

function idFromSingleData(data: unknown): string | null {
  const id = record(data).id;
  return typeof id === "string" ? id : null;
}

function errorMessage(error: unknown): string | null {
  const message = record(error).message;
  return typeof message === "string" && message.trim() ? message : null;
}

function isConflictConstraintError(message: string | null): boolean {
  return Boolean(message?.toLowerCase().includes("no unique or exclusion constraint matching the on conflict specification"));
}

async function findExistingLiveFeatureSnapshotId(client: SupabaseClient, row: FootballProviderLiveFeatureSnapshotInsertRow): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await client
    .from(FEATURE_SNAPSHOT_TABLE)
    .select("id")
    .eq("sport", row.sport)
    .eq("fixture_external_id", row.fixture_external_id)
    .eq("model_key", row.model_key)
    .eq("split", row.split)
    .eq("source", row.source)
    .limit(1);

  const message = errorMessage(error);
  if (message) return { id: null, error: message };
  return { id: idsFromSelectData(data)[0] ?? null, error: null };
}

async function writeLiveFeatureRowsWithoutRestConflict(
  client: SupabaseClient,
  rows: FootballProviderLiveFeatureSnapshotInsertRow[]
): Promise<{ insertedIds: string[]; rowsInserted: number; error: string | null }> {
  const insertedIds: string[] = [];

  for (const row of rows) {
    const existing = await findExistingLiveFeatureSnapshotId(client, row);
    if (existing.error) return { insertedIds, rowsInserted: insertedIds.length, error: existing.error };

    if (existing.id) {
      const { data, error } = await client.from(FEATURE_SNAPSHOT_TABLE).update(row).eq("id", existing.id).select("id").single();
      const message = errorMessage(error);
      if (message) return { insertedIds, rowsInserted: insertedIds.length, error: message };
      insertedIds.push(idFromSingleData(data) ?? existing.id);
      continue;
    }

    const { data, error } = await client.from(FEATURE_SNAPSHOT_TABLE).insert(row).select("id").single();
    const message = errorMessage(error);
    if (message) return { insertedIds, rowsInserted: insertedIds.length, error: message };
    const insertedId = idFromSingleData(data);
    if (insertedId) insertedIds.push(insertedId);
  }

  return { insertedIds, rowsInserted: insertedIds.length || rows.length, error: null };
}

async function writeLiveFeatureRows(
  client: SupabaseClient,
  rows: FootballProviderLiveFeatureSnapshotInsertRow[]
): Promise<{ insertedIds: string[]; rowsInserted: number; error: string | null }> {
  const { data, error } = await client
    .from(FEATURE_SNAPSHOT_TABLE)
    .upsert(rows, { onConflict: FEATURE_SNAPSHOT_UPSERT_CONFLICT_TARGET })
    .select("id");
  const message = errorMessage(error);
  if (!message) {
    const insertedIds = idsFromSelectData(data);
    return { insertedIds, rowsInserted: insertedIds.length || rows.length, error: null };
  }

  if (!isConflictConstraintError(message)) {
    return { insertedIds: [], rowsInserted: 0, error: message };
  }

  const fallback = await writeLiveFeatureRowsWithoutRestConflict(client, rows);
  if (fallback.error) {
    return { ...fallback, error: `${message}; fallback failed: ${fallback.error}` };
  }
  return fallback;
}

function readbackRowFromData(value: unknown): FootballProviderLiveFeatureStorageReadbackRow | null {
  const row = record(value);
  const id = textFrom(row.id);
  const fixtureExternalId = textFrom(row.fixture_external_id);
  const modelKey = textFrom(row.model_key);
  const split = textFrom(row.split);
  const source = textFrom(row.source);
  if (!id || !fixtureExternalId || !modelKey || split !== "live" || !source) return null;

  const features = record(row.features);
  const targets = record(row.targets);
  const homeTeam = record(features.homeTeam);
  const awayTeam = record(features.awayTeam);
  const league = record(features.league);
  const evidence = record(features.evidence);
  const dataSource = record(features.dataSource);
  const homeName = textFrom(homeTeam.name) ?? "Home";
  const awayName = textFrom(awayTeam.name) ?? "Away";

  return {
    id,
    fixtureExternalId,
    modelKey,
    split,
    source,
    label: textFrom(row.label),
    featureHash: textFrom(row.feature_hash),
    settlementStatus: textFrom(targets.settlementStatus),
    rawPayloadLinked: boolFrom(evidence.rawPayloadLinked),
    fixtureProvider: textFrom(dataSource.fixtureProvider),
    oddsProvider: textFrom(dataSource.oddsProvider),
    matchLabel: `${homeName} vs ${awayName}`,
    league: textFrom(league.name),
    generatedAt: textFrom(row.generated_at),
    createdAt: textFrom(row.created_at)
  };
}

function readbackEvidenceReady(rows: FootballProviderLiveFeatureStorageReadbackRow[], expectedRows: number): boolean {
  return (
    expectedRows > 0 &&
    rows.length >= expectedRows &&
    rows.every((row) => row.split === "live" && row.label === null && row.settlementStatus === "pending" && row.rawPayloadLinked)
  );
}

async function readLiveFeatureRows(
  client: SupabaseClient,
  rows: FootballProviderLiveFeatureSnapshotInsertRow[]
): Promise<{ rows: FootballProviderLiveFeatureStorageReadbackRow[]; error: string | null }> {
  const readRows: FootballProviderLiveFeatureStorageReadbackRow[] = [];

  for (const row of rows) {
    const { data, error } = await client
      .from(FEATURE_SNAPSHOT_TABLE)
      .select("id,sport,fixture_external_id,model_key,split,source,label,feature_hash,features,targets,generated_at,created_at")
      .eq("sport", row.sport)
      .eq("fixture_external_id", row.fixture_external_id)
      .eq("model_key", row.model_key)
      .eq("split", row.split)
      .eq("source", row.source)
      .limit(1);

    const message = errorMessage(error);
    if (message) return { rows: readRows, error: message };
    const parsed = Array.isArray(data) ? data.flatMap((item) => readbackRowFromData(item) ?? []) : [];
    readRows.push(...parsed);
  }

  const uniqueRows = Array.from(new Map(readRows.map((row) => [row.id, row])).values());
  return { rows: uniqueRows, error: null };
}

function queryString(params: Record<string, string | null | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function statusFor({
  runRequested,
  adminAuthorized,
  serverWriteReady,
  hasPayloadRows,
  providerProofReady,
  inserted,
  error
}: {
  runRequested: boolean;
  adminAuthorized: boolean;
  serverWriteReady: boolean;
  hasPayloadRows: boolean;
  providerProofReady: boolean;
  inserted: boolean;
  error: string | null;
}): FootballProviderLiveFeatureStorageStatus {
  if (error) return "failed";
  if (inserted) return "stored";
  if (!hasPayloadRows) return "waiting-live-preview";
  if (!providerProofReady) return "waiting-provider-proof";
  if (!serverWriteReady) return "waiting-supabase";
  if (runRequested && !adminAuthorized) return "waiting-admin";
  return "preview-ready";
}

function summaryFor(status: FootballProviderLiveFeatureStorageStatus, rows: number, storedEvidenceReady: boolean): string {
  if (status === "stored") return `Stored or updated ${rows} provider-backed live feature row(s) for monitor evidence; training and public picks remain locked.`;
  if (storedEvidenceReady) return `Provider-backed live feature row(s) were read back from storage as monitor evidence; training and public picks remain locked.`;
  if (status === "waiting-provider-proof") return "Live feature rows are prepared, but storage is blocked until every row links to provider raw payload proof.";
  if (status === "waiting-admin") return "Provider-backed live feature rows are prepared, but storage requires x-oddspadi-admin-token.";
  if (status === "waiting-supabase") return "Provider-backed live feature rows are prepared, but OddsPadi Supabase service-role write readiness is missing.";
  if (status === "waiting-live-preview") return "Live feature storage is waiting for split=live rows with pending settlement targets.";
  if (status === "failed") return "Live feature storage attempt failed.";
  return "Provider-backed live rows are ready to store as monitor evidence; dryRun=0, run=1, and admin authorization are required.";
}

export async function observeFootballProviderLiveFeatureStorageReceipt({
  materializer,
  runRequested = false,
  adminAuthorized = false,
  filters = { league: null, country: null, query: null },
  env = process.env,
  origin,
  now = new Date()
}: {
  materializer: FootballProviderLiveFeatureMaterializerReceipt;
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
}): Promise<FootballProviderLiveFeatureStorageReceipt> {
  const runtime = getSupabaseRuntimeStatus(env);
  const rows = payloadRowsFromMaterializer(materializer);
  const providerBackedRows = materializer.previewRows.filter(isProviderBackedLiveRow).length;
  const pendingRows = materializer.previewRows.filter(isPendingLiveRow).length;
  const providerProofReady = rows.length > 0 && rows.length === providerBackedRows;
  const serverReadbackReady = runtime.serverWriteReady && runtime.serverKeyProfile.serverSafe && runtime.serverKeyProfile.kind !== "unknown";
  let inserted = false;
  let rowsInserted = 0;
  let insertedIds: string[] = [];
  let error: string | null = null;
  let readbackChecked = false;
  let readbackRows: FootballProviderLiveFeatureStorageReadbackRow[] = [];
  let readbackError: string | null = null;

  if (runRequested && adminAuthorized && runtime.serverWriteReady && rows.length && providerProofReady) {
    const client = getSupabaseServerClient(env);
    if (!client) {
      error = "Supabase server client is not available for the configured OddsPadi project.";
    } else {
      const writeResult = await writeLiveFeatureRows(client, rows);
      if (writeResult.error) {
        error = writeResult.error;
      } else {
        inserted = true;
        insertedIds = writeResult.insertedIds;
        rowsInserted = writeResult.rowsInserted;
      }
    }
  }

  if (!error && serverReadbackReady && rows.length && providerProofReady) {
    const client = getSupabaseServerClient(env);
    readbackChecked = true;
    if (!client) {
      readbackError = "Supabase server client is not available for live feature readback.";
    } else {
      const readback = await readLiveFeatureRows(client, rows);
      readbackRows = readback.rows;
      readbackError = readback.error;
    }
  }

  const storedEvidenceReady = readbackEvidenceReady(readbackRows, rows.length);

  const status = statusFor({
    runRequested,
    adminAuthorized,
    serverWriteReady: runtime.serverWriteReady,
    hasPayloadRows: rows.length > 0,
    providerProofReady,
    inserted,
    error
  });
  const verifyQuery = queryString({
    date: materializer.request.targetDate,
    dryRun: "1",
    league: filters.league,
    country: filters.country,
    query: filters.query
  });
  const verifyUrl = `/api/sports/decision/training/football-provider-live-feature-storage-receipt?${verifyQuery}`;
  const writeQuery = queryString({
    date: materializer.request.targetDate,
    dryRun: "0",
    run: "1",
    league: filters.league,
    country: filters.country,
    query: filters.query
  });
  const writeUrl = `/api/sports/decision/training/football-provider-live-feature-storage-receipt?${writeQuery}`;
  const command = `${decisionCurlCommand(`${origin}${writeUrl}`)} -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`;
  const receiptHash = stableHash({
    status,
    materializer: [materializer.materializerHash, materializer.status, materializer.corpus.rowsPreviewed],
    target: [runtime.projectRef, runtime.urlProjectRef, runtime.serverWriteReady],
    rows: rows.map((row) => [row.fixture_external_id, row.model_key, row.feature_hash, row.split]),
    providerBackedRows,
    pendingRows,
    inserted,
    rowsInserted,
    readback: [readbackChecked, storedEvidenceReady, readbackRows.map((row) => [row.id, row.fixtureExternalId, row.featureHash])]
  });

  return {
    mode: "football-provider-live-feature-storage-receipt",
    generatedAt: now.toISOString(),
    status,
    receiptHash,
    summary: summaryFor(status, rows.length, storedEvidenceReady),
    request: {
      runRequested,
      adminAuthorized,
      adminTokenConfigured: adminTokenConfigured(env),
      dryRun: !runRequested,
      filters: {
        league: filters.league ?? null,
        country: filters.country ?? null,
        query: filters.query ?? null
      }
    },
    target: {
      projectRef: runtime.projectRef ?? runtime.urlProjectRef ?? "missing",
      table: FEATURE_SNAPSHOT_TABLE,
      expectedProjectRef: ODDSPADI_SUPABASE_PROJECT_REF,
      modelKey: FOOTBALL_PROVIDER_RETEST_MODEL_KEY,
      split: "live",
      upsertConflictTarget: FEATURE_SNAPSHOT_UPSERT_CONFLICT_TARGET,
      serverWriteReady: runtime.serverWriteReady,
      serverReadbackReady,
      targetMatchesExpected: runtime.targetMatchesExpected
    },
    materializer: {
      status: materializer.status,
      materializerHash: materializer.materializerHash,
      provider: materializer.provider,
      rowsPreviewed: materializer.corpus.rowsPreviewed,
      rejectedFixtures: materializer.corpus.rejectedFixtures,
      providerBackedRows,
      pendingRows
    },
    payload: {
      table: FEATURE_SNAPSHOT_TABLE,
      rows,
      sourceMaterializerHash: materializer.materializerHash
    },
    storage: {
      inserted,
      rowsInserted,
      insertedIds,
      error
    },
    readback: {
      checked: readbackChecked,
      evidenceReady: storedEvidenceReady,
      matchedRows: readbackRows.length,
      rows: readbackRows,
      error: readbackError
    },
    nextAction: {
      label: storedEvidenceReady ? "Use stored provider-backed monitor evidence" : providerProofReady ? "Store provider-backed live feature snapshots" : "Collect provider-backed live feature proof",
      command,
      verifyUrl,
      expectedEvidence:
        "Rows appear in op_training_feature_snapshots with split=live, label=null, pending settlement targets, provider raw payload links, and no training/publish/stake unlocks."
    },
    controls: {
      canInspectReadOnly: true,
      canPrepareLiveFeatureRows: rows.length > 0,
      canUseStoredMonitorEvidence: storedEvidenceReady,
      canWriteLiveFeatureSnapshots: Boolean(!error && rows.length && providerProofReady && runRequested && runtime.serverWriteReady && adminTokenConfigured(env) && adminAuthorized),
      canFeedProviderRetestRunner: false,
      canTrainModels: false,
      canApplyThresholds: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Live feature snapshots are monitor evidence only and cannot feed provider retest runner until settlement labels exist.",
      "Writes require provider raw payload links for every live row, dryRun=0, run=1, x-oddspadi-admin-token, correct OddsPadi Supabase ref, and service-role readiness.",
      "Mock, official-seed, or synthetic EPL rows cannot be stored as provider-backed live evidence.",
      "Public picks, staking, learned weights, and threshold application remain locked after live feature storage."
    ],
    proofUrls: [
      "/api/sports/decision/training/football-provider-live-feature-storage-receipt",
      "/api/sports/decision/training/football-provider-live-feature-materializer",
      "/api/sports/decision/training/football-provider-live-watchlist",
      "/api/sports/decision/training/football-provider-feature-intake-gap",
      "/api/sports/decision/supabase-proof-binder"
    ]
  };
}
