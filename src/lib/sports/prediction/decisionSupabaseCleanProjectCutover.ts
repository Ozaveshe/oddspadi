import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DecisionSupabaseAuthorityRemediation } from "@/lib/sports/prediction/decisionSupabaseAuthorityRemediation";
import type { DecisionSupabaseMcpObservationReceipt } from "@/lib/sports/prediction/decisionSupabaseMcpObservationReceipt";
import type { DecisionSupabaseProofBinder } from "@/lib/sports/prediction/decisionSupabaseProofBinder";

export type DecisionSupabaseCleanProjectCutoverStatus =
  | "blocked-current-target"
  | "waiting-clean-project-proof"
  | "ready-migration-review"
  | "clean-authority-ready";

export type DecisionSupabaseCleanProjectCutoverGateStatus = "pass" | "watch" | "block";

export type DecisionSupabaseCleanProjectCutoverGate = {
  id:
    | "current-authority"
    | "operator-approval"
    | "environment-cutover"
    | "mcp-clean-observation"
    | "migration-inventory"
    | "security-advisors"
    | "write-locks";
  label: string;
  status: DecisionSupabaseCleanProjectCutoverGateStatus;
  detail: string;
  requiredEvidence: string;
};

export type DecisionSupabaseCleanProjectCutoverMigration = {
  file: string;
  order: number;
  purpose: string;
};

export type DecisionSupabaseCleanProjectCutoverStep = {
  id:
    | "confirm-clean-project"
    | "switch-runtime-env"
    | "capture-clean-mcp-observation"
    | "review-apply-migrations"
    | "rerun-storage-proof"
    | "resume-provider-dry-runs";
  label: string;
  status: "done" | "next" | "locked";
  owner: "operator" | "codex";
  detail: string;
  expectedEvidence: string;
  proofUrl: string;
  command: string | null;
  safeToRun: boolean;
};

export type DecisionSupabaseCleanProjectCutover = {
  generatedAt: string;
  mode: "supabase-clean-project-cutover";
  status: DecisionSupabaseCleanProjectCutoverStatus;
  cutoverHash: string;
  summary: string;
  target: {
    expectedProjectRef: string;
    expectedProjectUrl: string;
    currentSchemaEvidence: DecisionSupabaseMcpObservationReceipt["observed"]["schemaEvidenceStatus"];
    currentForeignSignalCount: number;
    expectedOpTableCount: number;
  };
  migrationPlan: {
    migrationCount: number;
    migrations: DecisionSupabaseCleanProjectCutoverMigration[];
    expectedTablesAfterApply: number;
  };
  cutoverChecklist: {
    activeStepId: DecisionSupabaseCleanProjectCutoverStep["id"] | null;
    steps: DecisionSupabaseCleanProjectCutoverStep[];
  };
  gates: DecisionSupabaseCleanProjectCutoverGate[];
  nextAction: {
    label: string;
    proofUrl: string;
    command: string | null;
    safeToRun: boolean;
  };
  controls: {
    canInspectReadOnly: true;
    canApplyMigrations: boolean;
    canRunProviderWrites: false;
    canPersistDecisions: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
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

function migrationPurpose(file: string): string {
  if (file.includes("decision_engine_foundation")) return "Core decision runs, model versions, provider ingestion, and raw provider payloads.";
  if (file.includes("decision_agent_trace")) return "Agent trace columns for stored decision runs.";
  if (file.includes("decision_learning_loop")) return "Outcome settlement and calibration loop.";
  if (file.includes("historical_training_backtest_spine")) return "Fixture, odds, feature, standings, lineup, event, news, weather, and backtest spine.";
  if (file.includes("decision_context_snapshot")) return "Persisted context-adjustment snapshot.";
  if (file.includes("ai_thought_episodes")) return "Private AI thought episode audit ledger.";
  if (file.includes("decision_briefing_runs")) return "Decision briefing ledger.";
  if (file.includes("shadow_memory_replay")) return "Shadow memory replay storage.";
  if (file.includes("backtest_calibration_metrics")) return "Backtest calibration metric columns.";
  return "OddsPadi schema migration.";
}

function listMigrations(workspaceRoot: string): DecisionSupabaseCleanProjectCutoverMigration[] {
  const dir = join(workspaceRoot, "supabase", "migrations");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b))
    .map((file, index) => ({
      file,
      order: index + 1,
      purpose: migrationPurpose(file)
    }));
}

