import type { DecisionEvidenceGraph } from "@/lib/sports/prediction/decisionEvidenceGraph";
import type { DecisionReflection } from "@/lib/sports/prediction/decisionReflection";
import type { DecisionRehearsal } from "@/lib/sports/prediction/decisionRehearsal";
import type { DecisionSlateThinking } from "@/lib/sports/prediction/decisionSlateThinking";
import type { DecisionWorkingMemory } from "@/lib/sports/prediction/decisionWorkingMemory";
import type { Sport } from "@/lib/sports/types";

export type DecisionThinkingIntrospectionStatus = "ready-shadow" | "needs-proof" | "blocked";
export type DecisionThinkingIntrospectionCheckStatus = "pass" | "watch" | "block";
export type DecisionThinkingIntrospectionLayerId = "slate" | "memory" | "reflection" | "rehearsal" | "evidence-graph";

export type DecisionThinkingIntrospectionLayer = {
  id: DecisionThinkingIntrospectionLayerId;
  label: string;
  status: DecisionThinkingIntrospectionCheckStatus;
  score: number;
  hash: string;
  summary: string;
  evidence: string[];
  nextAction: string;
  proofUrl: string;
};

export type DecisionThinkingIntrospection = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-thinking-introspection";
  status: DecisionThinkingIntrospectionStatus;
  introspectionHash: string;
  summary: string;
  focus: {
    layer: DecisionThinkingIntrospectionLayerId | null;
    matchId: string | null;
    match: string | null;
    currentBelief: string;
    primaryDoubt: string;
    nextQuestion: string;
    nextObservation: string;
  };
  totals: {
    layers: number;
    pass: number;
    watch: number;
    block: number;
    averageScore: number;
  };
  layers: DecisionThinkingIntrospectionLayer[];
  nextStep: {
    label: string;
    command: string | null;
    verifyUrl: string | null;
    safeToRun: boolean;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunReadOnlyProof: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canRaiseTrust: false;
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

function compact(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 20): string[] {
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

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function layerStatus(score: number, blockers: number, watch: number): DecisionThinkingIntrospectionCheckStatus {
  if (blockers > 0 || score < 35) return "block";
  if (watch > 0 || score < 72) return "watch";
  return "pass";
}

function layerRank(status: DecisionThinkingIntrospectionCheckStatus): number {
  if (status === "block") return 3;
  if (status === "watch") return 2;
  return 1;
}

function sortLayers(layers: DecisionThinkingIntrospectionLayer[]): DecisionThinkingIntrospectionLayer[] {
  return layers.slice().sort((a, b) => {
    const status = layerRank(b.status) - layerRank(a.status);
    if (status !== 0) return status;
    return a.score - b.score;
  });
}

function statusFromLayers(layers: DecisionThinkingIntrospectionLayer[]): DecisionThinkingIntrospectionStatus {
  if (layers.some((layer) => layer.status === "block")) return "blocked";
  if (layers.some((layer) => layer.status === "watch")) return "needs-proof";
  return "ready-shadow";
}

export function buildDecisionThinkingIntrospection({
  date,
  sport,
  slateThinking,
  workingMemory,
  reflection,
  rehearsal,
  evidenceGraph,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  slateThinking: DecisionSlateThinking;
  workingMemory: DecisionWorkingMemory;
  reflection: DecisionReflection;
  rehearsal: DecisionRehearsal;
  evidenceGraph: DecisionEvidenceGraph;
  now?: Date;
}): DecisionThinkingIntrospection {
  const layers: DecisionThinkingIntrospectionLayer[] = [
    {
      id: "slate",
      label: "Slate belief selection",
      status: layerStatus(slateThinking.averageConfidenceScore, slateThinking.blocked, slateThinking.contested + slateThinking.unproven),
      score: clamp(slateThinking.averageConfidenceScore),
      hash: slateThinking.thinkingHash,
      summary: slateThinking.summary,
      evidence: [
        `${slateThinking.totalThoughts} thought(s)`,
        `${slateThinking.blocked} blocked`,
        `${slateThinking.contested + slateThinking.unproven} unresolved`,
        slateThinking.nextThought?.nextEvidenceAction ?? "No next thought selected."
      ],
      nextAction: slateThinking.nextThought?.nextEvidenceAction ?? "Inspect slate thinking before selecting an action.",
      proofUrl: slateThinking.policy.verificationUrl
    },
    {
      id: "memory",
      label: "Working memory",
      status: layerStatus(100 - workingMemory.counts.blockers * 18 - workingMemory.counts.doubts * 7 - workingMemory.counts.assumptions * 4, workingMemory.counts.blockers, workingMemory.counts.doubts + workingMemory.counts.assumptions),
      score: clamp(100 - workingMemory.counts.blockers * 18 - workingMemory.counts.doubts * 7 - workingMemory.counts.assumptions * 4),
      hash: workingMemory.memoryHash,
      summary: workingMemory.summary,
      evidence: [
        workingMemory.attention.currentBelief,
        workingMemory.attention.primaryDoubt,
        workingMemory.attention.decisiveUnknown,
        `${workingMemory.counts.facts} fact(s), ${workingMemory.counts.blockers} blocker(s)`
      ],
      nextAction: workingMemory.attention.safestNextAction,
      proofUrl: workingMemory.policy.verificationUrl
    },
    {
      id: "reflection",
      label: "Reflection",
      status: reflection.status === "blocked" ? "block" : reflection.status === "watching" ? "watch" : "pass",
      score: reflection.score,
      hash: reflection.reflectionHash,
      summary: reflection.summary,
      evidence: [
        `${reflection.counts.block} block item(s)`,
        `${reflection.counts.watch} watch item(s)`,
        reflection.nextReflection?.question ?? "No active reflection question."
      ],
      nextAction: reflection.nextReflection?.requiredChange ?? "Keep reflection clear before any trust change.",
      proofUrl: reflection.policy.verificationUrl
    },
    {
      id: "rehearsal",
      label: "Next-turn rehearsal",
      status: rehearsal.status === "blocked" ? "block" : rehearsal.status === "needs-proof" ? "watch" : "pass",
      score: clamp(rehearsal.counts.ready * 20 - rehearsal.counts.blocked * 18 - rehearsal.counts.waiting * 6 + (rehearsal.nextCommand.safeToRun ? 25 : 0)),
      hash: rehearsal.rehearsalHash,
      summary: rehearsal.summary,
      evidence: [
        `${rehearsal.counts.ready}/${rehearsal.counts.steps} step(s) ready`,
        rehearsal.nextCommand.expectedStateChange,
        rehearsal.outcomeProjection.remainingLocks.join(", ")
      ],
      nextAction: rehearsal.nextCommand.label,
      proofUrl: rehearsal.policy.verificationUrl
    },
    {
      id: "evidence-graph",
      label: "Evidence graph",
      status: evidenceGraph.status === "blocked" ? "block" : evidenceGraph.status === "contested" ? "watch" : "pass",
      score: clamp(evidenceGraph.totals.supporting * 5 - evidenceGraph.totals.blocking * 12 - evidenceGraph.totals.watch * 5 + Math.min(35, evidenceGraph.totals.nodes)),
      hash: evidenceGraph.graphHash,
      summary: evidenceGraph.summary,
      evidence: [
        `${evidenceGraph.totals.nodes} node(s), ${evidenceGraph.totals.edges} edge(s)`,
        `${evidenceGraph.totals.blocking} blocked, ${evidenceGraph.totals.watch} watch`,
        `path:${evidenceGraph.activePath.join(" -> ") || "none"}`
      ],
      nextAction: evidenceGraph.nextObservation.reason,
      proofUrl: "/api/sports/decision/evidence-graph"
    }
  ];
  const orderedLayers = sortLayers(layers);
  const topLayer = orderedLayers[0] ?? null;
  const status = statusFromLayers(layers);
  const pass = layers.filter((layer) => layer.status === "pass").length;
  const watch = layers.filter((layer) => layer.status === "watch").length;
  const block = layers.filter((layer) => layer.status === "block").length;
  const nextStep = {
    label: rehearsal.nextCommand.safeToRun ? rehearsal.nextCommand.label : evidenceGraph.nextObservation.label,
    command: rehearsal.nextCommand.safeToRun ? rehearsal.nextCommand.command : evidenceGraph.nextObservation.command,
    verifyUrl: rehearsal.nextCommand.safeToRun ? rehearsal.nextCommand.verifyUrl : evidenceGraph.nextObservation.verifyUrl,
    safeToRun: Boolean(rehearsal.nextCommand.safeToRun || evidenceGraph.nextObservation.safeToRun),
    expectedEvidence: topLayer?.nextAction ?? "Inspect thinking layers before changing trust."
  };
  const introspectionHash = stableHash({
    date,
    sport,
    status,
    layers: layers.map((layer) => [layer.id, layer.status, layer.score, layer.hash]),
    nextStep
  });

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-thinking-introspection",
    status,
    introspectionHash,
    summary:
      status === "blocked"
        ? `Thinking introspection is blocked by ${block} layer(s); next safe observation is ${nextStep.label}.`
        : status === "needs-proof"
          ? `Thinking introspection needs proof across ${watch} layer(s); next safe observation is ${nextStep.label}.`
          : "Thinking introspection is ready in shadow mode; every layer is inspectable and still locked from public-action upgrades.",
    focus: {
      layer: topLayer?.id ?? null,
      matchId: workingMemory.focus.matchId,
      match: workingMemory.focus.match,
      currentBelief: compact(workingMemory.attention.currentBelief, 240),
      primaryDoubt: compact(workingMemory.attention.primaryDoubt, 240),
      nextQuestion: compact(reflection.nextReflection?.question ?? rehearsal.focus.question, 240),
      nextObservation: compact(evidenceGraph.nextObservation.reason || workingMemory.attention.safestNextAction, 240)
    },
    totals: {
      layers: layers.length,
      pass,
      watch,
      block,
      averageScore: average(layers.map((layer) => layer.score))
    },
    layers,
    nextStep,
    controls: {
      canInspectReadOnly: true,
      canRunReadOnlyProof: nextStep.safeToRun,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRaiseTrust: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/thinking-introspection",
      "/api/sports/decision/slate-thinking",
      "/api/sports/decision/working-memory",
      "/api/sports/decision/reflection",
      "/api/sports/decision/rehearsal",
      workingMemory.policy.verificationUrl,
      reflection.policy.verificationUrl,
      rehearsal.policy.verificationUrl,
      "/api/sports/decision/evidence-graph",
      ...evidenceGraph.proofUrls
    ]),
    locks: [
      "Thinking introspection is read-only and cannot persist, publish, train, raise trust, or upgrade public action.",
      "The audit exposes public beliefs, doubts, graph nodes, and rehearsal steps, not hidden chain-of-thought.",
      "A passing introspection layer can only justify another proof check; it cannot authorize live picks or writes."
    ]
  };
}
