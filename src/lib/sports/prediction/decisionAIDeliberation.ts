import type { DecisionAISession, DecisionAISessionTraceStatus } from "@/lib/sports/prediction/decisionAISession";
import type {
  DecisionAISessionShadowEvaluation,
  DecisionAISessionShadowEvaluationGate,
  DecisionAISessionShadowEvaluationGateStatus
} from "@/lib/sports/prediction/decisionAISessionShadowEvaluation";
import type { DecisionAction, Sport } from "@/lib/sports/types";

export type DecisionAIDeliberationStatus = "ready-shadow" | "needs-proof" | "blocked";
export type DecisionAIDeliberationItemStatus = "pass" | "watch" | "block";
export type DecisionAIDeliberationRole =
  | "model-chair"
  | "market-skeptic"
  | "data-steward"
  | "safety-reviewer"
  | "learning-analyst"
  | "operator";

export type DecisionAIDeliberationPanel = {
  id: string;
  role: DecisionAIDeliberationRole;
  label: string;
  status: DecisionAIDeliberationItemStatus;
  position: DecisionAction;
  finding: string;
  evidence: string[];
  wouldChangeIf: string;
};

export type DecisionAIDeliberationHypothesis = {
  id: string;
  label: string;
  status: DecisionAIDeliberationItemStatus;
  score: number;
  thesis: string;
  supports: string[];
  challenges: string[];
  falsifier: string;
  nextProof: string;
};

export type DecisionAIDeliberationQuestion = {
  id: string;
  question: string;
  answer: string;
  status: DecisionAIDeliberationItemStatus;
  evidence: string[];
};

export type DecisionAIDeliberation = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-deliberation";
  status: DecisionAIDeliberationStatus;
  deliberationHash: string;
  summary: string;
  activeDecision: {
    matchId: string | null;
    match: string | null;
    action: DecisionAction;
    publicPosture: DecisionAISession["activeDecision"]["publicPosture"];
    trustCeiling: DecisionAISession["metareasoning"]["trustCeiling"];
    reviewStatus: DecisionAISession["latestRun"]["status"];
  };
  scorecard: {
    panelPasses: number;
    panelWatches: number;
    panelBlocks: number;
    hypothesisPasses: number;
    hypothesisWatches: number;
    hypothesisBlocks: number;
    evidenceItems: number;
    learningReadinessScore: number;
    evidenceDebt: number;
    contradictionCount: number;
  };
  thesis: string;
  counterThesis: string;
  panel: DecisionAIDeliberationPanel[];
  hypotheses: DecisionAIDeliberationHypothesis[];
  decisionQuestions: DecisionAIDeliberationQuestion[];
  finalResolution: {
    stance: "consider-shadow" | "monitor-shadow" | "avoid";
    publicAnswer: string;
    confidenceCeiling: DecisionAISession["metareasoning"]["trustCeiling"];
    reason: string;
    canShowAsPick: false;
    canPublish: false;
    canTrain: false;
  };
  nextProof: {
    label: string;
    command: string | null;
    verifyUrl: string;
    expectedEvidence: string;
    safeToRun: boolean;
  };
  controls: {
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canUpgradePublicAction: false;
    canUseHiddenChainOfThought: false;
  };
  proofUrls: string[];
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

function compact(value: string, maxLength = 360): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

function statusScore(status: DecisionAIDeliberationItemStatus): number {
  if (status === "pass") return 100;
  if (status === "watch") return 56;
  return 14;
}

function gateToStatus(status: DecisionAISessionShadowEvaluationGateStatus): DecisionAIDeliberationItemStatus {
  if (status === "pass") return "pass";
  if (status === "watch") return "watch";
  return "block";
}

function traceToStatus(status: DecisionAISessionTraceStatus | undefined): DecisionAIDeliberationItemStatus {
  if (status === "pass") return "pass";
  if (status === "watch") return "watch";
  return "block";
}

