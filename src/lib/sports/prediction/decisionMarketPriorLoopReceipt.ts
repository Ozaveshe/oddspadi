import type { DecisionMarketPriorResolutionTurn } from "@/lib/sports/prediction/decisionMarketPriorResolutionTurn";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

export type DecisionMarketPriorLoopReceiptStatus =
  | "observed-market-prior"
  | "observed-provider-plan"
  | "ready-next-proof"
  | "proof-failed"
  | "blocked";

export type DecisionMarketPriorLoopReceipt = {
  mode: "market-prior-loop-receipt";
  generatedAt: string;
  date: string;
  sport: DecisionMarketPriorResolutionTurn["sport"];
  status: DecisionMarketPriorLoopReceiptStatus;
  loopHash: string;
  summary: string;
  loop: {
    iteration: 1;
    sourceTurnHash: string;
    selectedProof: DecisionMarketPriorResolutionTurn["selectedProof"]["stepId"];
    observedProofHash: string | null;
    beliefUpdate: "market-prior-stays-dominant" | "provider-plan-can-continue" | "no-observation-yet" | "blocked";
    confidenceEffect: "cap-trust" | "shadow-only-watch" | "none";
    publicActionEffect: "none";
    continuation: "rebuild-resolver" | "observe-proof" | "repair-proof" | "hold";
  };
  evidenceTrace: Array<{
    id: "turn-observation" | "market-prior-belief" | "change-condition" | "safety-boundary";
    label: string;
    status: "pass" | "watch" | "block";
    evidence: string;
    nextAction: string;
  }>;
  reasoning: {
    learned: string;
    belief: string;
    doubt: string;
    changeMindCondition: string;
    nextSafeStep: string;
  };
  controls: {
    canInspectReadOnly: true;
    canContinueReadOnlyLoop: boolean;
    canRunNextProof: boolean;
    canCallOpenAI: false;
    canFetchProviders: false;
    canWriteSupabaseRows: false;
    canPersistBacktestMemory: false;
    canPersistTrainingRows: false;
    canPersistLoopMemory: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
  };
  nextAction: {
    label: string;
    command: string | null;
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

function compact(value: string | null | undefined, maxLength = 320): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No evidence available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 64): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function safeApiUrl(value: string): boolean {
  if (!value.toLowerCase().startsWith("/api/sports/decision/")) return false;
  let url: URL;
  try {
    url = new URL(value, "http://127.0.0.1:3025");
  } catch {
    return false;
  }
  const blockedParams = ["persist", "publish", "train", "stake", "openAiRun"];
  for (const param of blockedParams) {
    const normalized = url.searchParams.get(param)?.toLowerCase();
    if (normalized === "1" || normalized === "true") return false;
  }
  const dryRun = url.searchParams.get("dryRun")?.toLowerCase();
  return dryRun !== "0" && dryRun !== "false";
}

function statusFor(turn: DecisionMarketPriorResolutionTurn): DecisionMarketPriorLoopReceiptStatus {
  if (turn.status === "blocked") return "blocked";
  if (turn.status === "proof-failed") return "proof-failed";
  if (turn.status === "preview-ready") return "ready-next-proof";
  if (turn.observation.proofStatus === "model-prior-eligible") return "observed-provider-plan";
  return "observed-market-prior";
}

function beliefUpdateFor(status: DecisionMarketPriorLoopReceiptStatus): DecisionMarketPriorLoopReceipt["loop"]["beliefUpdate"] {
  if (status === "observed-market-prior") return "market-prior-stays-dominant";
  if (status === "observed-provider-plan") return "provider-plan-can-continue";
  if (status === "ready-next-proof") return "no-observation-yet";
  return "blocked";
}

function nextActionFor(status: DecisionMarketPriorLoopReceiptStatus, turn: DecisionMarketPriorResolutionTurn): DecisionMarketPriorLoopReceipt["nextAction"] {
  if (status === "ready-next-proof") {
    const verifyUrl = `/api/sports/decision/market-prior-resolution-turn?date=${turn.date}&sport=${turn.sport}&limit=8&dryRun=1&run=1`;
    const safeToRun = turn.controls.canRunSelectedProof && safeApiUrl(verifyUrl);
    return {
      label: "Observe selected market-prior proof",
      command: safeToRun ? decisionCurlCommand(verifyUrl) : null,
      verifyUrl,
      safeToRun,
      expectedEvidence: turn.selectedProof.expectedEvidence
    };
  }

  if (status === "observed-market-prior" || status === "observed-provider-plan") {
    const verifyUrl = `/api/sports/decision/market-prior-blocker-resolver?date=${turn.date}&sport=${turn.sport}&limit=8&dryRun=1`;
    const safeToRun = safeApiUrl(verifyUrl);
    return {
      label: "Rebuild market-prior resolver",
      command: safeToRun ? decisionCurlCommand(verifyUrl) : null,
      verifyUrl,
      safeToRun,
      expectedEvidence: "Fresh resolver state incorporates the observed proof and ranks the next safe evidence step."
    };
  }

  return {
    label: "Repair market-prior proof turn",
    command: null,
    verifyUrl: `/api/sports/decision/market-prior-resolution-turn?date=${turn.date}&sport=${turn.sport}&limit=8&dryRun=1`,
    safeToRun: false,
    expectedEvidence: turn.observation.error ?? "Resolution turn must expose a safe read-only proof before the loop can continue."
  };
}

function traceFor(status: DecisionMarketPriorLoopReceiptStatus, turn: DecisionMarketPriorResolutionTurn): DecisionMarketPriorLoopReceipt["evidenceTrace"] {
  return [
    {
      id: "turn-observation",
      label: "Observe selected proof",
      status: turn.observation.success ? "pass" : turn.status === "proof-failed" || turn.status === "blocked" ? "block" : "watch",
      evidence: compact(turn.observation.proofSummary ?? turn.summary),
      nextAction: turn.observation.success ? "Integrate observed proof through resolver rebuild." : turn.nextAction.expectedEvidence
    },
    {
      id: "market-prior-belief",
      label: "Update market-prior belief",
      status: status === "observed-provider-plan" ? "watch" : status === "observed-market-prior" ? "pass" : "watch",
      evidence: compact(turn.reasoning.publicBelief),
      nextAction:
        status === "observed-provider-plan"
          ? "Continue provider-plan review without public-action upgrade."
          : "Keep no-vig market consensus as the trust cap."
    },
    {
      id: "change-condition",
      label: "Preserve change-my-mind condition",
      status: "watch",
      evidence: compact(turn.reasoning.changeMindCondition),
      nextAction: "Require stable benchmark, provider retest, closing-line value, and governance before trust can rise."
    },
    {
      id: "safety-boundary",
      label: "Hold safety boundary",
      status: "pass",
      evidence: "This loop receipt cannot write, train, adjust probabilities, publish picks, stake, or expose hidden chain-of-thought.",
      nextAction: "Continue with read-only resolver evidence only."
    }
  ];
}

export function buildDecisionMarketPriorLoopReceipt({
  turn,
  now = new Date()
}: {
  turn: DecisionMarketPriorResolutionTurn;
  now?: Date;
}): DecisionMarketPriorLoopReceipt {
  const status = statusFor(turn);
  const nextAction = nextActionFor(status, turn);
  const evidenceTrace = traceFor(status, turn);
  const beliefUpdate = beliefUpdateFor(status);
  const canContinue = nextAction.safeToRun && status !== "blocked" && status !== "proof-failed";
  const confidenceEffect: DecisionMarketPriorLoopReceipt["loop"]["confidenceEffect"] =
    status === "observed-provider-plan" ? "shadow-only-watch" : status === "observed-market-prior" ? "cap-trust" : "none";

  return {
    mode: "market-prior-loop-receipt",
    generatedAt: now.toISOString(),
    date: turn.date,
    sport: turn.sport,
    status,
    loopHash: stableHash({
      status,
      turn: [turn.turnHash, turn.status, turn.selectedProof.stepId, turn.observation.proofHash],
      beliefUpdate,
      trace: evidenceTrace.map((item) => [item.id, item.status]),
      nextAction: [nextAction.verifyUrl, nextAction.safeToRun]
    }),
    summary:
      status === "observed-market-prior"
        ? "Market-prior loop observed the selected proof and kept the model trust capped by no-vig market consensus."
        : status === "observed-provider-plan"
          ? "Market-prior loop observed evidence that can continue provider-plan review, but only in shadow."
          : status === "ready-next-proof"
            ? "Market-prior loop is ready to observe one read-only proof."
            : status === "proof-failed"
              ? "Market-prior loop could not observe the selected proof successfully."
              : "Market-prior loop is blocked because no safe proof turn is available.",
    loop: {
      iteration: 1,
      sourceTurnHash: turn.turnHash,
      selectedProof: turn.selectedProof.stepId,
      observedProofHash: turn.observation.proofHash,
      beliefUpdate,
      confidenceEffect,
      publicActionEffect: "none",
      continuation:
        status === "ready-next-proof"
          ? "observe-proof"
          : status === "observed-market-prior" || status === "observed-provider-plan"
            ? "rebuild-resolver"
            : status === "proof-failed"
              ? "repair-proof"
              : "hold"
    },
    evidenceTrace,
    reasoning: {
      learned:
        status === "observed-market-prior"
          ? compact(`Observed ${turn.observation.proofMode ?? "proof"} with status ${turn.observation.proofStatus ?? "unknown"}; market prior remains the cap.`)
          : status === "observed-provider-plan"
            ? compact(`Observed ${turn.observation.proofMode ?? "proof"} with status ${turn.observation.proofStatus}; provider review can continue as shadow-only.`)
            : compact(turn.summary),
      belief: compact(turn.reasoning.publicBelief),
      doubt: compact(turn.reasoning.currentDoubt),
      changeMindCondition: compact(turn.reasoning.changeMindCondition),
      nextSafeStep: compact(nextAction.expectedEvidence)
    },
    controls: {
      canInspectReadOnly: true,
      canContinueReadOnlyLoop: canContinue,
      canRunNextProof: status === "ready-next-proof" && nextAction.safeToRun,
      canCallOpenAI: false,
      canFetchProviders: false,
      canWriteSupabaseRows: false,
      canPersistBacktestMemory: false,
      canPersistTrainingRows: false,
      canPersistLoopMemory: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    nextAction,
    proofUrls: unique([
      "/api/sports/decision/market-prior-loop-receipt",
      "/api/sports/decision/market-prior-resolution-turn",
      ...turn.proofUrls
    ]),
    locks: unique([
      "Market-prior loop receipt interprets one read-only turn only; it cannot persist loop memory.",
      "Observed proof can cap, hold, or continue shadow review, but cannot raise confidence or change public action.",
      "No OpenAI call, provider fetch, Supabase write, persistence, training, learned-weight update, probability adjustment, public pick, stake, or hidden chain-of-thought exposure is allowed.",
      ...turn.locks
    ])
  };
}
