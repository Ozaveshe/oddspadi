import type { DecisionSupabaseProofBinder } from "@/lib/sports/prediction/decisionSupabaseProofBinder";
import type { DecisionSupabaseProjectIsolation } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";

export type DecisionSupabaseMcpObservationReceiptStatus =
  | "waiting-for-observation"
  | "clean-odds-padi-proof"
  | "missing-op-schema"
  | "blocked-foreign-schema"
  | "blocked-mixed-schema";

export type DecisionSupabaseMcpObservationReceiptGate = {
  id: string;
  label: string;
  status: "pass" | "watch" | "block";
  detail: string;
  nextAction: string;
};

export type DecisionSupabaseMcpObservationReceipt = {
  generatedAt: string;
  mode: "supabase-mcp-observation-receipt";
  status: DecisionSupabaseMcpObservationReceiptStatus;
  receiptHash: string;
  summary: string;
  expected: {
    projectRef: string;
    tableCount: number;
    tables: string[];
  };
  observed: {
    source: string;
    tableCount: number;
    opTableCount: number;
    expectedTablesPresent: string[];
    missingExpectedTables: string[];
    foreignSignals: Array<{
      table: string;
      product: string;
    }>;
    schemaEvidenceStatus: DecisionSupabaseProjectIsolation["detected"]["mcpSchemaEvidence"]["status"];
    isolationStatus: DecisionSupabaseProjectIsolation["status"];
    binderStatus: DecisionSupabaseProofBinder["status"];
  };
  gates: DecisionSupabaseMcpObservationReceiptGate[];
  controls: {
    canTrustMcpForSchema: boolean;
    canApplyMigrations: boolean;
    canPersistDecisions: false;
    canRunProviderWrites: false;
    canTrainModels: false;
    canPublishPicks: false;
  };
  nextAction: string;
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

function gate(input: DecisionSupabaseMcpObservationReceiptGate): DecisionSupabaseMcpObservationReceiptGate {
  return input;
}

function statusFor(evidenceStatus: DecisionSupabaseProjectIsolation["detected"]["mcpSchemaEvidence"]["status"]): DecisionSupabaseMcpObservationReceiptStatus {
  if (evidenceStatus === "odds-padi-proof") return "clean-odds-padi-proof";
  if (evidenceStatus === "foreign-schema") return "blocked-foreign-schema";
  if (evidenceStatus === "mixed-schema") return "blocked-mixed-schema";
  if (evidenceStatus === "missing-op-schema") return "missing-op-schema";
  return "waiting-for-observation";
}

function summaryFor(status: DecisionSupabaseMcpObservationReceiptStatus, tableCount: number, opTableCount: number): string {
  if (status === "clean-odds-padi-proof") return "Live MCP observation includes the expected OddsPadi op_ schema; schema work can move to the remaining binder gates.";
  if (status === "blocked-foreign-schema") return "Live MCP observation exposes foreign product tables, so OddsPadi migrations, writes, training, and publishing stay locked.";
  if (status === "blocked-mixed-schema") return "Live MCP observation mixes OddsPadi and foreign schema signals, so the project target must be corrected before schema work.";
  if (status === "missing-op-schema") return `Live MCP observation has ${opTableCount} op_ table(s) across ${tableCount} table(s), but not the complete OddsPadi schema.`;
  return "No live MCP table-list observation is attached yet; this receipt is waiting for read-only evidence.";
}

export function buildDecisionSupabaseMcpObservationReceipt({
  isolation,
  binder,
  now = new Date()
}: {
  isolation: DecisionSupabaseProjectIsolation;
  binder: DecisionSupabaseProofBinder;
  now?: Date;
}): DecisionSupabaseMcpObservationReceipt {
  const evidence = isolation.detected.mcpSchemaEvidence;
  const status = statusFor(evidence.status);
  const foreignSignals = evidence.foreignSchemaSignals
    .filter((signal) => signal.status === "present")
    .map((signal) => ({ table: signal.table, product: signal.product }));
  const cleanMcpProof = status === "clean-odds-padi-proof";
  const canTrustMcpForSchema = cleanMcpProof && binder.controls.canUseMcpForSchema;
  const gates = [
    gate({
      id: "table-list-attached",
      label: "MCP table list attached",
      status: evidence.status === "not-provided" ? "watch" : "pass",
      detail:
        evidence.status === "not-provided"
          ? "Attach the live MCP list_tables output through observedMcpTables or ODDSPADI_SUPABASE_MCP_OBSERVED_TABLES."
          : `Observed ${evidence.observedTables.length} table(s) from ${evidence.source}.`,
      nextAction:
        evidence.status === "not-provided"
          ? "Capture a read-only table list from the project-scoped Supabase MCP session."
          : "Keep this table list with the activation receipt."
    }),
    gate({
      id: "foreign-sentinel-check",
      label: "Foreign sentinel check",
      status: foreignSignals.length ? "block" : "pass",
      detail: foreignSignals.length
        ? `Foreign table signal(s): ${foreignSignals.map((signal) => `${signal.table} (${signal.product})`).join(", ")}.`
        : "No known AfroTools, LATMtools, Matchday, payroll, scholarship, or creator sentinel tables are present in the attached observation.",
      nextAction: foreignSignals.length ? "Switch the MCP session/project before running migrations or persistence." : "Continue to op_ schema coverage."
    }),
    gate({
      id: "rls-advisory",
      label: "RLS advisor signal",
      status: evidence.observedTables.includes("spatial_ref_sys") ? "block" : "pass",
      detail: evidence.observedTables.includes("spatial_ref_sys")
        ? "The live MCP observation includes public.spatial_ref_sys. The Supabase advisor reported this table with RLS disabled; do not apply migrations or expose Data API access until the operator reviews the extension-table policy."
        : "No public.spatial_ref_sys RLS advisory signal is attached to this observation.",
      nextAction: evidence.observedTables.includes("spatial_ref_sys")
        ? "Review the Supabase advisor finding for public.spatial_ref_sys and decide whether to enable RLS or keep the extension table isolated before continuing schema work."
        : "Continue to op_ schema coverage."
    }),
    gate({
      id: "expected-op-schema",
      label: "Expected op_ schema",
      status: cleanMcpProof ? "pass" : evidence.status === "foreign-schema" || evidence.status === "mixed-schema" ? "block" : "watch",
      detail: `${evidence.expectedTablesPresent.length}/${binder.expected.tableCount} expected OddsPadi table(s) observed; ${evidence.missingExpectedTables.length} missing.`,
      nextAction: cleanMcpProof ? "Use the Supabase proof binder to evaluate credentials and migration controls." : "Attach a table list that includes every expected OddsPadi op_ table."
    }),
    gate({
      id: "binder-alignment",
      label: "Binder alignment",
      status: canTrustMcpForSchema ? "pass" : binder.status === "blocked-cross-project" ? "block" : "watch",
      detail: `Proof binder status is ${binder.status}; MCP schema control is ${binder.controls.canUseMcpForSchema ? "ready" : "held"}.`,
      nextAction: canTrustMcpForSchema ? "Proceed only through the binder's next safe proof." : binder.nextProof.expectedEvidence
    })
  ];
  const nextGate = gates.find((item) => item.status === "block") ?? gates.find((item) => item.status === "watch") ?? null;
  const receiptHash = stableHash({
    status,
    expected: binder.expected.tables,
    observed: evidence.observedTables,
    isolationStatus: isolation.status,
    binderStatus: binder.status,
    gates: gates.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: now.toISOString(),
    mode: "supabase-mcp-observation-receipt",
    status,
    receiptHash,
    summary: summaryFor(status, evidence.observedTables.length, evidence.opTableCount),
    expected: {
      projectRef: binder.expected.projectRef,
      tableCount: binder.expected.tableCount,
      tables: binder.expected.tables
    },
    observed: {
      source: evidence.source,
      tableCount: evidence.observedTables.length,
      opTableCount: evidence.opTableCount,
      expectedTablesPresent: evidence.expectedTablesPresent,
      missingExpectedTables: evidence.missingExpectedTables,
      foreignSignals,
      schemaEvidenceStatus: evidence.status,
      isolationStatus: isolation.status,
      binderStatus: binder.status
    },
    gates,
    controls: {
      canTrustMcpForSchema,
      canApplyMigrations: canTrustMcpForSchema && binder.controls.canApplyMigrations,
      canPersistDecisions: false,
      canRunProviderWrites: false,
      canTrainModels: false,
      canPublishPicks: false
    },
    nextAction: nextGate?.nextAction ?? "Keep the observation receipt attached to the activation packet.",
    locks: [
      "No Supabase migrations through an MCP session with foreign or mixed schema evidence.",
      "No Supabase schema work should ignore RLS advisor findings such as public.spatial_ref_sys with RLS disabled.",
      "No decision persistence until the proof binder is ready and write controls are separately approved.",
      "No provider write backfill, model training, or public pick publishing from MCP observation alone."
    ],
    proofUrls: [
      "/api/sports/decision/supabase-mcp-observation-receipt",
      "/api/sports/decision/supabase-project-isolation",
      "/api/sports/decision/supabase-proof-binder"
    ]
  };
}
