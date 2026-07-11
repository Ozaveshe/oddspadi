import type { DecisionMvpAnswerAuthorityGate } from "@/lib/sports/prediction/decisionMvpAnswerAuthorityGate";
import type { DecisionMvpProviderProofGate } from "@/lib/sports/prediction/decisionMvpProviderProofGate";
import type { DecisionMvpProviderSetupPacket } from "@/lib/sports/prediction/decisionMvpProviderSetupPacket";
import type { DecisionMvpStorageCorpusGate } from "@/lib/sports/prediction/decisionMvpStorageCorpusGate";
import type { Sport } from "@/lib/sports/types";

export type DecisionMvpProviderActivationChecklistStatus =
  | "waiting-provider-key"
  | "waiting-admin-token"
  | "ready-dry-run"
  | "proof-observed"
  | "waiting-storage-review"
  | "blocked";

export type DecisionMvpProviderActivationChecklistStepStatus = "pass" | "ready" | "waiting" | "locked" | "block";
export type DecisionMvpProviderActivationChecklistStepId =
  | "acquire-provider-key"
  | "save-local-env"
  | "mirror-netlify-env"
  | "restart-localhost"
  | "run-dry-run-proof"
  | "review-storage-corpus"
  | "keep-answer-locked";

export type DecisionMvpProviderActivationChecklistStep = {
  id: DecisionMvpProviderActivationChecklistStepId;
  label: string;
  status: DecisionMvpProviderActivationChecklistStepStatus;
  detail: string;
  evidence: string;
  proofUrl: string;
  command: string | null;
};