function statusFromScore(score: number): DecisionAIDeliberationItemStatus {
  if (score >= 72) return "pass";
  if (score >= 38) return "watch";
  return "block";
}

function actionRank(action: DecisionAction): number {
  if (action === "consider") return 2;
  if (action === "monitor") return 1;
  return 0;
}

function safestAction(actions: DecisionAction[]): DecisionAction {
  return actions.reduce((lowest, action) => (actionRank(action) < actionRank(lowest) ? action : lowest), "consider" as DecisionAction);
}

function panelPosition(status: DecisionAIDeliberationItemStatus, fallback: DecisionAction): DecisionAction {
  if (status === "block") return "avoid";
  if (status === "watch") return "monitor";
  return fallback;
}

function trace(session: DecisionAISession, phase: DecisionAISession["trace"][number]["phase"]) {
  return session.trace.find((item) => item.phase === phase) ?? null;
}

function gate(evaluation: DecisionAISessionShadowEvaluation, id: DecisionAISessionShadowEvaluationGate["id"]) {
  return evaluation.gates.find((item) => item.id === id) ?? null;
}

function isSafeReadOnlyCommand(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  return (
    lower.includes("curl.exe") &&
    !lower.includes("-x post") &&
    !lower.includes("-xpost") &&
    !lower.includes("--request post") &&
    !lower.includes("persist=1") &&
    !lower.includes("publish=1") &&
    !lower.includes("dryrun=0")
  );
}

function panelItem(input: DecisionAIDeliberationPanel): DecisionAIDeliberationPanel {
  return {
    ...input,
    finding: compact(input.finding, 420),
    evidence: unique(input.evidence, 8),
    wouldChangeIf: compact(input.wouldChangeIf, 260)
  };
}

function buildPanel(session: DecisionAISession, evaluation: DecisionAISessionShadowEvaluation): DecisionAIDeliberationPanel[] {
  const modelTrace = trace(session, "model");
  const marketTrace = trace(session, "market");
  const dataTrace = trace(session, "data");
  const reviewGate = gate(evaluation, "session-review");
  const learningGate = gate(evaluation, "learning-permission");
  const reviewStatus = gateToStatus(reviewGate?.status ?? "block");
  const learningStatus = gateToStatus(learningGate?.status ?? "block");
  const safetyStatus: DecisionAIDeliberationItemStatus =
    session.metareasoning.trustCeiling === "none" || session.activeDecision.sessionAction === "avoid"
      ? "block"
      : session.metareasoning.trustCeiling === "candidate"
        ? "pass"
        : "watch";

  return [
    panelItem({
      id: "model-chair",
      role: "model-chair",
      label: "Model chair",
      status: traceToStatus(modelTrace?.status),
      position: panelPosition(traceToStatus(modelTrace?.status), session.activeDecision.sessionAction),
      finding: modelTrace?.finding ?? "No model trace is available for this session.",
      evidence: modelTrace?.evidence ?? ["model-belief"],
      wouldChangeIf: "A fresh model run changes the posterior probability, scoreline projection, or confidence boundary."
    }),
    panelItem({
      id: "market-skeptic",
      role: "market-skeptic",
      label: "Market skeptic",
      status: traceToStatus(marketTrace?.status),
      position: panelPosition(traceToStatus(marketTrace?.status), session.activeDecision.sessionAction),
      finding: marketTrace?.finding ?? "No market trace is available for this session.",
      evidence: marketTrace?.evidence ?? ["market-edge"],
      wouldChangeIf: "A real odds refresh confirms closing-line value and positive no-vig edge after margin removal."
    }),
    panelItem({
      id: "data-steward",
      role: "data-steward",
      label: "Data steward",
      status: traceToStatus(dataTrace?.status),
      position: panelPosition(traceToStatus(dataTrace?.status), session.activeDecision.sessionAction),
      finding: dataTrace?.finding ?? "No data trace is available for this session.",
      evidence: dataTrace?.evidence ?? ["data-gates"],
      wouldChangeIf: "Provider-backed fixtures, lineups, injuries, live state, odds, and news replace mock or missing signals."
    }),
    panelItem({
      id: "safety-reviewer",
      role: "safety-reviewer",
      label: "Safety reviewer",
      status: safetyStatus,
      position: panelPosition(safetyStatus, session.activeDecision.sessionAction),
      finding: session.metareasoning.summary,
      evidence: ["metareasoning", "controls", `thought-${session.metareasoning.thoughtTrace[0]?.id ?? "trust-ceiling"}`],
      wouldChangeIf: session.metareasoning.requiredEvidence[0] ?? "Authority, proof, and governance gates clear without raising public risk."
    }),
    panelItem({
      id: "reviewer",
      role: "operator",
      label: "Session reviewer",
      status: reviewStatus,
      position: panelPosition(reviewStatus, session.activeDecision.sessionAction),
      finding: reviewGate?.reason ?? session.latestRun.reason ?? "The top-level session review has not returned reviewed evidence.",
      evidence: ["session-review", "ai-decision-session", session.latestRun.status],
      wouldChangeIf: "The configured AI session reviewer returns a schema-valid review that cites only supplied evidence IDs."
    }),
    panelItem({
      id: "learning-analyst",
      role: "learning-analyst",
      label: "Learning analyst",
      status: learningStatus,
      position: panelPosition(learningStatus, "monitor"),
      finding: learningGate?.reason ?? evaluation.summary,
      evidence: ["ai-session-evaluation", "learning-queue", "calibration", "training"],
      wouldChangeIf: "A pending outcome, calibration sample, real backtest, and real corpus proof clear the learning gates."
    })
  ];
}

