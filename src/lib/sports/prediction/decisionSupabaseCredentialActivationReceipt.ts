import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import type { DecisionStorageActivationChecklist } from "@/lib/sports/prediction/decisionStorageActivationChecklist";
import type { DecisionSupabaseMcpObservationReceipt } from "@/lib/sports/prediction/decisionSupabaseMcpObservationReceipt";
import type { DecisionSupabaseSchemaManifest } from "@/lib/sports/prediction/decisionSupabaseSchemaManifest";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import { ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";

export type DecisionSupabaseCredentialActivationStatus =
  | "ready-storage-credential"
  | "needs-secret-replacement"
  | "needs-server-secret"
  | "needs-project-target"
  | "needs-schema-proof"
  | "blocked-cross-project";

export type DecisionSupabaseCredentialActivationStepStatus = "done" | "next" | "blocked" | "locked";

export type DecisionSupabaseCredentialActivationStep = {
  id: "target" | "mcp-proof" | "schema-proof" | "server-secret" | "restart" | "post-restart-proof" | "provider-dry-run";
  label: string;
  status: DecisionSupabaseCredentialActivationStepStatus;
  evidence: string;
  nextAction: string;
  proofUrl: string;
};

export type DecisionSupabaseCredentialActivationReceipt = {
  mode: "supabase-credential-activation-receipt";
  generatedAt: string;
  status: DecisionSupabaseCredentialActivationStatus;
  receiptHash: string;
  summary: string;
  target: {
    projectRef: string;
    projectUrl: string;
    localEnvFile: ".env.local";
    localEnvKey: "SUPABASE_SECRET_KEY" | "SUPABASE_SERVICE_ROLE_KEY";
    acceptedServerEnvKeys: ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
    acceptedPublicEnvKeys: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
    netlifyEnvKey: "SUPABASE_SECRET_KEY" | "SUPABASE_SERVICE_ROLE_KEY";
  };
  evidence: {
    projectMatchesExpected: boolean;
    liveMcpSchemaProof: boolean;
    liveTables: number;
    expectedTables: number;
    credentialConfigured: boolean;
    credentialStatus: DecisionEngineReadiness["supabase"]["schema"]["credentialStatus"];
    credentialErrorTables: number;
    credentialErrorDetail: string | null;
    serverKeySourceEnv: string | null;
    serverKeyKind: DecisionEngineReadiness["supabase"]["preflight"]["serverKeyProfile"]["kind"];
    serverKeyProjectRef: string | null;
    serverKeyRecommendation: string;
    publicKeySourceEnv: string | null;
    publicKeyKind: DecisionEngineReadiness["supabase"]["preflight"]["publicKeyProfile"]["kind"];
    publicKeyRecommendation: string;
    storageStatus: DecisionStorageActivationChecklist["status"];
  };
  steps: DecisionSupabaseCredentialActivationStep[];
  nextStep: DecisionSupabaseCredentialActivationStep;
  commands: Array<{
    id: string;
    label: string;
    command: string;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
    missing: string[];
  }>;
  controls: {
    canInspectReadOnly: true;
    canAcceptSecretInChat: false;
    canVerifyAfterRestart: boolean;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canPersistDecisions: false;
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

function step(input: DecisionSupabaseCredentialActivationStep): DecisionSupabaseCredentialActivationStep {
  return input;
}

function statusFor({
  targetReady,
  mcpSchemaReady,
  schemaReady,
  credentialConfigured,
  credentialInvalid,
  storageStatus
}: {
  targetReady: boolean;
  mcpSchemaReady: boolean;
  schemaReady: boolean;
  credentialConfigured: boolean;
  credentialInvalid: boolean;
  storageStatus: DecisionStorageActivationChecklist["status"];
}): DecisionSupabaseCredentialActivationStatus {
  if (storageStatus === "blocked-cross-project") return "blocked-cross-project";
  if (!targetReady) return "needs-project-target";
  if (!mcpSchemaReady || !schemaReady) return "needs-schema-proof";
  if (!credentialConfigured) return "needs-server-secret";
  if (credentialInvalid) return "needs-secret-replacement";
  return "ready-storage-credential";
}

function summaryFor(status: DecisionSupabaseCredentialActivationStatus, liveTables: number, expectedTables: number): string {
  if (status === "ready-storage-credential") return "OddsPadi server credential is usable for guarded storage reads; provider dry-runs can evaluate their own keys and counts.";
  if (status === "needs-secret-replacement") return `Live schema is proven at ${liveTables}/${expectedTables} tables, but the running app is using a rejected Supabase server secret. Prefer a fresh sb_secret_ key.`;
  if (status === "needs-server-secret") return `Live schema is proven at ${liveTables}/${expectedTables} tables, but a server-safe SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is missing from server env.`;
  if (status === "needs-project-target") return "Supabase credential activation needs the local project URL/ref to point at OddsPadi before secrets can be trusted.";
  if (status === "blocked-cross-project") return "Supabase credential activation is blocked by cross-project evidence.";
  return "Supabase credential activation needs live MCP/schema proof before a server secret can unlock storage reads.";
}

export function buildDecisionSupabaseCredentialActivationReceipt({
  readiness,
  schemaManifest,
  storageActivationChecklist,
  mcpObservationReceipt,
  now = new Date()
}: {
  readiness: DecisionEngineReadiness;
  schemaManifest: DecisionSupabaseSchemaManifest;
  storageActivationChecklist: DecisionStorageActivationChecklist;
  mcpObservationReceipt: DecisionSupabaseMcpObservationReceipt;
  now?: Date;
}): DecisionSupabaseCredentialActivationReceipt {
  const targetReady = schemaManifest.project.targetMatchesExpected;
  const mcpSchemaReady = mcpObservationReceipt.status === "clean-odds-padi-proof";
  const schemaReady = schemaManifest.inventory.liveVerifiedTables === schemaManifest.inventory.expectedTables;
  const credentialConfigured = readiness.supabase.preflight.serverClientConfigured;
  const credentialInvalid = readiness.supabase.schema.credentialStatus === "invalid";
  const credentialReady = readiness.supabase.schema.credentialStatus === "valid";
  const status = statusFor({
    targetReady,
    mcpSchemaReady,
    schemaReady,
    credentialConfigured,
    credentialInvalid,
    storageStatus: storageActivationChecklist.status
  });
  const steps = [
    step({
      id: "target",
      label: "OddsPadi target",
      status: targetReady ? "done" : "blocked",
      evidence: `Expected ${ODDSPADI_SUPABASE_PROJECT_REF}; configured ${schemaManifest.project.configuredRef ?? "missing"}; URL ${schemaManifest.project.urlRef ?? "missing"}.`,
      nextAction: targetReady ? "Keep local and Netlify Supabase URL/ref pointed at OddsPadi." : `Set SUPABASE_PROJECT_REF and Supabase URLs to ${ODDSPADI_SUPABASE_PROJECT_REF}.`,
      proofUrl: "/api/sports/decision/supabase-project-isolation"
    }),
    step({
      id: "mcp-proof",
      label: "Live MCP schema proof",
      status: mcpSchemaReady ? "done" : targetReady ? "next" : "blocked",
      evidence: `${mcpObservationReceipt.observed.expectedTablesPresent.length}/${mcpObservationReceipt.expected.tableCount} expected op_ tables observed; ${mcpObservationReceipt.observed.foreignSignals.length} foreign signal(s).`,
      nextAction: mcpSchemaReady ? "Keep the non-secret proof receipt attached." : "Attach a project-scoped MCP table list with every expected op_ table.",
      proofUrl: "/api/sports/decision/supabase-mcp-observation-receipt"
    }),
    step({
      id: "schema-proof",
      label: "Live op_ schema",
      status: schemaReady ? "done" : mcpSchemaReady ? "next" : "blocked",
      evidence: `${schemaManifest.inventory.liveVerifiedTables}/${schemaManifest.inventory.expectedTables} live table(s) verified.`,
      nextAction: schemaReady ? "Do not re-apply schema; move to credential replacement." : "Verify all expected op_ tables through MCP or server credential reads.",
      proofUrl: "/api/sports/decision/supabase-schema-manifest"
    }),
    step({
      id: "server-secret",
      label: "Server secret",
      status: credentialReady ? "done" : schemaReady ? "next" : "blocked",
      evidence: credentialInvalid
        ? `${schemaManifest.inventory.credentialErrorTables.length} table check(s) reject the configured server key.`
        : credentialConfigured
          ? `Server key is configured as ${readiness.supabase.preflight.serverKeyProfile.kind} but not yet verified.`
          : "Server key is missing.",
      nextAction: credentialReady
        ? "Keep the secret server-only."
        : "Replace the server key with a fresh OddsPadi sb_secret_ key when available, or the active legacy service_role key; never paste it into chat or client code.",
      proofUrl: "/api/sports/decision/status"
    }),
    step({
      id: "restart",
      label: "Restart app",
      status: credentialReady ? "done" : credentialConfigured || schemaReady ? "next" : "blocked",
      evidence: "Next.js reads server env at process start.",
      nextAction: "Restart the local server and update the same server-only key in Netlify environment variables.",
      proofUrl: "/api/sports/decision/supabase-credential-activation"
    }),
    step({
      id: "post-restart-proof",
      label: "Post-restart proof",
      status: credentialReady ? "done" : "locked",
      evidence: `Credential status is ${readiness.supabase.schema.credentialStatus}.`,
      nextAction: "Re-run status, schema manifest, and storage activation until credential errors are zero.",
      proofUrl: "/api/sports/decision/supabase-schema-manifest"
    }),
    step({
      id: "provider-dry-run",
      label: "Provider dry-run",
      status: storageActivationChecklist.controls.canRunProviderDryRun ? "next" : "locked",
      evidence: storageActivationChecklist.summary,
      nextAction: storageActivationChecklist.controls.canRunProviderDryRun
        ? "Run provider dry-runs only; inspect normalized counts before writes."
        : "Keep provider dry-runs held until credential and provider env gates pass.",
      proofUrl: "/api/sports/decision/provider-batch-manifest"
    })
  ];
  const nextStep = steps.find((item) => item.status === "next") ?? steps.find((item) => item.status === "blocked") ?? steps[0];
  const commands = [
    {
      id: "status",
      label: "Recheck status",
      command: decisionCurlCommand("/api/sports/decision/status"),
      verifyUrl: "/api/sports/decision/status",
      safeToRun: true,
      expectedEvidence: "Credential status becomes valid and credential-error tables drop to zero after the key is replaced and the app restarts.",
      missing: credentialReady ? [] : ["valid SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY"]
    },
    {
      id: "schema-manifest",
      label: "Recheck schema manifest",
      command: decisionCurlCommand("/api/sports/decision/supabase-schema-manifest"),
      verifyUrl: "/api/sports/decision/supabase-schema-manifest",
      safeToRun: true,
      expectedEvidence: "Schema manifest keeps 22/22 live tables and moves out of blocked-credentials.",
      missing: credentialReady ? [] : ["valid SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY"]
    },
    {
      id: "storage-checklist",
      label: "Recheck storage activation",
      command: decisionCurlCommand("/api/sports/decision/storage-activation-checklist"),
      verifyUrl: "/api/sports/decision/storage-activation-checklist",
      safeToRun: true,
      expectedEvidence: "Storage activation moves from needs-credential to the next provider dry-run gate.",
      missing: credentialReady ? [] : ["valid SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY"]
    }
  ];
  const receiptHash = stableHash({
    status,
    targetReady,
    mcpSchemaReady,
    schemaReady,
    credentialConfigured,
    credentialStatus: readiness.supabase.schema.credentialStatus,
    steps: steps.map((item) => [item.id, item.status])
  });

  return {
    mode: "supabase-credential-activation-receipt",
    generatedAt: now.toISOString(),
    status,
    receiptHash,
    summary: summaryFor(status, schemaManifest.inventory.liveVerifiedTables, schemaManifest.inventory.expectedTables),
    target: {
      projectRef: ODDSPADI_SUPABASE_PROJECT_REF,
      projectUrl: `https://${ODDSPADI_SUPABASE_PROJECT_REF}.supabase.co`,
      localEnvFile: ".env.local",
      localEnvKey: readiness.supabase.preflight.serverKeyProfile.kind === "modern-secret" ? "SUPABASE_SECRET_KEY" : "SUPABASE_SERVICE_ROLE_KEY",
      acceptedServerEnvKeys: ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
      acceptedPublicEnvKeys: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
      netlifyEnvKey: readiness.supabase.preflight.serverKeyProfile.kind === "modern-secret" ? "SUPABASE_SECRET_KEY" : "SUPABASE_SERVICE_ROLE_KEY"
    },
    evidence: {
      projectMatchesExpected: targetReady,
      liveMcpSchemaProof: mcpSchemaReady,
      liveTables: schemaManifest.inventory.liveVerifiedTables,
      expectedTables: schemaManifest.inventory.expectedTables,
      credentialConfigured,
      credentialStatus: readiness.supabase.schema.credentialStatus,
      credentialErrorTables: schemaManifest.inventory.credentialErrorTables.length,
      credentialErrorDetail: readiness.supabase.schema.credentialErrorDetail,
      serverKeySourceEnv: readiness.supabase.preflight.serverKeyProfile.sourceEnvKey,
      serverKeyKind: readiness.supabase.preflight.serverKeyProfile.kind,
      serverKeyProjectRef: readiness.supabase.preflight.serverKeyProfile.legacyJwtProjectRef,
      serverKeyRecommendation: readiness.supabase.preflight.serverKeyProfile.recommendation,
      publicKeySourceEnv: readiness.supabase.preflight.publicKeyProfile.sourceEnvKey,
      publicKeyKind: readiness.supabase.preflight.publicKeyProfile.kind,
      publicKeyRecommendation: readiness.supabase.preflight.publicKeyProfile.recommendation,
      storageStatus: storageActivationChecklist.status
    },
    steps,
    nextStep,
    commands,
    controls: {
      canInspectReadOnly: true,
      canAcceptSecretInChat: false,
      canVerifyAfterRestart: true,
      canRunProviderDryRun: storageActivationChecklist.controls.canRunProviderDryRun,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Do not paste Supabase service-role or secret keys into chat, source files, browser clients, screenshots, or logs.",
      "Do not store SUPABASE_SERVICE_ROLE_KEY in any NEXT_PUBLIC variable.",
      "Schema proof is not write proof; provider writes, persistence, training, publishing, and staking stay locked.",
      "After replacing the key, restart the app before trusting any credential status.",
      "Mirror the server-only secret into Netlify only through Netlify environment-variable controls."
    ],
    proofUrls: [
      "/api/sports/decision/supabase-credential-activation",
      "/api/sports/decision/status",
      "/api/sports/decision/supabase-schema-manifest",
      "/api/sports/decision/storage-activation-checklist",
      "/api/sports/decision/provider-batch-manifest"
    ]
  };
}
