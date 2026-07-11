import { fetchDecisionApiData, type DecisionInternalFetchOptions } from "@/lib/sports/prediction/decisionInternalFetch";
import type { DecisionMarketPriorBlockerResolver, DecisionMarketPriorBlockerResolverStep } from "@/lib/sports/prediction/decisionMarketPriorBlockerResolver";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

export type DecisionMarketPriorResolutionTurnStatus = "preview-ready" | "observed" | "blocked" | "proof-failed";
export type DecisionMarketPriorResolutionTurnPhaseId = "observe" | "hypothesize" | "test" | "integrate" | "decide";
export type DecisionMarketPriorResolutionTurnPhaseStatus = "pass" | "watch" | "block";

export type DecisionMarketPriorResolutionTurnPhase = {
  id: DecisionMarketPriorResolutionTurnPhaseId;
  label: string;
  status: DecisionMarketPriorResolutionTurnPhaseStatus;
  note: string;
};

export type DecisionMarketPriorResolutionTurn = {
  mode: "market-prior-resolution-turn";
  generatedAt: string;
  date: string;
  sport: DecisionMarketPriorBlockerResolver["sport"];
  status: DecisionMarketPriorResolutionTurnStatus;
  turnHash: string;
  summary: string;
  resolver: {
    resolverHash: string;
    status: DecisionMarketPriorBlockerResolver["status"];
    benchmarkVerdict: DecisionMarketPriorBlockerResolver["marketPrior"]["benchmarkVerdict"];
    promotionStatus: DecisionMarketPriorBlockerResolver["promotion"]["promotionStatus"];
    blockingGateCount: number;
  };
  selectedProof: {
    stepId: DecisionMarketPriorBlockerResolverStep["id"] | "none";
    label: string;
    verifyUrl: string | null;
    command: string | null;
    safeToRun: boolean;
    expectedEvidence: string;
    selectionReason: string;
  };
  observation: {
    requested: boolean;
    attempted: boolean;
    success: boolean;
    url: string | null;
    proofHash: string | null;
    proofMode: string | null;
    proofStatus: string | null;
    proofSummary: string | null;
    error: string | null;
  };
  phases: DecisionMarketPriorResolutionTurnPhase[];
  reasoning: {
    publicBelief: string;
    currentDoubt: string;
    proofHypothesis: string;
    changeMindCondition: string;
    integrationRule: string;
    safestDecision: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunSelectedProof: boolean;
    requiresExplicitRunParam: true;
    canCallOpenAI: false;
    canFetchProviders: false;
    canWriteSupabaseRows: false;
    canPersistBacktestMemory: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
  };
  nextAction: {
    label: string;
    command: string | null;
    verifyUrl: string;
    expectedEvidence: string;
  };
  proofUrls: string[];
  locks: string[];
};

type FetchLike = NonNullable<DecisionInternalFetchOptions["fetchImpl"]>;

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

function proofUrlWithContext(verifyUrl: string, resolver: DecisionMarketPriorBlockerResolver): string {
  const url = new URL(verifyUrl, "http://127.0.0.1:3025");
  if (!url.searchParams.has("date")) url.searchParams.set("date", resolver.date);
  if (!url.searchParams.has("sport")) url.searchParams.set("sport", resolver.sport);
  return `${url.pathname}${url.search}`;
}

function absoluteProofUrl(origin: string, verifyUrl: string): string {
  return new URL(verifyUrl, origin).toString();
}

function proofString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return typeof record[key] === "string" ? compact(record[key]) : null;
}

function selectStep(resolver: DecisionMarketPriorBlockerResolver): DecisionMarketPriorBlockerResolverStep | null {
  const nextUrl = resolver.nextAction.verifyUrl;
  return (
    resolver.rankedPlan.find((step) => step.verifyUrl === nextUrl && step.status === "ready") ??
    resolver.rankedPlan.find((step) => step.status === "ready") ??
    resolver.rankedPlan.find((step) => step.status === "waiting") ??
    null
  );
}

