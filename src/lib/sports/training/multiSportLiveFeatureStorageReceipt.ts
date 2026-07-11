import { getSupabaseRuntimeStatus, getSupabaseServerClient, ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { FootballDataProviderRetestFeatureRow } from "@/lib/sports/training/footballDataProviderRetestBridge";
import type { LiveTrainingSport, MultiSportLiveFeatureMaterializerReceipt } from "@/lib/sports/training/multiSportLiveFeatureMaterializer";

type EnvLike = Record<string, string | undefined>;
const FEATURE_SNAPSHOT_UPSERT_CONFLICT_TARGET = "sport,fixture_external_id,model_key,split,source";

export type MultiSportLiveFeatureStorageStatus =
  | "preview-ready"
  | "stored"
  | "waiting-provider-proof"
  | "waiting-admin"
  | "waiting-supabase"
  | "waiting-live-preview"
  | "failed";

export type MultiSportLiveFeatureSnapshotInsertRow = Pick<
  FootballDataProviderRetestFeatureRow,
  "sport" | "fixture_external_id" | "model_key" | "generated_at" | "label" | "features" | "targets" | "split" | "source" | "feature_hash" | "created_at"
>;

export type MultiSportLiveFeatureStorageReceipt = {
  mode: "multi-sport-live-feature-storage-receipt";
  generatedAt: string;
  status: MultiSportLiveFeatureStorageStatus;
  receiptHash: string;
  summary: string;
  request: {
    runRequested: boolean;
    adminAuthorized: boolean;
    adminTokenConfigured: boolean;
    dryRun: boolean;
    sport: LiveTrainingSport;
  };
  target: {
    projectRef: string;
    table: "op_training_feature_snapshots";
    expectedProjectRef: string;
    modelKey: string;
    split: "live";
    upsertConflictTarget: typeof FEATURE_SNAPSHOT_UPSERT_CONFLICT_TARGET;
    serverWriteReady: boolean;
    targetMatchesExpected: boolean;
  };
  materializer: {
    status: MultiSportLiveFeatureMaterializerReceipt["status"];
    materializerHash: string;
    provider: string;
    rowsPreviewed: number;
    rejectedFixtures: number;
    providerBackedRows: number;
    pendingRows: number;
    ineligiblePendingRows: number;
  };
  payload: {
    table: "op_training_feature_snapshots";
    rows: MultiSportLiveFeatureSnapshotInsertRow[];
    sourceMaterializerHash: string;
  };
  storage: {
    inserted: boolean;
    rowsInserted: number;
    insertedIds: string[];
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
    canWriteLiveFeatureSnapshots: boolean;
    canFeedBacktestRunner: false;
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

function isProviderBackedLiveRow(row: FootballDataProviderRetestFeatureRow): boolean {
  if (row.split !== "live") return false;
  if (row.label !== null) return false;
  const features = record(row.features);
  const evidence = record(features.evidence);
  const featureQuality = record(features.featureQuality);
  const dataSource = record(features.dataSource);
  return (
    dataSource.kind === "provider" &&
    boolFrom(evidence.rawPayloadLinked) &&
    boolFrom(evidence.providerIdentity) &&
    boolFrom(evidence.providerStrength) &&
    boolFrom(evidence.coreFeatureComplete) &&
    boolFrom(evidence.proxyFree) &&
    featureQuality.status === "complete" &&
    boolFrom(featureQuality.completeForTraining)
  );
}

function isPendingLiveRow(row: FootballDataProviderRetestFeatureRow): boolean {
  const targets = record(row.targets);
  return row.split === "live" && row.label === null && targets.settlementStatus === "pending";
}

function payloadRowsFromMaterializer(materializer: MultiSportLiveFeatureMaterializerReceipt): MultiSportLiveFeatureSnapshotInsertRow[] {
  return materializer.previewRows.filter((row) => isPendingLiveRow(row) && isProviderBackedLiveRow(row)).map((row) => ({
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
  hasPendingRows,
  providerProofReady,
  inserted,
  error
}: {
  runRequested: boolean;
  adminAuthorized: boolean;
  serverWriteReady: boolean;
  hasPendingRows: boolean;
  providerProofReady: boolean;
  inserted: boolean;
  error: string | null;
}): MultiSportLiveFeatureStorageStatus {
  if (error) return "failed";
  if (inserted) return "stored";
  if (!hasPendingRows) return "waiting-live-preview";
  if (!providerProofReady) return "waiting-provider-proof";
  if (!serverWriteReady) return "waiting-supabase";
  if (runRequested && !adminAuthorized) return "waiting-admin";
  return "preview-ready";
}

function summaryFor(status: MultiSportLiveFeatureStorageStatus, sport: LiveTrainingSport, rows: number, ineligibleRows: number): string {
  const skipped = ineligibleRows > 0 ? ` Skipped ${ineligibleRows} incomplete row(s).` : "";
  if (status === "stored") return `Stored or updated ${rows} provider-backed ${sport} live feature row(s) for monitor evidence.${skipped} Training and public picks remain locked.`;
  if (status === "waiting-provider-proof") return `${sport} live feature rows are prepared, but none have complete provider identity, provider strength, model inputs, and proxy-free evidence.${skipped}`;
  if (status === "waiting-admin") return `${sport} provider-backed live feature rows are prepared, but storage requires x-oddspadi-admin-token.${skipped}`;
  if (status === "waiting-supabase") return `${sport} provider-backed live feature rows are prepared, but OddsPadi Supabase service-role write readiness is missing.${skipped}`;
  if (status === "waiting-live-preview") return `${sport} live feature storage is waiting for split=live rows with pending settlement targets.`;
  if (status === "failed") return `${sport} live feature storage attempt failed.`;
  return `${sport} has ${rows} provider-backed live row(s) ready to store as monitor evidence.${skipped} run=1 with admin authorization is required.`;
}

export async function observeMultiSportLiveFeatureStorageReceipt({
  materializer,
  runRequested = false,
  adminAuthorized = false,
  env = process.env,
  origin,
  now = new Date()
}: {
  materializer: MultiSportLiveFeatureMaterializerReceipt;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  env?: EnvLike;
  origin: string;
  now?: Date;
}): Promise<MultiSportLiveFeatureStorageReceipt> {
  const runtime = getSupabaseRuntimeStatus(env);
  const rows = payloadRowsFromMaterializer(materializer);
  const providerBackedRows = materializer.previewRows.filter(isProviderBackedLiveRow).length;
  const pendingRows = materializer.previewRows.filter(isPendingLiveRow).length;
  const ineligiblePendingRows = Math.max(0, pendingRows - providerBackedRows);
  const providerProofReady = rows.length > 0 && rows.length === providerBackedRows;
  let inserted = false;
  let rowsInserted = 0;
  let insertedIds: string[] = [];
  let error: string | null = null;

  if (runRequested && adminAuthorized && runtime.serverWriteReady && rows.length && providerProofReady) {
    const client = getSupabaseServerClient(env);
    if (!client) {
      error = "Supabase server client is not available for the configured OddsPadi project.";
    } else {
      const { data, error: insertError } = await client
        .from("op_training_feature_snapshots")
        .upsert(rows, { onConflict: FEATURE_SNAPSHOT_UPSERT_CONFLICT_TARGET })
        .select("id");
      if (insertError) {
        error = insertError.message;
      } else {
        inserted = true;
        insertedIds = (data ?? []).flatMap((item: { id?: unknown }) => (typeof item.id === "string" ? [item.id] : []));
        rowsInserted = insertedIds.length || rows.length;
      }
    }
  }

  const status = statusFor({
    runRequested,
    adminAuthorized,
    serverWriteReady: runtime.serverWriteReady,
    hasPendingRows: pendingRows > 0,
    providerProofReady,
    inserted,
    error
  });
  const sport = materializer.request.sport;
  const verifyUrl = `/api/sports/decision/training/multi-sport-live-feature-storage-receipt?sport=${sport}&date=${materializer.request.targetDate}&dryRun=1`;
  const command = `${decisionCurlCommand(`${origin}${verifyUrl}&run=1`)} -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`;
  const receiptHash = stableHash({
    status,
    materializer: [materializer.materializerHash, materializer.status, materializer.corpus.rowsPreviewed],
    target: [runtime.projectRef, runtime.urlProjectRef, runtime.serverWriteReady],
    rows: rows.map((row) => [row.sport, row.fixture_external_id, row.model_key, row.feature_hash, row.split]),
    providerBackedRows,
    pendingRows,
    ineligiblePendingRows,
    inserted,
    rowsInserted
  });

  return {
    mode: "multi-sport-live-feature-storage-receipt",
    generatedAt: now.toISOString(),
    status,
    receiptHash,
    summary: summaryFor(status, sport, rows.length, ineligiblePendingRows),
    request: {
      runRequested,
      adminAuthorized,
      adminTokenConfigured: adminTokenConfigured(env),
      dryRun: !runRequested,
      sport
    },
    target: {
      projectRef: runtime.projectRef ?? runtime.urlProjectRef ?? "missing",
      table: "op_training_feature_snapshots",
      expectedProjectRef: ODDSPADI_SUPABASE_PROJECT_REF,
      modelKey: materializer.request.modelKey,
      split: "live",
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
      providerBackedRows,
      pendingRows,
      ineligiblePendingRows
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
      error
    },
    nextAction: {
      label: providerProofReady ? `Store provider-backed ${sport} live feature snapshots` : `Collect provider-backed ${sport} live feature proof`,
      command,
      verifyUrl,
      expectedEvidence:
        "Rows appear in op_training_feature_snapshots with split=live, label=null, pending settlement targets, complete model inputs, provider identity and strength provenance, and no training/publish/stake unlocks."
    },
    controls: {
      canInspectReadOnly: true,
      canPrepareLiveFeatureRows: pendingRows > 0,
      canWriteLiveFeatureSnapshots: Boolean(!error && rows.length && providerProofReady && runRequested && runtime.serverWriteReady && adminTokenConfigured(env) && adminAuthorized),
      canFeedBacktestRunner: false,
      canTrainModels: false,
      canApplyThresholds: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Multi-sport live feature snapshots are monitor evidence only and cannot feed backtest runners until settlement labels exist.",
      "Writes include only rows with complete proxy-free model inputs plus provider identity and strength provenance; incomplete live rows are skipped rather than weakening the evidence gate.",
      "Writes require run=1, x-oddspadi-admin-token, the correct OddsPadi Supabase ref, and service-role readiness.",
      "Mock or synthetic basketball/tennis rows cannot be stored as provider-backed live evidence.",
      "Public picks, staking, learned weights, and threshold application remain locked after live feature storage."
    ],
    proofUrls: [
      "/api/sports/decision/training/multi-sport-live-feature-storage-receipt",
      "/api/sports/decision/training/multi-sport-live-feature-materializer",
      "/api/sports/decision/training/multi-sport-corpus-plan",
      "/api/sports/decision/training/provider-readiness",
      "/api/sports/decision/supabase-proof-binder"
    ]
  };
}