function hypothesisScore(statuses: DecisionAIDeliberationItemStatus[], modifier = 0): number {
  const base = statuses.length ? statuses.reduce((sum, status) => sum + statusScore(status), 0) / statuses.length : 0;
  return round(clamp(base + modifier, 0, 100));
}

function hypothesis(
  input: Omit<DecisionAIDeliberationHypothesis, "status" | "score" | "supports" | "challenges"> & {
    supports: Array<string | null | undefined>;
    challenges: Array<string | null | undefined>;
    statuses: DecisionAIDeliberationItemStatus[];
    modifier?: number;
  }
): DecisionAIDeliberationHypothesis {
  const score = hypothesisScore(input.statuses, input.modifier);
  return {
    id: input.id,
    label: input.label,
    status: statusFromScore(score),
    score,
    thesis: compact(input.thesis, 420),
    supports: unique(input.supports, 6),
    challenges: unique(input.challenges, 6),
    falsifier: compact(input.falsifier, 260),
    nextProof: compact(input.nextProof, 260)
  };
}

function buildHypotheses(
  session: DecisionAISession,
  evaluation: DecisionAISessionShadowEvaluation,
  panel: DecisionAIDeliberationPanel[]
): DecisionAIDeliberationHypothesis[] {
  const modelPanel = panel.find((item) => item.id === "model-chair")?.status ?? "block";
  const marketPanel = panel.find((item) => item.id === "market-skeptic")?.status ?? "block";
  const dataPanel = panel.find((item) => item.id === "data-steward")?.status ?? "block";
  const safetyPanel = panel.find((item) => item.id === "safety-reviewer")?.status ?? "block";
  const reviewPanel = panel.find((item) => item.id === "reviewer")?.status ?? "block";
  const learningPanel = panel.find((item) => item.id === "learning-analyst")?.status ?? "block";
  const marketEvidence = session.evidencePacket.find((item) => item.id === "trace-market-edge");
  const dataEvidence = session.evidencePacket.find((item) => item.id === "trace-data-gates");

  return [
    hypothesis({
      id: "value-thesis",
      label: "The active selection is real value",
      statuses: [modelPanel, marketPanel, dataPanel],
      modifier: session.activeDecision.sessionAction === "avoid" ? -10 : 0,
      thesis: marketEvidence?.detail ?? "The active selection needs model, market, and data evidence before it can be treated as value.",
      supports: [trace(session, "model")?.finding, trace(session, "market")?.finding],
      challenges: [dataEvidence?.detail, session.metareasoning.strongestObjection],
      falsifier: "The edge disappears after a fresh no-vig odds refresh, lineup/news update, or data-quality correction.",
      nextProof: dataPanel === "block" ? "Run the next data-intake proof before trusting the value thesis." : "Refresh market odds and compare model probability to no-vig implied probability again."
    }),
    hypothesis({
      id: "review-thesis",
      label: "The AI reviewer can safely critique the session",
      statuses: [reviewPanel, safetyPanel],
      thesis:
        session.latestRun.status === "reviewed"
          ? "A schema-valid session review exists and can critique the public evidence packet."
          : "The top-level reviewer is wired, but it has not produced a live reviewed session yet.",
      supports: [session.requestPreview.text.format.name, session.latestRun.status],
      challenges: [session.latestRun.reason, session.openAiConfigured ? null : "OPENAI_API_KEY is not configured."],
      falsifier: "The reviewer invents unsupported evidence IDs, recommends an upgrade, or asks to persist, publish, or train.",
      nextProof: `Inspect /api/sports/decision/ai-decision-session?date=${session.date}&sport=${session.sport}&run=1`
    }),
    hypothesis({
      id: "learning-thesis",
      label: "The session can be graded later",
      statuses: [learningPanel, gateToStatus(gate(evaluation, "outcome-ticket")?.status ?? "block"), gateToStatus(gate(evaluation, "calibration")?.status ?? "block")],
      modifier: evaluation.scorecard.learningReadinessScore >= 75 ? 10 : -8,
      thesis:
        evaluation.status === "ready-shadow"
          ? "The session can be observed as a shadow candidate for future grading."
          : "The session cannot be learned from yet because outcomes, calibration, or training evidence is missing.",
      supports: [`Learning readiness ${evaluation.scorecard.learningReadinessScore}/100`, `${evaluation.scorecard.outcomesTracked} outcome record(s)`],
      challenges: evaluation.gates.filter((item) => item.status === "block").map((item) => `${item.label}: ${item.reason}`),
      falsifier: "No pending/settled outcome, closing odds, calibration row, or real backtest exists for the session.",
      nextProof: evaluation.nextEvaluationTask?.expectedEvidence ?? "Open a pending outcome ticket after write gates and operator approval exist."
    }),
    hypothesis({
      id: "public-action-thesis",
      label: "The public action can rise above avoid",
      statuses: [safetyPanel, session.activeDecision.sessionAction === "avoid" ? "block" : "watch"],
      thesis:
        session.activeDecision.sessionAction === "avoid"
          ? "The current public answer must stay avoid because the session action is avoid."
          : "The public answer can remain no stronger than the current authorized session action.",
      supports: [session.activeDecision.reason, session.metareasoning.summary],
      challenges: [session.metareasoning.strongestObjection, ...session.blockers.slice(0, 3)],
      falsifier: "Authority remains blocked, trust ceiling remains none, or any proof gate still blocks.",
      nextProof: session.nextSafeAction
    })
  ];
}

