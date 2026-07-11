import type { DecisionEnvActivationMatrix } from "@/lib/sports/prediction/decisionEnvActivationMatrix";
import type {
  DecisionProviderKeyBlockerResolver,
  DecisionProviderKeyBlockerResolverLane
} from "@/lib/sports/prediction/decisionProviderKeyBlockerResolver";

export type DecisionProviderKeyActivationRehearsalStatus =
  | "waiting-local-env"
  | "waiting-netlify-env"
  | "ready-restart"
  | "ready-retry-proof"
  | "not-provider-key-blocked";

export type DecisionProviderKeyActivationRehearsal = {
  generatedAt: string;
  date: string;
  sport: DecisionProviderKeyBlockerResolver["sport"];
  mode: "decision-provider-key-activation-rehearsal";
  status: DecisionProviderKeyActivationRehearsalStatus;
  rehearsalHash: string;
  summary: string;
  input: {
    resolverHash: string;
    resolverStatus: DecisionProviderKeyBlockerResolver["status"];
    envMatrixHash: string | null;
    envMatrixStatus: DecisionEnvActivationMatrix["status"] | null;
  };
  selectedLane: DecisionProviderKeyBlockerResolverLane | null;
  local: {
    target: ".env.local";
    placeholderLines: string[];
    acceptedEnvNames: string[];
    restartRequired: boolean;
    nextAction: string;
  };
  netlify: {
    target: "Netlify environment variables";
    envNames: string[];
    nextAction: string;
  };
  restart: {
    required: boolean;
    reason: string;
  };
  verification: {
    verifyUrl: string;
    afterRestartUrl: string;
    safeToRun: boolean;
    expectedEvidence: string[];
  };
  controls: {
    canInspectReadOnly: true;
    canShowProviderUrls: true;
    canShowPlaceholderLines: true;
    canReadSecrets: false;
    canWriteEnvFiles: false;
    canWriteNetlifyEnv: false;
    canValidateSecretValues: false;
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

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function placeholderFor(envName: string): string {
  return `${envName}=paste_${envName.toLowerCase()}_here`;
}

function statusFor(resolver: DecisionProviderKeyBlockerResolver): DecisionProviderKeyActivationRehearsalStatus {
  if (resolver.status === "not-provider-key-blocked") return "not-provider-key-blocked";
  if (resolver.status === "ready-to-retry-context-proof") return "ready-retry-proof";
  if (resolver.status === "partial") return "waiting-netlify-env";
  return "waiting-local-env";
}

function summaryFor(status: DecisionProviderKeyActivationRehearsalStatus, lane: DecisionProviderKeyBlockerResolverLane | null): string {
  if (status === "not-provider-key-blocked") return "Provider-key activation rehearsal is idle because the current context proof is not provider-key blocked.";
  if (status === "ready-retry-proof") return "Provider keys for this context blocker are configured; restart if keys were just added, then retry the read-only proof.";
  if (status === "waiting-netlify-env") return `Local provider configuration is partly resolved; mirror ${lane?.label ?? "the provider key"} into Netlify env before production proof.`;
  if (status === "ready-restart") return "Provider key names are present; restart localhost before retrying the proof route.";
  return `Provider-key activation is waiting for ${lane?.label ?? "the selected provider lane"} in .env.local and Netlify env.`;
}

export function buildDecisionProviderKeyActivationRehearsal({
  resolver,
  envActivationMatrix = null,
  now = new Date()
}: {
  resolver: DecisionProviderKeyBlockerResolver;
  envActivationMatrix?: DecisionEnvActivationMatrix | null;
  now?: Date;
}): DecisionProviderKeyActivationRehearsal {
  const selectedLane = resolver.selectedLane;
  const status = statusFor(resolver);
  const acceptedEnvNames = selectedLane?.acceptedEnvNames ?? [];
  const placeholderLines = acceptedEnvNames.slice(0, 3).map(placeholderFor);
  const afterRestartUrl =
    resolver.status === "ready-to-retry-context-proof"
      ? resolver.nextTurn.verifyUrl
      : "/api/sports/decision/provider-key-blocker-resolver?date=2026-07-04&sport=football&run=1&targetDate=2026-08-21";
  const verificationUrl = "/api/sports/decision/provider-key-activation-rehearsal?date=2026-07-04&sport=football&run=1&targetDate=2026-08-21";
  const rehearsalHash = stableHash({
    resolver: resolver.resolverHash,
    status,
    lane: selectedLane ? [selectedLane.id, selectedLane.status, selectedLane.acceptedEnvNames, selectedLane.netlifyEnvNames] : null,
    env: envActivationMatrix ? [envActivationMatrix.matrixHash, envActivationMatrix.status] : null
  });

  return {
    generatedAt: now.toISOString(),
    date: resolver.date,
    sport: resolver.sport,
    mode: "decision-provider-key-activation-rehearsal",
    status,
    rehearsalHash,
    summary: summaryFor(status, selectedLane),
    input: {
      resolverHash: resolver.resolverHash,
      resolverStatus: resolver.status,
      envMatrixHash: envActivationMatrix?.matrixHash ?? null,
      envMatrixStatus: envActivationMatrix?.status ?? null
    },
    selectedLane,
    local: {
      target: ".env.local",
      placeholderLines,
      acceptedEnvNames,
      restartRequired: true,
      nextAction: selectedLane
        ? `Add one accepted ${selectedLane.label} variable to .env.local, for example ${placeholderLines[0] ?? `${selectedLane.recommendedEnvName}=paste_key_here`}.`
        : "No provider lane is selected; inspect the provider-key blocker resolver."
    },
    netlify: {
      target: "Netlify environment variables",
      envNames: selectedLane?.netlifyEnvNames ?? [],
      nextAction: selectedLane
        ? `Mirror the same provider key into Netlify using one of: ${selectedLane.netlifyEnvNames.join(" or ")}.`
        : "No Netlify provider key lane is selected."
    },
    restart: {
      required: true,
      reason: "Next.js reads server env at process start; after editing .env.local, restart localhost before retrying provider proof."
    },
    verification: {
      verifyUrl: verificationUrl,
      afterRestartUrl,
      safeToRun: true,
      expectedEvidence: unique([
        "status moves away from waiting-provider-keys after accepted key names are present",
        `selected lane remains ${selectedLane?.id ?? "provider-key-plan"}`,
        `next proof route is ${resolver.nextTurn.verifyUrl}`,
        "secret values are never printed, read, or returned"
      ])
    },
    controls: {
      canInspectReadOnly: true,
      canShowProviderUrls: true,
      canShowPlaceholderLines: true,
      canReadSecrets: false,
      canWriteEnvFiles: false,
      canWriteNetlifyEnv: false,
      canValidateSecretValues: false,
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
      verificationUrl,
      "/api/sports/decision/provider-key-activation-rehearsal",
      "/api/sports/decision/provider-key-blocker-resolver",
      "/api/sports/decision/env-activation-matrix",
      "/api/sports/decision/provider-key-plan",
      resolver.nextTurn.verifyUrl,
      selectedLane?.proofUrl,
      ...(envActivationMatrix?.proofUrls ?? []),
      ...resolver.proofUrls
    ]),
    locks: unique([
      "Provider-key activation rehearsal only returns env names and placeholders, never real values.",
      "The user must save keys manually in .env.local and Netlify environment variables.",
      "Restart localhost after .env.local changes before retrying proof routes.",
      "Read-only key-name proof does not unlock provider writes, feature writes, model training, public picks, or staking.",
      ...resolver.locks
    ])
  };
}