function phasesFor({
  resolver,
  step,
  status,
  observed
}: {
  resolver: DecisionMarketPriorBlockerResolver;
  step: DecisionMarketPriorBlockerResolverStep | null;
  status: DecisionMarketPriorResolutionTurnStatus;
  observed: boolean;
}): DecisionMarketPriorResolutionTurnPhase[] {
  return [
    {
      id: "observe",
      label: "Observe blocker state",
      status: resolver.status === "market-prior-dominant" ? "pass" : resolver.status === "blocked" ? "block" : "watch",
      note: compact(resolver.summary)
    },
    {
      id: "hypothesize",
      label: "Frame change condition",
      status: step ? "pass" : "block",
      note: compact(step?.requiredProof ?? resolver.reasoning.counterfactualToChangeMind)
    },
    {
      id: "test",
      label: "Run one read-only proof",
      status: status === "observed" ? "pass" : status === "proof-failed" ? "block" : step ? "watch" : "block",
      note: observed ? "A read-only proof was observed and hashed." : compact(step?.verifyUrl ?? "No safe proof is available.")
    },
    {
      id: "integrate",
      label: "Integrate without side effects",
      status: observed ? "pass" : "watch",
      note: "Observed evidence may update the next diagnostic turn only; it cannot train, write, publish, stake, or adjust probabilities."
    },
    {
      id: "decide",
      label: "Choose safest decision",
      status: "pass",
      note: "Keep public action locked while market-prior evidence dominates."
    }
  ];
}

