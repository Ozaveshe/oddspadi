import type { DecisionActionSandbox } from "@/lib/sports/prediction/decisionActionSandbox";
import type { DecisionAICouncil } from "@/lib/sports/prediction/decisionAICouncil";
import type { DecisionAutopilot } from "@/lib/sports/prediction/decisionAutopilot";
import type { DecisionInvalidationMonitor } from "@/lib/sports/prediction/decisionInvalidationMonitor";
import type { DecisionLearningQueue } from "@/lib/sports/prediction/decisionLearningQueue";
import type { DecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { buildDecisionRunPayload } from "@/lib/sports/prediction/decisionPersistence";
import type { DecisionResearchAgent } from "@/lib/sports/prediction/decisionResearchAgent";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionTraceLedgerStatus = "ready" | "watching" | "blocked" | "no-target";
export type DecisionTraceNodeStatus = "pass" | "watch" | "block";
export type DecisionTraceNodeKind =
  | "input"
  | "model"
  | "market"
  | "data"
  | "governance"
  | "invalidation"
  | "research"
  | "council"
  | "autopilot"
  | "action"
  | "learning"
  | "persistence";

export type DecisionTraceNode = {
  id: string;
  kind: DecisionTraceNodeKind;
  status: DecisionTraceNodeStatus;
  claim: string;
  evidence: string;
  source: string;
  command: string | null;
  verifyUrl: string;
  missingEnv: string[];
};

export type DecisionTraceReplayStep = {
  id: string;
  label: string;
  command: string;
  verifyUrl: string;
  expectedEvidence: string;
  canReplay: boolean;
  blockedBy: string[];
};

export type DecisionTraceLedger = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionTraceLedgerStatus;
  traceId: string;
  inputHash: string | null;
  summary: string;
  target: {
    matchId: string;
    match: string;
    action: Prediction["decision"]["action"];
    verdict: Prediction["decision"]["verdict"];
    decisionScore: number;
    selection: string | null;
  } | null;
  nodes: DecisionTraceNode[];
  replaySteps: DecisionTraceReplayStep[];
  nextReplayStep: DecisionTraceReplayStep | null;
  supportedClaims: number;
  challengedClaims: number;
  blockedClaims: number;
  missingEnv: string[];
  persistence: {
    table: "op_decision_runs";
    payloadReady: boolean;
    inputHash: string | null;
    includesBrainTrace: boolean;
    requiresSupabase: boolean;
  };
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

function matchLabel(row: DecisionRow): string {
  return `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`;
}

function rowRank(row: DecisionRow): number {
  const bestPick = row.prediction.bestPick;
  return (
    row.prediction.decision.decisionScore +
    (row.prediction.decision.action === "consider" ? 180 : row.prediction.decision.action === "monitor" ? 90 : 0) +
    (bestPick.hasValue ? Math.max(0, bestPick.expectedValue) * 120 + Math.max(0, bestPick.edge) * 100 : 0) +
    row.match.dataQualityScore * 10
  );
}

function chooseTarget(rows: DecisionRow[], research: DecisionResearchAgent): DecisionRow | null {
  const researchMatchId = research.target?.matchId;
  if (researchMatchId) {
    const row = rows.find((item) => item.match.id === researchMatchId);
    if (row) return row;
  }
  return rows.slice().sort((a, b) => rowRank(b) - rowRank(a))[0] ?? null;
}

function commandIsReplaySafe(command: string): boolean {
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return false;
  if (!lower.includes("-x post") && !lower.includes("-xpost")) return true;
  return lower.includes("dryrun=1");
}

function traceStatus(nodes: DecisionTraceNode[]): DecisionTraceLedgerStatus {
  if (!nodes.length) return "no-target";
  if (nodes.some((node) => node.status === "block")) return "blocked";
  if (nodes.some((node) => node.status === "watch")) return "watching";
  return "ready";
}

function node(input: DecisionTraceNode): DecisionTraceNode {
  return input;
}

function buildNodes({
  row,
  governance,
  invalidation,
  research,
  council,
  autopilot,
  actionSandbox,
  learningQueue,
  inputHash
}: {
  row: DecisionRow;
  governance: DecisionModelGovernance;
  invalidation: DecisionInvalidationMonitor;
  research: DecisionResearchAgent;
  council: DecisionAICouncil;
  autopilot: DecisionAutopilot;
  actionSandbox: DecisionActionSandbox;
  learningQueue: DecisionLearningQueue;
  inputHash: string | null;
}): DecisionTraceNode[] {
  const decision = row.prediction.decision;
  const bestPick = row.prediction.bestPick;
  return [
    node({
      id: "input-snapshot",
      kind: "input",
      status: inputHash ? "pass" : "block",
      claim: "The fixture, market, model, and decision inputs have a replay hash.",
      evidence: inputHash ? `Persistence input hash is ${inputHash}.` : "No input hash could be produced.",
      source: "buildDecisionRunPayload",
      command: decisionCurlCommand(`/api/sports/decision/${encodeURIComponent(row.match.id)}`),
      verifyUrl: `/api/sports/decision/${encodeURIComponent(row.match.id)}`,
      missingEnv: []
    }),
    node({
      id: "model-belief",
      kind: "model",
      status: decision.beliefState.grade === "strong" ? "pass" : decision.beliefState.grade === "moderate" ? "watch" : "block",
      claim: "The model belief is explicit, bounded, and expires.",
      evidence: decision.beliefState.summary,
      source: "decision.beliefState",
      command: null,
      verifyUrl: `/api/sports/decision/${encodeURIComponent(row.match.id)}`,
      missingEnv: []
    }),
    node({
      id: "market-edge",
      kind: "market",
      status: decision.oddsIntelligence.status === "positive-ev" ? "pass" : decision.oddsIntelligence.status === "watchlist" ? "watch" : "block",
      claim: bestPick.hasValue ? `${bestPick.label} has model, no-vig, edge, and EV evidence.` : "No priced candidate passed value checks.",
      evidence: decision.oddsIntelligence.summary,
      source: "decision.oddsIntelligence",
      command: null,
      verifyUrl: `/api/sports/decision/${encodeURIComponent(row.match.id)}`,
      missingEnv: []
    }),
    node({
      id: "data-coverage",
      kind: "data",
      status: decision.dataCoverage.requiredBeforeTrust.length ? "block" : decision.dataCoverage.status === "provider-backed" ? "pass" : "watch",
      claim: "The decision records which data is provider-backed, computed, mock, stale, or missing.",
      evidence: decision.dataCoverage.summary,
      source: "decision.dataCoverage",
      command: research.nextResearchAction?.command ?? null,
      verifyUrl: research.nextResearchAction?.verifyUrl ?? "/api/sports/decision/data-intake",
      missingEnv: research.nextResearchAction?.missingEnv ?? []
    }),
    node({
      id: "governance-gate",
      kind: "governance",
      status: governance.status === "approved" ? "pass" : governance.status === "shadow" ? "watch" : "block",
      claim: "Learned guardrails are allowed only after corpus, targets, backtests, runtime, and drift checks pass.",
      evidence: governance.summary,
      source: "decisionModelGovernance",
      command: decisionCurlCommand("/api/sports/decision/model-governance"),
      verifyUrl: "/api/sports/decision/model-governance",
      missingEnv: governance.trainingCorpus.configured ? [] : ["SUPABASE_SERVICE_ROLE_KEY"]
    }),
    node({
      id: "invalidation-state",
      kind: "invalidation",
      status: invalidation.status === "clear" ? "pass" : invalidation.status === "watching" || invalidation.status === "urgent" ? "watch" : "block",
      claim: "Stale beliefs, market movement, live-state, and provider refresh needs are tracked before trust rises.",
      evidence: invalidation.summary,
      source: "decisionInvalidationMonitor",
      command: invalidation.nextJob?.command ?? null,
      verifyUrl: invalidation.nextJob?.verifyUrl ?? "/api/sports/decision/invalidation-monitor",
      missingEnv: invalidation.nextJob?.missingEnv ?? []
    }),
    node({
      id: "research-dossier",
      kind: "research",
      status: research.status === "ready" ? "pass" : research.status === "needs-data" ? "watch" : "block",
      claim: "The research agent produces a cited dossier with thesis, counter-thesis, evidence, contradictions, and open questions.",
      evidence: research.summary,
      source: "decisionResearchAgent",
      command: research.nextResearchAction?.command ?? null,
      verifyUrl: research.nextResearchAction?.verifyUrl ?? "/api/sports/decision/research-agent",
      missingEnv: research.nextResearchAction?.missingEnv ?? []
    }),
    node({
      id: "council-arbitration",
      kind: "council",
      status: council.status === "ready" ? "pass" : council.status === "needs-data" ? "watch" : "block",
      claim: `Council final action is ${council.finalAction}; AI may not upgrade it.`,
      evidence: council.summary,
      source: "decisionAICouncil",
      command: council.nextOperation.command,
      verifyUrl: council.nextOperation.verifyUrl,
      missingEnv: council.nextOperation.missingEnv
    }),
    node({
      id: "autopilot-gate",
      kind: "autopilot",
      status: autopilot.status === "ready" ? "pass" : autopilot.status === "waiting" || autopilot.status === "supervised" ? "watch" : "block",
      claim: "Autopilot selects one bounded next proof action and refuses unsafe publish/persist states.",
      evidence: autopilot.summary,
      source: "decisionAutopilot",
      command: autopilot.nextAction?.command ?? null,
      verifyUrl: autopilot.nextAction?.verifyUrl ?? "/api/sports/decision/autopilot",
      missingEnv: autopilot.nextAction?.missingEnv ?? []
    }),
    node({
      id: "action-sandbox",
      kind: "action",
      status: actionSandbox.status === "ready" ? "pass" : actionSandbox.status === "waiting" ? "watch" : "block",
      claim: "Execution is gated through read-only or dry-run commands before writes.",
      evidence: actionSandbox.safetyVerdict.reason,
      source: "decisionActionSandbox",
      command: actionSandbox.primaryCommand,
      verifyUrl: actionSandbox.postRunVerification.verifyUrl,
      missingEnv: actionSandbox.blockedBy
    }),
    node({
      id: "learning-loop",
      kind: "learning",
      status: learningQueue.status === "ready" ? "pass" : learningQueue.status === "waiting" ? "watch" : "block",
      claim: "Decision memory, outcomes, calibration, and backtests are represented as feedback-loop tasks.",
      evidence: learningQueue.summary,
      source: "decisionLearningQueue",
      command: learningQueue.nextTask?.command ?? null,
      verifyUrl: learningQueue.nextTask?.verifyUrl ?? "/api/sports/decision/learning-queue",
      missingEnv: learningQueue.nextTask?.missingEnv ?? []
    }),
    node({
      id: "persistence-payload",
      kind: "persistence",
      status: inputHash && decision.controlPolicy.persistAllowed ? "pass" : inputHash ? "watch" : "block",
      claim: "The decision can be converted into the op_decision_runs payload shape with model_snapshot and brain trace.",
      evidence: decision.controlPolicy.persistAllowed
        ? "Control policy allows persistence when Supabase is configured."
        : "Control policy or Supabase readiness prevents persistence right now.",
      source: "decisionPersistence.buildDecisionRunPayload",
      command: decisionCurlCommand(`/api/sports/decision/${encodeURIComponent(row.match.id)}?persist=1`),
      verifyUrl: "/api/sports/decision/memory",
      missingEnv: decision.controlPolicy.persistAllowed ? ["SUPABASE_SERVICE_ROLE_KEY"] : []
    })
  ];
}

function replayStep(input: Omit<DecisionTraceReplayStep, "canReplay" | "blockedBy"> & { missingEnv?: string[] }): DecisionTraceReplayStep {
  const blockedBy = input.missingEnv ?? [];
  return {
    id: input.id,
    label: input.label,
    command: input.command,
    verifyUrl: input.verifyUrl,
    expectedEvidence: input.expectedEvidence,
    blockedBy,
    canReplay: blockedBy.length === 0 && commandIsReplaySafe(input.command)
  };
}

function buildReplaySteps(nodes: DecisionTraceNode[]): DecisionTraceReplayStep[] {
  const steps = nodes
    .filter((node) => node.command)
    .map((node) =>
      replayStep({
        id: `replay-${node.id}`,
        label: node.claim,
        command: node.command as string,
        verifyUrl: node.verifyUrl,
        expectedEvidence: node.evidence,
        missingEnv: node.missingEnv
      })
    );
  return Array.from(new Map(steps.map((step) => [step.command, step])).values()).slice(0, 10);
}

export function buildDecisionTraceLedger({
  rows,
  date,
  sport,
  governance,
  invalidationMonitor,
  researchAgent,
  aiCouncil,
  autopilot,
  actionSandbox,
  learningQueue
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  governance: DecisionModelGovernance;
  invalidationMonitor: DecisionInvalidationMonitor;
  researchAgent: DecisionResearchAgent;
  aiCouncil: DecisionAICouncil;
  autopilot: DecisionAutopilot;
  actionSandbox: DecisionActionSandbox;
  learningQueue: DecisionLearningQueue;
}): DecisionTraceLedger {
  const row = chooseTarget(rows, researchAgent);
  if (!row) {
    return {
      generatedAt: new Date().toISOString(),
      date,
      sport,
      status: "no-target",
      traceId: stableHash({ date, sport, reason: "no-target" }),
      inputHash: null,
      summary: "Trace ledger has no target match to replay.",
      target: null,
      nodes: [],
      replaySteps: [],
      nextReplayStep: null,
      supportedClaims: 0,
      challengedClaims: 0,
      blockedClaims: 0,
      missingEnv: [],
      persistence: {
        table: "op_decision_runs",
        payloadReady: false,
        inputHash: null,
        includesBrainTrace: false,
        requiresSupabase: true
      }
    };
  }

  const payload = buildDecisionRunPayload({ match: row.match, prediction: row.prediction });
  const inputHash = typeof payload.input_hash === "string" ? payload.input_hash : null;
  const nodes = buildNodes({
    row,
    governance,
    invalidation: invalidationMonitor,
    research: researchAgent,
    council: aiCouncil,
    autopilot,
    actionSandbox,
    learningQueue,
    inputHash
  });
  const replaySteps = buildReplaySteps(nodes);
  const nextReplayStep = replaySteps.find((step) => step.canReplay) ?? replaySteps[0] ?? null;
  const status = traceStatus(nodes);
  const missingEnv = Array.from(new Set(nodes.flatMap((nodeItem) => nodeItem.missingEnv))).filter(Boolean);
  const modelSnapshot = payload.model_snapshot;
  const includesBrainTrace = typeof modelSnapshot === "object" && modelSnapshot !== null && "brain" in modelSnapshot;

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    traceId: stableHash({ date, sport, matchId: row.match.id, inputHash, nodes: nodes.map((item) => [item.id, item.status]) }),
    inputHash,
    summary:
      status === "ready"
        ? `Trace ledger is replayable for ${matchLabel(row)} with ${nodes.length} passing audit node(s).`
        : status === "watching"
          ? `Trace ledger is watching ${nodes.filter((item) => item.status === "watch").length} audit node(s) for ${matchLabel(row)}.`
          : `Trace ledger is blocked on ${nodes.filter((item) => item.status === "block").length} audit node(s) for ${matchLabel(row)}.`,
    target: {
      matchId: row.match.id,
      match: matchLabel(row),
      action: row.prediction.decision.action,
      verdict: row.prediction.decision.verdict,
      decisionScore: row.prediction.decision.decisionScore,
      selection: row.prediction.bestPick.hasValue ? row.prediction.bestPick.label : row.prediction.decision.recommendedSelection
    },
    nodes,
    replaySteps,
    nextReplayStep,
    supportedClaims: nodes.filter((nodeItem) => nodeItem.status === "pass").length,
    challengedClaims: nodes.filter((nodeItem) => nodeItem.status === "watch").length,
    blockedClaims: nodes.filter((nodeItem) => nodeItem.status === "block").length,
    missingEnv,
    persistence: {
      table: "op_decision_runs",
      payloadReady: Boolean(inputHash),
      inputHash,
      includesBrainTrace,
      requiresSupabase: true
    }
  };
}
