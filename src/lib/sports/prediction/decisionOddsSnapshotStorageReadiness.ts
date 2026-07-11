import type { DecisionEplOddsDryRunInterpreter } from "@/lib/sports/prediction/decisionEplOddsDryRunInterpreter";
import type { DecisionEplOddsMarketMap } from "@/lib/sports/prediction/decisionEplOddsMarketMap";
import type { DecisionStorageActivationChecklist } from "@/lib/sports/prediction/decisionStorageActivationChecklist";
import type { DecisionSupabaseProofBinder } from "@/lib/sports/prediction/decisionSupabaseProofBinder";
import type { DecisionSupabaseSchemaManifest } from "@/lib/sports/prediction/decisionSupabaseSchemaManifest";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import { ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";

export type DecisionOddsSnapshotStorageReadinessStatus =
  | "waiting-odds-proof"
  | "needs-storage-proof"
  | "needs-schema-verify"
  | "ready-shadow-storage-review"
  | "blocked-cross-project"
  | "blocked-credential";

export type DecisionOddsSnapshotStorageReadinessGateStatus = "pass" | "watch" | "block";

export type DecisionOddsSnapshotStorageReadinessGate = {
  id: "odds-proof" | "project" | "schema" | "table-security" | "snapshot-shape" | "write-lock";
  label: string;
  status: DecisionOddsSnapshotStorageReadinessGateStatus;
  evidence: string;
  nextAction: string;
};

export type DecisionOddsSnapshotStorageReadinessColumn = {
  name:
    | "fixture_external_id"
    | "sport"
    | "provider"
    | "bookmaker"
    | "market"
    | "selection"
    | "decimal_odds"
    | "implied_probability"
    | "margin_adjusted_probability"
    | "is_closing"
    | "observed_at"
    | "metadata";
  source: "provider" | "derived" | "engine" | "system";
  required: boolean;
  rule: string;
};

export type DecisionOddsSnapshotStorageReadiness = {
  generatedAt: string;
  date: string;
  sport: "football";
  mode: "decision-odds-snapshot-storage-readiness";
  status: DecisionOddsSnapshotStorageReadinessStatus;
  readinessHash: string;
  summary: string;
  input: {
    interpreterHash: string;
    receiptHash: string;
    oddsMapHash: string;
    storageChecklistHash: string;
    supabaseBinderHash: string;
    schemaManifestHash: string;
    oddsRows: number;
    requiredSnapshots: number;
  };
  target: {
    projectRef: string;
    table: "op_odds_snapshots";
    domain: "market-odds";
    localDeclared: boolean;
    localRlsEnabled: boolean;
    localAnonRevoked: boolean;
    localServiceRoleGrant: boolean;
    liveStatus: string;
    rowCount: number | null;
  };
  columns: DecisionOddsSnapshotStorageReadinessColumn[];
  gates: DecisionOddsSnapshotStorageReadinessGate[];
  nextTurn: {
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
    requiresAdminHeader: boolean;
  };
  controls: {
    canInspectReadOnly: true;
    canUseOddsProofForStorageReview: boolean;
    canRequestSchemaProof: boolean;
    canRequestAdminSnapshotWrite: false;
    canWriteOddsSnapshots: false;
    canPersistDecisions: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
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

function unique(values: Array<string | null | undefined>, limit = 36): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function gate(input: DecisionOddsSnapshotStorageReadinessGate): DecisionOddsSnapshotStorageReadinessGate {
  return input;
}

function columns(): DecisionOddsSnapshotStorageReadinessColumn[] {
  return [
    { name: "fixture_external_id", source: "engine", required: true, rule: "Must map to the normalized provider fixture/event id before storage." },
    { name: "sport", source: "engine", required: true, rule: "football for EPL rows." },
    { name: "provider", source: "provider", required: true, rule: "the-odds-api for this dry-run lane." },
    { name: "bookmaker", source: "provider", required: true, rule: "Provider bookmaker key/title; never infer when missing." },
    { name: "market", source: "provider", required: true, rule: "h2h, spreads, or totals for source markets; derived alternatives stay out of raw snapshots." },
    { name: "selection", source: "provider", required: true, rule: "Provider outcome/selection label normalized only after event matching." },
    { name: "decimal_odds", source: "provider", required: true, rule: "Numeric decimal odds must be greater than 1." },
    { name: "implied_probability", source: "derived", required: false, rule: "1 / decimal_odds, bounded between 0 and 1." },
    { name: "margin_adjusted_probability", source: "derived", required: false, rule: "No-vig probability within a complete bookmaker market." },
    { name: "is_closing", source: "engine", required: true, rule: "true only for the closing snapshot; opening and pre-kickoff stay false." },
    { name: "observed_at", source: "system", required: true, rule: "Provider observation timestamp or server receipt timestamp." },
    { name: "metadata", source: "engine", required: true, rule: "Receipt hash, event id, bookmaker id, raw market key, and dry-run provenance." }
  ];
}

function statusFor({
  interpreter,
  binder,
  storage,
  table
}: {
  interpreter: DecisionEplOddsDryRunInterpreter;
  binder: DecisionSupabaseProofBinder;
  storage: DecisionStorageActivationChecklist;
  table: DecisionOddsSnapshotStorageReadiness["target"];
}): DecisionOddsSnapshotStorageReadinessStatus {
  if (binder.status === "blocked-cross-project" || storage.status === "blocked-cross-project") return "blocked-cross-project";
  if (binder.status === "blocked-invalid-key" || storage.status === "needs-credential") return "blocked-credential";
  if (!interpreter.controls.canUseOddsProofForStorageReview) return "waiting-odds-proof";
  if (binder.status !== "ready-proof") return "needs-storage-proof";
  if (table.liveStatus !== "verified" || !table.localDeclared || !table.localRlsEnabled) return "needs-schema-verify";
  return "ready-shadow-storage-review";
}

function summaryFor(status: DecisionOddsSnapshotStorageReadinessStatus, oddsRows: number): string {
  if (status === "ready-shadow-storage-review") {
    return `Odds snapshot storage is ready for operator review with ${oddsRows} dry-run odds row(s), but writes remain locked.`;
  }
  if (status === "waiting-odds-proof") return "Odds snapshot storage is waiting for a verified bookmaker dry-run before schema review can matter.";
  if (status === "needs-storage-proof") return "Odds snapshot storage needs OddsPadi Supabase project, MCP, credential, and storage proof before any snapshot write.";
  if (status === "needs-schema-verify") return "Odds snapshot storage needs op_odds_snapshots live schema/security verification.";
  if (status === "blocked-cross-project") return "Odds snapshot storage is blocked because Supabase evidence points at a foreign or mixed project.";
  return "Odds snapshot storage is blocked by invalid or missing server credentials.";
}

function nextTurnFor(status: DecisionOddsSnapshotStorageReadinessStatus): DecisionOddsSnapshotStorageReadiness["nextTurn"] {
  if (status === "ready-shadow-storage-review") {
    return {
      label: "Prepare admin odds snapshot write receipt",
      command: null,
      verifyUrl: "/api/sports/decision/epl-odds-dry-run-receipt",
      safeToRun: false,
      requiresAdminHeader: true
    };
  }
  if (status === "waiting-odds-proof") {
    return {
      label: "Prove bookmaker odds dry-run rows",
      command: null,
      verifyUrl: "/api/sports/decision/epl-odds-dry-run-interpreter",
      safeToRun: false,
      requiresAdminHeader: true
    };
  }
  if (status === "needs-schema-verify") {
    return {
      label: "Verify op_odds_snapshots schema",
      command: decisionCurlCommand("/api/sports/decision/supabase-schema-manifest"),
      verifyUrl: "/api/sports/decision/supabase-schema-manifest",
      safeToRun: true,
      requiresAdminHeader: false
    };
  }
  return {
    label: "Prove OddsPadi Supabase storage",
    command: decisionCurlCommand("/api/sports/decision/supabase-proof-binder"),
    verifyUrl: "/api/sports/decision/supabase-proof-binder",
    safeToRun: true,
    requiresAdminHeader: false
  };
}

export function buildDecisionOddsSnapshotStorageReadiness({
  oddsMap,
  interpreter,
  supabaseProofBinder,
  schemaManifest,
  storageActivationChecklist,
  now = new Date()
}: {
  oddsMap: DecisionEplOddsMarketMap;
  interpreter: DecisionEplOddsDryRunInterpreter;
  supabaseProofBinder: DecisionSupabaseProofBinder;
  schemaManifest: DecisionSupabaseSchemaManifest;
  storageActivationChecklist: DecisionStorageActivationChecklist;
  now?: Date;
}): DecisionOddsSnapshotStorageReadiness {
  const tableEvidence = schemaManifest.tables.find((table) => table.table === "op_odds_snapshots");
  const target: DecisionOddsSnapshotStorageReadiness["target"] = {
    projectRef: ODDSPADI_SUPABASE_PROJECT_REF,
    table: "op_odds_snapshots",
    domain: "market-odds",
    localDeclared: Boolean(tableEvidence?.localDeclared),
    localRlsEnabled: Boolean(tableEvidence?.localRlsEnabled),
    localAnonRevoked: Boolean(tableEvidence?.localAnonRevoked),
    localServiceRoleGrant: Boolean(tableEvidence?.localServiceRoleGrant),
    liveStatus: tableEvidence?.liveStatus ?? "not-checked",
    rowCount: tableEvidence?.rowCount ?? null
  };
  const status = statusFor({ interpreter, binder: supabaseProofBinder, storage: storageActivationChecklist, table: target });
  const nextTurn = nextTurnFor(status);
  const requiredSnapshots = oddsMap.totals.requiredSnapshots;
  const gates = [
    gate({
      id: "odds-proof",
      label: "Bookmaker dry-run proof",
      status: interpreter.controls.canUseOddsProofForStorageReview ? "pass" : interpreter.status === "waiting-odds-key" ? "block" : "watch",
      evidence: `${interpreter.input.oddsRows} normalized odds row(s); interpreter ${interpreter.status}.`,
      nextAction: interpreter.controls.canUseOddsProofForStorageReview ? "Use dry-run proof for storage review only." : interpreter.nextTurn.label
    }),
    gate({
      id: "project",
      label: "OddsPadi Supabase target",
      status: supabaseProofBinder.status === "ready-proof" ? "pass" : supabaseProofBinder.status.startsWith("blocked") ? "block" : "watch",
      evidence: `${supabaseProofBinder.status}; expected ${supabaseProofBinder.expected.projectRef}; MCP proof ${supabaseProofBinder.observed.mcpProofRef ?? "missing"}.`,
      nextAction: supabaseProofBinder.status === "ready-proof" ? "Keep project proof attached to the operator receipt." : supabaseProofBinder.nextProof.label
    }),
    gate({
      id: "schema",
      label: "op_odds_snapshots schema",
      status: target.liveStatus === "verified" && target.localDeclared ? "pass" : target.liveStatus === "credential-error" || target.liveStatus === "missing" ? "block" : "watch",
      evidence: `local=${target.localDeclared}; live=${target.liveStatus}; rowCount=${target.rowCount ?? "unknown"}.`,
      nextAction: target.liveStatus === "verified" && target.localDeclared ? "Keep schema proof fresh before write-mode receipts." : "Verify op_odds_snapshots in the OddsPadi schema manifest."
    }),
    gate({
      id: "table-security",
      label: "RLS and grants",
      status: target.localRlsEnabled && target.localAnonRevoked && target.localServiceRoleGrant ? "pass" : "watch",
      evidence: `RLS=${target.localRlsEnabled}; anon/auth revoked=${target.localAnonRevoked}; service role grant=${target.localServiceRoleGrant}.`,
      nextAction: "Keep odds snapshots server-only: RLS enabled, anon/auth revoked, service-role writes only."
    }),
    gate({
      id: "snapshot-shape",
      label: "Snapshot row shape",
      status: "pass",
      evidence: `${columns().filter((column) => column.required).length} required column rules; ${requiredSnapshots} opening/pre-kickoff/closing snapshots planned.`,
      nextAction: "Store only complete provider rows with decimal odds, market, selection, bookmaker, event id, and observed timestamp."
    }),
    gate({
      id: "write-lock",
      label: "Write lock",
      status: "pass",
      evidence: "This packet cannot write odds snapshots, decisions, training rows, public picks, or stake.",
      nextAction: "Use a separate admin-authorized write receipt only after dry-run, storage, and operator review pass."
    })
  ];
  const readinessHash = stableHash({
    date: oddsMap.date,
    status,
    inputs: [interpreter.interpreterHash, interpreter.input.receiptHash, oddsMap.mapHash, storageActivationChecklist.checklistHash, supabaseProofBinder.binderHash],
    target,
    gates: gates.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: now.toISOString(),
    date: oddsMap.date,
    sport: "football",
    mode: "decision-odds-snapshot-storage-readiness",
    status,
    readinessHash,
    summary: summaryFor(status, interpreter.input.oddsRows),
    input: {
      interpreterHash: interpreter.interpreterHash,
      receiptHash: interpreter.input.receiptHash,
      oddsMapHash: oddsMap.mapHash,
      storageChecklistHash: storageActivationChecklist.checklistHash,
      supabaseBinderHash: supabaseProofBinder.binderHash,
      schemaManifestHash: schemaManifest.manifestHash,
      oddsRows: interpreter.input.oddsRows,
      requiredSnapshots
    },
    target,
    columns: columns(),
    gates,
    nextTurn,
    controls: {
      canInspectReadOnly: true,
      canUseOddsProofForStorageReview: interpreter.controls.canUseOddsProofForStorageReview,
      canRequestSchemaProof: status === "needs-storage-proof" || status === "needs-schema-verify",
      canRequestAdminSnapshotWrite: false,
      canWriteOddsSnapshots: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/odds-snapshot-storage-readiness",
      "/api/sports/decision/epl-odds-dry-run-interpreter",
      "/api/sports/decision/supabase-proof-binder",
      "/api/sports/decision/supabase-schema-manifest",
      "/api/sports/decision/storage-activation-checklist",
      nextTurn.verifyUrl,
      ...interpreter.proofUrls,
      ...storageActivationChecklist.proofUrls,
      ...supabaseProofBinder.proofUrls
    ]),
    locks: unique([
      "Odds snapshot storage readiness is read-only and cannot write op_odds_snapshots.",
      "Bookmaker dry-run proof cannot become stored snapshots until OddsPadi project, MCP, credential, schema, and operator review all pass.",
      "Derived double-chance and draw-no-bet alternatives do not write raw provider odds snapshots.",
      "No probability, confidence, learned-weight, public-pick, or stake change is allowed from this storage readiness packet.",
      ...interpreter.locks,
      ...storageActivationChecklist.locks,
      ...supabaseProofBinder.locks
    ])
  };
}
