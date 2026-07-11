import type { DecisionActivationAudit } from "@/lib/sports/prediction/decisionActivationAudit";
import type { DecisionAIOrchestrator, DecisionAIOrchestratorRunItem } from "@/lib/sports/prediction/decisionAIOrchestrator";
import type { DecisionProofReceipt, DecisionProofRunner } from "@/lib/sports/prediction/decisionProofRunner";
import type { Sport } from "@/lib/sports/types";

export type DecisionAIReviewLedgerStatus = "ready" | "needs-config" | "blocked" | "reviewed";
export type DecisionAIReviewLedgerEntryKind = "review-target" | "thinking-role" | "proof-dependency" | "latest-run";
export type DecisionAIReviewLedgerEntryStatus = "recorded" | "needs-config" | "blocked" | "verified";

export type DecisionAIReviewLedgerEntry = {
  id: string;
  kind: DecisionAIReviewLedgerEntryKind;
  status: DecisionAIReviewLedgerEntryStatus;
  label: string;
  inputScope: string;
  outputContract: string;
  command: string | null;
  verifyUrl: string | null;
  missingEnv: string[];
  blockedBy: string[];
  evidenceHash: string;
};

export type DecisionAIReviewLedger = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionAIReviewLedgerStatus;
  mode: "append-only-ai-review-ledger";
  ledgerHash: string;
  promptManifestHash: string;
  summary: string;
  counts: {
    entries: number;
    reviewTargets: number;
    thinkingRoles: number;
    proofDependencies: number;
    latestRuns: number;
    blocked: number;
    needsConfig: number;
    verified: number;
  };
  promptManifest: {
    model: string;
    scope: string;
    allowedInputs: string[];
    deniedInputs: string[];
    requiredOutputs: string[];
    schemaNames: string[];
    safetyRules: string[];
  };
  controlContract: {
    noUpgrade: boolean;
    noPersistence: boolean;
    noPublish: boolean;
    actionRankRule: string;
    submitToOpenAIAllowed: boolean;
    persistAllowed: boolean;
    publishAllowed: boolean;
  };
  nextEntry: DecisionAIReviewLedgerEntry | null;
  entries: DecisionAIReviewLedgerEntry[];
  runbook: {
    firstReviewCommand: string | null;
    firstReviewUrl: string | null;
    firstProofCommand: string | null;
    firstProofUrl: string | null;
    requiredBeforeReview: string[];
    requiredBeforePersistence: string[];
  };
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

function unsafeCommandReasons(command: string | null): string[] {
  if (!command) return [];
  const lower = command.toLowerCase();
  return [
    lower.includes("persist=1") || lower.includes("persist=true") ? "command requests persistence" : "",
    lower.includes("dryrun=0") || lower.includes("dryrun=false") ? "command disables dry-run" : "",
    lower.includes("-x post") || lower.includes("-xpost") ? "command is a POST request" : ""
  ].filter(Boolean);
}

function entry(input: Omit<DecisionAIReviewLedgerEntry, "evidenceHash">): DecisionAIReviewLedgerEntry {
  return {
    ...input,
    evidenceHash: stableHash({
      id: input.id,
      kind: input.kind,
      status: input.status,
      inputScope: input.inputScope,
      outputContract: input.outputContract,
      verifyUrl: input.verifyUrl
    })
  };
}

function targetEntries(orchestrator: DecisionAIOrchestrator): DecisionAIReviewLedgerEntry[] {
  return orchestrator.targets.map((target) => {
    const unsafeReasons = unsafeCommandReasons(target.command);
    const blockedBy = [...target.missingEnv, ...unsafeReasons];
    return entry({
      id: `target-${target.id}`,
      kind: "review-target",
      status: blockedBy.length ? (target.missingEnv.length ? "needs-config" : "blocked") : "recorded",
      label: target.label,
      inputScope: `${target.scope}${target.matchId ? `:${target.matchId}` : ""}`,
      outputContract: target.expectedEvidence,
      command: target.command,
      verifyUrl: target.verifyUrl,
      missingEnv: target.missingEnv,
      blockedBy
    });
  });
}

