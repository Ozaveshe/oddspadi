import { getSupabaseRuntimeStatus, getSupabaseServerClient, ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";
import type { FootballDataProviderRetestContract } from "@/lib/sports/training/footballDataProviderRetestContract";
import type { FootballDataProviderRetestOutcome, FootballDataProviderRetestRow } from "@/lib/sports/training/footballDataProviderRetestRunner";

type EnvLike = Record<string, string | undefined>;
type JsonRecord = Record<string, unknown>;

export const FOOTBALL_PROVIDER_RETEST_MODEL_KEY = "football-provider-enriched-retest-v1";

export type FootballDataProviderRetestBridgeStatus =
  | "ready-rows"
  | "partial-evidence"
  | "empty"
  | "not-configured"
  | "blocked-contract"
  | "failed";

export type FootballDataProviderRetestFeatureRow = {
  id: string;
  fixture_external_id: string;
  sport: string;
  model_key: string;
  generated_at: string;
  label: string | null;
  features: JsonRecord | null;
  targets: JsonRecord | null;
  split: string;
  source: string;
  feature_hash: string | null;
  created_at: string;
};

export type FootballDataProviderRetestRejectedRow = {
  id: string;
  fixtureExternalId: string | null;
  reason: string;
};

export type FootballDataProviderRetestBridge = {
  mode: "football-data-provider-retest-bridge";
  generatedAt: string;
  status: FootballDataProviderRetestBridgeStatus;
  bridgeHash: string;
  summary: string;
  target: {
    projectRef: string | null;
    expectedProjectRef: string;
    sourceTable: "op_training_feature_snapshots";
    rawPayloadTable: "op_raw_provider_payloads";
    backtestTable: "op_backtest_runs";
    modelKey: typeof FOOTBALL_PROVIDER_RETEST_MODEL_KEY;
    serverReadReady: boolean;
    targetMatchesExpected: boolean;
  };
  contract: {
    selectedSegmentId: string | null;
    minHoldoutRows: number;
    canQueueProviderRetest: boolean;
  };
  corpus: {
    featureRows: number;
    normalizedRows: number;
    rejectedRows: number;
    testRows: number;
    liveRows: number;
  };
  normalizedRows: FootballDataProviderRetestRow[];
  rejectedRows: FootballDataProviderRetestRejectedRow[];
  controls: {
    canInspectReadOnly: true;
    canFeedRunner: boolean;
    canWriteProviderRows: false;
    canPersistBacktestMemory: false;
    canApplyThresholds: false;
    canPublishPicks: false;
    canStake: false;
  };
  nextAction: {
    label: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  proofUrls: string[];
  locks: string[];
  error: string | null;
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

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function boolFrom(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function outcomeFrom(value: unknown): FootballDataProviderRetestOutcome | null {
  return value === "home" || value === "draw" || value === "away" ? value : null;
}

function probabilityMap(value: unknown): Record<FootballDataProviderRetestOutcome, number> | null {
  const source = record(value);
  const home = numberFrom(source.home);
  const draw = numberFrom(source.draw);
  const away = numberFrom(source.away);
  return home === null || draw === null || away === null ? null : { home, draw, away };
}

function oddsMap(value: unknown): Record<FootballDataProviderRetestOutcome, number> | null {
  const source = record(value);
  const home = numberFrom(source.home);
  const draw = numberFrom(source.draw);
  const away = numberFrom(source.away);
  return home === null || draw === null || away === null ? null : { home, draw, away };
}

function optionalOddsMap(value: unknown): Partial<Record<FootballDataProviderRetestOutcome, number>> {
  const source = record(value);
  return {
    ...(numberFrom(source.home) === null ? {} : { home: numberFrom(source.home)! }),
    ...(numberFrom(source.draw) === null ? {} : { draw: numberFrom(source.draw)! }),
    ...(numberFrom(source.away) === null ? {} : { away: numberFrom(source.away)! })
  };
}

function evidenceFrom(value: unknown): FootballDataProviderRetestRow["evidence"] {
  const source = record(value);
  return {
    fixtureIdentity: boolFrom(source.fixtureIdentity),
    marketOdds: boolFrom(source.marketOdds),
    teamStrength: boolFrom(source.teamStrength),
    availabilityContext: boolFrom(source.availabilityContext),
    newsWeatherContext: boolFrom(source.newsWeatherContext),
    liveAndSettlement: boolFrom(source.liveAndSettlement),
    featureSnapshot: boolFrom(source.featureSnapshot),
    rawPayloadLinked: boolFrom(source.rawPayloadLinked)
  };
}

export function footballDataProviderRetestRowFromFeatureRow(row: FootballDataProviderRetestFeatureRow): {
  row: FootballDataProviderRetestRow | null;
  rejection: FootballDataProviderRetestRejectedRow | null;
} {
  const features = record(row.features);
  const targets = record(row.targets);
  const actualOutcome = outcomeFrom(targets.actualOutcome ?? targets.outcome ?? features.actualOutcome);
  const modelProbabilities = probabilityMap(features.modelProbabilities);
  const marketProbabilities = probabilityMap(features.marketProbabilities);
  const odds = oddsMap(features.odds);
  const evidence = evidenceFrom(features.evidence);

  const reason = [
    actualOutcome ? "" : "missing actualOutcome target",
    modelProbabilities ? "" : "missing modelProbabilities",
    marketProbabilities ? "" : "missing marketProbabilities",
    odds ? "" : "missing odds"
  ].filter(Boolean)[0];

  if (reason || !actualOutcome || !modelProbabilities || !marketProbabilities || !odds) {
    return {
      row: null,
      rejection: {
        id: row.id,
        fixtureExternalId: row.fixture_external_id || null,
        reason: reason ?? "feature row could not be normalized"
      }
    };
  }

  return {
    row: {
      fixtureExternalId: row.fixture_external_id,
      kickoffAt: String(features.kickoffAt ?? row.generated_at),
      actualOutcome,
      modelProbabilities,
      marketProbabilities,
      odds,
      closingOdds: optionalOddsMap(features.closingOdds),
      evidence
    },
    rejection: null
  };
}

function statusFor({
  contract,
  rows,
  normalizedRows,
  rejectedRows,
  serverReadReady,
  error
}: {
  contract: FootballDataProviderRetestContract;
  rows: FootballDataProviderRetestFeatureRow[];
  normalizedRows: FootballDataProviderRetestRow[];
  rejectedRows: FootballDataProviderRetestRejectedRow[];
  serverReadReady: boolean;
  error: string | null;
}): FootballDataProviderRetestBridgeStatus {
  if (error) return "failed";
  if (!serverReadReady) return "not-configured";
  if (!contract.controls.canQueueProviderRetest) return "blocked-contract";
  if (!rows.length) return "empty";
  if (rejectedRows.length || normalizedRows.length < rows.length) return "partial-evidence";
  return "ready-rows";
}

function summaryFor(status: FootballDataProviderRetestBridgeStatus, normalizedRows: number, error: string | null): string {
  if (status === "failed") return `Provider retest bridge read failed: ${error ?? "unknown error"}.`;
  if (status === "not-configured") return "Provider retest bridge needs OddsPadi Supabase service-role read readiness.";
  if (status === "blocked-contract") return "Provider retest bridge is waiting for a queueable market-learning segment before feature rows can feed the runner.";
  if (status === "empty") return "No provider-enriched retest feature rows are stored yet.";
  if (status === "partial-evidence") return "Some provider-enriched feature rows are present but cannot be normalized into retest rows.";
  return `Provider retest bridge normalized ${normalizedRows} stored feature row(s) for the read-only runner.`;
}

export function buildFootballDataProviderRetestBridgeFromRows({
  contract,
  rows,
  generatedAt = new Date().toISOString(),
  projectRef = ODDSPADI_SUPABASE_PROJECT_REF,
  serverReadReady = true,
  targetMatchesExpected = true,
  error = null
}: {
  contract: FootballDataProviderRetestContract;
  rows: FootballDataProviderRetestFeatureRow[];
  generatedAt?: string;
  projectRef?: string | null;
  serverReadReady?: boolean;
  targetMatchesExpected?: boolean;
  error?: string | null;
}): FootballDataProviderRetestBridge {
  const mapped = rows.map(footballDataProviderRetestRowFromFeatureRow);
  const normalizedRows = mapped.flatMap((item) => (item.row ? [item.row] : []));
  const rejectedRows = mapped.flatMap((item) => (item.rejection ? [item.rejection] : []));
  const status = statusFor({ contract, rows, normalizedRows, rejectedRows, serverReadReady, error });
  const bridgeHash = stableHash({
    status,
    projectRef,
    contract: [contract.contractHash, contract.segment.selectedId, contract.controls.canQueueProviderRetest],
    rows: rows.map((row) => [row.id, row.fixture_external_id, row.feature_hash]),
    rejectedRows
  });

  return {
    mode: "football-data-provider-retest-bridge",
    generatedAt,
    status,
    bridgeHash,
    summary: summaryFor(status, normalizedRows.length, error),
    target: {
      projectRef,
      expectedProjectRef: ODDSPADI_SUPABASE_PROJECT_REF,
      sourceTable: "op_training_feature_snapshots",
      rawPayloadTable: "op_raw_provider_payloads",
      backtestTable: "op_backtest_runs",
      modelKey: FOOTBALL_PROVIDER_RETEST_MODEL_KEY,
      serverReadReady,
      targetMatchesExpected
    },
    contract: {
      selectedSegmentId: contract.segment.selectedId,
      minHoldoutRows: contract.segment.minHoldoutRows,
      canQueueProviderRetest: contract.controls.canQueueProviderRetest
    },
    corpus: {
      featureRows: rows.length,
      normalizedRows: normalizedRows.length,
      rejectedRows: rejectedRows.length,
      testRows: rows.filter((row) => row.split === "test").length,
      liveRows: rows.filter((row) => row.split === "live").length
    },
    normalizedRows,
    rejectedRows,
    controls: {
      canInspectReadOnly: true,
      canFeedRunner: status === "ready-rows" || status === "partial-evidence",
      canWriteProviderRows: false,
      canPersistBacktestMemory: false,
      canApplyThresholds: false,
      canPublishPicks: false,
      canStake: false
    },
    nextAction: {
      label:
        status === "ready-rows" || status === "partial-evidence"
          ? "Run provider retest runner from stored rows"
          : status === "blocked-contract"
            ? "Clear provider retest contract"
            : "Store provider-enriched feature rows",
      verifyUrl: "/api/sports/decision/training/football-data-provider-retest-bridge",
      expectedEvidence:
        status === "ready-rows" || status === "partial-evidence"
          ? "Stored op_training_feature_snapshots rows normalize into provider retest rows with raw payload links and settlement targets."
          : "Provider-enriched feature rows exist for the selected segment with model probabilities, market probabilities, odds, evidence flags, and outcome targets."
    },
    proofUrls: [
      "/api/sports/decision/training/football-data-provider-retest-bridge",
      "/api/sports/decision/training/football-data-provider-retest-runner",
      "/api/sports/decision/training/football-data-provider-retest-contract",
      "/api/sports/decision/supabase-schema-manifest",
      "/api/sports/decision/supabase-proof-binder"
    ],
    locks: [
      "Provider retest bridge is read-only and cannot write feature rows, persist backtests, apply thresholds, publish picks, or stake.",
      "Rows must come from server-side op_training_feature_snapshots with raw provider payload links; public client data is not accepted.",
      "Supabase service-role readiness must target the OddsPadi project before stored rows can feed the runner."
    ],
    error
  };
}

export async function readFootballDataProviderRetestBridge({
  contract,
  limit = 250,
  env = process.env,
  now = new Date()
}: {
  contract: FootballDataProviderRetestContract;
  limit?: number;
  env?: EnvLike;
  now?: Date;
}): Promise<FootballDataProviderRetestBridge> {
  const runtime = getSupabaseRuntimeStatus(env);
  if (!runtime.serverWriteReady) {
    return buildFootballDataProviderRetestBridgeFromRows({
      contract,
      rows: [],
      generatedAt: now.toISOString(),
      projectRef: runtime.projectRef ?? runtime.urlProjectRef,
      serverReadReady: false,
      targetMatchesExpected: runtime.targetMatchesExpected
    });
  }

  const client = getSupabaseServerClient(env);
  if (!client) {
    return buildFootballDataProviderRetestBridgeFromRows({
      contract,
      rows: [],
      generatedAt: now.toISOString(),
      projectRef: runtime.projectRef ?? runtime.urlProjectRef,
      serverReadReady: false,
      targetMatchesExpected: runtime.targetMatchesExpected,
      error: "Supabase server client could not be created."
    });
  }

  const { data, error } = await client
    .from("op_training_feature_snapshots")
    .select("id, fixture_external_id, sport, model_key, generated_at, label, features, targets, split, source, feature_hash, created_at")
    .eq("sport", "football")
    .eq("model_key", FOOTBALL_PROVIDER_RETEST_MODEL_KEY)
    .in("split", ["test", "live"])
    .order("generated_at", { ascending: false })
    .limit(Math.max(1, Math.min(1000, limit)));

  return buildFootballDataProviderRetestBridgeFromRows({
    contract,
    rows: error ? [] : ((data ?? []) as FootballDataProviderRetestFeatureRow[]),
    generatedAt: now.toISOString(),
    projectRef: runtime.projectRef ?? runtime.urlProjectRef,
    serverReadReady: true,
    targetMatchesExpected: runtime.targetMatchesExpected,
    error: error?.message ?? null
  });
}