export type DecisionMvpProviderActivationChecklist = {
  mode: "decision-mvp-provider-activation-checklist";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMvpProviderActivationChecklistStatus;
  checklistHash: string;
  summary: string;
  selectedStep: DecisionMvpProviderActivationChecklistStep | null;
  provider: {
    id: string | null;
    label: string | null;
    provider: string | null;
    recommendedEnvName: string | null;
    acceptedEnvNames: string[];
    localEnvLine: string | null;
    localTarget: ".env.local";
    netlifyEnvNames: string[];
    getKeyUrl: string | null;
    docsUrl: string | null;
    secretValuesReturned: false;
  };
  steps: DecisionMvpProviderActivationChecklistStep[];
  totals: {
    steps: number;
    pass: number;
    ready: number;
    waiting: number;
    locked: number;
    block: number;
  };
  controls: {
    canInspectReadOnly: true;
    canShowProviderUrls: true;
    canShowPlaceholderLines: true;
    canReadSecretValues: false;
    canPrintSecretValues: false;
    canWriteEnvFiles: false;
    canWriteNetlifyEnv: false;
    canRunSelectedDryRun: boolean;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
    canUseHiddenChainOfThought: false;
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

function compact(value: string | null | undefined, maxLength = 260): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No detail available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function step(input: DecisionMvpProviderActivationChecklistStep): DecisionMvpProviderActivationChecklistStep {
  return {
    ...input,
    detail: compact(input.detail),
    evidence: compact(input.evidence)
  };
}

function statusFor({
  providerProofGate,
  storageCorpusGate
}: {
  providerProofGate: DecisionMvpProviderProofGate;
  storageCorpusGate: DecisionMvpStorageCorpusGate;
}): DecisionMvpProviderActivationChecklistStatus {
  if (!providerProofGate.selected) return "blocked";
  if (providerProofGate.status === "proof-observed") {
    return storageCorpusGate.status === "ready-dry-run" ? "proof-observed" : "waiting-storage-review";
  }
  if (providerProofGate.status === "ready-dry-run") return "ready-dry-run";
  if (providerProofGate.status === "waiting-admin-token") return "waiting-admin-token";
  if (providerProofGate.status === "waiting-provider-env") return "waiting-provider-key";
  return "blocked";
}

function summaryFor(status: DecisionMvpProviderActivationChecklistStatus, label: string | null): string {
  if (status === "ready-dry-run") return `${label ?? "Selected provider"} is ready for an admin-gated dry-run proof.`;
  if (status === "proof-observed") return "Provider proof is observed; continue only to storage/corpus review and keep answer authority locked.";
  if (status === "waiting-storage-review") return "Provider proof is observed, but storage/corpus review must clear before training or answer promotion.";
  if (status === "waiting-admin-token") return `${label ?? "Selected provider"} has env configured and needs ODDSPADI_ADMIN_TOKEN before dry-run proof.`;
  if (status === "waiting-provider-key") return `${label ?? "Selected provider"} still needs a provider key saved locally and mirrored in Netlify.`;
  return "Provider activation checklist is blocked because no provider proof lane can be selected.";
}

export function buildDecisionMvpProviderActivationChecklist({
  date,
  sport,
  setupPacket,
  providerProofGate,
  storageCorpusGate,
  answerAuthorityGate,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  setupPacket: DecisionMvpProviderSetupPacket;
  providerProofGate: DecisionMvpProviderProofGate;
  storageCorpusGate: DecisionMvpStorageCorpusGate;
  answerAuthorityGate: DecisionMvpAnswerAuthorityGate;
  now?: Date;
}): DecisionMvpProviderActivationChecklist {
  const setupStep =
    setupPacket.nextStep ??
    setupPacket.steps.find((item) => item.critical && item.status !== "configured") ??
    setupPacket.steps.find((item) => item.critical) ??
    setupPacket.steps[0] ??
    null;
  const selected = providerProofGate.selected;
  const providerConfigured = Boolean(selected?.providerConfigured || setupStep?.status === "configured");
  const adminConfigured = Boolean(selected?.adminTokenConfigured);
  const proofObserved = providerProofGate.status === "proof-observed";
  const status = statusFor({ providerProofGate, storageCorpusGate });
  const acceptedEnvNames = setupStep?.acceptedEnvNames ?? selected?.requiredEnv ?? [];
  const netlifyEnvNames = setupStep?.netlifyEnvNames ?? acceptedEnvNames;
  const localEnvLine = setupStep?.localEnvLine ?? (acceptedEnvNames[0] ? `${acceptedEnvNames[0]}=paste_${acceptedEnvNames[0].toLowerCase()}_here` : null);
  const proofUrl = providerProofGate.nextAction.proofUrl;

  const steps = [
    step({
      id: "acquire-provider-key",
      label: "Acquire provider key",
      status: providerConfigured ? "pass" : "waiting",
      detail: setupStep?.whyItMatters ?? providerProofGate.summary,
      evidence: providerConfigured ? `${selected?.label ?? setupStep?.label ?? "Provider"} env name is present.` : setupStep?.afterSave[0] ?? "Create or reuse the provider key.",
      proofUrl: setupStep?.getKeyUrl ?? "/api/sports/decision/mvp-provider-setup-packet",
      command: null
    }),
    step({
      id: "save-local-env",
      label: "Save local env",
      status: providerConfigured ? "pass" : "waiting",
      detail: `Save one accepted env name in .env.local: ${localEnvLine ?? "provider key placeholder"}.`,
      evidence: providerConfigured ? "Provider env name is configured in the server runtime." : "Only placeholder env names are shown; secret values are not read or returned.",
      proofUrl: "/api/sports/decision/mvp-provider-setup-packet",
      command: null
    }),
    step({
      id: "mirror-netlify-env",
      label: "Mirror Netlify env",
      status: providerConfigured ? "ready" : "waiting",
      detail: `Add the same provider value to Netlify using one of: ${netlifyEnvNames.join(" or ") || "provider env names"}.`,
      evidence: providerConfigured ? "Local proof can proceed; production still needs Netlify env parity before deploy proof." : "Netlify env is manual and cannot be written by this route.",
      proofUrl: "/api/sports/decision/netlify-readiness",
      command: null
    }),
    step({
      id: "restart-localhost",
      label: "Restart localhost",
      status: providerConfigured ? "pass" : "locked",
      detail: "Restart the Next.js server after editing .env.local so process.env reloads.",
      evidence: providerConfigured ? "Current server runtime sees an accepted env name." : "Restart proof waits until a real key is saved.",
      proofUrl: "/api/sports/decision/provider-env-diagnostic",
      command: null
    }),
    step({
      id: "run-dry-run-proof",
      label: "Run dry-run proof",
      status: proofObserved ? "pass" : providerProofGate.controls.canRunSelectedDryRun ? "ready" : providerConfigured && !adminConfigured ? "waiting" : "locked",
      detail: providerProofGate.nextAction.detail,
      evidence: proofObserved ? providerProofGate.summary : "Dry-run proof must keep dryRun=true and use run=1 plus the admin header.",
      proofUrl,
      command: selected?.command ?? null
    }),
    step({
      id: "review-storage-corpus",
      label: "Review storage/corpus",
      status: proofObserved ? (storageCorpusGate.status === "ready-dry-run" ? "ready" : "waiting") : "locked",
      detail: storageCorpusGate.nextStep.detail,
      evidence: storageCorpusGate.summary,
      proofUrl: storageCorpusGate.nextStep.proofUrl,
      command: null
    }),
    step({
      id: "keep-answer-locked",
      label: "Keep answer locked",
      status: answerAuthorityGate.publicAnswer.allowed ? "block" : "pass",
      detail: answerAuthorityGate.summary,
      evidence: answerAuthorityGate.publicAnswer.reason,
      proofUrl: "/api/sports/decision/mvp-answer-authority-gate",
      command: null
    })
  ];
  const selectedStep = steps.find((item) => item.status === "waiting" || item.status === "ready" || item.status === "block") ?? steps[0] ?? null;
  const totals = {
    steps: steps.length,
    pass: steps.filter((item) => item.status === "pass").length,
    ready: steps.filter((item) => item.status === "ready").length,
    waiting: steps.filter((item) => item.status === "waiting").length,
    locked: steps.filter((item) => item.status === "locked").length,
    block: steps.filter((item) => item.status === "block").length
  };

  return {
    mode: "decision-mvp-provider-activation-checklist",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    checklistHash: stableHash({
      date,
      sport,
      status,
      setup: [setupPacket.setupHash, setupPacket.status],
      proof: [providerProofGate.gateHash, providerProofGate.status],
      storage: [storageCorpusGate.gateHash, storageCorpusGate.status],
      authority: [answerAuthorityGate.authorityHash, answerAuthorityGate.status],
      steps: steps.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status, selected?.label ?? setupStep?.label ?? null),
    selectedStep,
    provider: {
      id: selected?.providerId ?? setupStep?.id ?? null,
      label: selected?.label ?? setupStep?.label ?? null,
      provider: selected?.provider ?? setupStep?.provider ?? null,
      recommendedEnvName: setupStep?.recommendedEnvName ?? acceptedEnvNames[0] ?? null,
      acceptedEnvNames,
      localEnvLine,
      localTarget: ".env.local",
      netlifyEnvNames,
      getKeyUrl: setupStep?.getKeyUrl ?? null,
      docsUrl: setupStep?.docsUrl ?? null,
      secretValuesReturned: false
    },
    steps,
    totals,
    controls: {
      canInspectReadOnly: true,
      canShowProviderUrls: true,
      canShowPlaceholderLines: true,
      canReadSecretValues: false,
      canPrintSecretValues: false,
      canWriteEnvFiles: false,
      canWriteNetlifyEnv: false,
      canRunSelectedDryRun: providerProofGate.controls.canRunSelectedDryRun,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-provider-activation-checklist",
      "/api/sports/decision/mvp-provider-setup-packet",
      "/api/sports/decision/mvp-provider-proof-gate",
      "/api/sports/decision/mvp-storage-corpus-gate",
      "/api/sports/decision/mvp-answer-authority-gate",
      ...steps.map((item) => item.proofUrl),
      ...setupPacket.proofUrls,
      ...providerProofGate.proofUrls,
      ...storageCorpusGate.proofUrls,
      ...answerAuthorityGate.proofUrls
    ]),
    locks: unique([
      "MVP provider activation checklist never reads, prints, writes, or validates plaintext provider keys.",
      "The user must save provider keys manually in .env.local and Netlify environment variables.",
      "Provider proof must be dry-run/admin-gated before any storage review.",
      "Provider activation cannot publish picks, stake, persist decisions, train models, apply learned weights, adjust probabilities, raise confidence, or reveal hidden chain-of-thought.",
      ...setupPacket.locks,
      ...providerProofGate.locks,
      ...storageCorpusGate.locks,
      ...answerAuthorityGate.locks
    ])
  };
}
