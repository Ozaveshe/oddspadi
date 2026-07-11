import { getSupabaseRuntimeStatus, getSupabaseServerClient, ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { FootballProviderFeatureMaterializerReceipt } from "@/lib/sports/training/footballDataProviderFeatureMaterializer";
import { FOOTBALL_PROVIDER_RETEST_MODEL_KEY, type FootballDataProviderRetestFeatureRow } from "@/lib/sports/training/footballDataProviderRetestBridge";

type EnvLike = Record<string, string | undefined>;
const FEATURE_SNAPSHOT_UPSERT_CONFLICT_TARGET = "sport,fixture_external_id,model_key,split,source";
const FEATURE_SNAPSHOT_WRITE_CHUNK_SIZE = 250;

export type FootballProviderFeatureStorageStatus =
  | "preview-ready"
  | "stored"
  | "waiting-admin"
  | "waiting-supabase"
  | "waiting-feature-preview"
  | "failed";

export type FootballProviderFeatureSnapshotInsertRow = Pick<
  FootballDataProviderRetestFeatureRow,
  "sport" | "fixture_external_id" | "model_key" | "generated_at" | "label" | "features" | "targets" | "split" | "source" | "feature_hash" | "created_at"
>;

export type FootballProviderFeatureStorageReceipt = {
  mode: "football-provider-feature-storage-receipt";
  generatedAt: string;
  status: FootballProviderFeatureStorageStatus;
  receiptHash: string;
  summary: string;
  request: {
    runRequested: boolean;
    adminAuthorized: boolean;
    adminTokenConfigured: boolean;
    dryRun: boolean;
  };
  target: {
    projectRef: string;
    table: "op_training_feature_snapshots";
    expectedProjectRef: string;
    modelKey: typeof FOOTBALL_PROVIDER_RETEST_MODEL_KEY;
    upsertConflictTarget: typeof FEATURE_SNAPSHOT_UPSERT_CONFLICT_TARGET;
    serverWriteReady: boolean;
    targetMatchesExpected: boolean;
  };
  materializer: {
    status: FootballProviderFeatureMaterializerReceipt["status"];
    materializerHash: string;
    provider: string;
    rowsPreviewed: number;
    rejectedFixtures: number;
    withChronologyFeatures: number;
    chronologyWarmupFixtures: number;
    withCrossSeasonHistory: number;
  };
  payload: {
    table: "op_training_feature_snapshots";
    rows: FootballProviderFeatureSnapshotInsertRow[];
    sourceMaterializerHash: string;
  };
  storage: {
    inserted: boolean;
    rowsInserted: number;
    insertedIds: string[];
    chunkSize: number;
    chunksAttempted: number;
    chunksCompleted: number;
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
    canPrepareFeatureRows: boolean;
    canWriteFeatureSnapshots: boolean;
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

function payloadRowsFromMaterializer(materializer: FootballProviderFeatureMaterializerReceipt): FootballProviderFeatureSnapshotInsertRow[] {
  return materializer.previewRows.map((row) => ({
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

function statusFor({
  runRequested,
  adminAuthorized,
  serverWriteReady,
  hasPayloadRows,
  inserted,
  error
}: {
  runRequested: boolean;
  adminAuthorized: boolean;
  serverWriteReady: boolean;
  hasPayloadRows: boolean;
  inserted: boolean;
  error: string | null;
}): FootballProviderFeatureStorageStatus {
  if (error) return "failed";
  if (inserted) return "stored";
  if (!hasPayloadRows) return "waiting-feature-preview";
  if (!serverWriteReady) return "waiting-supabase";
  if (runRequested && !adminAuthorized) return "waiting-admin";
  return "preview-ready";
}

function summaryFor(status: FootballProviderFeatureStorageStatus, rows: number): string {
  if (status === "stored") return `Stored or updated ${rows} provider-enriched feature row(s) for audit and future retesting; training and publishing remain locked.`;
  if (status === "waiting-admin") return "Provider feature rows are prepared, but storing them requires x-oddspadi-admin-token.";
  if (status === "waiting-supabase") return "Provider feature rows are prepared, but OddsPadi Supabase service-role write readiness is missing.";
  if (status === "waiting-feature-preview") return "Provider feature storage is waiting for materialized rows with complete odds and finished outcomes.";
  if (status === "failed") return "Provider feature storage attempt failed.";
  return "Provider feature rows are prepared for op_training_feature_snapshots; run=1 with admin authorization is required to store them.";
}

export async function observeFootballProviderFeatureStorageReceipt({
  materializer,
  runRequested = false,
  adminAuthorized = false,
  env = process.env,
  origin,
  now = new Date()
}: {
  materializer: FootballProviderFeatureMaterializerReceipt;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  env?: EnvLike;
  origin: string;
  now?: Date;
}): Promise<FootballProviderFeatureStorageReceipt> {
  const runtime = getSupabaseRuntimeStatus(env);
  const rows = payloadRowsFromMaterializer(materializer);
  let inserted = false;
  let rowsInserted = 0;
  let insertedIds: string[] = [];
  let chunksAttempted = 0;
  let chunksCompleted = 0;
  let error: string | null = null;

  if (runRequested && adminAuthorized && runtime.serverWriteReady && rows.length) {
    const client = getSupabaseServerClient(env);
    if (!client) {
      error = "Supabase server client is not available for the configured OddsPadi project.";
    } else {
      for (let index = 0; index < rows.length; index += FEATURE_SNAPSHOT_WRITE_CHUNK_SIZE) {
        const chunk = rows.slice(index, index + FEATURE_SNAPSHOT_WRITE_CHUNK_SIZE);
        chunksAttempted += 1;
        const { data, error: insertError } = await client
          .from("op_training_feature_snapshots")
          .upsert(chunk, { onConflict: FEATURE_SNAPSHOT_UPSERT_CONFLICT_TARGET })
          .select("id");
        if (insertError) {
          error = `Chunk ${chunksAttempted} failed after ${rowsInserted} stored row(s): ${insertError.message}`;
          break;
        }
        const chunkIds = (data ?? []).flatMap((item: { id?: unknown }) => (typeof item.id === "string" ? [item.id] : []));
        insertedIds = [...insertedIds, ...chunkIds];
        rowsInserted += chunkIds.length || chunk.length;
        chunksCompleted += 1;
      }
      inserted = !error && rowsInserted === rows.length;
    }
  }

  const status = statusFor({
    runRequested,
    adminAuthorized,
    serverWriteReady: runtime.serverWriteReady,
    hasPayloadRows: rows.length > 0,
    inserted,
    error
  });
  const verifyUrl = "/api/sports/decision/training/football-provider-feature-storage-receipt?demo=1&dryRun=1";
  const command = `${decisionCurlCommand(`${origin}${verifyUrl}&run=1`)} -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`;
  const receiptHash = stableHash({
    status,
    materializer: [materializer.materializerHash, materializer.status, materializer.corpus.rowsPreviewed],
    target: [runtime.projectRef, runtime.urlProjectRef, runtime.serverWriteReady],
    rows: rows.map((row) => [row.fixture_external_id, row.model_key, row.feature_hash, row.split]),
    inserted,
    rowsInserted
  });

  return {
    mode: "football-provider-feature-storage-receipt",
    generatedAt: now.toISOString(),
    status,
    receiptHash,
    summary: summaryFor(status, rows.length),
    request: {
      runRequested,
      adminAuthorized,
      adminTokenConfigured: adminTokenConfigured(env),
      dryRun: !runRequested
    },
    target: {
      projectRef: runtime.projectRef ?? runtime.urlProjectRef ?? "missing",
      table: "op_training_feature_snapshots",
      expectedProjectRef: ODDSPADI_SUPABASE_PROJECT_REF,
      modelKey: FOOTBALL_PROVIDER_RETEST_MODEL_KEY,
      upsertConflictTarget: FEATURE_SNAPSHOT_UPSERT_CONFLICT_TARGET,
      serverWriteReady: runtime.serverWriteReady,
      targetMatchesExpected: runtime.targetMatchesExpected
    },
    materializer: {
      status: materializer.status,
      materializerHash: materializer.materializerHash,
      provider: materializer.provider,
      rowsPreviewed: materializer.corpus.rowsPreviewed,
      rejectedFixtures: materializer.corpus.rejectedFixtures,
      withChronologyFeatures: materializer.corpus.withChronologyFeatures,
      chronologyWarmupFixtures: materializer.corpus.chronologyWarmupFixtures,
      withCrossSeasonHistory: materializer.corpus.withCrossSeasonHistory
    },
    payload: {
      table: "op_training_feature_snapshots",
      rows,
      sourceMaterializerHash: materializer.materializerHash
    },
    storage: {
      inserted,
      rowsInserted,
      insertedIds,
      chunkSize: FEATURE_SNAPSHOT_WRITE_CHUNK_SIZE,
      chunksAttempted,
      chunksCompleted,
      error
    },
    nextAction: {
      label: "Store provider feature snapshot rows",
      command,
      verifyUrl,
      expectedEvidence:
        "Rows appear in op_training_feature_snapshots for model_key football-provider-enriched-retest-v1, while retest, learned weights, public picks, and staking remain locked."
    },
    controls: {
      canInspectReadOnly: true,
      canPrepareFeatureRows: rows.length > 0,
      canWriteFeatureSnapshots: Boolean(!error && rows.length && runRequested && runtime.serverWriteReady && adminTokenConfigured(env) && adminAuthorized),
      canTrainModels: false,
      canApplyThresholds: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Stored feature snapshots are training inputs only and cannot apply learned weights by themselves.",
      "Writes require run=1, x-oddspadi-admin-token, correct OddsPadi Supabase ref, and service-role readiness.",
      "Rows must be produced by the server-side materializer from fixtures with complete odds and finished outcomes.",
      "Public picks and staking remain locked after feature storage."
    ],
    proofUrls: [
      "/api/sports/decision/training/football-provider-feature-storage-receipt",
      "/api/sports/decision/training/football-provider-feature-materializer",
      "/api/sports/decision/training/football-data-provider-retest-bridge",
      "/api/sports/decision/training/football-data-provider-retest-runner",
      "/api/sports/decision/supabase-proof-binder"
    ]
  };
}
