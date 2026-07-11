import type { DecisionDataBackbone } from "@/lib/sports/prediction/decisionDataBackbone";
import type { DecisionSupabaseLiveSchemaActivationPacket } from "@/lib/sports/prediction/decisionSupabaseLiveSchemaActivationPacket";
import type { DecisionSupabaseSchemaManifest } from "@/lib/sports/prediction/decisionSupabaseSchemaManifest";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { HistoricalCorpusAcquisition } from "@/lib/sports/training/historicalCorpusAcquisition";
import type { Sport } from "@/lib/sports/types";
import { ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";

export type DecisionStorageActivationChecklistStatus =
  | "ready-for-provider-dry-run"
  | "contained-provider-dry-run"
  | "ready-for-schema-apply"
  | "needs-credential"
  | "needs-provider-env"
  | "needs-project-proof"
  | "needs-live-schema"
  | "blocked-cross-project";

export type DecisionStorageActivationChecklistItemStatus = "done" | "next" | "blocked" | "locked";

export type DecisionStorageActivationChecklistItem = {
  id:
    | "target-project"
    | "server-credential"
    | "mcp-scope"
    | "local-schema"
    | "live-schema"
    | "provider-dry-runs"
    | "historical-backfill"
    | "training-unlock";
  label: string;
  status: DecisionStorageActivationChecklistItemStatus;
  evidence: string;
  nextAction: string;
  proofUrl: string;
};

export type DecisionStorageActivationProbe = {
  id: string;
  label: string;
  kind: "api" | "sql" | "operator";
  command: string;
  safeToRun: boolean;
  expectedEvidence: string;
  missing: string[];
};

export type DecisionStorageActivationChecklist = {
  mode: "decision-storage-activation-checklist";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionStorageActivationChecklistStatus;
  checklistHash: string;
  summary: string;
  target: {
    projectRef: string;
    configuredRef: string | null;
    urlRef: string | null;
    liveMcpProofRef: string | null;
  };
  progress: {
    items: number;
    done: number;
    next: number;
    blocked: number;
    locked: number;
    localTables: number;
    expectedTables: number;
    liveTables: number;
    storageReadiness: number;
    estimatedHistoricalMatches: number;
  };
  storageMvpMinimum: {
    status: "waiting" | "partial" | "ready" | "blocked";
    targetProjectRef: string;
    requiredServerEnvLines: string[];
    requiredProofs: Array<{
      id: "target-project" | "server-credential" | "mcp-scope" | "local-schema" | "live-schema";
      label: string;
      status: DecisionStorageActivationChecklistItemStatus;
      proofUrl: string;
      missing: string[];
    }>;
    localTables: number;
    expectedTables: number;
    liveTables: number;
    nextMissing: string | null;
    firstProofUrl: string;
    afterReady: string[];
  };
  checklist: DecisionStorageActivationChecklistItem[];
  probes: DecisionStorageActivationProbe[];
  nextProbe: DecisionStorageActivationProbe;
  controls: {
    canInspectReadOnly: true;
    canApplySchema: boolean;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canPersistDecisions: false;
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

function unique(values: Array<string | null | undefined>, limit = 30): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function item(input: DecisionStorageActivationChecklistItem): DecisionStorageActivationChecklistItem {
  return input;
}

function statusFor({
  manifest,
  activation,
  dataBackbone
}: {
  manifest: DecisionSupabaseSchemaManifest;
  activation: DecisionSupabaseLiveSchemaActivationPacket;
  dataBackbone: DecisionDataBackbone;
}): DecisionStorageActivationChecklistStatus {
  const containedReadOnly = manifest.status === "contained-mixed-schema" || activation.status === "contained-read-only";
  if (manifest.status === "blocked-cross-project" || activation.status === "blocked-cross-project") return "blocked-cross-project";
  if (manifest.status === "blocked-credentials" || activation.status === "blocked-credentials" || dataBackbone.status === "blocked-credentials") {
    return "needs-credential";
  }
  if (activation.status === "needs-mcp-proof" || manifest.status === "needs-project-proof") return "needs-project-proof";
  if (activation.status === "ready-to-apply-schema") return "ready-for-schema-apply";
  if (containedReadOnly && dataBackbone.status === "ready-provider-dry-run") return "contained-provider-dry-run";
  if (manifest.status === "ready-live-schema" && dataBackbone.status === "ready-provider-dry-run") return "ready-for-provider-dry-run";
  if ((containedReadOnly || manifest.status === "ready-live-schema") && dataBackbone.status === "needs-provider-env") return "needs-provider-env";
  return "needs-live-schema";
}

function summaryFor(status: DecisionStorageActivationChecklistStatus, progress: DecisionStorageActivationChecklist["progress"]): string {
  if (status === "ready-for-provider-dry-run") {
    return `Storage is live-verified across ${progress.liveTables}/${progress.expectedTables} tables and can move to guarded provider dry-runs.`;
  }
  if (status === "contained-provider-dry-run") {
    return `Storage has all ${progress.liveTables}/${progress.expectedTables} OddsPadi op_ tables inside a mixed schema; only read-only provider dry-runs may run while writes and migrations stay locked.`;
  }
  if (status === "ready-for-schema-apply") {
    return `Local schema is complete across ${progress.localTables}/${progress.expectedTables} tables; supervised OddsPadi schema apply is the next step.`;
  }
  if (status === "needs-credential") {
    return `Storage activation needs a valid server-only OddsPadi Supabase credential before live table verification can pass.`;
  }
  if (status === "needs-project-proof") {
    return `Storage activation needs project-scoped Supabase MCP proof for ${ODDSPADI_SUPABASE_PROJECT_REF} before any schema operation.`;
  }
  if (status === "needs-provider-env") {
    return `Storage is live-verified across ${progress.liveTables}/${progress.expectedTables} tables; provider keys are now the next blocker for guarded dry-runs.`;
  }
  if (status === "blocked-cross-project") {
    return "Storage activation is blocked because project evidence points at a foreign or mixed Supabase schema.";
  }
  return `Storage activation still needs live schema proof: ${progress.liveTables}/${progress.expectedTables} expected tables verified.`;
}

function probe(input: DecisionStorageActivationProbe): DecisionStorageActivationProbe {
  return input;
}

function nextProbeFor(probes: DecisionStorageActivationProbe[]): DecisionStorageActivationProbe {
  return probes.find((entry) => entry.safeToRun && entry.missing.length === 0) ?? probes[0];
}

function storageMvpMinimumFor({
  checklist,
  manifest,
  checklistStatus
}: {
  checklist: DecisionStorageActivationChecklistItem[];
  manifest: DecisionSupabaseSchemaManifest;
  checklistStatus: DecisionStorageActivationChecklistStatus;
}): DecisionStorageActivationChecklist["storageMvpMinimum"] {
  const proofIds = new Set<DecisionStorageActivationChecklist["storageMvpMinimum"]["requiredProofs"][number]["id"]>([
    "target-project",
    "server-credential",
    "mcp-scope",
    "local-schema",
    "live-schema"
  ]);
  const requiredProofs = checklist
    .filter((entry): entry is DecisionStorageActivationChecklistItem & { id: DecisionStorageActivationChecklist["storageMvpMinimum"]["requiredProofs"][number]["id"] } =>
      proofIds.has(entry.id as DecisionStorageActivationChecklist["storageMvpMinimum"]["requiredProofs"][number]["id"])
    )
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      status: entry.status,
      proofUrl: entry.proofUrl,
      missing: entry.status === "done" ? [] : [entry.nextAction]
    }));
  const blocked = requiredProofs.some((entry) => entry.status === "blocked");
  const done = requiredProofs.filter((entry) => entry.status === "done").length;
  const nextMissing = requiredProofs.find((entry) => entry.status !== "done") ?? null;
  const providerDryRunReady = checklistStatus === "ready-for-provider-dry-run" || checklistStatus === "contained-provider-dry-run";
  const nextExternalMissing =
    !nextMissing && checklistStatus === "needs-provider-env"
      ? {
          label: "Football provider keys",
          proofUrl: "/api/sports/decision/provider-onboarding-contract"
        }
      : null;

  return {
    status: blocked ? "blocked" : providerDryRunReady && done === requiredProofs.length ? "ready" : done > 0 ? "partial" : "waiting",
    targetProjectRef: ODDSPADI_SUPABASE_PROJECT_REF,
    requiredServerEnvLines: [
      `SUPABASE_URL=https://${ODDSPADI_SUPABASE_PROJECT_REF}.supabase.co`,
      "SUPABASE_SERVICE_ROLE_KEY=paste_supabase_service_role_key_here"
    ],
    requiredProofs,
    localTables: manifest.inventory.localDeclaredTables,
    expectedTables: manifest.inventory.expectedTables,
    liveTables: manifest.inventory.liveVerifiedTables,
    nextMissing: nextMissing?.label ?? nextExternalMissing?.label ?? null,
    firstProofUrl: nextMissing?.proofUrl ?? nextExternalMissing?.proofUrl ?? "/api/sports/decision/storage-activation-checklist",
    afterReady: [
      "Run provider dry-runs with dryRun=1 before writing corpus rows.",
      "Review storage write receipts before enabling any provider row persistence.",
      "Keep training, public picks, and staking locked until backtests and promotion gates pass."
    ]
  };
}