function gate(input: DecisionSupabaseCleanProjectCutoverGate): DecisionSupabaseCleanProjectCutoverGate {
  return {
    ...input,
    detail: compact(input.detail),
    requiredEvidence: compact(input.requiredEvidence)
  };
}

function checklistStep(input: Omit<DecisionSupabaseCleanProjectCutoverStep, "status"> & { done: boolean }): DecisionSupabaseCleanProjectCutoverStep {
  const { done, ...step } = input;
  return {
    ...step,
    status: done ? "done" : "locked",
    detail: compact(step.detail),
    expectedEvidence: compact(step.expectedEvidence)
  };
}

function buildCutoverChecklist({
  currentAuthorityClean,
  cleanObservation,
  hasMigrations,
  canApplyMigrations,
  expectedProjectRef,
  expectedProjectUrl,
  configuredRef,
  repoMcpRef,
  foreignSignals
}: {
  currentAuthorityClean: boolean;
  cleanObservation: boolean;
  hasMigrations: boolean;
  canApplyMigrations: boolean;
  expectedProjectRef: string;
  expectedProjectUrl: string;
  configuredRef: string | null;
  repoMcpRef: string | null;
  foreignSignals: number;
}): DecisionSupabaseCleanProjectCutover["cutoverChecklist"] {
  const runtimeEnvDone = currentAuthorityClean && configuredRef === expectedProjectRef && repoMcpRef === expectedProjectRef;
  const storageProofDone = false;
  const rawSteps = [
    checklistStep({
      id: "confirm-clean-project",
      label: "Confirm clean OddsPadi project",
      owner: "operator",
      done: currentAuthorityClean,
      detail: currentAuthorityClean
        ? "Authority is clean for OddsPadi schema proof."
        : `Current authority still has ${foreignSignals} foreign schema signal(s); choose a clean OddsPadi project before writes.`,
      expectedEvidence: `Supabase dashboard and MCP project URL both point at ${expectedProjectRef}, with no AfroTools, LATMtools, Matchday, payroll, creator, or scholarship sentinel tables.`,
      proofUrl: "/api/sports/decision/supabase-mcp-observation-receipt",
      command: null,
      safeToRun: false
    }),
    checklistStep({
      id: "switch-runtime-env",
      label: "Switch local and Netlify env",
      owner: "operator",
      done: runtimeEnvDone,
      detail: `Expected ${expectedProjectRef}; configured ${configuredRef ?? "missing"}; repo MCP ${repoMcpRef ?? "missing"}.`,
      expectedEvidence: `Local runtime, Netlify runtime, Supabase URL, service key, publishable key, and repo MCP all point at ${expectedProjectUrl}.`,
      proofUrl: "/api/sports/decision/supabase-project-isolation",
      command: null,
      safeToRun: false
    }),
    checklistStep({
      id: "capture-clean-mcp-observation",
      label: "Capture clean MCP observation",
      owner: "codex",
      done: cleanObservation,
      detail: cleanObservation
        ? "MCP observation is clean and contains the expected OddsPadi op_ schema."
        : "The active Supabase MCP observation is missing, foreign, or mixed; do not trust it for schema writes.",
      expectedEvidence: "Fresh project-scoped Supabase MCP list_tables output shows all expected OddsPadi op_ tables and zero known foreign sentinels.",
      proofUrl: "/api/sports/decision/supabase-mcp-observation-receipt",
      command: "Use Supabase MCP list_tables against the clean OddsPadi project only.",
      safeToRun: true
    }),
    checklistStep({
      id: "review-apply-migrations",
      label: "Review and apply migrations",
      owner: "operator",
      done: false,
      detail: hasMigrations
        ? canApplyMigrations
          ? "Clean authority is proven and local migrations are ready for operator-reviewed application."
          : "Local migration inventory is present; application still needs clean authority and operator approval."
        : "No local migration inventory was found.",
      expectedEvidence: "Migration files are reviewed in order, applied only to the clean OddsPadi project, and Supabase advisors are checked afterward.",
      proofUrl: "/api/sports/decision/supabase-clean-project-cutover",
      command: null,
      safeToRun: false
    }),
    checklistStep({
      id: "rerun-storage-proof",
      label: "Rerun storage proof routes",
      owner: "codex",
      done: storageProofDone,
      detail: storageProofDone ? "Storage proof prerequisites are present for read-only verification." : "Storage proof routes stay locked until clean authority and migration review pass.",
      expectedEvidence: "/status, /supabase-project-isolation, /supabase-bootstrap, and /supabase-storage-proof-ledger all agree on the clean OddsPadi project.",
      proofUrl: "/api/sports/decision/supabase-storage-proof-ledger",
      command: "curl.exe -sS http://127.0.0.1:3025/api/sports/decision/supabase-storage-proof-ledger",
      safeToRun: true
    }),
    checklistStep({
      id: "resume-provider-dry-runs",
      label: "Resume provider dry-runs",
      owner: "codex",
      done: false,
      detail: "Provider writes, training, public picks, and staking stay locked until storage proof and provider dry-run receipts pass.",
      expectedEvidence: "API-Football and The Odds API dry-run receipts return normalized rows, while write/train/publish/stake controls remain false.",
      proofUrl: "/api/sports/decision/provider-enriched-retest-readiness?run=1",
      command: "Run one admin dry-run after storage proof passes; do not repeat-poll providers.",
      safeToRun: false
    })
  ];
  const activeStepId = rawSteps.find((step) => step.status !== "done")?.id ?? null;
  const steps = rawSteps.map((step) => (step.id === activeStepId ? { ...step, status: "next" as const } : step));

  return {
    activeStepId,
    steps
  };
}

