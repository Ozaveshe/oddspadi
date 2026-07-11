import type { DecisionSupabaseProofBinder } from "@/lib/sports/prediction/decisionSupabaseProofBinder";
import type { DecisionSupabaseProjectIsolation } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";
import type { DecisionSupabaseSchemaManifest } from "@/lib/sports/prediction/decisionSupabaseSchemaManifest";

export type DecisionSupabaseContainmentPolicyStatus =
  | "clean-authoritative"
  | "contained-dry-run"
  | "missing-op-schema"
  | "blocked-foreign-only"
  | "blocked-credentials"
  | "needs-project-proof";

export type DecisionSupabaseContainmentPolicy = {
  generatedAt: string;
  mode: "supabase-containment-policy";
  status: DecisionSupabaseContainmentPolicyStatus;
  summary: string;
  policyHash: string;
  evidence: {
    isolationStatus: DecisionSupabaseProjectIsolation["status"];
    binderStatus: DecisionSupabaseProofBinder["status"];
    schemaManifestStatus: DecisionSupabaseSchemaManifest["status"];
    mcpSchemaEvidenceStatus: DecisionSupabaseProjectIsolation["detected"]["mcpSchemaEvidence"]["status"];
    expectedTables: number;
    expectedTablesPresent: number;
    liveVerifiedTables: number;
    missingExpectedTables: string[];
    foreignSignals: Array<{
      table: string;
      product: string;
    }>;
  };
  controls: {
    canInspectReadOnly: true;
    canRunProviderDryRun: boolean;
    canUseOpTablesAsReadScope: boolean;
    canApplyMigrations: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
    canUpgradePublicAction: false;
  };
  dryRunBoundary: {
    allowed: boolean;
    reason: string;
    allowedActions: string[];
    forbiddenActions: string[];
  };
  nextAction: {
    label: string;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
  };
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

function statusFor({
  isolation,
  binder,
  manifest
}: {
  isolation: DecisionSupabaseProjectIsolation;
  binder: DecisionSupabaseProofBinder;
  manifest: DecisionSupabaseSchemaManifest;
}): DecisionSupabaseContainmentPolicyStatus {
  const evidence = isolation.detected.mcpSchemaEvidence;
  const expectedTables = binder.expected.tableCount;
  const completeObservedOpSchema = evidence.expectedTablesPresent.length === expectedTables && evidence.missingExpectedTables.length === 0;
  const completeLiveOpSchema = manifest.inventory.liveVerifiedTables === manifest.inventory.expectedTables && manifest.inventory.expectedTables === expectedTables;
  const hasForeign = evidence.foreignSchemaSignals.some((signal) => signal.status === "present");

  if (!manifest.project.targetMatchesExpected) return "needs-project-proof";
  if (binder.status === "ready-proof" && manifest.status === "ready-live-schema" && !hasForeign) return "clean-authoritative";
  if (completeObservedOpSchema && completeLiveOpSchema && hasForeign) return "contained-dry-run";
  if (manifest.status === "blocked-credentials" || binder.status === "blocked-invalid-key") return "blocked-credentials";
  if (hasForeign && !completeObservedOpSchema) return "blocked-foreign-only";
  return "missing-op-schema";
}

function summaryFor(status: DecisionSupabaseContainmentPolicyStatus, expectedPresent: number, expectedTables: number, foreignCount: number): string {
  if (status === "clean-authoritative") return "Supabase target is clean and authoritative for OddsPadi proof review; write paths still require their own receipts.";
  if (status === "contained-dry-run") {
    return `All ${expectedPresent}/${expectedTables} OddsPadi op_ tables are present, but ${foreignCount} foreign signal(s) keep writes, migrations, training, and publishing locked. Provider dry-runs may run read-only.`;
  }
  if (status === "blocked-credentials") return "Supabase containment is blocked because the server credential was rejected.";
  if (status === "needs-project-proof") return "Supabase containment needs the OddsPadi project target to be proven before any provider rehearsal.";
  if (status === "blocked-foreign-only") return "Supabase containment is blocked because foreign schema signals are present without a complete OddsPadi op_ schema.";
  return `Supabase containment is missing required OddsPadi op_ schema coverage: ${expectedPresent}/${expectedTables} expected tables observed.`;
}

export function buildDecisionSupabaseContainmentPolicy({
  isolation,
  binder,
  manifest,
  now = new Date()
}: {
  isolation: DecisionSupabaseProjectIsolation;
  binder: DecisionSupabaseProofBinder;
  manifest: DecisionSupabaseSchemaManifest;
  now?: Date;
}): DecisionSupabaseContainmentPolicy {
  const evidence = isolation.detected.mcpSchemaEvidence;
  const foreignSignals = evidence.foreignSchemaSignals
    .filter((signal) => signal.status === "present")
    .map((signal) => ({ table: signal.table, product: signal.product }));
  const status = statusFor({ isolation, binder, manifest });
  const canRunProviderDryRun = status === "clean-authoritative" || status === "contained-dry-run";
  const summary = summaryFor(status, evidence.expectedTablesPresent.length, binder.expected.tableCount, foreignSignals.length);

  return {
    generatedAt: now.toISOString(),
    mode: "supabase-containment-policy",
    status,
    summary,
    policyHash: stableHash({
      status,
      isolation: isolation.isolationHash,
      binder: binder.binderHash,
      manifest: manifest.manifestHash,
      expectedPresent: evidence.expectedTablesPresent,
      foreignSignals
    }),
    evidence: {
      isolationStatus: isolation.status,
      binderStatus: binder.status,
      schemaManifestStatus: manifest.status,
      mcpSchemaEvidenceStatus: evidence.status,
      expectedTables: binder.expected.tableCount,
      expectedTablesPresent: evidence.expectedTablesPresent.length,
      liveVerifiedTables: manifest.inventory.liveVerifiedTables,
      missingExpectedTables: evidence.missingExpectedTables,
      foreignSignals
    },
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun,
      canUseOpTablesAsReadScope: canRunProviderDryRun,
      canApplyMigrations: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canUpgradePublicAction: false
    },
    dryRunBoundary: {
      allowed: canRunProviderDryRun,
      reason: summary,
      allowedActions: canRunProviderDryRun
        ? ["Run provider dry-runs with dryRun=1.", "Compare normalized counts against op_ table expectations.", "Review provider payload shape without writing rows."]
        : ["Inspect read-only proof APIs."],
      forbiddenActions: [
        "Do not apply migrations from a mixed schema observation.",
        "Do not write provider rows or raw payloads.",
        "Do not persist decisions, train models, publish picks, stake, or upgrade public action.",
        "Do not treat foreign public tables as OddsPadi training evidence."
      ]
    },
    nextAction: {
      label: canRunProviderDryRun ? "Run the first provider dry-run when provider keys are present" : "Resolve Supabase containment proof",
      verifyUrl: canRunProviderDryRun ? "/api/sports/decision/provider-batch-manifest" : "/api/sports/decision/supabase-mcp-observation-receipt",
      safeToRun: true,
      expectedEvidence: canRunProviderDryRun
        ? "Provider batch manifest exposes dryRun=1 commands while write, train, publish, and migration controls stay false."
        : "MCP observation returns a complete OddsPadi op_ table list without foreign sentinels, or the target remains read-only."
    },
    proofUrls: [
      "/api/sports/decision/supabase-containment-policy",
      "/api/sports/decision/supabase-project-isolation",
      "/api/sports/decision/supabase-mcp-observation-receipt",
      "/api/sports/decision/supabase-schema-manifest",
      "/api/sports/decision/provider-batch-manifest"
    ]
  };
}