export function buildDecisionStorageActivationChecklist({
  date,
  sport,
  manifest,
  activation,
  dataBackbone,
  historicalCorpusAcquisition,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  manifest: DecisionSupabaseSchemaManifest;
  activation: DecisionSupabaseLiveSchemaActivationPacket;
  dataBackbone: DecisionDataBackbone;
  historicalCorpusAcquisition: HistoricalCorpusAcquisition;
  now?: Date;
}): DecisionStorageActivationChecklist {
  const targetReady = manifest.project.targetMatchesExpected;
  const credentialReady =
    activation.status !== "blocked-credentials" &&
    manifest.status !== "blocked-credentials" &&
    dataBackbone.status !== "blocked-credentials";
  const mcpReady = activation.controls.canTrustCurrentMcp;
  const localSchemaReady =
    manifest.inventory.localDeclaredTables === manifest.inventory.expectedTables &&
    manifest.inventory.localRlsTables === manifest.inventory.expectedTables;
  const containedReadOnly = manifest.status === "contained-mixed-schema" || activation.status === "contained-read-only";
  const liveSchemaReady =
    manifest.inventory.liveVerifiedTables === manifest.inventory.expectedTables &&
    (manifest.status === "ready-live-schema" || manifest.status === "contained-mixed-schema");
  const providerDryRunReady = dataBackbone.controls.canRunProviderDryRun;
  const providerBlocked = historicalCorpusAcquisition.totals.providerKeysMissing > 0;
  const checklist = [
    item({
      id: "target-project",
      label: "Target OddsPadi project",
      status: targetReady ? "done" : "blocked",
      evidence: `Expected ${ODDSPADI_SUPABASE_PROJECT_REF}; configured ${manifest.project.configuredRef ?? "missing"}; URL ${manifest.project.urlRef ?? "missing"}.`,
      nextAction: targetReady ? "Keep local, MCP, Netlify, and server env pointed at OddsPadi." : `Retarget Supabase env and MCP to ${ODDSPADI_SUPABASE_PROJECT_REF}.`,
      proofUrl: "/api/sports/decision/supabase-project-isolation"
    }),
    item({
      id: "server-credential",
      label: "Server credential",
      status: credentialReady ? "done" : targetReady ? "next" : "blocked",
      evidence: credentialReady ? "Credential is not currently blocking schema reads." : `${manifest.inventory.credentialErrorTables.length} table checks returned credential errors.`,
      nextAction: credentialReady ? "Re-run live schema verification after any server restart." : "Replace the server-only Supabase secret/service-role key for OddsPadi and restart the app.",
      proofUrl: "/api/sports/decision/status"
    }),
    item({
      id: "mcp-scope",
      label: "Project-scoped MCP proof",
      status: mcpReady ? "done" : credentialReady ? "next" : "blocked",
      evidence: `Repo MCP ${manifest.project.repoMcpRef ?? "missing"}; live MCP proof ${manifest.project.mcpProofRef ?? "missing"}.`,
      nextAction: mcpReady ? "Keep MCP proof attached before live schema apply." : "Authenticate/use the repo-local OddsPadi Supabase MCP and prove the op_ table list.",
      proofUrl: "/api/sports/decision/supabase-proof-binder"
    }),
    item({
      id: "local-schema",
      label: "Local schema source",
      status: localSchemaReady ? "done" : "next",
      evidence: `${manifest.inventory.localDeclaredTables}/${manifest.inventory.expectedTables} tables declared; ${manifest.inventory.localRlsTables}/${manifest.inventory.expectedTables} RLS-enabled.`,
      nextAction: localSchemaReady ? "Treat migrations as the local source of truth." : "Repair local migrations before live apply.",
      proofUrl: "/api/sports/decision/supabase-schema-manifest"
    }),
    item({
      id: "live-schema",
      label: "Live op_ schema",
      status: liveSchemaReady ? "done" : localSchemaReady && mcpReady && credentialReady ? "next" : "blocked",
      evidence: `${manifest.inventory.liveVerifiedTables}/${manifest.inventory.expectedTables} expected tables live-verified.`,
      nextAction: liveSchemaReady
        ? containedReadOnly
          ? "Use contained op_ proof for read-only provider dry-runs only; move production writes to clean authority."
          : "Move to provider dry-runs only."
        : "Apply/verify the local migrations in the OddsPadi project, then re-run schema manifest.",
      proofUrl: "/api/sports/decision/supabase-live-schema-activation"
    }),
    item({
      id: "provider-dry-runs",
      label: "Provider dry-runs",
      status: providerDryRunReady ? "next" : liveSchemaReady ? "next" : "locked",
      evidence: dataBackbone.summary,
      nextAction: providerDryRunReady ? "Run dryRun=1 provider ingestion probes before any storage writes." : dataBackbone.nextAction.expectedEvidence,
      proofUrl: "/api/sports/decision/data-backbone"
    }),
    item({
      id: "historical-backfill",
      label: "10-year historical backfill",
      status: liveSchemaReady && !providerBlocked ? "next" : "locked",
      evidence: `${historicalCorpusAcquisition.historicalWindow.estimatedMatches} estimated matches and ${historicalCorpusAcquisition.historicalWindow.estimatedOddsSnapshots} odds snapshots planned.`,
      nextAction: historicalCorpusAcquisition.blockers[0] ?? "Run capped historical dry-runs, review counts, then write corpus batches under explicit admin control.",
      proofUrl: "/api/sports/decision/training/historical-corpus-acquisition"
    }),
    item({
      id: "training-unlock",
      label: "Training unlock",
      status: liveSchemaReady && !providerBlocked ? "next" : "locked",
      evidence: "Training remains shadow-only until real provider rows, outcome labels, backtests, calibration, and promotion gates pass.",
      nextAction: "Keep model training, learned weights, public publishing, and staking disabled until backtest receipts clear.",
      proofUrl: "/api/sports/decision/training/readiness"
    })
  ];
  const progress = {
    items: checklist.length,
    done: checklist.filter((entry) => entry.status === "done").length,
    next: checklist.filter((entry) => entry.status === "next").length,
    blocked: checklist.filter((entry) => entry.status === "blocked").length,
    locked: checklist.filter((entry) => entry.status === "locked").length,
    localTables: manifest.inventory.localDeclaredTables,
    expectedTables: manifest.inventory.expectedTables,
    liveTables: manifest.inventory.liveVerifiedTables,
    storageReadiness: dataBackbone.readinessScore,
    estimatedHistoricalMatches: historicalCorpusAcquisition.historicalWindow.estimatedMatches
  };
  const status = statusFor({ manifest, activation, dataBackbone });
  const storageMvpMinimum = storageMvpMinimumFor({ checklist, manifest, checklistStatus: status });
  const probes = [
    probe({
      id: "schema-manifest-api",
      label: "Read schema manifest",
      kind: "api",
      command: decisionCurlCommand("/api/sports/decision/supabase-schema-manifest"),
      safeToRun: true,
      expectedEvidence: "Returns local table/RLS counts, live table counts, credential errors, and target project evidence.",
      missing: []
    }),
    probe({
      id: "activation-packet-api",
      label: "Read live activation packet",
      kind: "api",
      command: decisionCurlCommand("/api/sports/decision/supabase-live-schema-activation"),
      safeToRun: true,
      expectedEvidence: "Returns gates, SQL probes, locked write posture, and the next supervised schema operation.",
      missing: []
    }),
    probe({
      id: "list-op-tables-sql",
      label: "List live op_ tables",
      kind: "sql",
      command: "select table_name from information_schema.tables where table_schema = 'public' and table_name like 'op_%' order by table_name;",
      safeToRun: false,
      expectedEvidence: `Project-scoped SQL returns ${manifest.inventory.expectedTables} OddsPadi op_ tables.`,
      missing: mcpReady || credentialReady ? [] : ["project-scoped Supabase SQL access"]
    }),
    probe({
      id: "rls-flags-sql",
      label: "Check RLS flags",
      kind: "sql",
      command: "select schemaname, tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename like 'op_%' order by tablename;",
      safeToRun: false,
      expectedEvidence: "Every live op_ table has rowsecurity enabled.",
      missing: mcpReady || credentialReady ? [] : ["project-scoped Supabase SQL access"]
    }),
    probe({
      id: "schema-apply-operator",
      label: "Supervised schema apply",
      kind: "operator",
      command: "Apply the checked-in supabase/migrations SQL only after credential and MCP proof both point at OddsPadi.",
      safeToRun: false,
      expectedEvidence: "Schema manifest moves to ready-live-schema and data backbone storage becomes 22/22.",
      missing: activation.controls.canRequestSchemaApply ? [] : ["ready-to-apply-schema activation packet"]
    })
  ];
  const checklistHash = stableHash({
    date,
    sport,
    status,
    target: manifest.project,
    progress,
    checklist: checklist.map((entry) => [entry.id, entry.status])
  });

  return {
    mode: "decision-storage-activation-checklist",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    checklistHash,
    summary: summaryFor(status, progress),
    target: {
      projectRef: ODDSPADI_SUPABASE_PROJECT_REF,
      configuredRef: manifest.project.configuredRef,
      urlRef: manifest.project.urlRef,
      liveMcpProofRef: manifest.project.mcpProofRef
    },
    progress,
    storageMvpMinimum,
    checklist,
    probes,
    nextProbe: nextProbeFor(probes),
    controls: {
      canInspectReadOnly: true,
      canApplySchema: containedReadOnly ? false : activation.controls.canRequestSchemaApply,
      canRunProviderDryRun: dataBackbone.controls.canRunProviderDryRun,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: unique([
      "/api/sports/decision/storage-activation-checklist",
      "/api/sports/decision/supabase-schema-manifest",
      "/api/sports/decision/supabase-live-schema-activation",
      "/api/sports/decision/data-backbone",
      "/api/sports/decision/status",
      "/api/sports/decision/training/historical-corpus-acquisition"
    ]),
    locks: unique([
      "Checklist is read-only and cannot apply schema, write provider rows, persist decisions, train models, publish picks, or stake.",
      "Do not apply schema until both server credential and MCP proof point at the OddsPadi project.",
      "Do not use AfroTools or LATMtools Supabase projects for OddsPadi storage.",
      ...activation.locks,
      ...dataBackbone.locks,
      ...historicalCorpusAcquisition.locks
    ])
  };
}
