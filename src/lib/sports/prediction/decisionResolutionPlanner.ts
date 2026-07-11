import type { DecisionAgentOperation, DecisionAgentOperationQueue } from "@/lib/sports/prediction/decisionAgentOperationQueue";
import type { DecisionContradictionItem, DecisionContradictionLedger } from "@/lib/sports/prediction/decisionContradictionLedger";
import type { DecisionEvidenceAcquisitionCandidate, DecisionEvidenceAcquisitionPlanner } from "@/lib/sports/prediction/decisionEvidenceAcquisitionPlanner";
import type { DecisionTrustFirewall } from "@/lib/sports/prediction/decisionTrustFirewall";
import type { Sport } from "@/lib/sports/types";

export type DecisionResolutionPlannerStatus = "ready-readonly" | "waiting-evidence" | "blocked" | "resolved";
export type DecisionResolutionStepStatus = "ready" | "waiting" | "blocked" | "done";
export type DecisionResolutionStepSource = "contradiction" | "evidence-acquisition" | "agent-operation" | "trust-firewall";

export type DecisionResolutionStep = {
  id: string;
  source: DecisionResolutionStepSource;
  contradictionId: string | null;
  status: DecisionResolutionStepStatus;
  priority: "critical" | "high" | "medium" | "low";
  label: string;
  strategy: string;
  expectedUnlock: string;
  command: string | null;
  verifyUrl: string;
  safeToRun: boolean;
  blockedBy: string[];
  evidence: string[];
};