export async function buildDecisionMarketPriorResolutionTurn({
  resolver,
  runRequested = false,
  origin = "http://127.0.0.1:3025",
  fetchImpl,
  now = new Date()
}: {
  resolver: DecisionMarketPriorBlockerResolver;
  runRequested?: boolean;
  origin?: string;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<DecisionMarketPriorResolutionTurn> {
  const step = selectStep(resolver);
  const verifyUrl = step ? proofUrlWithContext(step.verifyUrl, resolver) : null;
  const safeToRun = Boolean(step && verifyUrl && step.status === "ready" && safeApiUrl(verifyUrl));
  const proofUrl = verifyUrl && safeToRun ? absoluteProofUrl(origin, verifyUrl) : null;
  let proof: unknown = null;
  let attempted = false;
  let error: string | null = null;

  if (runRequested && proofUrl) {
    attempted = true;
    proof = await fetchDecisionApiData<unknown>(proofUrl, {
      fetchImpl,
      timeoutMs: 240000,
      maxAttempts: 1
    });
    if (!proof) error = "Read-only proof route did not return a successful OddsPadi API envelope.";
  }

  const status: DecisionMarketPriorResolutionTurnStatus = !step || !safeToRun ? "blocked" : runRequested ? (proof ? "observed" : "proof-failed") : "preview-ready";
  const proofHash = proof ? stableHash(proof) : null;
  const proofMode = proofString(proof, "mode");
  const proofStatus = proofString(proof, "status");
  const proofSummary = proofString(proof, "summary") ?? proofStatus ?? proofMode;
  const phases = phasesFor({ resolver, step, status, observed: Boolean(proof) });
  const selectedVerifyUrl = verifyUrl ?? "/api/sports/decision/market-prior-blocker-resolver?dryRun=1";

  return {
    mode: "market-prior-resolution-turn",
    generatedAt: now.toISOString(),
    date: resolver.date,
    sport: resolver.sport,
    status,
    turnHash: stableHash({
      status,
      resolver: [resolver.resolverHash, resolver.status, resolver.marketPrior.benchmarkVerdict],
      step: step ? [step.id, step.status, step.priority, selectedVerifyUrl] : null,
      proofHash,
      runRequested,
      phases: phases.map((phase) => [phase.id, phase.status])
    }),
    summary:
      status === "observed"
        ? `Observed ${step?.label ?? "selected proof"} and kept market-prior governance read-only.`
        : status === "preview-ready"
          ? `Ready to observe ${step?.label ?? "selected proof"} as the next market-prior proof.`
          : status === "proof-failed"
            ? `Tried to observe ${step?.label ?? "selected proof"}, but the proof route did not return a valid success envelope.`
            : "No safe market-prior proof can run in this turn.",
    resolver: {
      resolverHash: resolver.resolverHash,
      status: resolver.status,
      benchmarkVerdict: resolver.marketPrior.benchmarkVerdict,
      promotionStatus: resolver.promotion.promotionStatus,
      blockingGateCount: resolver.promotion.blockingGateCount
    },
    selectedProof: {
      stepId: step?.id ?? "none",
      label: step?.label ?? "No safe proof",
      verifyUrl,
      command: safeToRun && verifyUrl ? decisionCurlCommand(verifyUrl) : null,
      safeToRun,
      expectedEvidence: compact(step?.requiredProof ?? resolver.nextAction.expectedEvidence),
      selectionReason: compact(step ? `${step.label} is ${step.status} with priority ${step.priority}. ${step.unlocks}` : "No ranked resolver step is runnable.")
    },
    observation: {
      requested: runRequested,
      attempted,
      success: Boolean(proof),
      url: proofUrl,
      proofHash,
      proofMode,
      proofStatus,
      proofSummary,
      error
    },
    phases,
    reasoning: {
      publicBelief: compact(resolver.reasoning.whyMarketDominates),
      currentDoubt: compact(resolver.reasoning.weakestModelProof),
      proofHypothesis: compact(step?.requiredProof ?? resolver.reasoning.counterfactualToChangeMind),
      changeMindCondition: compact(resolver.reasoning.counterfactualToChangeMind),
      integrationRule: "After one proof observation, rebuild resolver state before any next turn; never carry proof into training or public picks directly.",
      safestDecision: "Keep market-prior lock active until the model beats no-vig market consensus through stable benchmark, provider retest, CLV, and promotion governance."
    },
    controls: {
      canInspectReadOnly: true,
      canRunSelectedProof: safeToRun,
      requiresExplicitRunParam: true,
      canCallOpenAI: false,
      canFetchProviders: false,
      canWriteSupabaseRows: false,
      canPersistBacktestMemory: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    nextAction:
      status === "observed"
        ? {
            label: "Rebuild market-prior resolver after observation",
            command: decisionCurlCommand(`/api/sports/decision/market-prior-blocker-resolver?date=${resolver.date}&sport=${resolver.sport}&limit=8&dryRun=1`),
            verifyUrl: `/api/sports/decision/market-prior-blocker-resolver?date=${resolver.date}&sport=${resolver.sport}&limit=8&dryRun=1`,
            expectedEvidence: "Updated resolver ranks whether the observed proof changed any market-prior, threshold, provider-row, runner, CLV, or promotion blocker."
          }
        : {
            label: runRequested ? "Retry selected read-only proof" : `Observe ${step?.label ?? "market-prior proof"}`,
            command: safeToRun && verifyUrl ? decisionCurlCommand(`/api/sports/decision/market-prior-resolution-turn?date=${resolver.date}&sport=${resolver.sport}&limit=8&dryRun=1&run=1`) : null,
            verifyUrl: `/api/sports/decision/market-prior-resolution-turn?date=${resolver.date}&sport=${resolver.sport}&limit=8&dryRun=1&run=1`,
            expectedEvidence: compact(step?.requiredProof ?? resolver.nextAction.expectedEvidence)
          },
    proofUrls: unique([
      "/api/sports/decision/market-prior-resolution-turn",
      "/api/sports/decision/market-prior-blocker-resolver",
      selectedVerifyUrl,
      ...resolver.proofUrls
    ]),
    locks: unique([
      "Market-prior resolution turn can only observe one read-only proof when run=1 is explicitly requested.",
      "No OpenAI call, provider fetch, Supabase write, persistence, training, learned-weight update, probability adjustment, public pick, stake, or hidden chain-of-thought exposure is allowed.",
      "Observed proof must flow back through a fresh resolver before any future action.",
      ...resolver.locks
    ])
  };
}