function thinkingRoleEntries(orchestrator: DecisionAIOrchestrator): DecisionAIReviewLedgerEntry[] {
  return orchestrator.thinkingProtocol.map((role) =>
    entry({
      id: `role-${role.id}`,
      kind: "thinking-role",
      status: role.status === "ready" ? "recorded" : role.status === "waiting" ? "needs-config" : "blocked",
      label: role.role,
      inputScope: role.inputEvidence.join(" | "),
      outputContract: role.expectedOutput,
      command: null,
      verifyUrl: null,
      missingEnv: role.status === "waiting" ? ["OPENAI_API_KEY"] : [],
      blockedBy: role.status === "blocked" ? [role.stopCondition] : role.status === "waiting" ? ["OPENAI_API_KEY"] : []
    })
  );
}

function proofStatus(receipt: DecisionProofReceipt): DecisionAIReviewLedgerEntryStatus {
  if (receipt.status === "verified") return "verified";
  if (receipt.status === "needs-run") return "recorded";
  return "blocked";
}

function proofEntries(proofRunner: DecisionProofRunner): DecisionAIReviewLedgerEntry[] {
  return proofRunner.receipts
    .filter((receipt) => receipt.status !== "verified")
    .slice(0, 8)
    .map((receipt) => {
      const unsafeReasons = unsafeCommandReasons(receipt.command);
      return entry({
        id: `proof-${receipt.id}`,
        kind: "proof-dependency",
        status: proofStatus(receipt),
        label: receipt.label,
        inputScope: `${receipt.kind}:${receipt.id}`,
        outputContract: receipt.expectedEvidence,
        command: unsafeReasons.length ? null : receipt.command,
        verifyUrl: receipt.verifyUrl,
        missingEnv: receipt.missingEnv,
        blockedBy:
          receipt.status === "blocked" || receipt.status === "contradicted"
            ? receipt.missingEnv.length
              ? [...receipt.missingEnv, ...unsafeReasons]
              : [receipt.observedEvidence, ...unsafeReasons]
            : unsafeReasons
      });
    });
}

function runItemEntries(items: DecisionAIOrchestratorRunItem[]): DecisionAIReviewLedgerEntry[] {
  return items.map((item) =>
    entry({
      id: `run-${item.scope}`,
      kind: "latest-run",
      status: item.status === "reviewed" ? "verified" : item.status === "not-configured" ? "needs-config" : item.status === "not-requested" ? "recorded" : "blocked",
      label: `${item.scope} review run`,
      inputScope: `${item.provider}:${item.scope}`,
      outputContract: item.reviewVerdict ? `Review verdict ${item.reviewVerdict}; applied action ${item.appliedAction ?? "none"}.` : "No OpenAI review was applied.",
      command: null,
      verifyUrl: null,
      missingEnv: item.status === "not-configured" ? ["OPENAI_API_KEY"] : [],
      blockedBy: item.reason ? [item.reason] : []
    })
  );
}

function ledgerStatus({
  orchestrator,
  activationAudit,
  proofRunner,
  entries
}: {
  orchestrator: DecisionAIOrchestrator;
  activationAudit: DecisionActivationAudit;
  proofRunner: DecisionProofRunner;
  entries: DecisionAIReviewLedgerEntry[];
}): DecisionAIReviewLedgerStatus {
  if (orchestrator.latestRun.items.some((item) => item.status === "reviewed")) return "reviewed";
  if (activationAudit.status === "blocked" || proofRunner.status === "blocked" || entries.some((item) => item.status === "blocked")) return "blocked";
  if (!orchestrator.openAiConfigured || entries.some((item) => item.status === "needs-config")) return "needs-config";
  return "ready";
}

function statusSummary(status: DecisionAIReviewLedgerStatus, counts: DecisionAIReviewLedger["counts"]): string {
  if (status === "reviewed") return `AI review ledger recorded a completed guarded review with ${counts.entries} audit entries.`;
  if (status === "ready") return `AI review ledger is ready with ${counts.reviewTargets} review target(s) and no blocking proof dependency.`;
  if (status === "needs-config") return `AI review ledger is waiting for configuration; ${counts.needsConfig} entry(s) need env or provider proof.`;
  return `AI review ledger is blocked by ${counts.blocked} entry(s); keep AI review, persistence, and publishing supervised.`;
}

