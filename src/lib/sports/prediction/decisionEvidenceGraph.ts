import type { DecisionAICognitiveProof } from "@/lib/sports/prediction/decisionAICognitiveProof";
import type { DecisionSlateThinking } from "@/lib/sports/prediction/decisionSlateThinking";
import type { DecisionTraceLedger } from "@/lib/sports/prediction/decisionTraceLedger";
import type { DecisionWorldModel } from "@/lib/sports/prediction/decisionWorldModel";
import type { DecisionAction, DecisionReasoningEdgeRelation, DecisionReasoningNodeStatus, Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionEvidenceGraphStatus = "coherent" | "contested" | "blocked";
export type DecisionEvidenceGraphNodeKind =
  | "objective"
  | "slate"
  | "match"
  | "model"
  | "market"
  | "data"
  | "risk"
  | "cognition"
  | "world"
  | "trace"
  | "action";
export type DecisionEvidenceGraphNodeStatus = "supporting" | "watch" | "blocking" | "neutral";
export type DecisionEvidenceGraphEdgeRelation = DecisionReasoningEdgeRelation | "summarizes" | "selects" | "observes";

export type DecisionEvidenceGraphNode = {
  id: string;
  kind: DecisionEvidenceGraphNodeKind;
  status: DecisionEvidenceGraphNodeStatus;
  label: string;
  detail: string;
  matchId: string | null;
  action: DecisionAction | "hold";
  strength: number;
  evidenceIds: string[];
  source: string;
};

export type DecisionEvidenceGraphEdge = {
  id: string;
  from: string;
  to: string;
  relation: DecisionEvidenceGraphEdgeRelation;
  weight: number;
  detail: string;
};

export type DecisionEvidenceGraph = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-evidence-graph";
  status: DecisionEvidenceGraphStatus;
  graphHash: string;
  summary: string;
  activePath: string[];
  blockingPath: string[];
  unresolvedNodes: string[];
  nodes: DecisionEvidenceGraphNode[];
  edges: DecisionEvidenceGraphEdge[];
  totals: {
    nodes: number;
    edges: number;
    supporting: number;
    watch: number;
    blocking: number;
    neutral: number;
    matches: number;
    maxStrength: number;
  };
  nextObservation: {
    label: string;
    command: string | null;
    verifyUrl: string | null;
    safeToRun: boolean;
    reason: string;
  };
  controls: {
    canInspectReadOnly: true;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canRaiseTrust: false;
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

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function matchLabel(row: DecisionRow): string {
  return `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`;
}

function nodeStatus(status: DecisionReasoningNodeStatus): DecisionEvidenceGraphNodeStatus {
  if (status === "blocking") return "blocking";
  if (status === "watch") return "watch";
  if (status === "supporting") return "supporting";
  return "neutral";
}

function kindFromReasoning(type: string): DecisionEvidenceGraphNodeKind {
  if (type === "model") return "model";
  if (type === "market") return "market";
  if (type === "data" || type === "context" || type === "tool" || type === "review") return "data";
  if (type === "risk" || type === "uncertainty" || type === "boundary") return "risk";
  if (type === "action") return "action";
  return "match";
}

function rankRows(rows: DecisionRow[]): DecisionRow[] {
  return rows.slice().sort((a, b) => {
    const aBest = a.prediction.bestPick;
    const bBest = b.prediction.bestPick;
    const aValue = a.prediction.decision.decisionScore + (aBest.hasValue ? aBest.expectedValue * 160 + aBest.edge * 100 : 0) + a.match.dataQualityScore;
    const bValue = b.prediction.decision.decisionScore + (bBest.hasValue ? bBest.expectedValue * 160 + bBest.edge * 100 : 0) + b.match.dataQualityScore;
    return bValue - aValue;
  });
}

function addNode(nodes: DecisionEvidenceGraphNode[], node: DecisionEvidenceGraphNode): void {
  if (nodes.some((item) => item.id === node.id)) return;
  nodes.push(node);
}

function addEdge(edges: DecisionEvidenceGraphEdge[], edge: DecisionEvidenceGraphEdge): void {
  if (edges.some((item) => item.id === edge.id)) return;
  edges.push(edge);
}

function graphStatus(nodes: DecisionEvidenceGraphNode[]): DecisionEvidenceGraphStatus {
  if (nodes.some((node) => node.status === "blocking")) return "blocked";
  if (nodes.some((node) => node.status === "watch")) return "contested";
  return "coherent";
}

export function buildDecisionEvidenceGraph({
  rows,
  date,
  sport,
  slateThinking,
  traceLedger,
  worldModel,
  cognitiveProof,
  limit = 5,
  now = new Date()
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  slateThinking: DecisionSlateThinking;
  traceLedger?: DecisionTraceLedger | null;
  worldModel?: DecisionWorldModel | null;
  cognitiveProof?: DecisionAICognitiveProof | null;
  limit?: number;
  now?: Date;
}): DecisionEvidenceGraph {
  const nodes: DecisionEvidenceGraphNode[] = [];
  const edges: DecisionEvidenceGraphEdge[] = [];
  const selectedRows = rankRows(rows).slice(0, Math.max(1, Math.min(10, limit)));
  const objectiveId = "objective";

  addNode(nodes, {
    id: objectiveId,
    kind: "objective",
    status: rows.length ? "supporting" : "blocking",
    label: "Find value without unsafe promotion",
    detail: "Rank model, market, data, risk, trace, and cognitive evidence before any decision can be considered.",
    matchId: null,
    action: "hold",
    strength: rows.length ? 82 : 0,
    evidenceIds: ["mvp-objective", "responsible-controls"],
    source: "decisionEvidenceGraph"
  });

  addNode(nodes, {
    id: "slate-thinking",
    kind: "slate",
    status: slateThinking.status === "blocked" ? "blocking" : slateThinking.status === "watching" ? "watch" : "supporting",
    label: "Slate thinking",
    detail: slateThinking.summary,
    matchId: slateThinking.nextThought?.matchId ?? null,
    action: "hold",
    strength: clamp(slateThinking.averageConfidenceScore),
    evidenceIds: unique([slateThinking.thinkingHash, slateThinking.nextThought?.id]),
    source: "decisionSlateThinking"
  });
  addEdge(edges, {
    id: "objective-to-slate",
    from: objectiveId,
    to: "slate-thinking",
    relation: "summarizes",
    weight: 0.84,
    detail: "The objective first asks which slate belief needs investigation."
  });

  for (const row of selectedRows) {
    const decision = row.prediction.decision;
    const graph = decision.reasoningGraph;
    const matchId = `match:${row.match.id}`;
    const matchStatus: DecisionEvidenceGraphNodeStatus =
      graph.status === "blocked" || decision.action === "avoid" ? "blocking" : graph.status === "contested" ? "watch" : "supporting";
    const selection = row.prediction.bestPick.hasValue ? row.prediction.bestPick.label : decision.recommendedSelection ?? "No selection";

    addNode(nodes, {
      id: matchId,
      kind: "match",
      status: matchStatus,
      label: matchLabel(row),
      detail: `${graph.summary} Candidate: ${selection}.`,
      matchId: row.match.id,
      action: decision.action,
      strength: clamp(decision.decisionScore),
      evidenceIds: unique([graph.entryNodeId, graph.decisionNodeId, ...graph.strongestPath.slice(0, 4)]),
      source: "prediction.decision.reasoningGraph"
    });
    addEdge(edges, {
      id: `slate-to-${row.match.id}`,
      from: "slate-thinking",
      to: matchId,
      relation: "selects",
      weight: Number((0.45 + Math.min(0.45, decision.decisionScore / 180)).toFixed(2)),
      detail: `Slate pressure selected ${matchLabel(row)} for graph inspection.`
    });

    for (const graphNode of graph.nodes.slice(0, 5)) {
      const nodeId = `match:${row.match.id}:${graphNode.id}`;
      addNode(nodes, {
        id: nodeId,
        kind: kindFromReasoning(graphNode.type),
        status: nodeStatus(graphNode.status),
        label: graphNode.label,
        detail: graphNode.detail,
        matchId: row.match.id,
        action: decision.action,
        strength: clamp(graphNode.strength),
        evidenceIds: graphNode.evidenceIds,
        source: `reasoningGraph.${graphNode.type}`
      });
      addEdge(edges, {
        id: `${nodeId}-to-match`,
        from: nodeId,
        to: matchId,
        relation: graphNode.status === "blocking" ? "blocks" : graphNode.status === "watch" ? "challenges" : "supports",
        weight: Number((Math.max(5, graphNode.strength) / 100).toFixed(2)),
        detail: `${graphNode.label} ${graphNode.status} ${matchLabel(row)}.`
      });
    }

    for (const graphEdge of graph.edges.slice(0, 4)) {
      const from = `match:${row.match.id}:${graphEdge.from}`;
      const to = `match:${row.match.id}:${graphEdge.to}`;
      if (!nodes.some((node) => node.id === from) || !nodes.some((node) => node.id === to)) continue;
      addEdge(edges, {
        id: `match:${row.match.id}:${graphEdge.id}`,
        from,
        to,
        relation: graphEdge.relation,
        weight: graphEdge.weight,
        detail: graphEdge.detail
      });
    }
  }

  if (worldModel) {
    addNode(nodes, {
      id: "world-model",
      kind: "world",
      status: worldModel.status === "blocked" ? "blocking" : worldModel.status === "observe-ready" ? "supporting" : "watch",
      label: "World model",
      detail: worldModel.summary,
      matchId: worldModel.topCell?.matchId ?? null,
      action: worldModel.topCell?.action ?? "hold",
      strength: clamp(100 - worldModel.totals.averagePressure),
      evidenceIds: unique([worldModel.worldHash, worldModel.topCell?.id]),
      source: "decisionWorldModel"
    });
    addEdge(edges, {
      id: "world-to-slate",
      from: "world-model",
      to: "slate-thinking",
      relation: "updates",
      weight: 0.72,
      detail: compact(worldModel.narrative.nextObservation)
    });
  }

  if (traceLedger?.target) {
    addNode(nodes, {
      id: "trace-ledger",
      kind: "trace",
      status: traceLedger.status === "blocked" ? "blocking" : traceLedger.status === "watching" ? "watch" : "supporting",
      label: "Trace ledger",
      detail: traceLedger.summary,
      matchId: traceLedger.target.matchId,
      action: traceLedger.target.action,
      strength: clamp(traceLedger.supportedClaims * 12 - traceLedger.blockedClaims * 18 + 45),
      evidenceIds: unique([traceLedger.traceId, traceLedger.inputHash, traceLedger.nextReplayStep?.id]),
      source: "decisionTraceLedger"
    });
    const targetMatchId = `match:${traceLedger.target.matchId}`;
    addEdge(edges, {
      id: "trace-to-target",
      from: "trace-ledger",
      to: nodes.some((node) => node.id === targetMatchId) ? targetMatchId : "slate-thinking",
      relation: "observes",
      weight: 0.78,
      detail: traceLedger.nextReplayStep?.expectedEvidence ?? "Trace ledger observes the selected decision target."
    });
  }

  if (cognitiveProof) {
    addNode(nodes, {
      id: "cognitive-proof",
      kind: "cognition",
      status: cognitiveProof.status === "blocked" ? "blocking" : cognitiveProof.status === "needs-provider" ? "watch" : "supporting",
      label: "AI cognitive proof",
      detail: cognitiveProof.summary,
      matchId: cognitiveProof.activeDecision.matchId,
      action: cognitiveProof.activeDecision.action as DecisionAction | "hold",
      strength: clamp(cognitiveProof.totals.pass * 14 - cognitiveProof.totals.blocked * 10 + 35),
      evidenceIds: unique([cognitiveProof.proofHash, cognitiveProof.nextMove.label, ...cognitiveProof.stages.map((stage) => stage.id).slice(0, 4)]),
      source: "decisionAICognitiveProof"
    });
    addEdge(edges, {
      id: "cognitive-to-slate",
      from: "cognitive-proof",
      to: "slate-thinking",
      relation: "observes",
      weight: 0.76,
      detail: cognitiveProof.nextMove.reason
    });
  }

  const status = graphStatus(nodes);
  const blockingPath = [objectiveId, ...nodes.filter((node) => node.status === "blocking" && node.id !== objectiveId).slice(0, 4).map((node) => node.id)];
  const unresolvedNodes = nodes.filter((node) => node.status === "watch").map((node) => node.id);
  const activePath = [
    objectiveId,
    "slate-thinking",
    traceLedger?.target && nodes.some((node) => node.id === `match:${traceLedger.target?.matchId}`) ? `match:${traceLedger.target.matchId}` : selectedRows[0] ? `match:${selectedRows[0].match.id}` : null,
    cognitiveProof ? "cognitive-proof" : null
  ].filter(Boolean) as string[];
  const nextThought = slateThinking.nextThought;
  const nextObservation = {
    label: nextThought ? `Inspect ${nextThought.match}` : "Inspect slate thinking",
    command: nextThought?.safeCommand ?? null,
    verifyUrl: nextThought?.verifyUrl ?? slateThinking.policy.verificationUrl,
    safeToRun: Boolean(nextThought?.safeCommand?.includes("curl.exe")),
    reason: nextThought?.nextEvidenceAction ?? "No slate thought is selected; inspect the graph and slate route first."
  };
  const graphHash = stableHash({
    date,
    sport,
    status,
    nodes: nodes.map((node) => [node.id, node.status, node.strength]),
    edges: edges.map((edge) => [edge.from, edge.to, edge.relation])
  });

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-evidence-graph",
    status,
    graphHash,
    summary:
      status === "blocked"
        ? `Decision evidence graph is blocked by ${nodes.filter((node) => node.status === "blocking").length} node(s); next observation is ${nextObservation.label}.`
        : status === "contested"
          ? `Decision evidence graph is contested by ${unresolvedNodes.length} watch node(s); next observation is ${nextObservation.label}.`
          : `Decision evidence graph is coherent across ${nodes.length} node(s); next observation is ${nextObservation.label}.`,
    activePath,
    blockingPath,
    unresolvedNodes,
    nodes,
    edges,
    totals: {
      nodes: nodes.length,
      edges: edges.length,
      supporting: nodes.filter((node) => node.status === "supporting").length,
      watch: nodes.filter((node) => node.status === "watch").length,
      blocking: nodes.filter((node) => node.status === "blocking").length,
      neutral: nodes.filter((node) => node.status === "neutral").length,
      matches: selectedRows.length,
      maxStrength: nodes.reduce((max, node) => Math.max(max, node.strength), 0)
    },
    nextObservation,
    controls: {
      canInspectReadOnly: true,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRaiseTrust: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique(
      [
        "/api/sports/decision/evidence-graph",
        "/api/sports/decision/slate-thinking",
        "/api/sports/decision/trace-ledger",
        "/api/sports/decision/world-model",
        "/api/sports/decision/ai-cognitive-proof",
        traceLedger?.nextReplayStep?.verifyUrl,
        worldModel?.proofUrls[0],
        cognitiveProof?.proofUrls[0]
      ],
      20
    ),
    locks: [
      "Evidence graph is read-only and cannot persist, publish, train, raise trust, or upgrade public action.",
      "Graph nodes summarize supplied deterministic evidence only; provider, outcome, and OpenAI evidence remain separately gated.",
      "Hidden chain-of-thought is not represented in graph nodes or edges."
    ]
  };
}