export type DecisionResolutionPlanner = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-resolution-planner";
  status: DecisionResolutionPlannerStatus;
  plannerHash: string;
  summary: string;
  nextStep: DecisionResolutionStep | null;
  steps: DecisionResolutionStep[];
  totals: {
    steps: number;
    ready: number;
    waiting: number;
    blocked: number;
    done: number;
    critical: number;
    contradictions: number;
    safeCommands: number;
  };
  policy: {
    goal: string;
    rule: string;
    canRunReadOnly: boolean;
    canRunDryRun: boolean;
    canResolveAutomatically: false;
    canRaiseConfidence: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
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

function unique(values: Array<string | null | undefined>, limit = 30): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, max = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3).trim()}...` : normalized;
}

function commandIsSafe(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return false;
  if (lower.includes("persist=1") || lower.includes("persist=true")) return false;
  if (lower.includes("publish=1") || lower.includes("publish=true")) return false;
  if (lower.includes("stake=1") || lower.includes("train=1") || lower.includes("deploy --prod")) return false;
  if (lower.includes("dryrun=0") || lower.includes("dryrun=false")) return false;
  return true;
}

function step(input: DecisionResolutionStep): DecisionResolutionStep {
  const blockedBy = unique(input.blockedBy, 8);
  return {
    ...input,
    strategy: compact(input.strategy),
    expectedUnlock: compact(input.expectedUnlock),
    blockedBy,
    evidence: unique(input.evidence, 8),
    safeToRun: input.status === "ready" && blockedBy.length === 0 && commandIsSafe(input.command)
  };
}

function priorityFromContradiction(item: DecisionContradictionItem): DecisionResolutionStep["priority"] {
  if (item.severity === "critical") return "critical";
  if (item.severity === "high") return "high";
  if (item.severity === "medium") return "medium";
  return "low";
}

function statusFromContradiction(item: DecisionContradictionItem): DecisionResolutionStepStatus {
  if (item.status === "resolved") return "done";
  if (item.status === "contradiction") return "blocked";
  return "waiting";
}

function findEvidenceCandidate(item: DecisionContradictionItem, planner: DecisionEvidenceAcquisitionPlanner): DecisionEvidenceAcquisitionCandidate | null {
  const id = item.id;
  const candidates = planner.candidates;
  if (id === "freshness-vs-model" || id === "edge-vs-action") {
    return (
      candidates.find((candidate) => candidate.category === "odds" && candidate.status === "ready") ??
      candidates.find((candidate) => candidate.category === "fixtures") ??
      candidates.find((candidate) => candidate.source === "data-intake") ??
      planner.nextCandidate
    );
  }
  if (id === "confidence-vs-learning") {
    return candidates.find((candidate) => candidate.category === "training") ?? planner.nextCandidate;
  }
  return planner.nextCandidate;
}

function findOperation(item: DecisionContradictionItem, queue: DecisionAgentOperationQueue): DecisionAgentOperation | null {
  if (item.id === "ai-vs-deterministic") {
    return queue.operations.find((operation) => operation.id === "openai-live-proof") ?? queue.nextOperation;
  }
  if (item.id === "confidence-vs-learning") {
    return queue.operations.find((operation) => operation.kind === "training") ?? queue.nextOperation;
  }
  if (item.id === "edge-vs-action" || item.id === "freshness-vs-model") {
    return queue.operations.find((operation) => operation.kind === "proof" && operation.status === "ready") ?? queue.nextOperation;
  }
  return queue.nextOperation;
}

function contradictionStep({
  item,
  evidenceCandidate,
  operation
}: {
  item: DecisionContradictionItem;
  evidenceCandidate: DecisionEvidenceAcquisitionCandidate | null;
  operation: DecisionAgentOperation | null;
}): DecisionResolutionStep {
  const preferredCommand = evidenceCandidate?.command ?? operation?.command ?? null;
  const status = evidenceCandidate?.safeToRun || operation?.safeToRun ? "ready" : statusFromContradiction(item);
  const blockedBy = unique([
    ...item.evidence.filter((entry) => entry.includes("blocked") || entry.includes("missing") || entry.includes("status:blocked")),
    ...(evidenceCandidate?.missingEnv ?? []),
    ...(evidenceCandidate?.blockers ?? []),
    ...(operation?.blockedBy ?? [])
  ]);

  return step({
    id: `resolve-${item.id}`,
    source: "contradiction",
    contradictionId: item.id,
    status,
    priority: priorityFromContradiction(item),
    label: `Resolve ${item.label}`,
    strategy: item.resolution,
    expectedUnlock: evidenceCandidate?.expectedBeliefChange ?? operation?.expectedEvidence ?? item.tension,
    command: preferredCommand,
    verifyUrl: evidenceCandidate?.verifyUrl ?? operation?.verifyUrl ?? "/api/sports/decision/contradiction-ledger",
    safeToRun: false,
    blockedBy,
    evidence: unique([item.status, item.severity, ...item.evidence, evidenceCandidate?.id, operation?.id])
  });
}

function evidenceStep(candidate: DecisionEvidenceAcquisitionCandidate | null): DecisionResolutionStep | null {
  if (!candidate) return null;
  return step({
    id: `evidence-${candidate.id}`,
    source: "evidence-acquisition",
    contradictionId: null,
    status: candidate.status === "ready" ? "ready" : candidate.status === "blocked" ? "blocked" : "waiting",
    priority: candidate.priority,
    label: candidate.label,
    strategy: candidate.expectedEvidence,
    expectedUnlock: candidate.expectedBeliefChange,
    command: candidate.command,
    verifyUrl: candidate.verifyUrl,
    safeToRun: false,
    blockedBy: [...candidate.missingEnv, ...candidate.blockers],
    evidence: [candidate.id, candidate.source, candidate.mode, `score:${candidate.informationGainScore}`]
  });
}

function operationStep(operation: DecisionAgentOperation | null): DecisionResolutionStep | null {
  if (!operation) return null;
  return step({
    id: `operation-${operation.id}`,
    source: "agent-operation",
    contradictionId: null,
    status: operation.status === "done" ? "done" : operation.status,
    priority: operation.priority,
    label: operation.label,
    strategy: operation.rationale,
    expectedUnlock: operation.expectedEvidence,
    command: operation.command,
    verifyUrl: operation.verifyUrl,
    safeToRun: false,
    blockedBy: operation.blockedBy,
    evidence: [operation.id, operation.kind, operation.status]
  });
}

function trustStep(trustFirewall: DecisionTrustFirewall): DecisionResolutionStep {
  const blockedGate = trustFirewall.gates.find((gate) => gate.status === "block") ?? trustFirewall.gates.find((gate) => gate.status === "watch");
  return step({
    id: "trust-firewall-next-gate",
    source: "trust-firewall",
    contradictionId: null,
    status: trustFirewall.status === "actionable-shadow" ? "done" : trustFirewall.status === "watchlist-only" ? "waiting" : "blocked",
    priority: blockedGate?.severity === "critical" ? "critical" : blockedGate?.severity === "high" ? "high" : "medium",
    label: blockedGate ? `Clear ${blockedGate.label}` : "Keep trust firewall clear",
    strategy: blockedGate?.detail ?? trustFirewall.summary,
    expectedUnlock: blockedGate?.nextAction ?? trustFirewall.actionContract.reason,
    command: null,
    verifyUrl: "/api/sports/decision/trust-firewall",
    safeToRun: false,
    blockedBy: blockedGate ? [blockedGate.nextAction] : [],
    evidence: [trustFirewall.firewallHash, trustFirewall.status, `max:${trustFirewall.actionContract.maximumPublicAction}`]
  });
}

function rank(stepItem: DecisionResolutionStep): number {
  const statusRank = { ready: 4, blocked: 3, waiting: 2, done: 1 }[stepItem.status];
  const priorityRank = { critical: 4, high: 3, medium: 2, low: 1 }[stepItem.priority];
  const safeBonus = stepItem.safeToRun ? 8 : 0;
  return statusRank * 20 + priorityRank * 4 + safeBonus;
}

function statusFor(steps: DecisionResolutionStep[], ledger: DecisionContradictionLedger): DecisionResolutionPlannerStatus {
  if (!ledger.totals.contradictions && !ledger.totals.watch) return "resolved";
  if (steps.some((item) => item.safeToRun)) return "ready-readonly";
  if (ledger.status === "contradicted" || steps.some((item) => item.status === "blocked" && item.priority === "critical")) return "blocked";
  return "waiting-evidence";
}

function summaryFor(status: DecisionResolutionPlannerStatus, nextStep: DecisionResolutionStep | null): string {
  if (status === "resolved") return "Resolution planner has no unresolved contradictions; keep read-only monitoring active.";
  if (status === "ready-readonly") return `Resolution planner selected a safe read-only proof step: ${nextStep?.label ?? "inspect the next evidence gate"}.`;
  if (status === "waiting-evidence") return `Resolution planner is waiting on evidence before it can clear ${nextStep?.label ?? "the active contradiction"}.`;
  return `Resolution planner is blocked by ${nextStep?.label ?? "a critical contradiction"}; no confidence, publish, train, stake, or persistence action is allowed.`;
}

export function buildDecisionResolutionPlanner({
  date,
  sport,
  contradictionLedger,
  evidenceAcquisitionPlanner,
  agentOperationQueue,
  trustFirewall,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  contradictionLedger: DecisionContradictionLedger;
  evidenceAcquisitionPlanner: DecisionEvidenceAcquisitionPlanner;
  agentOperationQueue: DecisionAgentOperationQueue;
  trustFirewall: DecisionTrustFirewall;
  now?: Date;
}): DecisionResolutionPlanner {
  const unresolved = contradictionLedger.items.filter((item) => item.status !== "resolved");
  const contradictionSteps = unresolved.map((item) =>
    contradictionStep({
      item,
      evidenceCandidate: findEvidenceCandidate(item, evidenceAcquisitionPlanner),
      operation: findOperation(item, agentOperationQueue)
    })
  );
  const extraSteps = [
    evidenceStep(evidenceAcquisitionPlanner.nextCandidate),
    operationStep(agentOperationQueue.nextOperation),
    trustStep(trustFirewall)
  ].filter((item): item is DecisionResolutionStep => item !== null);
  const steps = [...contradictionSteps, ...extraSteps]
    .sort((a, b) => rank(b) - rank(a) || a.label.localeCompare(b.label))
    .slice(0, 10);
  const nextStep = steps.find((item) => item.safeToRun) ?? steps.find((item) => item.status === "blocked") ?? steps[0] ?? null;
  const status = statusFor(steps, contradictionLedger);
  const totals = {
    steps: steps.length,
    ready: steps.filter((item) => item.status === "ready").length,
    waiting: steps.filter((item) => item.status === "waiting").length,
    blocked: steps.filter((item) => item.status === "blocked").length,
    done: steps.filter((item) => item.status === "done").length,
    critical: steps.filter((item) => item.priority === "critical").length,
    contradictions: contradictionLedger.totals.contradictions,
    safeCommands: steps.filter((item) => item.safeToRun).length
  };

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-resolution-planner",
    status,
    plannerHash: stableHash({
      date,
      sport,
      ledger: contradictionLedger.ledgerHash,
      trust: trustFirewall.firewallHash,
      steps: steps.map((item) => [item.id, item.status, item.safeToRun, item.blockedBy])
    }),
    summary: summaryFor(status, nextStep),
    nextStep,
    steps,
    totals,
    policy: {
      goal: "Resolve contradictions by collecting proof, not by weakening action locks.",
      rule: "A resolution step may inspect or dry-run safe evidence only. It cannot resolve contradictions automatically, raise confidence, persist, publish, train, stake, or expose hidden chain-of-thought.",
      canRunReadOnly: steps.some((item) => item.safeToRun),
      canRunDryRun: steps.some((item) => item.safeToRun && item.command?.toLowerCase().includes("dryrun=1")),
      canResolveAutomatically: false,
      canRaiseConfidence: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/resolution-planner",
      "/api/sports/decision/contradiction-ledger",
      "/api/sports/decision/evidence-acquisition-planner",
      "/api/sports/decision/agent-operation-queue",
      "/api/sports/decision/trust-firewall",
      nextStep?.verifyUrl,
      ...contradictionLedger.proofUrls,
      ...evidenceAcquisitionPlanner.proofUrls,
      ...agentOperationQueue.proofUrls,
      ...trustFirewall.proofUrls
    ]),
    locks: [
      "Resolution planner is read-only; it cannot mark contradictions resolved without new proof.",
      "Safe commands must be curl-based inspection or dry-run commands and must not include persist, publish, train, stake, or prod deploy flags.",
      "A selected step can lower or hold actionability only; it cannot upgrade public action."
    ]
  };
}