export function buildDecisionAIReviewLedger({
  date,
  sport,
  orchestrator,
  activationAudit,
  proofRunner,
  limit = 18
}: {
  date: string;
  sport: Sport;
  orchestrator: DecisionAIOrchestrator;
  activationAudit: DecisionActivationAudit;
  proofRunner: DecisionProofRunner;
  limit?: number;
}): DecisionAIReviewLedger {
  const promptManifest: DecisionAIReviewLedger["promptManifest"] = {
    model: orchestrator.model,
    scope: "active match and slate council review",
    allowedInputs: orchestrator.evidenceContract.allowedEvidenceSources,
    deniedInputs: [
      "service_role keys",
      "admin tokens",
      "private user data",
      "uncited injuries or news",
      "uncited bookmaker moves",
      "raw provider credentials"
    ],
    requiredOutputs: [
      "evidence-cited checks",
      "safety gates",
      "unsupported claims",
      "same-or-safer action",
      "checks before action",
      "data gaps"
    ],
    schemaNames: orchestrator.evidenceContract.outputSchemas,
    safetyRules: [...orchestrator.evidenceContract.forbiddenClaims, ...orchestrator.runbook.forbiddenActions]
  };
  const allEntries = [
    ...targetEntries(orchestrator),
    ...thinkingRoleEntries(orchestrator),
    ...proofEntries(proofRunner),
    ...runItemEntries(orchestrator.latestRun.items)
  ];
  const sortedEntries = allEntries.sort((a, b) => {
    const statusRank = { blocked: 4, "needs-config": 3, recorded: 2, verified: 1 }[a.status] - { blocked: 4, "needs-config": 3, recorded: 2, verified: 1 }[b.status];
    if (statusRank !== 0) return -statusRank;
    return a.id.localeCompare(b.id);
  });
  const entries = sortedEntries.slice(0, limit);
  const counts = {
    entries: allEntries.length,
    reviewTargets: allEntries.filter((item) => item.kind === "review-target").length,
    thinkingRoles: allEntries.filter((item) => item.kind === "thinking-role").length,
    proofDependencies: allEntries.filter((item) => item.kind === "proof-dependency").length,
    latestRuns: allEntries.filter((item) => item.kind === "latest-run").length,
    blocked: allEntries.filter((item) => item.status === "blocked").length,
    needsConfig: allEntries.filter((item) => item.status === "needs-config").length,
    verified: allEntries.filter((item) => item.status === "verified").length
  };
  const status = ledgerStatus({ orchestrator, activationAudit, proofRunner, entries: allEntries });
  const firstReview = orchestrator.targets.find((target) => target.safeToRun);
  const firstProof = proofRunner.receipts.find((receipt) => receipt.safeToRun && !receipt.missingEnv.length);

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    mode: "append-only-ai-review-ledger",
    ledgerHash: stableHash({
      date,
      sport,
      status,
      promptManifest,
      entries: allEntries.map((item) => item.evidenceHash)
    }),
    promptManifestHash: stableHash(promptManifest),
    summary: statusSummary(status, counts),
    counts,
    promptManifest,
    controlContract: {
      noUpgrade: orchestrator.evidenceContract.noUpgrade,
      noPersistence: orchestrator.evidenceContract.noPersistence,
      noPublish: true,
      actionRankRule: "avoid < monitor < consider; AI output must be same-or-safer than deterministic baseline.",
      submitToOpenAIAllowed: orchestrator.openAiConfigured && orchestrator.runbook.canRunReview && proofRunner.status !== "blocked",
      persistAllowed: false,
      publishAllowed: false
    },
    nextEntry: sortedEntries.find((item) => item.status === "blocked") ?? sortedEntries.find((item) => item.status === "needs-config") ?? sortedEntries[0] ?? null,
    entries,
    runbook: {
      firstReviewCommand: firstReview?.command ?? null,
      firstReviewUrl: firstReview?.verifyUrl ?? null,
      firstProofCommand: firstProof?.command ?? null,
      firstProofUrl: firstProof?.verifyUrl ?? null,
      requiredBeforeReview: [
        ...(orchestrator.openAiConfigured ? [] : ["OPENAI_API_KEY"]),
        ...(proofRunner.status === "blocked" ? ["clear proof-runner blocked receipts"] : []),
        ...(activationAudit.status === "blocked" ? ["clear activation-audit blocked gates"] : [])
      ],
      requiredBeforePersistence: activationAudit.evidenceContract.requiredBeforeWriteMode
    }
  };
}
