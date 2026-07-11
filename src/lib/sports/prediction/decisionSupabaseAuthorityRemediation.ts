import type { DecisionSupabaseMcpObservationReceipt } from "@/lib/sports/prediction/decisionSupabaseMcpObservationReceipt";
import type { DecisionSupabaseProofBinder } from "@/lib/sports/prediction/decisionSupabaseProofBinder";
import type { DecisionSupabaseProjectIsolation } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";

export type DecisionSupabaseAuthorityRemediationStatus =
  | "clean-authority"
  | "blocked-mixed-public-schema"
  | "blocked-foreign-public-schema"
  | "waiting-live-observation";

export type DecisionSupabaseAuthorityRemediationOption = {
  id: "clean-project-reseed" | "dedicated-schema" | "accept-mixed-public-schema";
  label: string;
  status: "recommended" | "available-after-approval" | "rejected";
  detail: string;
  nextAction: string;
  risk: "low" | "medium" | "high";
  unlocks: string[];
};

export type DecisionSupabaseAuthorityRemediation = {
  generatedAt: string;
  mode: "supabase-authority-remediation";
  status: DecisionSupabaseAuthorityRemediationStatus;
  remediationHash: string;
  summary: string;
  authority: {
    expectedProjectRef: string;
    observedProjectRef: string | null;
    schemaEvidenceStatus: DecisionSupabaseMcpObservationReceipt["observed"]["schemaEvidenceStatus"];
    opTableCount: number;
    expectedOpTables: number;
    foreignSignalCount: number;
    foreignSignals: DecisionSupabaseMcpObservationReceipt["observed"]["foreignSignals"];
  };
  recommendedOption: DecisionSupabaseAuthorityRemediationOption;
  options: DecisionSupabaseAuthorityRemediationOption[];
  controls: {
    canInspectReadOnly: true;
    canApplyMigrations: false;
    canRunProviderWrites: false;
    canPersistDecisions: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  nextAction: {
    label: string;
    proofUrl: string;
    requiresOperatorApproval: true;
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

function compact(value: string, maxLength = 280): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...` : normalized;
}

function option(input: DecisionSupabaseAuthorityRemediationOption): DecisionSupabaseAuthorityRemediationOption {
  return {
    ...input,
    detail: compact(input.detail),
    nextAction: compact(input.nextAction),
    unlocks: Array.from(new Set(input.unlocks)).slice(0, 8)
  };
}

function statusFor(receipt: DecisionSupabaseMcpObservationReceipt): DecisionSupabaseAuthorityRemediationStatus {
  if (receipt.status === "clean-odds-padi-proof" && receipt.controls.canTrustMcpForSchema) return "clean-authority";
  if (receipt.status === "blocked-mixed-schema") return "blocked-mixed-public-schema";
  if (receipt.status === "blocked-foreign-schema") return "blocked-foreign-public-schema";
  return "waiting-live-observation";
}

function summaryFor(status: DecisionSupabaseAuthorityRemediationStatus, receipt: DecisionSupabaseMcpObservationReceipt): string {
  if (status === "clean-authority") return "Supabase authority is clean for OddsPadi schema proof; writes still need separate operator receipts.";
  if (status === "blocked-mixed-public-schema") {
    return `Supabase authority is blocked: ${receipt.observed.opTableCount} OddsPadi op_ table(s) share public schema with ${receipt.observed.foreignSignals.length} foreign sentinel signal(s).`;
  }
  if (status === "blocked-foreign-public-schema") return "Supabase authority is blocked because the live public schema looks like another product database.";
  return "Supabase authority is waiting for a live MCP table-list observation before any schema or write path can unlock.";
}

export function buildDecisionSupabaseAuthorityRemediation({
  isolation,
  binder,
  mcpObservationReceipt,
  now = new Date()
}: {
  isolation: DecisionSupabaseProjectIsolation;
  binder: DecisionSupabaseProofBinder;
  mcpObservationReceipt: DecisionSupabaseMcpObservationReceipt;
  now?: Date;
}): DecisionSupabaseAuthorityRemediation {
  const status = statusFor(mcpObservationReceipt);
  const mixedOrForeign = status === "blocked-mixed-public-schema" || status === "blocked-foreign-public-schema";
  const cleanProject = option({
    id: "clean-project-reseed",
    label: "Use a clean OddsPadi Supabase project",
    status: status === "clean-authority" ? "available-after-approval" : "recommended",
    detail: "Point SUPABASE_URL, SUPABASE_PROJECT_REF, service role credentials, Netlify env, and repo MCP at a project whose public schema contains only OddsPadi-owned op_ tables plus safe platform extension tables.",
    nextAction: "Confirm the clean OddsPadi project, attach a fresh MCP list_tables receipt, then run the existing OddsPadi migrations through the approved migration flow.",
    risk: "low",
    unlocks: ["schema proof", "provider writes", "odds snapshots", "training corpus backfill"]
  });
  const dedicatedSchema = option({
    id: "dedicated-schema",
    label: "Move OddsPadi into a dedicated schema",
    status: mixedOrForeign ? "available-after-approval" : "rejected",
    detail: "Keep the current project but move OddsPadi tables and APIs into an oddspadi schema, then update all server queries, grants, RLS policies, and provider write paths to use that schema.",
    nextAction: "Only choose this after operator approval because it is a larger code/database migration and still leaves foreign product data in the same project.",
    risk: "medium",
    unlocks: ["schema isolation", "reduced public-schema collision", "future multi-product coexistence"]
  });
  const acceptMixed = option({
    id: "accept-mixed-public-schema",
    label: "Accept the mixed public schema",
    status: "rejected",
    detail: "Do not treat a mixed public schema as production authority for a betting decision engine; it risks wrong writes, polluted training data, and accidental cross-product access assumptions.",
    nextAction: "Keep all writes, training, publishing, staking, and OpenAI live decision upgrades locked.",
    risk: "high",
    unlocks: []
  });
  const options = [cleanProject, dedicatedSchema, acceptMixed];
  const recommendedOption = status === "clean-authority" ? dedicatedSchema : cleanProject;

  return {
    generatedAt: now.toISOString(),
    mode: "supabase-authority-remediation",
    status,
    remediationHash: stableHash({
      status,
      isolation: isolation.status,
      binder: binder.status,
      observed: mcpObservationReceipt.observed,
      options: options.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status, mcpObservationReceipt),
    authority: {
      expectedProjectRef: binder.expected.projectRef,
      observedProjectRef: isolation.detected.observedMcpProjectRef,
      schemaEvidenceStatus: mcpObservationReceipt.observed.schemaEvidenceStatus,
      opTableCount: mcpObservationReceipt.observed.opTableCount,
      expectedOpTables: mcpObservationReceipt.expected.tableCount,
      foreignSignalCount: mcpObservationReceipt.observed.foreignSignals.length,
      foreignSignals: mcpObservationReceipt.observed.foreignSignals
    },
    recommendedOption,
    options,
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
      label: recommendedOption.nextAction,
      proofUrl: "/api/sports/decision/supabase-mcp-observation-receipt",
      requiresOperatorApproval: true
    },
    proofUrls: [
      "/api/sports/decision/supabase-authority-remediation",
      "/api/sports/decision/supabase-mcp-observation-receipt",
      "/api/sports/decision/supabase-project-isolation",
      "/api/sports/decision/supabase-proof-binder"
    ],
    locks: [
      "Do not apply migrations while MCP evidence shows a mixed or foreign public schema.",
      "Do not run provider writes, persist decisions, write training rows, train models, publish picks, stake, or upgrade public action from a mixed authority target.",
      "Use a clean project or explicitly approved dedicated-schema migration before storage gates can unlock."
    ]
  };
}
