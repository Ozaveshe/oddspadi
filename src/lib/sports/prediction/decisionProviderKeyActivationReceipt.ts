import { configuredEnvKeys } from "@/lib/env";
import type { DecisionProviderKeyActivationRehearsal } from "@/lib/sports/prediction/decisionProviderKeyActivationRehearsal";
import type { DecisionProviderKeyPlan, DecisionProviderKeyPlanLane } from "@/lib/sports/prediction/decisionProviderKeyPlan";

type EnvMap = Record<string, string | undefined>;

export type DecisionProviderKeyActivationReceiptStatus =
  | "waiting-provider-env"
  | "partial-provider-env"
  | "ready-read-only-proof"
  | "not-provider-key-blocked";

export type DecisionProviderKeyActivationReceiptLane = {
  id: DecisionProviderKeyPlanLane["id"];
  label: string;
  status: DecisionProviderKeyPlanLane["status"];
  requiredEnvNames: string[];
  configuredEnvNames: string[];
  missingEnvNames: string[];
  proofUrl: string;
  nextAction: string;
};

export type DecisionProviderKeyActivationReceipt = {
  generatedAt: string;
  date: string;
  sport: DecisionProviderKeyActivationRehearsal["sport"];
  mode: "decision-provider-key-activation-receipt";
  status: DecisionProviderKeyActivationReceiptStatus;
  receiptHash: string;
  summary: string;
  input: {
    rehearsalHash: string;
    rehearsalStatus: DecisionProviderKeyActivationRehearsal["status"];
    providerKeyPlanStatus: DecisionProviderKeyPlan["status"];
  };
  observed: {
    selectedLaneId: DecisionProviderKeyPlanLane["id"] | null;
    selectedLaneConfigured: boolean;
    relevantConfiguredLanes: number;
    relevantLaneCount: number;
    configuredEnvNames: string[];
    missingEnvNames: string[];
    secretValuesReturned: false;
  };
  selectedLane: DecisionProviderKeyActivationReceiptLane | null;
  relevantLanes: DecisionProviderKeyActivationReceiptLane[];
  nextProof: {
    label: string;
    url: string;
    safeToRun: boolean;
    expectedEvidence: string[];
  };
  controls: {
    canInspectReadOnly: true;
    canReadSecretValues: false;
    canPrintSecretValues: false;
    canWriteEnvFiles: false;
    canWriteNetlifyEnv: false;
    canRetryContextProof: boolean;
    canRunProviderDryRun: false;
    canWriteProviderRows: false;
    canWriteFeatureSnapshots: false;
    canPersistDecisions: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
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

function unique(values: Array<string | null | undefined>, limit = 60): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function configuredNames(env: EnvMap, keys: string[]): string[] {
  return configuredEnvKeys(env, keys);
}

function laneFor(lane: DecisionProviderKeyPlanLane, env: EnvMap): DecisionProviderKeyActivationReceiptLane {
  const configured = configuredNames(env, lane.keys);
  return {
    id: lane.id,
    label: lane.label,
    status: lane.status,
    requiredEnvNames: lane.keys,
    configuredEnvNames: configured,
    missingEnvNames: configured.length ? [] : lane.keys,
    proofUrl: lane.proofUrl,
    nextAction:
      lane.status === "configured"
        ? `Retry read-only proof at ${lane.proofUrl}; do not write provider rows from this receipt.`
        : `Set one accepted env name for ${lane.label}, restart localhost, then re-run this receipt.`
  };
}

function statusFor({
  rehearsal,
  relevantLanes
}: {
  rehearsal: DecisionProviderKeyActivationRehearsal;
  relevantLanes: DecisionProviderKeyActivationReceiptLane[];
}): DecisionProviderKeyActivationReceiptStatus {
  if (rehearsal.status === "not-provider-key-blocked") return "not-provider-key-blocked";
  if (relevantLanes.length && relevantLanes.every((lane) => lane.status === "configured")) return "ready-read-only-proof";
  if (relevantLanes.some((lane) => lane.status === "configured")) return "partial-provider-env";
  return "waiting-provider-env";
}

function summaryFor(status: DecisionProviderKeyActivationReceiptStatus, lane: DecisionProviderKeyActivationReceiptLane | null): string {
  if (status === "ready-read-only-proof") return "Provider env names are present for the current blocker; the next safe move is a read-only proof retry.";
  if (status === "partial-provider-env") return `Provider env is partially configured; next missing lane is ${lane?.label ?? "not selected"}.`;
  if (status === "not-provider-key-blocked") return "Provider-key activation receipt is idle because the current blocker is not provider-key related.";
  return `Provider-key activation receipt is still waiting for ${lane?.label ?? "the selected provider lane"} env names after restart.`;
}

export function buildDecisionProviderKeyActivationReceipt({
  rehearsal,
  providerKeyPlan,
  env = process.env,
  now = new Date()
}: {
  rehearsal: DecisionProviderKeyActivationRehearsal;
  providerKeyPlan: DecisionProviderKeyPlan;
  env?: EnvMap;
  now?: Date;
}): DecisionProviderKeyActivationReceipt {
  const lanesFromResolver = rehearsal.selectedLane
    ? providerKeyPlan.lanes.filter((lane) => lane.id === rehearsal.selectedLane?.id || rehearsal.proofUrls.includes(lane.proofUrl))
    : [];
  const relevantPlanLanes = lanesFromResolver.length ? lanesFromResolver : providerKeyPlan.lanes.filter((lane) => lane.status === "missing").slice(0, 1);
  const relevantLanes = relevantPlanLanes.map((lane) => laneFor(lane, env));
  const selectedLane = relevantLanes.find((lane) => lane.status === "missing") ?? relevantLanes[0] ?? null;
  const status = statusFor({ rehearsal, relevantLanes });
  const configuredEnvNames = unique(relevantLanes.flatMap((lane) => lane.configuredEnvNames));
  const missingEnvNames = unique(relevantLanes.flatMap((lane) => lane.missingEnvNames));
  const canRetryContextProof = status === "ready-read-only-proof";
  const nextUrl = canRetryContextProof ? rehearsal.verification.afterRestartUrl : (selectedLane?.proofUrl ?? rehearsal.verification.verifyUrl);
  const receiptHash = stableHash({
    rehearsal: rehearsal.rehearsalHash,
    status,
    providerKeyPlan: providerKeyPlan.status,
    lanes: relevantLanes.map((lane) => [lane.id, lane.status, lane.configuredEnvNames, lane.missingEnvNames])
  });

  return {
    generatedAt: now.toISOString(),
    date: rehearsal.date,
    sport: rehearsal.sport,
    mode: "decision-provider-key-activation-receipt",
    status,
    receiptHash,
    summary: summaryFor(status, selectedLane),
    input: {
      rehearsalHash: rehearsal.rehearsalHash,
      rehearsalStatus: rehearsal.status,
      providerKeyPlanStatus: providerKeyPlan.status
    },
    observed: {
      selectedLaneId: selectedLane?.id ?? null,
      selectedLaneConfigured: selectedLane?.status === "configured",
      relevantConfiguredLanes: relevantLanes.filter((lane) => lane.status === "configured").length,
      relevantLaneCount: relevantLanes.length,
      configuredEnvNames,
      missingEnvNames,
      secretValuesReturned: false
    },
    selectedLane,
    relevantLanes,
    nextProof: {
      label: canRetryContextProof ? "Retry context feature proof receipt" : `Resolve ${selectedLane?.label ?? "provider env"}`,
      url: nextUrl,
      safeToRun: true,
      expectedEvidence: unique([
        canRetryContextProof ? "context proof moves beyond provider-key blocker" : "missing env names are reduced to zero after restart",
        "only env names are returned; secret values remain hidden",
        "provider writes, feature writes, training, public picks, and staking remain locked"
      ])
    },
    controls: {
      canInspectReadOnly: true,
      canReadSecretValues: false,
      canPrintSecretValues: false,
      canWriteEnvFiles: false,
      canWriteNetlifyEnv: false,
      canRetryContextProof,
      canRunProviderDryRun: false,
      canWriteProviderRows: false,
      canWriteFeatureSnapshots: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/provider-key-activation-receipt",
      rehearsal.verification.verifyUrl,
      rehearsal.verification.afterRestartUrl,
      nextUrl,
      ...relevantLanes.map((lane) => lane.proofUrl),
      ...rehearsal.proofUrls
    ]),
    locks: unique([
      "Provider-key activation receipt observes env-name presence only and never returns secret values.",
      "A ready receipt permits only read-only proof retry; it does not permit provider writes or data persistence.",
      "Model probabilities, learned weights, public picks, and staking stay locked until stored evidence and backtests pass.",
      ...rehearsal.locks
    ])
  };
}
