import type { DecisionEplProviderFixtureMap } from "@/lib/sports/prediction/decisionEplProviderFixtureMap";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { FootballProviderFeatureIntakeGapReceipt } from "@/lib/sports/training/footballProviderFeatureIntakeGapReceipt";

export type FootballProviderFixtureFeatureReadinessStatus =
  | "ready-live-feature-preview"
  | "waiting-provider-keys"
  | "waiting-admin-dry-run"
  | "waiting-provider-evidence"
  | "waiting-supabase"
  | "waiting-feature-materialization"
  | "waiting-settlement-history"
  | "failed";

export type FootballProviderFixtureFeatureReadinessRow = {
  id: string;
  date: string;
  match: string;
  providerEndpoint: string;
  providerMatchKey: string;
  oddsEventKey: string;
  mapStatus: DecisionEplProviderFixtureMap["rows"][number]["status"];
  featureStatus: "ready-preview" | "waiting" | "blocked";
  requiredEvidence: string[];
  storageTargets: string[];
  nextAction: string;
};

export type FootballProviderFixtureFeatureReadiness = {
  mode: "football-provider-fixture-feature-readiness";
  generatedAt: string;
  status: FootballProviderFixtureFeatureReadinessStatus;
  readinessHash: string;
  summary: string;
  season: DecisionEplProviderFixtureMap["season"];
  fixtureMap: {
    status: DecisionEplProviderFixtureMap["status"];
    mapHash: string;
    fixtures: number;
    readyDryRun: number;
    mappedShadow: number;
    contextBlocks: number;
  };
  featureIntake: {
    status: FootballProviderFeatureIntakeGapReceipt["status"];
    gapHash: string;
    liveWatchlistStatus: FootballProviderFeatureIntakeGapReceipt["lanes"]["eplLiveWatchlist"]["status"];
    settledTrainingStatus: FootballProviderFeatureIntakeGapReceipt["lanes"]["settledTraining"]["status"];
    missingLiveEvidence: string[];
    storage: FootballProviderFeatureIntakeGapReceipt["storage"];
  };
  rows: FootballProviderFixtureFeatureReadinessRow[];
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunProviderDryRun: boolean;
    canRunOddsDryRun: boolean;
    canMaterializeFeaturePreview: boolean;
    canUseForLiveWatchlist: boolean;
    canWriteFixtures: false;
    canWriteProviderRows: false;
    canWriteFeatureSnapshots: false;
    canTrainModels: false;
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

function unique(values: Array<string | null | undefined>, limit = 48): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function statusFor({
  fixtureMap,
  featureGap
}: {
  fixtureMap: DecisionEplProviderFixtureMap;
  featureGap: FootballProviderFeatureIntakeGapReceipt;
}): FootballProviderFixtureFeatureReadinessStatus {
  if (fixtureMap.status === "blocked" || featureGap.status === "failed") return "failed";
  if (fixtureMap.status === "waiting-provider-key" || featureGap.status === "waiting-provider-keys") return "waiting-provider-keys";
  if (fixtureMap.status === "waiting-admin-token" || fixtureMap.status === "ready-admin-dry-run") return "waiting-admin-dry-run";
  if (fixtureMap.status === "waiting-storage-proof" || featureGap.status === "waiting-supabase") return "waiting-supabase";
  if (featureGap.status === "waiting-epl-fixtures" || featureGap.status === "waiting-provider-evidence") return "waiting-provider-evidence";
  if (featureGap.status === "waiting-feature-materialization") return "waiting-feature-materialization";
  if (featureGap.status === "waiting-settlement-history") return "waiting-settlement-history";
  return "ready-live-feature-preview";
}

function summaryFor(status: FootballProviderFixtureFeatureReadinessStatus, fixtureMap: DecisionEplProviderFixtureMap): string {
  if (status === "ready-live-feature-preview") return `EPL provider fixtures can produce live feature previews for ${fixtureMap.totals.fixtures} opening fixture(s); training and public picks remain locked.`;
  if (status === "waiting-provider-keys") return "EPL provider feature readiness is waiting for football and odds provider keys.";
  if (status === "waiting-admin-dry-run") return "EPL provider feature readiness is waiting for an admin-authorized fixture and odds dry-run.";
  if (status === "waiting-provider-evidence") return "EPL provider feature readiness is waiting for stored fixture rows, odds snapshots, and raw provider payload evidence.";
  if (status === "waiting-supabase") return "EPL provider feature readiness is waiting for OddsPadi Supabase storage proof.";
  if (status === "waiting-feature-materialization") return "EPL provider feature readiness is waiting for provider-enriched feature snapshot previews.";
  if (status === "waiting-settlement-history") return "EPL provider feature readiness can support live watchlists, but settled outcomes and backtests are still required for training.";
  return "EPL provider feature readiness failed because fixture-map or feature-intake evidence is unsafe.";
}

function nextActionFor({
  status,
  fixtureMap,
  featureGap
}: {
  status: FootballProviderFixtureFeatureReadinessStatus;
  fixtureMap: DecisionEplProviderFixtureMap;
  featureGap: FootballProviderFeatureIntakeGapReceipt;
}): FootballProviderFixtureFeatureReadiness["nextAction"] {
  if (status === "waiting-admin-dry-run") {
    return {
      label: "Run EPL provider fixture dry-run",
      command: fixtureMap.providerPlan.dryRunCommand ?? decisionCurlCommand(fixtureMap.providerPlan.receiptUrl),
      verifyUrl: fixtureMap.providerPlan.receiptUrl,
      expectedEvidence: "Admin-authorized fixture dry-run maps API-Football event IDs to the official EPL opening fixture seed without writes."
    };
  }
  if (status === "waiting-provider-keys") return featureGap.nextAction;
  if (status === "waiting-provider-evidence" || status === "waiting-supabase" || status === "waiting-feature-materialization") return featureGap.nextAction;
  if (status === "waiting-settlement-history") {
    return {
      label: "Collect settled outcomes and backtests",
      command: featureGap.nextAction.command,
      verifyUrl: featureGap.nextAction.verifyUrl,
      expectedEvidence: "Finished fixtures, complete odds snapshots, provider feature rows, and completed backtests exist before model training activation."
    };
  }
  if (status === "ready-live-feature-preview") {
    const verifyUrl = "/api/sports/decision/training/football-provider-live-feature-materializer?dryRun=1";
    return {
      label: "Preview live feature rows",
      command: decisionCurlCommand(verifyUrl),
      verifyUrl,
      expectedEvidence: "Upcoming EPL fixtures materialize into live feature previews with provider, market, context, and hash provenance."
    };
  }
  return {
    label: "Inspect unsafe feature readiness",
    command: decisionCurlCommand("/api/sports/decision/training/football-provider-fixture-feature-readiness?date=2026-08-21"),
    verifyUrl: "/api/sports/decision/training/football-provider-fixture-feature-readiness?date=2026-08-21",
    expectedEvidence: "Receipt reports the exact fixture-map or feature-intake blocker before any write or training action."
  };
}

export function buildFootballProviderFixtureFeatureReadiness({
  fixtureMap,
  featureGap,
  now = new Date()
}: {
  fixtureMap: DecisionEplProviderFixtureMap;
  featureGap: FootballProviderFeatureIntakeGapReceipt;
  now?: Date;
}): FootballProviderFixtureFeatureReadiness {
  const status = statusFor({ fixtureMap, featureGap });
  const canUseForLiveWatchlist = status === "ready-live-feature-preview" || status === "waiting-settlement-history";
  const missingLiveEvidence = featureGap.lanes.eplLiveWatchlist.missing;
  const rows = fixtureMap.rows.map((row): FootballProviderFixtureFeatureReadinessRow => {
    const rowBlocked = row.status === "needs-provider" || row.status === "needs-admin" || featureGap.status === "failed";
    const rowReady = canUseForLiveWatchlist && !missingLiveEvidence.length && (row.status === "mapped-shadow" || row.status === "needs-storage");
    return {
      id: row.id,
      date: row.date,
      match: row.match,
      providerEndpoint: row.providerLookup.endpointPath,
      providerMatchKey: row.providerLookup.matchKey,
      oddsEventKey: row.oddsLookup.eventKey,
      mapStatus: row.status,
      featureStatus: rowReady ? "ready-preview" : rowBlocked ? "blocked" : "waiting",
      requiredEvidence: unique([
        ...row.missing,
        ...missingLiveEvidence,
        row.contextGates.find((gate) => gate.status === "block")?.nextAction
      ], 12),
      storageTargets: unique([...row.storageTargets, "op_training_feature_snapshots", "op_raw_provider_payloads", "op_backtest_runs"], 12),
      nextAction: rowReady ? "Preview live feature rows and keep them read-only until storage approval." : row.nextAction
    };
  });
  const readinessHash = stableHash({
    status,
    mapHash: fixtureMap.mapHash,
    gapHash: featureGap.gapHash,
    rows: rows.map((row) => [row.id, row.mapStatus, row.featureStatus, row.requiredEvidence])
  });

  return {
    mode: "football-provider-fixture-feature-readiness",
    generatedAt: now.toISOString(),
    status,
    readinessHash,
    summary: summaryFor(status, fixtureMap),
    season: fixtureMap.season,
    fixtureMap: {
      status: fixtureMap.status,
      mapHash: fixtureMap.mapHash,
      fixtures: fixtureMap.totals.fixtures,
      readyDryRun: fixtureMap.totals.readyDryRun,
      mappedShadow: fixtureMap.totals.mappedShadow,
      contextBlocks: fixtureMap.totals.contextBlocks
    },
    featureIntake: {
      status: featureGap.status,
      gapHash: featureGap.gapHash,
      liveWatchlistStatus: featureGap.lanes.eplLiveWatchlist.status,
      settledTrainingStatus: featureGap.lanes.settledTraining.status,
      missingLiveEvidence,
      storage: featureGap.storage
    },
    rows,
    nextAction: nextActionFor({ status, fixtureMap, featureGap }),
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun: fixtureMap.controls.canRequestAdminDryRun || featureGap.controls.canRunProviderDryRun,
      canRunOddsDryRun: featureGap.controls.canRunOddsDryRun,
      canMaterializeFeaturePreview: canUseForLiveWatchlist && featureGap.controls.canMaterializeFeaturePreview,
      canUseForLiveWatchlist,
      canWriteFixtures: false,
      canWriteProviderRows: false,
      canWriteFeatureSnapshots: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: unique([
      "Fixture feature readiness is read-only and cannot write fixtures, provider rows, feature snapshots, train models, publish picks, or stake.",
      "Upcoming EPL fixtures can support live feature previews only after provider IDs, odds snapshots, raw payloads, and storage proof are present.",
      "Settled outcomes and completed backtests remain required before any learned weights or live probability promotion.",
      ...fixtureMap.locks,
      ...featureGap.locks
    ], 40),
    proofUrls: unique([
      "/api/sports/decision/training/football-provider-fixture-feature-readiness",
      "/api/sports/decision/training/supabase-training-corpus-census",
      "/api/sports/decision/epl-provider-fixture-map",
      "/api/sports/decision/training/football-provider-feature-intake-gap",
      "/api/sports/decision/training/football-provider-live-feature-materializer",
      ...fixtureMap.proofUrls,
      ...featureGap.proofUrls
    ])
  };
}