function buildQuestions(session: DecisionAISession, evaluation: DecisionAISessionShadowEvaluation): DecisionAIDeliberationQuestion[] {
  const blockingGate = evaluation.gates.find((item) => item.status === "block");
  return [
    {
      id: "should-act",
      question: "Should the engine act on this selection now?",
      answer:
        session.activeDecision.sessionAction === "avoid"
          ? "No. The safe session action is avoid until proof gates clear."
          : `Only in ${session.activeDecision.sessionAction} shadow mode; no persistence, publishing, or training is allowed.`,
      status: session.activeDecision.sessionAction === "avoid" ? "block" : "watch",
      evidence: ["active-decision", "authority", "metareasoning"]
    },
    {
      id: "what-is-missing",
      question: "What evidence is missing?",
      answer: blockingGate ? `${blockingGate.label}: ${blockingGate.reason}` : session.metareasoning.requiredEvidence[0] ?? "No blocking evidence gap was reported.",
      status: blockingGate ? "block" : "watch",
      evidence: unique([blockingGate?.id, "ai-session-evaluation", "metareasoning"], 5)
    },
    {
      id: "can-ai-change-action",
      question: "Can AI text change the public action?",
      answer: "No. AI review can agree, downgrade, request evidence, or block; it cannot publish, persist, train, or upgrade the public action.",
      status: "pass",
      evidence: ["controls", "requestPreview", "noPublicActionUpgrade"]
    },
    {
      id: "can-learn",
      question: "Can this session train the model?",
      answer: evaluation.controls.canTrain
        ? "No. This evaluator still keeps training locked even when shadow readiness improves."
        : "No. Training and learned guardrails remain locked until outcome, calibration, backtest, corpus, and operator gates clear.",
      status: "block",
      evidence: ["learning-permission", "calibration", "training"]
    }
  ];
}

