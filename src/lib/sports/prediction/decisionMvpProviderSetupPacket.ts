import type { DecisionMvpEvidenceAcquisitionQueue } from "@/lib/sports/prediction/decisionMvpEvidenceAcquisitionQueue";
import type { DecisionProviderUnlockItem, DecisionProviderUnlockSnapshot } from "@/lib/sports/prediction/decisionProviderUnlockSnapshot";
import type { Sport } from "@/lib/sports/types";

export type DecisionMvpProviderSetupStatus = "ready-for-proof" | "waiting-critical-provider" | "partial-provider-setup" | "blocked";

export type DecisionMvpProviderSetupStep = {
  id: DecisionProviderUnlockItem["id"];
  label: string;
  provider: string;
  status: DecisionProviderUnlockItem["status"];
  order: number;
  critical: boolean;
  recommendedEnvName: string;
  acceptedEnvNames: string[];
  localEnvLine: string;
  localTarget: ".env.local";
  netlifyEnvNames: string[];
  getKeyUrl: string;
  docsUrl: string;
  proofUrl: string;
  evidenceQueueUrl: string;
  canRunProofNow: boolean;
  unlocksFeeds: string[];
  unlocksModelFeatures: string[];
  whyItMatters: string;
  afterSave: string[];
};

export type DecisionMvpProviderSetupPacket = {
  mode: "decision-mvp-provider-setup-packet";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMvpProviderSetupStatus;
  setupHash: string;
  summary: string;
  nextStep: DecisionMvpProviderSetupStep | null;
  footballMvpMinimum: {
    status: DecisionProviderUnlockSnapshot["footballMvpMinimum"]["status"];
    nextMissingEnvName: string | null;
    localEnvLines: string[];
    netlifyEnvNames: string[];
    firstProofUrl: string;
    afterSave: string[];
  };
  totals: {
    steps: number;
    configured: number;
    waiting: number;
    critical: number;
    configuredCritical: number;
    proofReady: number;
  };
  steps: DecisionMvpProviderSetupStep[];
  controls: {
    canInspectReadOnly: true;
    canShowProviderUrls: true;
    canReadSecretValues: false;
    canPrintSecretValues: false;
    canWriteEnvFiles: false;
    canWriteNetlifyEnv: false;
    canRunProviderProof: boolean;
    canWriteProviderRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
};

const SETUP_ORDER: Record<DecisionProviderUnlockItem["id"], number> = {
  "football-core": 1,
  "odds-markets": 2,
  "basketball-core": 3,
  "tennis-core": 4,
  "news-context": 5,
  "weather-context": 6
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

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function statusFor(providerUnlockSnapshot: DecisionProviderUnlockSnapshot): DecisionMvpProviderSetupStatus {
  if (!providerUnlockSnapshot.providers.length) return "blocked";
  if (providerUnlockSnapshot.status === "ready") return "ready-for-proof";
  if (providerUnlockSnapshot.status === "partial") return "partial-provider-setup";
  return "waiting-critical-provider";
}

function summaryFor(status: DecisionMvpProviderSetupStatus, nextStep: DecisionMvpProviderSetupStep | null): string {
  if (status === "ready-for-proof") return "Provider setup is ready for read-only proof runs; writes, training, public picks, and staking remain locked.";
  if (status === "partial-provider-setup") return `Provider setup is partially configured; next setup step is ${nextStep?.label ?? "not selected"}.`;
  if (status === "blocked") return "Provider setup cannot be planned because the provider unlock map is unavailable.";
  return `Provider setup is waiting on ${nextStep?.label ?? "critical football and odds keys"} before the live MVP can use real data.`;
}

function buildStep({
  provider,
  evidenceQueue
}: {
  provider: DecisionProviderUnlockItem;
  evidenceQueue: DecisionMvpEvidenceAcquisitionQueue;
}): DecisionMvpProviderSetupStep {
  const evidenceItem = evidenceQueue.items.find((item) => item.providerId === provider.id);
  return {
    id: provider.id,
    label: provider.label,
    provider: provider.provider,
    status: provider.status,
    order: SETUP_ORDER[provider.id] ?? provider.acceptedEnvNames.length + 10,
    critical: provider.critical,
    recommendedEnvName: provider.recommendedEnvName,
    acceptedEnvNames: provider.acceptedEnvNames,
    localEnvLine: provider.localEnvLine,
    localTarget: ".env.local",
    netlifyEnvNames: provider.netlifyEnvNames,
    getKeyUrl: provider.getKeyUrl,
    docsUrl: provider.docsUrl,
    proofUrl: provider.firstProofUrl,
    evidenceQueueUrl: evidenceItem?.proofUrl ?? "/api/sports/decision/mvp-evidence-acquisition-queue",
    canRunProofNow: provider.status === "configured",
    unlocksFeeds: provider.unlocksFeeds,
    unlocksModelFeatures: provider.unlocksModelFeatures,
    whyItMatters:
      evidenceItem?.expectedBeliefChange ??
      `${provider.label} unlocks ${provider.unlocksModelFeatures.slice(0, 3).join(", ")} and reduces this blocker: ${provider.riskIfMissing}`,
    afterSave: [
      "Save the real secret manually in .env.local; keep the file out of git.",
      "Mirror the same env name in Netlify environment variables before production proof.",
      "Restart localhost so Next.js reloads process.env.",
      `Open ${provider.firstProofUrl} as a read-only proof before any storage write or training run.`
    ]
  };
}

export function buildDecisionMvpProviderSetupPacket({
  date,
  sport,
  providerUnlockSnapshot,
  evidenceQueue,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  providerUnlockSnapshot: DecisionProviderUnlockSnapshot;
  evidenceQueue: DecisionMvpEvidenceAcquisitionQueue;
  now?: Date;
}): DecisionMvpProviderSetupPacket {
  const steps = providerUnlockSnapshot.providers
    .map((provider) => buildStep({ provider, evidenceQueue }))
    .sort((left, right) => {
      if (left.critical !== right.critical) return left.critical ? -1 : 1;
      if (left.status !== right.status) {
        const score = { missing: 0, placeholder: 1, configured: 2 };
        return score[left.status] - score[right.status];
      }
      return left.order - right.order;
    });
  const nextStep =
    steps.find((step) => step.critical && step.status !== "configured") ??
    steps.find((step) => step.status !== "configured") ??
    steps.find((step) => step.canRunProofNow && step.critical) ??
    steps[0] ??
    null;
  const status = statusFor(providerUnlockSnapshot);
  const localEnvLines = providerUnlockSnapshot.footballMvpMinimum.requiredEnvLines;
  const netlifyEnvNames = unique(
    providerUnlockSnapshot.providers
      .filter((provider) => provider.id === "football-core" || provider.id === "odds-markets")
      .flatMap((provider) => provider.netlifyEnvNames),
    12
  );

  return {
    mode: "decision-mvp-provider-setup-packet",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    setupHash: stableHash({
      date,
      sport,
      status,
      unlock: [providerUnlockSnapshot.snapshotHash, providerUnlockSnapshot.status, providerUnlockSnapshot.totals],
      evidence: [evidenceQueue.queueHash, evidenceQueue.status, evidenceQueue.totals],
      steps: steps.map((step) => [step.id, step.status, step.recommendedEnvName, step.canRunProofNow])
    }),
    summary: summaryFor(status, nextStep),
    nextStep,
    footballMvpMinimum: {
      status: providerUnlockSnapshot.footballMvpMinimum.status,
      nextMissingEnvName: providerUnlockSnapshot.footballMvpMinimum.nextMissingEnvName,
      localEnvLines,
      netlifyEnvNames,
      firstProofUrl: providerUnlockSnapshot.footballMvpMinimum.firstProofUrl,
      afterSave: providerUnlockSnapshot.footballMvpMinimum.afterSave
    },
    totals: {
      steps: steps.length,
      configured: steps.filter((step) => step.status === "configured").length,
      waiting: steps.filter((step) => step.status !== "configured").length,
      critical: steps.filter((step) => step.critical).length,
      configuredCritical: steps.filter((step) => step.critical && step.status === "configured").length,
      proofReady: steps.filter((step) => step.canRunProofNow).length
    },
    steps,
    controls: {
      canInspectReadOnly: true,
      canShowProviderUrls: true,
      canReadSecretValues: false,
      canPrintSecretValues: false,
      canWriteEnvFiles: false,
      canWriteNetlifyEnv: false,
      canRunProviderProof: providerUnlockSnapshot.controls.canRunProviderDryRun,
      canWriteProviderRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-provider-setup-packet",
      "/api/sports/decision/provider-env-diagnostic",
      "/api/sports/decision/provider-unlock-snapshot",
      "/api/sports/decision/mvp-evidence-acquisition-queue",
      ...steps.map((step) => step.proofUrl),
      ...steps.map((step) => step.evidenceQueueUrl)
    ]),
    locks: [
      "The setup packet never returns plaintext provider keys and cannot write .env.local or Netlify env values.",
      "Provider setup can only unlock read-only proof until storage, Supabase, training, and admin gates pass.",
      "Provider rows, learned weights, public picks, staking, and public action upgrades remain locked."
    ]
  };
}
