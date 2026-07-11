import { describe, expect, it } from "vitest";
import {
  buildDecisionSupabaseCleanProjectCutover,
  type DecisionSupabaseCleanProjectCutover
} from "@/lib/sports/prediction/decisionSupabaseCleanProjectCutover";
import type { DecisionSupabaseAuthorityRemediation } from "@/lib/sports/prediction/decisionSupabaseAuthorityRemediation";
import type { DecisionSupabaseMcpObservationReceipt } from "@/lib/sports/prediction/decisionSupabaseMcpObservationReceipt";
import type { DecisionSupabaseProofBinder } from "@/lib/sports/prediction/decisionSupabaseProofBinder";

const expectedRef = "wncwtzqipnoqwmqlznqn";
const expectedUrl = `https://${expectedRef}.supabase.co`;

function remediation(overrides: Partial<DecisionSupabaseAuthorityRemediation> = {}): DecisionSupabaseAuthorityRemediation {
  return {
    generatedAt: "2026-07-09T00:00:00.000Z",
    mode: "supabase-authority-remediation",
    status: "blocked-mixed-public-schema",
    remediationHash: "fnv1a-remediation",
    summary: "Supabase authority is blocked by mixed schema evidence.",
    authority: {
      expectedProjectRef: expectedRef,
      observedProjectRef: expectedRef,
      schemaEvidenceStatus: "mixed-schema",
      opTableCount: 23,
      expectedOpTables: 23,
      foreignSignalCount: 6,
      foreignSignals: [
        { table: "as_news", product: "AfroTools/AfroStream" },
        { table: "scholarships", product: "AfroTools Scholarship Finder" }
      ]
    },
    recommendedOption: {
      id: "clean-project-reseed",
      label: "Use a clean OddsPadi Supabase project",
      status: "recommended",
      detail: "Use clean project.",
      nextAction: "Confirm clean project.",
      risk: "low",
      unlocks: ["schema proof"]
    },
    options: [],
    controls: {
      canInspectReadOnly: true,
      canApplyMigrations: false,
      canRunProviderWrites: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    nextAction: {
      label: "Confirm clean project.",
      proofUrl: "/api/sports/decision/supabase-mcp-observation-receipt",
      requiresOperatorApproval: true
    },
    proofUrls: [],
    locks: [],
    ...overrides
  };
}

function binder(overrides: Partial<DecisionSupabaseProofBinder> = {}): DecisionSupabaseProofBinder {
  return {
    generatedAt: "2026-07-09T00:00:00.000Z",
    mode: "supabase-proof-binder",
    status: "blocked-cross-project",
    binderHash: "fnv1a-binder",
    summary: "Blocked by mixed schema.",
    expected: {
      projectRef: expectedRef,
      projectUrl: expectedUrl,
      tableCount: 23,
      tables: ["op_model_versions", "op_decision_runs"]
    },
    observed: {
      configuredRef: expectedRef,
      urlRef: expectedRef,
      linkedRef: expectedRef,
      repoMcpRef: expectedRef,
      mcpProofRef: expectedRef,
      repoMcpScoped: true,
      mcpSchemaEvidence: {
        status: "mixed-schema",
        source: "observed-mcp-table-list",
        observedTables: ["op_model_versions", "op_decision_runs", "as_news"],
        opTableCount: 2,
        expectedTablesPresent: ["op_model_versions", "op_decision_runs"],
        missingExpectedTables: [],
        foreignSchemaSignals: [{ table: "as_news", product: "AfroTools/AfroStream", status: "present", error: null }],
        summary: "Live MCP table list mixes OddsPadi op_ tables with foreign sentinel tables."
      },
      schemaStatus: "blocked",
      credentialStatus: "valid",
      verifiedTableCount: 23,
      missingTables: [],
      inaccessibleTables: [],
      foreignSchemaSignals: [{ table: "as_news", product: "AfroTools/AfroStream", status: "present", error: null }]
    },
    local: {
      migrationCount: 10,
      migrations: [],
      declaresExpectedTables: true,
      missingDeclaredTables: []
    },
    gates: [],
    nextProof: {
      label: "MCP schema evidence",
      command: "curl.exe -sS /api/sports/decision/supabase-project-isolation",
      verifyUrl: "/api/sports/decision/supabase-project-isolation",
      safeToRun: true,
      expectedEvidence: "Switch the active MCP project.",
      missingEnv: []
    },
    controls: {
      canInspectReadOnly: true,
      canUseMcpForSchema: false,
      canApplyMigrations: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canUpgradePublicAction: false
    },
    locks: [],
    proofUrls: [],
    ...overrides
  };
}

function receipt(overrides: Partial<DecisionSupabaseMcpObservationReceipt> = {}): DecisionSupabaseMcpObservationReceipt {
  return {
    generatedAt: "2026-07-09T00:00:00.000Z",
    mode: "supabase-mcp-observation-receipt",
    status: "blocked-mixed-schema",
    receiptHash: "fnv1a-receipt",
    summary: "Live MCP observation mixes OddsPadi and foreign schema signals.",
    expected: {
      projectRef: expectedRef,
      tableCount: 23,
      tables: ["op_model_versions", "op_decision_runs"]
    },
    observed: {
      source: "observed-mcp-table-list",
      tableCount: 8,
      opTableCount: 2,
      expectedTablesPresent: ["op_model_versions", "op_decision_runs"],
      missingExpectedTables: [],
      foreignSignals: [{ table: "as_news", product: "AfroTools/AfroStream" }],
      schemaEvidenceStatus: "mixed-schema",
      isolationStatus: "blocked-cross-project",
      binderStatus: "blocked-cross-project"
    },
    gates: [],
    controls: {
      canTrustMcpForSchema: false,
      canApplyMigrations: false,
      canPersistDecisions: false,
      canRunProviderWrites: false,
      canTrainModels: false,
      canPublishPicks: false
    },
    nextAction: "Switch the MCP session.",
    locks: [],
    proofUrls: [],
    ...overrides
  };
}

describe("Supabase clean-project cutover checklist", () => {
  it("makes clean project confirmation the active step when mixed schema evidence blocks writes", () => {
    const cutover = buildDecisionSupabaseCleanProjectCutover({
      remediation: remediation(),
      binder: binder(),
      mcpObservationReceipt: receipt(),
      workspaceRoot: process.cwd(),
      now: new Date("2026-07-09T18:00:00.000Z")
    });

    expect(cutover.status).toBe("blocked-current-target");
    expect(cutover.cutoverChecklist.activeStepId).toBe("confirm-clean-project");
    expect(cutover.cutoverChecklist.steps[0]).toMatchObject({
      id: "confirm-clean-project",
      status: "next",
      owner: "operator"
    });
    expect(cutover.cutoverChecklist.steps.find((step) => step.id === "review-apply-migrations")?.status).toBe("locked");
    expect(cutover.controls.canApplyMigrations).toBe(false);
    expect(cutover.controls.canRunProviderWrites).toBe(false);
    expect(cutover.controls.canTrainModels).toBe(false);
  });

  it("advances to migration review only after clean authority and clean MCP proof", () => {
    const cutover = buildDecisionSupabaseCleanProjectCutover({
      remediation: remediation({
        status: "clean-authority",
        summary: "Supabase authority is clean.",
        authority: {
          expectedProjectRef: expectedRef,
          observedProjectRef: expectedRef,
          schemaEvidenceStatus: "odds-padi-proof",
          opTableCount: 23,
          expectedOpTables: 23,
          foreignSignalCount: 0,
          foreignSignals: []
        }
      }),
      binder: binder({
        status: "needs-schema-proof",
        observed: {
          ...binder().observed,
          mcpSchemaEvidence: {
            ...binder().observed.mcpSchemaEvidence,
            status: "odds-padi-proof",
            foreignSchemaSignals: [],
            observedTables: ["op_model_versions", "op_decision_runs"],
            summary: "Live MCP table list includes all expected OddsPadi op_ tables."
          },
          foreignSchemaSignals: []
        },
        controls: {
          ...binder().controls,
          canUseMcpForSchema: true,
          canApplyMigrations: true
        }
      }),
      mcpObservationReceipt: receipt({
        status: "clean-odds-padi-proof",
        observed: {
          ...receipt().observed,
          foreignSignals: [],
          schemaEvidenceStatus: "odds-padi-proof",
          isolationStatus: "needs-schema-proof",
          binderStatus: "needs-schema-proof"
        },
        controls: {
          ...receipt().controls,
          canTrustMcpForSchema: true,
          canApplyMigrations: true
        }
      }),
      workspaceRoot: process.cwd(),
      now: new Date("2026-07-09T18:05:00.000Z")
    });

    expect(cutover.status).toBe("ready-migration-review");
    expect(cutover.cutoverChecklist.activeStepId).toBe("review-apply-migrations");
    expect(cutover.cutoverChecklist.steps.find((step) => step.id === "review-apply-migrations")?.status).toBe("next");
    expect(cutover.cutoverChecklist.steps.find((step) => step.id === "rerun-storage-proof")?.status).toBe("locked");
    expect(cutover.controls.canApplyMigrations).toBe(true);
  });
});