function counts(items: Array<{ status: DecisionAIDeliberationItemStatus }>) {
  return {
    passes: items.filter((item) => item.status === "pass").length,
    watches: items.filter((item) => item.status === "watch").length,
    blocks: items.filter((item) => item.status === "block").length
  };
}

function overallStatus(
  session: DecisionAISession,
  evaluation: DecisionAISessionShadowEvaluation,
  panel: DecisionAIDeliberationPanel[],
  hypotheses: DecisionAIDeliberationHypothesis[]
): DecisionAIDeliberationStatus {
  if (
    session.activeDecision.sessionAction === "avoid" ||
    evaluation.status === "blocked" ||
    panel.some((item) => item.status === "block") ||
    hypotheses.some((item) => item.status === "block")
  ) {
    return "blocked";
  }
  if (evaluation.status === "waiting" || panel.some((item) => item.status === "watch") || hypotheses.some((item) => item.status === "watch")) return "needs-proof";
  return "ready-shadow";
}

function finalResolution(
  status: DecisionAIDeliberationStatus,
  session: DecisionAISession,
  panel: DecisionAIDeliberationPanel[],
  hypotheses: DecisionAIDeliberationHypothesis[]
): DecisionAIDeliberation["finalResolution"] {
  const panelAction = safestAction(panel.map((item) => item.position));
  const stance =
    status === "ready-shadow" && panelAction === "consider"
      ? "consider-shadow"
      : status === "blocked" || session.activeDecision.sessionAction === "avoid"
        ? "avoid"
        : "monitor-shadow";
  const firstBlock = [...panel, ...hypotheses].find((item) => item.status === "block");
  return {
    stance,
    publicAnswer:
      stance === "consider-shadow"
        ? "The session can be inspected as a shadow candidate, but it still cannot publish or train."
        : stance === "monitor-shadow"
          ? "The session can stay under observation while missing proof is collected."
          : "Avoid a public recommendation for this session until proof, data, review, and learning gates clear.",
    confidenceCeiling: session.metareasoning.trustCeiling,
    reason: firstBlock?.label ? `${firstBlock.label}: ${"finding" in firstBlock ? firstBlock.finding : firstBlock.thesis}` : session.metareasoning.summary,
    canShowAsPick: false,
    canPublish: false,
    canTrain: false
  };
}