function statusFor({
  currentAuthorityClean,
  hasMigrations,
  canApplyMigrations
}: {
  currentAuthorityClean: boolean;
  hasMigrations: boolean;
  canApplyMigrations: boolean;
}): DecisionSupabaseCleanProjectCutoverStatus {
  if (!currentAuthorityClean) return "blocked-current-target";
  if (!hasMigrations) return "waiting-clean-project-proof";
  if (canApplyMigrations) return "ready-migration-review";
  return "clean-authority-ready";
}

function summaryFor(status: DecisionSupabaseCleanProjectCutoverStatus, foreignSignals: number): string {
  if (status === "blocked-current-target") return `Clean-project cutover is required before writes: current authority still has ${foreignSignals} foreign schema signal(s).`;
  if (status === "ready-migration-review") return "Clean authority is proven and local migrations are ready for operator-reviewed application.";
  if (status === "clean-authority-ready") return "Clean authority is proven; storage writes still need separate odds/provider receipts.";
  return "Clean-project cutover is waiting for a fresh OddsPadi-only MCP observation and migration inventory proof.";
}

export function buildDecisionSupabaseCleanProjectCutover({
  remediation,
  binder,
  mcpObservationReceipt,
  workspaceRoot = process.cwd(),
  now = new Date()
}: {
  remediation: DecisionSupabaseAuthorityRemediation;
  binder: DecisionSupabaseProofBinder;
  mcpObservationReceipt: DecisionSupabaseMcpObservationReceipt;
  workspaceRoot?: string;
  now?: Date;
}): DecisionSupabaseCleanProjectCutover {
  const migrations = listMigrations(workspaceRoot);
  const currentAuthorityClean = remediation.status === "clean-authority";
  const cleanObservation = mcpObservationReceipt.status === "clean-odds-padi-proof";
  const canApplyMigrations = currentAuthorityClean && cleanObservation && binder.controls.canApplyMigrations;
  const status = statusFor({ currentAuthorityClean, hasMigrations: migrations.length > 0, canApplyMigrations });
  const cutoverChecklist = buildCutoverChecklist({
    currentAuthorityClean,
    cleanObservation,
    hasMigrations: migrations.length > 0,
    canApplyMigrations,
    expectedProjectRef: binder.expected.projectRef,
    expectedProjectUrl: binder.expected.projectUrl,
    configuredRef: binder.observed.configuredRef,
    repoMcpRef: binder.observed.repoMcpRef,
    foreignSignals: remediation.authority.foreignSignalCount
  });
  const gates = [
    gate({
      id: "current-authority",
      label: "Current authority",
      status: currentAuthorityClean ? "pass" : "block",
      detail: remediation.summary,
      requiredEvidence: "A live MCP observation with every expected op_ table and zero known foreign sentinel tables."
    }),
    gate({
      id: "operator-approval",
      label: "Operator approval",
      status: currentAuthorityClean ? "watch" : "block",
      detail: "Cutover needs explicit operator approval because it changes project authority for storage, provider ingestion, and training data.",
      requiredEvidence: "Operator confirms the clean OddsPadi Supabase project/ref and rejects using the mixed public schema for production writes."
    }),
    gate({
      id: "environment-cutover",
      label: "Environment cutover",
      status: currentAuthorityClean && binder.observed.configuredRef === binder.expected.projectRef ? "pass" : "block",
      detail: `Expected ${binder.expected.projectRef}; configured ${binder.observed.configuredRef ?? "missing"}; URL ${binder.observed.urlRef ?? "missing"}; repo MCP ${binder.observed.repoMcpRef ?? "missing"}.`,
      requiredEvidence: "Local .env.local, Netlify env, Supabase CLI link, and repo MCP all point at the clean OddsPadi project."
    }),
    gate({
      id: "mcp-clean-observation",
      label: "Clean MCP observation",
      status: cleanObservation && remediation.authority.foreignSignalCount === 0 ? "pass" : "block",
      detail: `${mcpObservationReceipt.observed.expectedTablesPresent.length}/${mcpObservationReceipt.expected.tableCount} expected op_ table(s), ${mcpObservationReceipt.observed.foreignSignals.length} foreign signal(s).`,
      requiredEvidence: "Fresh list_tables output from the clean project shows the expected OddsPadi op_ schema and no AfroTools/LATMtools/Matchday/payroll sentinel tables."
    }),
    gate({
      id: "migration-inventory",
      label: "Migration inventory",
      status: migrations.length > 0 ? "pass" : "block",
      detail: `${migrations.length} local migration file(s) are available for the clean project bootstrap.`,
      requiredEvidence: "Local migration files are reviewed in order and match the expected op_ table inventory before application."
    }),
    gate({
      id: "security-advisors",
      label: "Security advisors",
      status: currentAuthorityClean ? "watch" : "block",
      detail: "After migration, Supabase security advisors must be reviewed before provider writes or training rows unlock.",
      requiredEvidence: "Security advisor output is captured for the clean project, including RLS, policies, function search_path, and extension placement findings."
    }),
    gate({
      id: "write-locks",
      label: "Write locks",
      status: "pass",
      detail: "Cutover receipt cannot write, train, publish, stake, or call OpenAI live review.",
      requiredEvidence: "Write receipts remain separately gated by storage readiness, provider dry-runs, admin authorization, and run=1 receipts."
    })
  ];
  const nextGate = gates.find((item) => item.status === "block") ?? gates.find((item) => item.status === "watch") ?? null;

  return {
    generatedAt: now.toISOString(),
    mode: "supabase-clean-project-cutover",
    status,
    cutoverHash: stableHash({
      status,
      remediation: remediation.remediationHash,
      binder: binder.binderHash,
      mcp: mcpObservationReceipt.receiptHash,
      migrations: migrations.map((item) => item.file),
      gates: gates.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status, remediation.authority.foreignSignalCount),
    target: {
      expectedProjectRef: binder.expected.projectRef,
      expectedProjectUrl: binder.expected.projectUrl,
      currentSchemaEvidence: mcpObservationReceipt.observed.schemaEvidenceStatus,
      currentForeignSignalCount: remediation.authority.foreignSignalCount,
      expectedOpTableCount: binder.expected.tableCount
    },
    migrationPlan: {
      migrationCount: migrations.length,
      migrations,
      expectedTablesAfterApply: binder.expected.tableCount
    },
    cutoverChecklist,
    gates,
    nextAction: {
      label: nextGate?.requiredEvidence ?? "Keep write receipts locked until storage/provider receipts pass.",
      proofUrl: nextGate?.id === "migration-inventory" ? "/api/sports/decision/supabase-clean-project-cutover" : "/api/sports/decision/supabase-mcp-observation-receipt",
      command: nextGate?.id === "current-authority" || nextGate?.id === "mcp-clean-observation" ? "Use Supabase MCP list_tables against the clean OddsPadi project and attach the receipt." : null,
      safeToRun: false
    },
    controls: {
      canInspectReadOnly: true,
      canApplyMigrations,
      canRunProviderWrites: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: [
      "/api/sports/decision/supabase-clean-project-cutover",
      "/api/sports/decision/supabase-authority-remediation",
      "/api/sports/decision/supabase-mcp-observation-receipt",
      "/api/sports/decision/supabase-proof-binder",
      "/api/sports/decision/storage-activation-checklist"
    ],
    locks: [
      "Do not apply migrations to the mixed public schema.",
      "Do not run provider writes or odds snapshot writes until clean authority, storage readiness, admin authorization, and dry-run receipts pass.",
      "Do not train, publish, stake, or upgrade public action from cutover proof alone."
    ]
  };
}
