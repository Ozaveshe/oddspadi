import type { DecisionAgentOperationQueue } from "@/lib/sports/prediction/decisionAgentOperationQueue";
import type { DecisionBayesianBeliefLedger } from "@/lib/sports/prediction/decisionBayesianBeliefLedger";
import type { DecisionContextSignalCategorySummary, DecisionContextSignalProof } from "@/lib/sports/prediction/decisionContextSignalProof";
import type { DecisionDataGapResolver, DecisionDataGapResolverAction } from "@/lib/sports/prediction/decisionDataGapResolver";
import type { DecisionDataIntakeItem, DecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import type { DecisionOpenAILiveReviewReceipt } from "@/lib/sports/prediction/decisionOpenAILiveReviewReceipt";
import type { DecisionDataSignalCategory, Sport } from "@/lib/sports/types";

export type DecisionEvidenceAcquisitionStatus = "ready-readonly" | "waiting-provider" | "waiting-supabase" | "blocked";
export type DecisionEvidenceAcquisitionCandidateStatus = "ready" | "waiting-env" | "waiting-supabase" | "manual" | "blocked";
export type DecisionEvidenceAcquisitionSource = "data-gap" | "data-intake" | "context-signal" | "belief-ledger" | "operation-queue" | "openai-proof";
export type DecisionEvidenceAcquisitionMode = "read-only" | "dry-run" | "manual-only";

export type DecisionEvidenceAcquisitionCandidate = {
  id: string;
  source: DecisionEvidenceAcquisitionSource;
  category: DecisionDataSignalCategory | "belief" | "proof" | "openai";
  status: DecisionEvidenceAcquisitionCandidateStatus;
  mode: DecisionEvidenceAcquisitionMode;
  priority: "critical" | "high" | "medium" | "low";
  label: string;
  provider: string;
  informationGainScore: number;
  affectedBeliefs: number;
  expectedBeliefChange: string;
  expectedEvidence: string;
  ifMissing: string;
  command: string | null;
  verifyUrl: string;
  safeToRun: boolean;
  missingEnv: string[];
  blockers: string[];
};

export type DecisionEvidenceAcquisitionPlanner = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "evidence-acquisition-planner";
  status: DecisionEvidenceAcquisitionStatus;
  plannerHash: string;
  summary: string;
  nextCandidate: DecisionEvidenceAcquisitionCandidate | null;
  candidates: DecisionEvidenceAcquisitionCandidate[];
  totals: {
    candidates: number;
    ready: number;
    waitingEnv: number;
    waitingSupabase: number;
    manual: number;
    blocked: number;
    averageInformationGain: number;
    maxInformationGain: number;
  };
  acquisitionPolicy: {
    question: string;
    rule: string;
    canRunReadOnly: boolean;
    canRunDryRun: boolean;
    canWriteProviderRows: false;
    canPersistBeliefs: false;
    canPublishPicks: false;
    canTrainModels: false;
  };
  controls: {
    canInspectReadOnly: true;
    canRunNextSafeCommand: boolean;
    canAskOpenAI: boolean;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
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

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function priorityRank(priority: DecisionEvidenceAcquisitionCandidate["priority"]): number {
  if (priority === "critical") return 4;
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function statusRank(status: DecisionEvidenceAcquisitionCandidateStatus): number {
  if (status === "ready") return 5;
  if (status === "waiting-supabase") return 4;
  if (status === "waiting-env") return 3;
  if (status === "manual") return 2;
  return 1;
}

function modeFor(command: string | null): DecisionEvidenceAcquisitionMode {
  const lower = command?.toLowerCase() ?? "";
  if (!command) return "manual-only";
  if (lower.includes("dryrun=1") || lower.includes("dry-run")) return "dry-run";
  if (lower.includes("-x post") || lower.includes("-xpost") || lower.includes("--request post")) return "manual-only";
  return "read-only";
}

function commandIsSafe(command: string | null, mode: DecisionEvidenceAcquisitionMode, missingEnv: string[]): boolean {
  if (!command || missingEnv.length) return false;
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return false;
  if (lower.includes("persist=1") || lower.includes("publish=1") || lower.includes("dryrun=0") || lower.includes("deploy --prod")) return false;
  if (mode === "manual-only") return false;
  return true;
}

function statusFor({
  command,
  missingEnv,
  blockers,
  supabaseBlocked
}: {
  command: string | null;
  missingEnv: string[];
  blockers: string[];
  supabaseBlocked: boolean;
}): DecisionEvidenceAcquisitionCandidateStatus {
  if (supabaseBlocked) return "waiting-supabase";
  if (missingEnv.length) return "waiting-env";
  if (blockers.length && !command) return "blocked";
  if (!command) return "manual";
  return "ready";
}

function candidate(input: Omit<DecisionEvidenceAcquisitionCandidate, "safeToRun" | "expectedBeliefChange" | "expectedEvidence" | "ifMissing" | "missingEnv" | "blockers"> & {
  expectedBeliefChange: string;
  expectedEvidence: string;
  ifMissing: string;
  missingEnv?: string[];
  blockers?: string[];
}): DecisionEvidenceAcquisitionCandidate {
  const missingEnv = unique(input.missingEnv ?? []);
  const blockers = unique(input.blockers ?? []);
  const mode = input.mode;
  return {
    ...input,
    informationGainScore: clamp(input.informationGainScore),
    expectedBeliefChange: compact(input.expectedBeliefChange),
    expectedEvidence: compact(input.expectedEvidence),
    ifMissing: compact(input.ifMissing),
    missingEnv,
    blockers,
    safeToRun: input.status === "ready" && commandIsSafe(input.command, mode, missingEnv)
  };
}

function dataGapCandidate(action: DecisionDataGapResolverAction, beliefLedger: DecisionBayesianBeliefLedger): DecisionEvidenceAcquisitionCandidate {
  const mode = modeFor(action.command);
  const supabaseBlocked = action.status === "waiting-supabase";
  const missingEnv = action.missingEnv;
  const blockers = action.blockers;
  const status = statusFor({ command: action.command, missingEnv, blockers, supabaseBlocked });
  const affectedBeliefs = Math.max(1, Math.min(beliefLedger.totals.beliefs, action.score > 70 ? 12 : action.score > 50 ? 8 : 4));
  return candidate({
    id: `acquire-${action.id}`,
    source: "data-gap",
    category: action.kind === "training-corpus" ? "training" : "proof",
    status,
    mode,
    priority: action.priority,
    label: action.label,
    provider: action.provider,
    informationGainScore: action.score,
    affectedBeliefs,
    expectedBeliefChange: action.unlocks.modelImpact,
    expectedEvidence: action.expectedEvidence,
    ifMissing: action.blockers[0] ?? "Keep the related beliefs capped and require another provider observation.",
    command: action.command,
    verifyUrl: action.verifyUrl,
    missingEnv,
    blockers
  });
}

function dataIntakeCandidate(item: DecisionDataIntakeItem, beliefLedger: DecisionBayesianBeliefLedger): DecisionEvidenceAcquisitionCandidate {
  const mode = modeFor(item.command);
  const missingEnv = item.missingEnv;
  const blockers = item.status === "blocked" ? [item.expectedEvidence] : [];
  const status = statusFor({ command: item.command, missingEnv, blockers, supabaseBlocked: false });
  return candidate({
    id: `acquire-intake-${item.category}`,
    source: "data-intake",
    category: item.category,
    status,
    mode,
    priority: item.priority,
    label: item.label,
    provider: item.provider,
    informationGainScore: item.affectedMatches * 4 + item.missingSignals * 7 + item.staleSignals * 5 + item.mockSignals * 4,
    affectedBeliefs: Math.min(beliefLedger.totals.beliefs, Math.max(1, item.affectedMatches)),
    expectedBeliefChange: item.decisionImpact,
    expectedEvidence: item.expectedEvidence,
    ifMissing: `Beliefs remain capped because ${item.label.toLowerCase()} is still ${item.status.replaceAll("-", " ")}.`,
    command: item.command,
    verifyUrl: item.verifyUrl,
    missingEnv,
    blockers
  });
}

function contextCandidate(category: DecisionContextSignalCategorySummary, beliefLedger: DecisionBayesianBeliefLedger): DecisionEvidenceAcquisitionCandidate {
  const blocking = category.readiness === "blocked";
  return candidate({
    id: `acquire-context-${category.category}`,
    source: "context-signal",
    category: category.category,
    status: category.readiness === "ready-proof" ? "manual" : blocking ? "blocked" : "manual",
    mode: "manual-only",
    priority: category.requiredForProduction ? "high" : "medium",
    label: category.label,
    provider: "Context signal provider",
    informationGainScore:
      (category.requiredForProduction ? 26 : 12) + category.missing * 8 + category.stale * 6 + category.mock * 4 + Math.min(category.totalSignals, 10),
    affectedBeliefs: Math.min(beliefLedger.totals.beliefs, Math.max(1, category.missing + category.stale + category.mock)),
    expectedBeliefChange: category.modelImpact,
    expectedEvidence: category.nextAction,
    ifMissing: `Keep ${category.label.toLowerCase()} as a trust cap until provider-backed evidence exists.`,
    command: null,
    verifyUrl: "/api/sports/decision/context-signal-proof",
    blockers: blocking ? [category.nextAction] : []
  });
}

export function buildDecisionEvidenceAcquisitionPlanner({
  date,
  sport,
  beliefLedger,
  dataGapResolver,
  dataIntake,
  contextSignalProof,
  agentOperationQueue,
  openAiLiveReviewReceipt,
  now = new Date(),
  limit = 12
}: {
  date: string;
  sport: Sport;
  beliefLedger: DecisionBayesianBeliefLedger;
  dataGapResolver: DecisionDataGapResolver;
  dataIntake: DecisionDataIntakeQueue;
  contextSignalProof: DecisionContextSignalProof;
  agentOperationQueue: DecisionAgentOperationQueue;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  now?: Date;
  limit?: number;
}): DecisionEvidenceAcquisitionPlanner {
  const dataGapCandidates = dataGapResolver.actions.slice(0, 8).map((action) => dataGapCandidate(action, beliefLedger));
  const intakeCandidates = dataIntake.items.slice(0, 8).map((item) => dataIntakeCandidate(item, beliefLedger));
  const contextCandidates = contextSignalProof.categories
    .filter((item) => item.readiness !== "ready-proof" || item.requiredForProduction)
    .slice(0, 8)
    .map((item) => contextCandidate(item, beliefLedger));
  const activeBelief = beliefLedger.activeBelief
    ? candidate({
        id: "acquire-active-belief-proof",
        source: "belief-ledger",
        category: "belief",
        status: "ready",
        mode: "read-only",
        priority: beliefLedger.activeBelief.status === "block" ? "critical" : beliefLedger.activeBelief.status === "watch" ? "high" : "medium",
        label: `Verify ${beliefLedger.activeBelief.match}`,
        provider: "OddsPadi decision endpoint",
        informationGainScore: beliefLedger.activeBelief.revisionPressure + Math.min(20, beliefLedger.activeBelief.uncertaintyScore * 0.25),
        affectedBeliefs: 1,
        expectedBeliefChange: `May confirm, weaken, or retire posterior ${beliefLedger.activeBelief.posteriorProbability ?? "n/a"}.`,
        expectedEvidence: beliefLedger.activeBelief.nextObservation,
        ifMissing: beliefLedger.activeBelief.falsifier,
        command: beliefLedger.activeBelief.command,
        verifyUrl: beliefLedger.activeBelief.verifyUrl
      })
    : null;
  const operationCandidate = agentOperationQueue.nextOperation
    ? candidate({
        id: "acquire-operation-proof",
        source: "operation-queue",
        category: "proof",
        status: agentOperationQueue.nextOperation.safeToRun ? "ready" : agentOperationQueue.nextOperation.status === "blocked" ? "blocked" : "manual",
        mode: modeFor(agentOperationQueue.nextOperation.command),
        priority: agentOperationQueue.nextOperation.priority,
        label: agentOperationQueue.nextOperation.label,
        provider: agentOperationQueue.nextOperation.kind,
        informationGainScore: agentOperationQueue.nextOperation.status === "blocked" ? 64 : 48,
        affectedBeliefs: Math.max(1, Math.min(10, beliefLedger.totals.block + beliefLedger.totals.watch)),
        expectedBeliefChange: agentOperationQueue.nextOperation.rationale,
        expectedEvidence: agentOperationQueue.nextOperation.expectedEvidence,
        ifMissing: agentOperationQueue.nextOperation.blockedBy[0] ?? "Keep the queue blocked until this proof changes.",
        command: agentOperationQueue.nextOperation.command,
        verifyUrl: agentOperationQueue.nextOperation.verifyUrl,
        blockers: agentOperationQueue.nextOperation.blockedBy
      })
    : null;
  const openAiCandidate = candidate({
    id: "acquire-openai-live-critique",
    source: "openai-proof",
    category: "openai",
    status:
      openAiLiveReviewReceipt.status === "quota-or-billing-blocked" || openAiLiveReviewReceipt.status === "rate-or-quota-limited"
        ? "waiting-env"
        : openAiLiveReviewReceipt.controls.canRequestLiveReview
          ? "ready"
          : "blocked",
    mode: "read-only",
    priority: "high",
    label: "Run guarded OpenAI live critique",
    provider: "OpenAI Responses API",
    informationGainScore: openAiLiveReviewReceipt.status === "reviewed" ? 20 : 58,
    affectedBeliefs: Math.max(1, Math.min(8, beliefLedger.totals.block + beliefLedger.totals.watch || beliefLedger.totals.beliefs)),
    expectedBeliefChange: "Can challenge unsupported claims, list required evidence, and keep trust capped when citations are missing.",
    expectedEvidence: openAiLiveReviewReceipt.nextAction,
    ifMissing: "Keep AI critique in deterministic fallback and do not raise trust.",
    command:
      openAiLiveReviewReceipt.controls.canRequestLiveReview
        ? `curl.exe -sS "http://127.0.0.1:3025/api/sports/decision/openai-live-review-receipt?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}&limit=1&run=1"`
        : null,
    verifyUrl: "/api/sports/decision/openai-live-review-receipt?run=1&limit=1",
    missingEnv:
      openAiLiveReviewReceipt.status === "quota-or-billing-blocked" || openAiLiveReviewReceipt.status === "rate-or-quota-limited"
        ? ["OPENAI_PROJECT_BILLING_OR_QUOTA"]
        : []
  });

  const candidates = [...dataGapCandidates, ...intakeCandidates, ...contextCandidates, activeBelief, operationCandidate, openAiCandidate]
    .filter((item): item is DecisionEvidenceAcquisitionCandidate => Boolean(item))
    .sort((a, b) => {
      const status = statusRank(b.status) - statusRank(a.status);
      if (status !== 0) return status;
      const priority = priorityRank(b.priority) - priorityRank(a.priority);
      if (priority !== 0) return priority;
      return b.informationGainScore - a.informationGainScore;
    });
  const visible = candidates.slice(0, limit);
  const nextCandidate = candidates.find((item) => item.safeToRun) ?? candidates.find((item) => item.status !== "blocked") ?? null;
  const totals = {
    candidates: candidates.length,
    ready: candidates.filter((item) => item.status === "ready").length,
    waitingEnv: candidates.filter((item) => item.status === "waiting-env").length,
    waitingSupabase: candidates.filter((item) => item.status === "waiting-supabase").length,
    manual: candidates.filter((item) => item.status === "manual").length,
    blocked: candidates.filter((item) => item.status === "blocked").length,
    averageInformationGain: average(candidates.map((item) => item.informationGainScore)),
    maxInformationGain: candidates.length ? Math.max(...candidates.map((item) => item.informationGainScore)) : 0
  };
  const status: DecisionEvidenceAcquisitionStatus = totals.ready
    ? "ready-readonly"
    : totals.waitingSupabase
      ? "waiting-supabase"
      : totals.waitingEnv || totals.manual
        ? "waiting-provider"
        : "blocked";

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "evidence-acquisition-planner",
    status,
    plannerHash: stableHash({
      date,
      sport,
      status,
      beliefLedger: beliefLedger.ledgerHash,
      dataGap: dataGapResolver.resolverHash,
      context: contextSignalProof.proofHash,
      candidates: visible.map((item) => [item.id, item.status, item.informationGainScore])
    }),
    summary:
      status === "ready-readonly"
        ? `Evidence acquisition planner can run ${nextCandidate?.label ?? "a read-only proof"} next.`
        : status === "waiting-supabase"
          ? "Evidence acquisition planner is waiting on clean OddsPadi Supabase proof before provider/storage work."
          : status === "waiting-provider"
            ? "Evidence acquisition planner is waiting on provider keys, quota, or manual evidence before trust can rise."
            : "Evidence acquisition planner found no safe acquisition path yet.",
    nextCandidate,
    candidates: visible,
    totals,
    acquisitionPolicy: {
      question: nextCandidate ? `Which evidence would most change ${nextCandidate.affectedBeliefs} belief(s)?` : "No acquisition candidate is available.",
      rule: "Acquire evidence by information gain first; use read-only or dry-run proof only; never write provider rows, publish picks, train, stake, or raise trust from acquisition alone.",
      canRunReadOnly: candidates.some((item) => item.safeToRun && item.mode === "read-only"),
      canRunDryRun: candidates.some((item) => item.safeToRun && item.mode === "dry-run"),
      canWriteProviderRows: false,
      canPersistBeliefs: false,
      canPublishPicks: false,
      canTrainModels: false
    },
    controls: {
      canInspectReadOnly: true,
      canRunNextSafeCommand: Boolean(nextCandidate?.safeToRun),
      canAskOpenAI: openAiLiveReviewReceipt.controls.canRequestLiveReview,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/evidence-acquisition-planner",
      ...dataGapResolver.proofUrls,
      ...contextSignalProof.proofUrls,
      ...beliefLedger.proofUrls,
      ...agentOperationQueue.proofUrls,
      ...openAiLiveReviewReceipt.proofUrls
    ]),
    locks: unique([
      "Evidence acquisition is read-only/dry-run only and cannot write provider rows, persist beliefs, train models, publish picks, stake, or upgrade public action.",
      ...dataGapResolver.locks,
      ...contextSignalProof.locks,
      ...beliefLedger.locks,
      ...agentOperationQueue.locks,
      ...openAiLiveReviewReceipt.locks
    ])
  };
}
