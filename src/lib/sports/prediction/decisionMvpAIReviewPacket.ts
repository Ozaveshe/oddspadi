import type { DecisionAIReviewReadiness } from "@/lib/sports/prediction/decisionAIReviewReadiness";
import type { DecisionMvpCognitiveCycle } from "@/lib/sports/prediction/decisionMvpCognitiveCycle";
import type { DecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";
import type { Sport } from "@/lib/sports/types";

export type DecisionMvpAIReviewPacketStatus = "ready-preview" | "needs-openai" | "waiting-cycle-proof" | "ready-to-submit" | "blocked";

export type DecisionMvpAIReviewPacketEvidenceStatus = "support" | "watch" | "block";

export type DecisionMvpAIReviewPacket = {
  mode: "decision-mvp-ai-review-packet";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMvpAIReviewPacketStatus;
  packetHash: string;
  summary: string;
  target: {
    match: string | null;
    selection: string | null;
    publicPosture: "locked" | "monitor-only" | "shadow-review";
    trustCeiling: "locked" | "monitor-only" | "shadow-review";
    activeStage: string | null;
  };
  requestPreview: {
    model: string;
    store: false;
    route: string;
    schemaName: "OddsPadiMvpAIReview";
    instructions: string[];
    responseContract: {
      format: "strict-json";
      allowedVerdicts: Array<"agree" | "downgrade" | "needs-evidence" | "block">;
      allowedActions: Array<"hold" | "monitor" | "avoid">;
      forbidden: string[];
    };
    input: {
      cycleHash: string;
      cycleStatus: DecisionMvpCognitiveCycle["status"];
      nextQuestion: string;
      nextTurn: DecisionMvpCognitiveCycle["nextTurn"];
      stages: Array<{
        id: string;
        status: string;
        signal: string;
        decision: string;
        nextAction: string;
        proofUrl: string;
      }>;
      requiredBeforeUpgrade: string[];
    };
  };
  evidence: {
    ids: string[];
    items: Array<{
      id: "cognitive-cycle" | "openai-key" | "review-readiness" | "next-turn" | "safety-locks";
      label: string;
      status: DecisionMvpAIReviewPacketEvidenceStatus;
      detail: string;
      proofUrl: string;
    }>;
    support: number;
    watch: number;
    block: number;
  };
  controls: {
    canInspectReadOnly: true;
    canSubmitToOpenAI: boolean;
    requiresExplicitRunParam: true;
    canApplyAIOutput: false;
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
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
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
  if (!normalized) return "No evidence available.";
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

function evidenceStatus(value: string): DecisionMvpAIReviewPacketEvidenceStatus {
  if (value.includes("ready") || value.includes("pass") || value.includes("configured")) return "support";
  if (value.includes("blocked") || value.includes("missing") || value.includes("locked") || value.includes("needs")) return "block";
  return "watch";
}

function statusFor({
  cognitiveCycle,
  aiReviewReadiness,
  openAiKeyDiagnostic
}: {
  cognitiveCycle: DecisionMvpCognitiveCycle;
  aiReviewReadiness: DecisionAIReviewReadiness;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
}): DecisionMvpAIReviewPacketStatus {
  if (cognitiveCycle.status === "blocked" || aiReviewReadiness.status === "blocked" || openAiKeyDiagnostic.status === "blocked") return "blocked";
  if (openAiKeyDiagnostic.status === "missing-key" || openAiKeyDiagnostic.status === "suspicious-key") return "needs-openai";
  if (cognitiveCycle.status !== "ready-readonly-cycle" && cognitiveCycle.status !== "ready-shadow-cycle") return "waiting-cycle-proof";
  if (openAiKeyDiagnostic.status === "ready-to-request" && aiReviewReadiness.controls.canRunLiveReview) return "ready-to-submit";
  return "ready-preview";
}

function summaryFor(status: DecisionMvpAIReviewPacketStatus): string {
  if (status === "ready-to-submit") return "MVP AI review packet is ready for an explicit guarded OpenAI review request.";
  if (status === "needs-openai") return "MVP AI review packet is preview-only until the server runtime has a valid OPENAI_API_KEY.";
  if (status === "waiting-cycle-proof") return "MVP AI review packet is preview-only until the cognitive cycle has a safe proof turn.";
  if (status === "blocked") return "MVP AI review packet is blocked by cycle, OpenAI, or review-contract evidence.";
  return "MVP AI review packet is available as a read-only contract with no side effects.";
}

export function buildDecisionMvpAIReviewPacket({
  date,
  sport,
  cognitiveCycle,
  aiReviewReadiness,
  openAiKeyDiagnostic,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  cognitiveCycle: DecisionMvpCognitiveCycle;
  aiReviewReadiness: DecisionAIReviewReadiness;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
  now?: Date;
}): DecisionMvpAIReviewPacket {
  const status = statusFor({ cognitiveCycle, aiReviewReadiness, openAiKeyDiagnostic });
  const canSubmit = status === "ready-to-submit";
  const requiredBeforeUpgrade = unique([
    ...cognitiveCycle.locks.slice(0, 8),
    ...aiReviewReadiness.missingEnv.map((item) => `Configure ${item}.`),
    openAiKeyDiagnostic.status === "ready-to-request" ? null : openAiKeyDiagnostic.summary
  ]);
  const evidence: DecisionMvpAIReviewPacket["evidence"]["items"] = [
    {
      id: "cognitive-cycle",
      label: "Cognitive cycle",
      status: evidenceStatus(cognitiveCycle.status),
      detail: cognitiveCycle.summary,
      proofUrl: "/api/sports/decision/mvp-cognitive-cycle"
    },
    {
      id: "openai-key",
      label: "OpenAI key diagnostic",
      status: evidenceStatus(openAiKeyDiagnostic.status),
      detail: openAiKeyDiagnostic.summary,
      proofUrl: "/api/sports/decision/openai-key-diagnostic"
    },
    {
      id: "review-readiness",
      label: "AI review readiness",
      status: evidenceStatus(aiReviewReadiness.status),
      detail: aiReviewReadiness.summary,
      proofUrl: "/api/sports/decision/ai-review-readiness"
    },
    {
      id: "next-turn",
      label: "Next safe turn",
      status: cognitiveCycle.nextTurn.safeToRun ? "support" : "block",
      detail: cognitiveCycle.nextTurn.expectedEvidence,
      proofUrl: cognitiveCycle.nextTurn.proofUrl
    },
    {
      id: "safety-locks",
      label: "Safety locks",
      status: "support",
      detail: "AI output cannot publish, persist, train, stake, adjust probabilities, raise confidence, or reveal hidden chain-of-thought.",
      proofUrl: "/api/sports/decision/mvp-ai-review-packet"
    }
  ];
  const route = "/api/sports/decision/mvp-ai-review-packet";
  const query = `date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}&limit=8`;

  return {
    mode: "decision-mvp-ai-review-packet",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    packetHash: stableHash({
      date,
      sport,
      status,
      cycle: [cognitiveCycle.cycleHash, cognitiveCycle.status, cognitiveCycle.activeStage?.id],
      ai: [aiReviewReadiness.readinessHash, aiReviewReadiness.status, aiReviewReadiness.model],
      key: [openAiKeyDiagnostic.diagnosticHash, openAiKeyDiagnostic.status, openAiKeyDiagnostic.runtime.keyShape],
      evidence: evidence.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status),
    target: {
      match: cognitiveCycle.focus.match,
      selection: cognitiveCycle.focus.selection,
      publicPosture: cognitiveCycle.focus.publicPosture,
      trustCeiling: cognitiveCycle.focus.trustCeiling,
      activeStage: cognitiveCycle.activeStage?.id ?? null
    },
    requestPreview: {
      model: aiReviewReadiness.model,
      store: false,
      route,
      schemaName: "OddsPadiMvpAIReview",
      instructions: [
        "Critique the public-safe MVP cognitive cycle only.",
        "Return strict JSON with verdict, action, risks, missingEvidence, and saferAlternative.",
        "Do not invent fixtures, injuries, lineups, odds, scores, news, weather, xG, or provider facts.",
        "Do not reveal hidden chain-of-thought; use concise public reasoning only.",
        "Do not upgrade public action, confidence, probabilities, staking, persistence, training, or provider writes."
      ],
      responseContract: {
        format: "strict-json",
        allowedVerdicts: ["agree", "downgrade", "needs-evidence", "block"],
        allowedActions: ["hold", "monitor", "avoid"],
        forbidden: [
          "publish-pick",
          "stake",
          "raise-confidence",
          "adjust-probability",
          "persist-decision",
          "write-provider-rows",
          "train-model",
          "invent-provider-facts",
          "hidden-chain-of-thought"
        ]
      },
      input: {
        cycleHash: cognitiveCycle.cycleHash,
        cycleStatus: cognitiveCycle.status,
        nextQuestion: cognitiveCycle.focus.nextQuestion,
        nextTurn: cognitiveCycle.nextTurn,
        stages: cognitiveCycle.stages.map((stage) => ({
          id: stage.id,
          status: stage.status,
          signal: compact(stage.signal, 180),
          decision: compact(stage.decision, 180),
          nextAction: compact(stage.nextAction, 180),
          proofUrl: stage.proofUrl
        })),
        requiredBeforeUpgrade
      }
    },
    evidence: {
      ids: evidence.map((item) => item.id),
      items: evidence,
      support: evidence.filter((item) => item.status === "support").length,
      watch: evidence.filter((item) => item.status === "watch").length,
      block: evidence.filter((item) => item.status === "block").length
    },
    controls: {
      canInspectReadOnly: true,
      canSubmitToOpenAI: canSubmit,
      requiresExplicitRunParam: true,
      canApplyAIOutput: false,
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
    nextAction: {
      label: canSubmit ? "Request guarded OpenAI critique" : status === "needs-openai" ? "Configure OpenAI key first" : "Inspect MVP AI review packet",
      command: `curl.exe "http://127.0.0.1:3025${route}?${query}${canSubmit ? "&run=1" : ""}"`,
      verifyUrl: route,
      safeToRun: canSubmit,
      expectedEvidence: canSubmit
        ? "Guarded review returns strict JSON critique; AI output remains advisory and cannot change public action."
        : "Packet returns store=false preview, evidence IDs, strict forbidden actions, and locked side-effect controls."
    },
    proofUrls: unique([
      route,
      "/api/sports/decision/mvp-cognitive-cycle",
      "/api/sports/decision/openai-key-diagnostic",
      "/api/sports/decision/ai-review-readiness",
      ...cognitiveCycle.proofUrls,
      ...aiReviewReadiness.proofUrls,
      ...openAiKeyDiagnostic.proofUrls
    ]),
    locks: unique([
      "MVP AI review packet is read-only unless a separate guarded live-review route is explicitly requested with run=1.",
      "The packet uses store=false and cannot apply AI output, persist decisions, write provider rows, train, publish, stake, adjust probabilities, raise confidence, or reveal hidden chain-of-thought.",
      "AI critique is advisory and cannot override provider, Supabase, OpenAI readiness, backtest, or answer-authority gates.",
      ...cognitiveCycle.locks,
      ...aiReviewReadiness.locks,
      ...openAiKeyDiagnostic.locks
    ])
  };
}