function nextProof(session: DecisionAISession, evaluation: DecisionAISessionShadowEvaluation): DecisionAIDeliberation["nextProof"] {
  if (evaluation.nextEvaluationTask) {
    return {
      label: evaluation.nextEvaluationTask.title,
      command: evaluation.nextEvaluationTask.command,
      verifyUrl: evaluation.nextEvaluationTask.verifyUrl,
      expectedEvidence: evaluation.nextEvaluationTask.expectedEvidence,
      safeToRun: isSafeReadOnlyCommand(evaluation.nextEvaluationTask.command)
    };
  }

  return {
    label: "Inspect AI decision session",
    command: session.nextSafeAction,
    verifyUrl: "/api/sports/decision/ai-decision-session",
    expectedEvidence: "A session response with public trace, metareasoning, no-write controls, and a stable session hash.",
    safeToRun: isSafeReadOnlyCommand(session.nextSafeAction)
  };
}

function summaryFor(status: DecisionAIDeliberationStatus, session: DecisionAISession): string {
  const target = session.activeDecision.match ?? "the active slate";
  if (status === "ready-shadow") return `AI deliberation can keep ${target} as a read-only shadow candidate.`;
  if (status === "needs-proof") return `AI deliberation needs more proof before ${target} can move beyond shadow review.`;
  return `AI deliberation blocks ${target}; the public answer remains avoid until evidence improves.`;
}

export function buildDecisionAIDeliberation({
  session,
  evaluation,
  now = new Date()
}: {
  session: DecisionAISession;
  evaluation: DecisionAISessionShadowEvaluation;
  now?: Date;
}): DecisionAIDeliberation {
  const panel = buildPanel(session, evaluation);
  const hypotheses = buildHypotheses(session, evaluation, panel);
  const decisionQuestions = buildQuestions(session, evaluation);
  const status = overallStatus(session, evaluation, panel, hypotheses);
  const panelCounts = counts(panel);
  const hypothesisCounts = counts(hypotheses);
  const next = nextProof(session, evaluation);
  const deliberationHash = stableHash({
    session: session.sessionHash,
    evaluation: evaluation.evaluationHash,
    status,
    panel: panel.map((item) => [item.id, item.status, item.position]),
    hypotheses: hypotheses.map((item) => [item.id, item.status, item.score]),
    next: [next.label, next.verifyUrl]
  });

  return {
    generatedAt: now.toISOString(),
    date: session.date,
    sport: session.sport,
    mode: "ai-deliberation",
    status,
    deliberationHash,
    summary: summaryFor(status, session),
    activeDecision: {
      matchId: session.activeDecision.matchId,
      match: session.activeDecision.match,
      action: session.activeDecision.sessionAction,
      publicPosture: session.activeDecision.publicPosture,
      trustCeiling: session.metareasoning.trustCeiling,
      reviewStatus: session.latestRun.status
    },
    scorecard: {
      panelPasses: panelCounts.passes,
      panelWatches: panelCounts.watches,
      panelBlocks: panelCounts.blocks,
      hypothesisPasses: hypothesisCounts.passes,
      hypothesisWatches: hypothesisCounts.watches,
      hypothesisBlocks: hypothesisCounts.blocks,
      evidenceItems: session.evidencePacket.length,
      learningReadinessScore: evaluation.scorecard.learningReadinessScore,
      evidenceDebt: session.metareasoning.evidenceDebt,
      contradictionCount: session.metareasoning.contradictionCount
    },
    thesis: compact(trace(session, "market")?.finding ?? session.activeDecision.reason, 420),
    counterThesis: compact(session.metareasoning.strongestObjection, 420),
    panel,
    hypotheses,
    decisionQuestions,
    finalResolution: finalResolution(status, session, panel, hypotheses),
    nextProof: next,
    controls: {
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique(
      [
        "/api/sports/decision/ai-deliberation",
        "/api/sports/decision/ai-decision-session",
        "/api/sports/decision/ai-session-evaluation",
        ...session.proofUrls,
        ...evaluation.proofUrls
      ],
      20
    )
  };
}
