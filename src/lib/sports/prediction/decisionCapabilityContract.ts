import type { DecisionActivationAudit } from "@/lib/sports/prediction/decisionActivationAudit";
import type { DecisionAgentRuntime } from "@/lib/sports/prediction/decisionAgentRuntime";
import type { DecisionAuthority } from "@/lib/sports/prediction/decisionAuthority";
import type { DecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import type { DecisionEvidenceTransition } from "@/lib/sports/prediction/decisionEvidenceTransition";
import type { DecisionModelTrust } from "@/lib/sports/prediction/decisionModelTrust";
import type { DecisionOddsBoard } from "@/lib/sports/prediction/decisionOddsBoard";
import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import type { DecisionSignalReliability } from "@/lib/sports/prediction/decisionSignalReliability";
import type { DecisionSupabaseBootstrap } from "@/lib/sports/prediction/decisionSupabaseBootstrap";
import type { Sport } from "@/lib/sports/types";

export type DecisionCapabilityContractStatus = "live-ready" | "review-ready" | "proof-mode" | "blocked";
export type DecisionCapabilityStatus = "active" | "shadow" | "proof-ready" | "locked";
export type DecisionCapabilityLevel = "live" | "shadow" | "proof" | "blocked";
export type DecisionCapabilityCategory = "data" | "model" | "odds" | "ai" | "automation" | "memory" | "learning" | "publishing";

export type DecisionCapability = {
  id: string;
  category: DecisionCapabilityCategory;
  label: string;
  status: DecisionCapabilityStatus;
  level: DecisionCapabilityLevel;
  detail: string;
  evidence: string[];
  verifyUrl: string;
  nextAction: string;
  requiredBeforeLive: string[];
  permissions: {
    canUseNow: boolean;
    canAutoRun: boolean;
    canWrite: boolean;
    canPublish: boolean;
    canTrain: boolean;
  };
};

export type DecisionCapabilityContract = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionCapabilityContractStatus;
  contractHash: string;
  summary: string;
  liveReadinessScore: number;
  capabilities: DecisionCapability[];
  nextCapability: DecisionCapability | null;
  counts: Record<DecisionCapabilityStatus, number>;
  nextSafeCommand: {
    label: string;
    command: string | null;
    verifyUrl: string | null;
    expectedEvidence: string;
    source: string;
    safeToRun: boolean;
  } | null;
  runtimeContract: {
    canRunReadOnly: boolean;
    canRunDryRun: boolean;
    canAskOpenAI: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    mode: DecisionAgentRuntime["mode"];
    evidenceTransition: DecisionEvidenceTransition["status"];
    authority: DecisionAuthority["status"];
    supabaseBootstrap: DecisionSupabaseBootstrap["status"];
  };
  blockers: string[];
  forbiddenActions: string[];
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

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function round(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

function scoreFor(status: DecisionCapabilityStatus): number {
  if (status === "active") return 100;
  if (status === "shadow") return 70;
  if (status === "proof-ready") return 45;
  return 0;
}

function capability(input: DecisionCapability): DecisionCapability {
  return {
    ...input,
    evidence: unique(input.evidence, 5),
    requiredBeforeLive: unique(input.requiredBeforeLive, 6),
    permissions: {
      canUseNow: input.status === "active" || input.status === "shadow" || input.status === "proof-ready",
      canAutoRun: input.permissions.canAutoRun && input.status !== "locked",
      canWrite: false,
      canPublish: false,
      canTrain: false
    }
  };
}

function statusCounts(capabilities: DecisionCapability[]): Record<DecisionCapabilityStatus, number> {
  return {
    active: capabilities.filter((item) => item.status === "active").length,
    shadow: capabilities.filter((item) => item.status === "shadow").length,
    "proof-ready": capabilities.filter((item) => item.status === "proof-ready").length,
    locked: capabilities.filter((item) => item.status === "locked").length
  };
}

function contractStatus({
  runtime,
  capabilities
}: {
  runtime: DecisionAgentRuntime;
  capabilities: DecisionCapability[];
}): DecisionCapabilityContractStatus {
  if (capabilities.every((item) => item.status === "active") && runtime.status === "live-ready") return "live-ready";
  if (runtime.permissions.canAskOpenAI && capabilities.some((item) => item.id === "guarded-ai-review" && item.status !== "locked")) return "review-ready";
  if (capabilities.some((item) => item.status === "proof-ready" || item.status === "shadow" || item.status === "active")) return "proof-mode";
  return "blocked";
}

function liveReadinessScore(capabilities: DecisionCapability[]): number {
  if (!capabilities.length) return 0;
  return round(capabilities.reduce((sum, item) => sum + scoreFor(item.status), 0) / capabilities.length);
}

function chooseNextCapability(capabilities: DecisionCapability[]): DecisionCapability | null {
  return (
    capabilities.find((item) => item.status === "proof-ready") ??
    capabilities.find((item) => item.status === "locked") ??
    capabilities.find((item) => item.status === "shadow") ??
    capabilities[0] ??
    null
  );
}

function chooseNextSafeCommand({
  transition,
  runtime,
  supabaseBootstrap,
  nextCapability
}: {
  transition: DecisionEvidenceTransition;
  runtime: DecisionAgentRuntime;
  supabaseBootstrap: DecisionSupabaseBootstrap;
  nextCapability: DecisionCapability | null;
}): DecisionCapabilityContract["nextSafeCommand"] {
  if (transition.policy.canRunNextProof && transition.nextTransition.command) {
    return {
      label: transition.nextTransition.label,
      command: transition.nextTransition.command,
      verifyUrl: transition.nextTransition.verifyUrl,
      expectedEvidence: transition.nextTransition.expectedEvidence,
      source: "evidence-transition",
      safeToRun: true
    };
  }

  if (runtime.nextCommand?.canRunNow) {
    return {
      label: runtime.nextCommand.label,
      command: runtime.nextCommand.command,
      verifyUrl: runtime.nextCommand.verifyUrl,
      expectedEvidence: runtime.nextCommand.expectedEvidence,
      source: runtime.nextCommand.source,
      safeToRun: true
    };
  }

  if (supabaseBootstrap.nextCommand?.safeToRun) {
    return {
      label: supabaseBootstrap.nextCommand.label,
      command: supabaseBootstrap.nextCommand.command,
      verifyUrl: supabaseBootstrap.nextCommand.verifyUrl,
      expectedEvidence: supabaseBootstrap.nextCommand.expectedEvidence,
      source: `supabase-bootstrap:${supabaseBootstrap.nextCommand.id}`,
      safeToRun: true
    };
  }

  if (!nextCapability) return null;
  return {
    label: nextCapability.label,
    command: null,
    verifyUrl: nextCapability.verifyUrl,
    expectedEvidence: nextCapability.nextAction,
    source: `capability:${nextCapability.id}`,
    safeToRun: false
  };
}

function buildCapabilities({
  readiness,
  dataIntake,
  signalReliability,
  modelTrust,
  oddsBoard,
  transition,
  authority,
  runtime,
  activationAudit,
  supabaseBootstrap
}: {
  readiness: DecisionEngineReadiness;
  dataIntake: DecisionDataIntakeQueue;
  signalReliability: DecisionSignalReliability;
  modelTrust: DecisionModelTrust;
  oddsBoard: DecisionOddsBoard;
  transition: DecisionEvidenceTransition;
  authority: DecisionAuthority;
  runtime: DecisionAgentRuntime;
  activationAudit: DecisionActivationAudit;
  supabaseBootstrap: DecisionSupabaseBootstrap;
}): DecisionCapability[] {
  const providerReady = readiness.dataProviders.liveRuntimeBacked && signalReliability.status === "ready";
  const deterministicReady = readiness.deterministicCore.status === "ready";
  const oddsProviderReady = readiness.dataProviders.oddsApiConfigured && dataIntake.items.find((item) => item.category === "odds")?.status === "ready";
  const aiReviewReady = runtime.permissions.canAskOpenAI && authority.control.canApplyAI;
  const memoryReady = readiness.supabase.schema.status === "ready" && !supabaseBootstrap.credentials.serverKeyRejected;
  const trainingReady = readiness.trainingData.status === "ready" && modelTrust.status === "trusted-shadow";
  const proofReady = transition.policy.canRunNextProof || runtime.permissions.canRunReadOnly || runtime.permissions.canRunDryRun;

  return [
    capability({
      id: "deterministic-model-core",
      category: "model",
      label: "Deterministic model core",
      status: deterministicReady ? "active" : "locked",
      level: deterministicReady ? "live" : "blocked",
      detail: readiness.deterministicCore.detail,
      evidence: [readiness.engineVersion, `runtime:${readiness.runtimeMode}`, `authority:${authority.status}`],
      verifyUrl: "/api/sports/decision/status",
      nextAction: deterministicReady ? "Keep deterministic Poisson, team-rating, market, and control-policy outputs as the baseline." : "Repair deterministic engine checks before using any AI layer.",
      requiredBeforeLive: deterministicReady ? [] : ["Deterministic readiness must be ready."],
      permissions: { canUseNow: deterministicReady, canAutoRun: false, canWrite: false, canPublish: false, canTrain: false }
    }),
    capability({
      id: "live-data-intake",
      category: "data",
      label: "Live data intake",
      status: providerReady ? "active" : dataIntake.providerBackedSignals > 0 || dataIntake.computedSignals > 0 ? "shadow" : "locked",
      level: providerReady ? "live" : dataIntake.providerBackedSignals > 0 || dataIntake.computedSignals > 0 ? "shadow" : "blocked",
      detail: dataIntake.summary,
      evidence: [`coverage:${dataIntake.coverageScore}`, `reliability:${signalReliability.reliabilityScore}`, `gaps:${signalReliability.totals.requiredGaps}`],
      verifyUrl: "/api/sports/decision/data-intake",
      nextAction: dataIntake.nextItem?.expectedEvidence ?? signalReliability.nextSignal?.nextAction ?? "Keep provider coverage fresh.",
      requiredBeforeLive: unique([
        providerReady ? null : "Provider-backed fixtures, history, standings, form, injuries, lineups, odds, live scores, news, and weather must replace mock/stale gaps.",
        signalReliability.status === "ready" ? null : "Signal reliability must become ready."
      ]),
      permissions: { canUseNow: dataIntake.providerBackedSignals + dataIntake.computedSignals > 0, canAutoRun: false, canWrite: false, canPublish: false, canTrain: false }
    }),
    capability({
      id: "odds-value-intelligence",
      category: "odds",
      label: "Odds value intelligence",
      status: oddsProviderReady ? "active" : oddsBoard.status === "value-found" ? "shadow" : "locked",
      level: oddsProviderReady ? "live" : oddsBoard.status === "value-found" ? "shadow" : "blocked",
      detail: oddsBoard.summary,
      evidence: [`value:${oddsBoard.totals.value}`, `watch:${oddsBoard.totals.watch}`, `avoid:${oddsBoard.totals.avoid}`, `margin:${oddsBoard.totals.averageMargin ?? "n/a"}`],
      verifyUrl: oddsBoard.policy.verificationUrl,
      nextAction: oddsProviderReady ? "Keep no-vig probability, EV, and edge rankings fresh before decisions." : "Connect bookmaker odds provider proof before treating value rankings as live.",
      requiredBeforeLive: oddsProviderReady ? [] : ["THE_ODDS_API_KEY or ODDS_API_KEY must be valid.", "Odds data-intake item must be provider-backed and ready."],
      permissions: { canUseNow: oddsBoard.totals.selections > 0, canAutoRun: false, canWrite: false, canPublish: false, canTrain: false }
    }),
    capability({
      id: "proof-autopilot",
      category: "automation",
      label: "Proof autopilot",
      status: proofReady ? "proof-ready" : "locked",
      level: proofReady ? "proof" : "blocked",
      detail: transition.summary,
      evidence: [transition.transitionHash, `runtime:${runtime.status}`, `next:${transition.nextTransition.label}`],
      verifyUrl: "/api/sports/decision/evidence-transition",
      nextAction: transition.nextTransition.expectedEvidence,
      requiredBeforeLive: unique([
        transition.status === "advance-ready" ? null : "Evidence transition must clear retry/blocked receipts before live automation.",
        runtime.status === "live-ready" ? null : "Runtime must become live-ready before unsupervised operation."
      ]),
      permissions: { canUseNow: proofReady, canAutoRun: transition.policy.canRunNextProof, canWrite: false, canPublish: false, canTrain: false }
    }),
    capability({
      id: "guarded-ai-review",
      category: "ai",
      label: "Guarded AI review",
      status: aiReviewReady ? "active" : readiness.openAi.configured || runtime.permissions.canAskOpenAI ? "proof-ready" : "locked",
      level: aiReviewReady ? "live" : readiness.openAi.configured || runtime.permissions.canAskOpenAI ? "proof" : "blocked",
      detail: readiness.openAi.detail,
      evidence: [`openai:${readiness.openAi.status}`, `runtimeAsk:${runtime.permissions.canAskOpenAI}`, `authorityApply:${authority.control.canApplyAI}`],
      verifyUrl: "/api/sports/decision/ai-orchestrator",
      nextAction: aiReviewReady ? "Run guarded AI review only through citation validation, firewall, and authority." : "Configure OpenAI and clear citation/firewall/authority proof before using model text.",
      requiredBeforeLive: aiReviewReady ? [] : ["OPENAI_API_KEY and OPENAI_DECISION_MODEL must be configured.", "Citation validator, firewall, and authority must allow same-or-safer AI output."],
      permissions: { canUseNow: aiReviewReady, canAutoRun: false, canWrite: false, canPublish: false, canTrain: false }
    }),
    capability({
      id: "supabase-memory",
      category: "memory",
      label: "Supabase decision memory",
      status: memoryReady ? "proof-ready" : "locked",
      level: memoryReady ? "proof" : "blocked",
      detail: supabaseBootstrap.summary,
      evidence: [`bootstrap:${supabaseBootstrap.status}`, `credential:${supabaseBootstrap.schema.credentialStatus}`, `tables:${supabaseBootstrap.schema.verifiedTableCount}/${supabaseBootstrap.schema.expectedTableCount}`],
      verifyUrl: "/api/sports/decision/supabase-bootstrap",
      nextAction: supabaseBootstrap.nextCommand?.expectedEvidence ?? "Fix Supabase credentials, MCP proof, and schema verification.",
      requiredBeforeLive: unique([
        memoryReady ? null : "Valid OddsPadi SUPABASE_SERVICE_ROLE_KEY is required.",
        supabaseBootstrap.mcp.scopedProofPasses ? null : "Project-scoped Supabase MCP proof is required.",
        readiness.supabase.schema.status === "ready" ? null : "All expected op_ tables must verify."
      ]),
      permissions: { canUseNow: memoryReady, canAutoRun: false, canWrite: false, canPublish: false, canTrain: false }
    }),
    capability({
      id: "model-learning",
      category: "learning",
      label: "Model learning loop",
      status: trainingReady ? "proof-ready" : "locked",
      level: trainingReady ? "proof" : "blocked",
      detail: modelTrust.summary,
      evidence: [modelTrust.trustHash, `trust:${modelTrust.trustScore}`, `training:${readiness.trainingData.status}`],
      verifyUrl: "/api/sports/decision/model-trust",
      nextAction: modelTrust.nextActions[0] ?? "Collect settled outcomes, real historical corpus, odds snapshots, and calibration proof.",
      requiredBeforeLive: trainingReady ? [] : ["Historical corpus, backtests, calibration, runtime storage, and model-trust gates must pass."],
      permissions: { canUseNow: trainingReady, canAutoRun: false, canWrite: false, canPublish: false, canTrain: false }
    }),
    capability({
      id: "public-publishing",
      category: "publishing",
      label: "Public publishing",
      status: activationAudit.capabilities.publishableSlate && authority.control.canDisplayCandidate ? "proof-ready" : "locked",
      level: activationAudit.capabilities.publishableSlate && authority.control.canDisplayCandidate ? "proof" : "blocked",
      detail: authority.summary,
      evidence: [authority.authorityHash, `posture:${authority.activeDecision.publicPosture}`, `activation:${activationAudit.status}`],
      verifyUrl: "/api/sports/decision/authority",
      nextAction: activationAudit.nextGate?.nextAction ?? authority.control.forbiddenActions[0] ?? "Keep public publishing disabled until activation proof clears.",
      requiredBeforeLive: ["Authority must be authorized with public-candidate posture.", "Activation audit must be ready.", "Netlify and responsible-controls proof must pass."],
      permissions: { canUseNow: false, canAutoRun: false, canWrite: false, canPublish: false, canTrain: false }
    })
  ];
}

export function buildDecisionCapabilityContract({
  date,
  sport,
  readiness,
  dataIntake,
  signalReliability,
  modelTrust,
  oddsBoard,
  transition,
  authority,
  runtime,
  activationAudit,
  supabaseBootstrap,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  readiness: DecisionEngineReadiness;
  dataIntake: DecisionDataIntakeQueue;
  signalReliability: DecisionSignalReliability;
  modelTrust: DecisionModelTrust;
  oddsBoard: DecisionOddsBoard;
  transition: DecisionEvidenceTransition;
  authority: DecisionAuthority;
  runtime: DecisionAgentRuntime;
  activationAudit: DecisionActivationAudit;
  supabaseBootstrap: DecisionSupabaseBootstrap;
  now?: Date;
}): DecisionCapabilityContract {
  const capabilities = buildCapabilities({
    readiness,
    dataIntake,
    signalReliability,
    modelTrust,
    oddsBoard,
    transition,
    authority,
    runtime,
    activationAudit,
    supabaseBootstrap
  });
  const counts = statusCounts(capabilities);
  const status = contractStatus({ runtime, capabilities });
  const nextCapability = chooseNextCapability(capabilities);
  const nextSafeCommand = chooseNextSafeCommand({ transition, runtime, supabaseBootstrap, nextCapability });
  const liveScore = liveReadinessScore(capabilities);
  const blockers = unique(
    capabilities
      .filter((item) => item.status === "locked")
      .flatMap((item) => item.requiredBeforeLive.length ? item.requiredBeforeLive.map((requirement) => `${item.label}: ${requirement}`) : [`${item.label}: ${item.nextAction}`]),
    10
  );
  const contractHash = stableHash({
    date,
    sport,
    status,
    liveScore,
    capabilities: capabilities.map((item) => [item.id, item.status, item.level]),
    runtime: runtime.runtimeHash,
    transition: transition.transitionHash,
    authority: authority.authorityHash,
    bootstrap: supabaseBootstrap.bootstrapHash
  });

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    contractHash,
    summary:
      status === "live-ready"
        ? "Capability contract is live-ready, with explicit write/publish/train gates still controlled separately."
        : status === "review-ready"
          ? "Capability contract can request guarded AI review, but persistence, publishing, and training remain locked."
          : status === "proof-mode"
            ? `Capability contract is in proof mode: ${counts.active} active, ${counts.shadow} shadow, ${counts["proof-ready"]} proof-ready, ${counts.locked} locked.`
            : "Capability contract is blocked; no live AI capability can advance until setup proof improves.",
    liveReadinessScore: liveScore,
    capabilities,
    nextCapability,
    counts,
    nextSafeCommand,
    runtimeContract: {
      canRunReadOnly: runtime.permissions.canRunReadOnly,
      canRunDryRun: runtime.permissions.canRunDryRun,
      canAskOpenAI: runtime.permissions.canAskOpenAI,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      mode: runtime.mode,
      evidenceTransition: transition.status,
      authority: authority.status,
      supabaseBootstrap: supabaseBootstrap.status
    },
    blockers,
    forbiddenActions: unique([
      "Do not present shadow or proof-ready capabilities as live-ready capabilities.",
      "Do not persist decisions until Supabase memory is proof-ready and write approval is explicit.",
      "Do not publish picks while public publishing is locked.",
      "Do not train or tune learned guardrails until model learning is proof-ready and outcome settlement passes.",
      "Do not use OpenAI review unless the guarded AI review capability is active.",
      ...runtime.guardrails,
      ...supabaseBootstrap.safety.forbiddenActions
    ])
  };
}
