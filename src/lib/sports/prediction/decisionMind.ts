import type { DecisionActivationRunbook } from "@/lib/sports/prediction/decisionActivationRunbook";
import type { DecisionAIFirewall } from "@/lib/sports/prediction/decisionAIFirewall";
import type { DecisionAIHandoffPacket } from "@/lib/sports/prediction/decisionAIHandoff";
import type { DecisionAIOrchestrator } from "@/lib/sports/prediction/decisionAIOrchestrator";
import type { DecisionAuthority } from "@/lib/sports/prediction/decisionAuthority";
import type { DecisionBrain, DecisionBrainSlate } from "@/lib/sports/prediction/decisionBrain";
import type { DecisionMetacognition } from "@/lib/sports/prediction/decisionMetacognition";
import type { DecisionResearchAgent } from "@/lib/sports/prediction/decisionResearchAgent";
import type { ConfidenceLevel, DecisionAction, Match, Prediction, RiskLevel, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionMindStatus = "thinking" | "waiting-for-evidence" | "blocked" | "review-ready";
export type DecisionMindMode = "active-decision-mind";
export type DecisionMindThoughtStatus = "supports" | "questions" | "blocks" | "needs-evidence";

export type DecisionMindThought = {
  id: string;
  label: string;
  status: DecisionMindThoughtStatus;
  claim: string;
  evidence: string[];
  uncertainty: string;
  nextCheck: string;
  source: string;
};

export type DecisionMindTraceStatus = "supportive" | "contested" | "unproven" | "blocked";

export type DecisionMindConfidenceBudgetItem = {
  id: string;
  label: string;
  status: "adds-confidence" | "subtracts-confidence" | "neutral";
  score: number;
  weight: number;
  weightedScore: number;
  detail: string;
};

export type DecisionMindThinkingTrace = {
  status: DecisionMindTraceStatus;
  thesis: string;
  counterThesis: string;
  synthesis: string;
  beliefPressure: {
    supporting: number;
    questioning: number;
    needsEvidence: number;
    blocking: number;
    netScore: number;
  };
  confidenceBudget: {
    score: number;
    grade: "high" | "medium" | "low";
    items: DecisionMindConfidenceBudgetItem[];
  };
  falsifiers: string[];
  evidenceGaps: string[];
  nextEvidenceAction: string;
  auditTrail: Array<{
    step: string;
    outcome: DecisionMindThoughtStatus;
    evidence: string[];
  }>;
};

export type DecisionMindNextSafeAction = {
  label: string;
  command: string;
  verifyUrl: string | null;
  reason: string;
  safeToRun: true;
};

export type DecisionMind = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMindStatus;
  mode: DecisionMindMode;
  mindHash: string;
  summary: string;
  activeDecision: {
    matchId: string | null;
    match: string | null;
    league: string | null;
    kickoffTime: string | null;
    selection: string | null;
    baselineAction: DecisionAction | null;
    revisedAction: DecisionAction | null;
    authorizedAction: DecisionAction;
    publicPosture: DecisionAuthority["activeDecision"]["publicPosture"];
    source: DecisionAuthority["activeDecision"]["source"];
    confidence: ConfidenceLevel;
    risk: RiskLevel;
    decisionScore: number | null;
    valueEdge: number | null;
    expectedValue: number | null;
    dataQualityScore: number | null;
    reason: string;
  };
  belief: {
    summary: string;
    grade: string | null;
    modelProbability: number | null;
    marketProbability: number | null;
    believedProbability: number | null;
    probabilityEdge: number | null;
    expectedValue: number | null;
    confidenceInterval: {
      low: number | null;
      high: number | null;
    };
    marketMovement: string;
    oddsIntelligence: string;
    authoritySummary: string;
  };
  doubts: string[];
  thoughts: DecisionMindThought[];
  thinkingTrace: DecisionMindThinkingTrace;
  changeMyMind: string[];
  aiState: {
    orchestratorStatus: DecisionAIOrchestrator["status"];
    handoffStatus: DecisionAIHandoffPacket["status"];
    firewallStatus: DecisionAIFirewall["status"];
    authorityStatus: DecisionAuthority["status"];
    activationStatus: DecisionActivationRunbook["status"];
    openAiConfigured: boolean;
    canAskOpenAI: boolean;
    reviewCommand: string | null;
    blockedBy: string[];
  };
  nextSafeAction: DecisionMindNextSafeAction | null;
  locks: {
    canPromote: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    reasons: string[];
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

function compact(value: string, max = 260): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))).slice(0, limit);
}

function matchLabel(row: DecisionRow): string {
  return `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`;
}

function findBrain(brains: DecisionBrain[], matchId: string | null): DecisionBrain | null {
  if (!matchId) return brains[0] ?? null;
  return brains.find((brain) => brain.matchId === matchId) ?? brains[0] ?? null;
}

function rowScore(row: DecisionRow): number {
  const bestPick = row.prediction.bestPick;
  return (
    row.prediction.decision.decisionScore +
    (row.prediction.decision.action === "consider" ? 120 : row.prediction.decision.action === "monitor" ? 60 : 0) +
    (bestPick.hasValue ? Math.max(0, bestPick.edge) * 100 + Math.max(0, bestPick.expectedValue) * 100 : 0)
  );
}

function activeRow({
  rows,
  authority,
  brainSlate,
  metacognition,
  researchAgent
}: {
  rows: DecisionRow[];
  authority: DecisionAuthority;
  brainSlate: DecisionBrainSlate;
  metacognition: DecisionMetacognition;
  researchAgent: DecisionResearchAgent;
}): DecisionRow | null {
  const targetIds = unique([
    authority.activeDecision.matchId,
    metacognition.activeBelief?.matchId,
    brainSlate.topBrains[0]?.matchId,
    researchAgent.target?.matchId
  ]);
  for (const id of targetIds) {
    const row = rows.find((item) => item.match.id === id);
    if (row) return row;
  }
  return rows.slice().sort((a, b) => rowScore(b) - rowScore(a))[0] ?? null;
}

function thought(input: DecisionMindThought): DecisionMindThought {
  return {
    ...input,
    claim: compact(input.claim),
    evidence: unique(input.evidence, 7),
    uncertainty: compact(input.uncertainty, 180),
    nextCheck: compact(input.nextCheck, 180)
  };
}

function thoughtStatusForGate(status: "pass" | "watch" | "block"): DecisionMindThoughtStatus {
  if (status === "block") return "blocks";
  if (status === "watch") return "questions";
  return "supports";
}

function firewallThoughtStatus(firewall: DecisionAIFirewall): DecisionMindThoughtStatus {
  if (firewall.status === "blocked" || firewall.status === "quarantined") return "blocks";
  if (firewall.status === "pending-review") return "needs-evidence";
  return "supports";
}

function authorityThoughtStatus(authority: DecisionAuthority): DecisionMindThoughtStatus {
  if (authority.status === "blocked") return "blocks";
  if (authority.status === "supervised") return "questions";
  return "supports";
}

function activationThoughtStatus(runbook: DecisionActivationRunbook): DecisionMindThoughtStatus {
  if (runbook.status === "blocked" || runbook.counts.blocked > 0) return "blocks";
  if (runbook.status === "ready-to-run") return "supports";
  return "needs-evidence";
}

function historicalDisciplineThoughtStatus(trustEffect: string | undefined): DecisionMindThoughtStatus {
  if (trustEffect === "cap-raw-edge" || trustEffect === "block") return "blocks";
  if (trustEffect === "queue-provider-retest" || !trustEffect || trustEffect === "none") return "needs-evidence";
  if (trustEffect === "diagnostic-context") return "questions";
  return "supports";
}

function traceStatusFromPressure(pressure: DecisionMindThinkingTrace["beliefPressure"]): DecisionMindTraceStatus {
  if (pressure.blocking > 0) return "blocked";
  if (pressure.needsEvidence > 0) return "unproven";
  if (pressure.questioning > pressure.supporting || pressure.netScore < 0) return "contested";
  return "supportive";
}

function boundConfidenceScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function confidenceBudgetItem(input: Omit<DecisionMindConfidenceBudgetItem, "score" | "weightedScore"> & { score: number }): DecisionMindConfidenceBudgetItem {
  const score = boundConfidenceScore(input.score);
  return {
    ...input,
    score,
    weightedScore: Math.round(score * input.weight)
  };
}

function confidenceGrade(score: number): DecisionMindThinkingTrace["confidenceBudget"]["grade"] {
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function dataQualityScore(value: number | null): number {
  return value == null ? 35 : value * 100;
}

function valueScore(valueEdge: number | null, expectedValue: number | null): number {
  if (valueEdge == null && expectedValue == null) return 35;
  const edge = valueEdge == null ? 0 : Math.max(-0.08, Math.min(0.12, valueEdge));
  const ev = expectedValue == null ? 0 : Math.max(-0.12, Math.min(0.18, expectedValue));
  return 45 + edge * 250 + ev * 180;
}

function thoughtConfidenceScore(thoughts: DecisionMindThought[]): number {
  if (!thoughts.length) return 35;
  const total = thoughts.reduce((sum, item) => {
    if (item.status === "supports") return sum + 1;
    if (item.status === "questions") return sum + 0.45;
    if (item.status === "needs-evidence") return sum + 0.2;
    return sum;
  }, 0);
  return (total / thoughts.length) * 100;
}

function actionConfidenceScore(action: DecisionAction): number {
  if (action === "consider") return 76;
  if (action === "monitor") return 58;
  return 38;
}

function aiReviewConfidenceScore(aiState: DecisionMind["aiState"]): number {
  if (aiState.canAskOpenAI) return 72;
  if (aiState.openAiConfigured) return 52;
  return 30;
}

function historicalDisciplineConfidenceScore(status: DecisionMindThoughtStatus): number {
  if (status === "supports") return 78;
  if (status === "questions") return 54;
  if (status === "needs-evidence") return 34;
  return 6;
}

function buildThinkingTrace({
  activeDecision,
  belief,
  thoughts,
  doubts,
  changeMyMind,
  aiState,
  researchAgent,
  activationRunbook
}: {
  activeDecision: DecisionMind["activeDecision"];
  belief: DecisionMind["belief"];
  thoughts: DecisionMindThought[];
  doubts: string[];
  changeMyMind: string[];
  aiState: DecisionMind["aiState"];
  researchAgent: DecisionResearchAgent;
  activationRunbook: DecisionActivationRunbook;
}): DecisionMindThinkingTrace {
  const historicalThought = thoughts.find((item) => item.id === "historical-discipline");
  const historicalStatus = historicalThought?.status ?? "needs-evidence";
  const pressure = {
    supporting: thoughts.filter((item) => item.status === "supports").length,
    questioning: thoughts.filter((item) => item.status === "questions").length,
    needsEvidence: thoughts.filter((item) => item.status === "needs-evidence").length,
    blocking: thoughts.filter((item) => item.status === "blocks").length,
    netScore: thoughts.reduce((sum, item) => {
      if (item.status === "supports") return sum + 2;
      if (item.status === "questions") return sum - 1;
      if (item.status === "needs-evidence") return sum - 2;
      return sum - 4;
    }, 0)
  };
  const status = traceStatusFromPressure(pressure);
  const budgetItems = [
    confidenceBudgetItem({
      id: "model-market-edge",
      label: "Model-market edge",
      status: activeDecision.valueEdge != null && activeDecision.valueEdge > 0 ? "adds-confidence" : "subtracts-confidence",
      score: valueScore(activeDecision.valueEdge, activeDecision.expectedValue),
      weight: 0.2,
      detail:
        activeDecision.valueEdge == null
          ? "No value edge is available for the active decision."
          : `Value edge ${activeDecision.valueEdge.toFixed(4)} and EV ${activeDecision.expectedValue?.toFixed(4) ?? "n/a"}.`
    }),
    confidenceBudgetItem({
      id: "data-quality",
      label: "Data quality",
      status: (activeDecision.dataQualityScore ?? 0) >= 0.72 ? "adds-confidence" : "subtracts-confidence",
      score: dataQualityScore(activeDecision.dataQualityScore),
      weight: 0.14,
      detail:
        activeDecision.dataQualityScore == null
          ? "No data-quality score is attached to the active decision."
          : `Data-quality score is ${Math.round(activeDecision.dataQualityScore * 100)}/100.`
    }),
    confidenceBudgetItem({
      id: "thought-consensus",
      label: "Thought consensus",
      status: pressure.blocking || pressure.needsEvidence > pressure.supporting ? "subtracts-confidence" : "adds-confidence",
      score: thoughtConfidenceScore(thoughts),
      weight: 0.18,
      detail: `${pressure.supporting} support, ${pressure.questioning} question, ${pressure.needsEvidence} need evidence, ${pressure.blocking} block.`
    }),
    confidenceBudgetItem({
      id: "authority-action",
      label: "Authority action",
      status: activeDecision.authorizedAction === "avoid" ? "subtracts-confidence" : "adds-confidence",
      score: actionConfidenceScore(activeDecision.authorizedAction),
      weight: 0.14,
      detail: `Authority currently allows ${activeDecision.authorizedAction} with posture ${activeDecision.publicPosture}.`
    }),
    confidenceBudgetItem({
      id: "ai-review-readiness",
      label: "AI review readiness",
      status: aiState.canAskOpenAI ? "adds-confidence" : "subtracts-confidence",
      score: aiReviewConfidenceScore(aiState),
      weight: 0.14,
      detail: aiState.canAskOpenAI ? "Guarded OpenAI review can run." : aiState.blockedBy[0] ?? "OpenAI review is not ready."
    }),
    confidenceBudgetItem({
      id: "historical-discipline",
      label: "Historical discipline",
      status: historicalStatus === "supports" ? "adds-confidence" : "subtracts-confidence",
      score: historicalDisciplineConfidenceScore(historicalStatus),
      weight: 0.2,
      detail: historicalThought?.claim ?? "No historical discipline thought is attached to the active mind."
    })
  ];
  const budgetScore = boundConfidenceScore(budgetItems.reduce((sum, item) => sum + item.weightedScore, 0));
  const evidenceGaps = unique(
    [
      ...thoughts.filter((item) => item.status === "needs-evidence" || item.status === "blocks").map((item) => item.nextCheck),
      ...aiState.blockedBy,
      ...activationRunbook.phases.filter((item) => item.status === "blocked").map((item) => item.requiredEvidence),
      ...researchAgent.openQuestions.map((item) => item.evidenceNeeded)
    ],
    8
  );
  const falsifiers = unique(
    [
      ...changeMyMind,
      ...thoughts.filter((item) => item.status !== "supports").map((item) => item.uncertainty),
      ...doubts
    ],
    8
  );
  const nextEvidenceAction =
    evidenceGaps[0] ??
    activationRunbook.nextPhase?.requiredEvidence ??
    researchAgent.nextResearchAction?.evidenceNeeded ??
    "Keep the current decision under read-only review.";
  const thesis =
    activeDecision.authorizedAction === "consider"
      ? `${activeDecision.match ?? "The active decision"} may be a value candidate if the model-market edge survives evidence checks.`
      : activeDecision.authorizedAction === "monitor"
        ? `${activeDecision.match ?? "The active decision"} belongs on watch until the evidence gaps close.`
        : `${activeDecision.match ?? "The active decision"} should stay avoid until the blocked evidence path is cleared.`;
  const counterThesis = falsifiers[0] ?? "The thesis has no strong falsifier yet, but provider-backed evidence is still required.";
  const synthesis =
    status === "blocked"
      ? `The agent is thinking, but ${pressure.blocking} blocking thought(s) prevent action. Next evidence: ${nextEvidenceAction}`
      : status === "unproven"
        ? `The agent has a working belief, but ${pressure.needsEvidence} thought(s) still need evidence. Next evidence: ${nextEvidenceAction}`
        : status === "contested"
          ? `The belief is contested: ${pressure.questioning} thought(s) question it against ${pressure.supporting} supporting thought(s).`
          : `The belief is internally supportive with budget score ${budgetScore}/100, but action locks still apply.`;

  return {
    status,
    thesis: compact(thesis, 240),
    counterThesis: compact(counterThesis, 240),
    synthesis: compact(synthesis, 280),
    beliefPressure: pressure,
    confidenceBudget: {
      score: budgetScore,
      grade: confidenceGrade(budgetScore),
      items: budgetItems
    },
    falsifiers,
    evidenceGaps,
    nextEvidenceAction: compact(nextEvidenceAction, 220),
    auditTrail: thoughts.slice(0, 8).map((item) => ({
      step: item.label,
      outcome: item.status,
      evidence: item.evidence.slice(0, 4)
    }))
  };
}

function isSafeCommand(command: string | null): boolean {
  if (!command) return false;
  const trimmed = command.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed) return false;
  if (
    lower.includes("deploy --prod") ||
    lower.includes("persist=1") ||
    lower.includes("persist=true") ||
    lower.includes("dryrun=0") ||
    lower.includes("dryrun=false") ||
    lower.includes("service_role") ||
    lower.includes("supabase_service_role_key")
  ) {
    return false;
  }
  if (trimmed === "npm run build" || trimmed === "npx netlify status" || trimmed === "npx netlify env:list") return true;
  if (!lower.startsWith("curl.exe -ss")) return false;
  if (lower.includes("-x post") || lower.includes("-xpost")) return lower.includes("dryrun=1");
  return true;
}

function firstSafeAction({
  metacognition,
  aiOrchestrator,
  handoff,
  firewall,
  authority,
  activationRunbook
}: {
  metacognition: DecisionMetacognition;
  aiOrchestrator: DecisionAIOrchestrator;
  handoff: DecisionAIHandoffPacket;
  firewall: DecisionAIFirewall;
  authority: DecisionAuthority;
  activationRunbook: DecisionActivationRunbook;
}): DecisionMindNextSafeAction | null {
  const candidates = [
    {
      label: activationRunbook.nextPhase?.label ?? "Activation runbook",
      command: activationRunbook.nextPhase?.command ?? null,
      verifyUrl: activationRunbook.nextPhase?.verifyUrl ?? null,
      reason: activationRunbook.nextPhase?.requiredEvidence ?? activationRunbook.summary
    },
    ...activationRunbook.commands.map((item) => ({
      label: item.label,
      command: item.command,
      verifyUrl: item.verifyUrl,
      reason: item.expectedEvidence
    })),
    {
      label: "Metacognition proof",
      command: metacognition.runbook.nextSafeCommand,
      verifyUrl: metacognition.runbook.verifyUrl,
      reason: metacognition.primaryDoubt
    },
    {
      label: "Authority proof",
      command: authority.control.nextSafeCommand,
      verifyUrl: authority.control.verifyUrl,
      reason: authority.summary
    },
    {
      label: "AI firewall proof",
      command: firewall.control.nextSafeCommand,
      verifyUrl: firewall.control.verifyUrl,
      reason: firewall.summary
    },
    {
      label: "AI handoff review",
      command: handoff.runbook.command,
      verifyUrl: handoff.runbook.verifyUrl,
      reason: handoff.summary
    },
    {
      label: "AI orchestrator review",
      command: aiOrchestrator.runbook.firstCommand,
      verifyUrl: aiOrchestrator.runbook.firstVerifyUrl,
      reason: aiOrchestrator.runbook.recommendedNextStep
    }
  ];
  const safe = candidates.find((item) => isSafeCommand(item.command));
  if (!safe || !safe.command) return null;
  return {
    label: safe.label,
    command: safe.command,
    verifyUrl: safe.verifyUrl,
    reason: compact(safe.reason, 220),
    safeToRun: true
  };
}

function statusFor({
  researchAgent,
  metacognition,
  aiOrchestrator,
  handoff,
  firewall,
  authority,
  activationRunbook
}: {
  researchAgent: DecisionResearchAgent;
  metacognition: DecisionMetacognition;
  aiOrchestrator: DecisionAIOrchestrator;
  handoff: DecisionAIHandoffPacket;
  firewall: DecisionAIFirewall;
  authority: DecisionAuthority;
  activationRunbook: DecisionActivationRunbook;
}): DecisionMindStatus {
  if (
    authority.status === "blocked" ||
    firewall.status === "blocked" ||
    firewall.status === "quarantined" ||
    activationRunbook.status === "blocked" ||
    activationRunbook.counts.blocked > 0
  ) {
    return "blocked";
  }
  if (aiOrchestrator.status === "ready-to-review" && handoff.status === "ready" && activationRunbook.status === "ready-to-run") return "review-ready";
  if (researchAgent.status === "blocked" || researchAgent.status === "needs-data" || metacognition.status !== "clear") return "waiting-for-evidence";
  return "thinking";
}

function buildThoughts({
  row,
  brain,
  researchAgent,
  metacognition,
  aiOrchestrator,
  handoff,
  firewall,
  authority,
  activationRunbook
}: {
  row: DecisionRow | null;
  brain: DecisionBrain | null;
  researchAgent: DecisionResearchAgent;
  metacognition: DecisionMetacognition;
  aiOrchestrator: DecisionAIOrchestrator;
  handoff: DecisionAIHandoffPacket;
  firewall: DecisionAIFirewall;
  authority: DecisionAuthority;
  activationRunbook: DecisionActivationRunbook;
}): DecisionMindThought[] {
  const decision = row?.prediction.decision ?? null;
  const dataCoverage = decision?.dataCoverage ?? null;
  const marketMovement = decision?.marketMovement ?? null;
  const oddsIntelligence = decision?.oddsIntelligence ?? null;
  const historicalDiscipline = decision?.historicalDiscipline ?? null;
  const historicalThoughtStatus = historicalDisciplineThoughtStatus(historicalDiscipline?.trustEffect);
  const researchEvidence = researchAgent.evidence.find((item) => item.status === "missing" || item.status === "risk") ?? researchAgent.evidence[0] ?? null;
  const highestAuthorityConcern = authority.chain.find((item) => item.status === "block") ?? authority.chain.find((item) => item.status === "watch") ?? null;
  const highestFirewallConcern = firewall.rules.find((item) => item.status === "block") ?? firewall.rules.find((item) => item.status === "watch") ?? null;

  return [
    thought({
      id: "model-market-belief",
      label: "Model-market belief",
      status:
        brain?.action === "avoid" || brain?.blockers.length
          ? "questions"
          : brain?.belief.grade === "strong" || brain?.belief.expectedValue
            ? "supports"
            : "needs-evidence",
      claim: brain?.belief.summary ?? decision?.beliefState.summary ?? "No model-market belief is available.",
      evidence: [
        brain ? `brain:${brain.matchId}` : "",
        brain ? `grade:${brain.belief.grade}` : "",
        brain?.belief.believedProbability != null ? `believed:${brain.belief.believedProbability}` : "",
        brain?.belief.probabilityEdge != null ? `edge:${brain.belief.probabilityEdge}` : "",
        brain?.belief.expectedValue != null ? `ev:${brain.belief.expectedValue}` : ""
      ],
      uncertainty: brain ? `Uncertainty score ${brain.belief.uncertaintyScore}; confidence ${brain.confidence}; risk ${brain.risk}.` : "No active brain selected.",
      nextCheck: brain?.nextBestAction ?? decision?.nextChecks[0] ?? "Load a deterministic decision first.",
      source: "decision.brain"
    }),
    thought({
      id: "market-skepticism",
      label: "Market skepticism",
      status:
        oddsIntelligence?.status === "positive-ev" && marketMovement?.status === "resilient"
          ? "supports"
          : oddsIntelligence?.status === "positive-ev"
            ? "questions"
            : "needs-evidence",
      claim: oddsIntelligence?.summary ?? "No odds intelligence is available.",
      evidence: [
        oddsIntelligence ? `status:${oddsIntelligence.status}` : "",
        oddsIntelligence?.bestSelection ? `selection:${oddsIntelligence.bestSelection.label}` : "",
        oddsIntelligence?.averageBookmakerMargin != null ? `margin:${oddsIntelligence.averageBookmakerMargin}` : "",
        marketMovement?.currentEdge != null ? `currentEdge:${marketMovement.currentEdge}` : "",
        marketMovement?.currentExpectedValue != null ? `currentEV:${marketMovement.currentExpectedValue}` : ""
      ],
      uncertainty: marketMovement?.summary ?? "Market movement has not been checked.",
      nextCheck: marketMovement?.nextAction ?? "Refresh odds before action.",
      source: "decision.oddsIntelligence"
    }),
    thought({
      id: "historical-discipline",
      label: "Historical discipline",
      status: historicalThoughtStatus,
      claim: historicalDiscipline
        ? `${historicalDiscipline.summary} ${historicalDiscipline.instruction}`
        : "No historical discipline artifact is attached to the active decision.",
      evidence: [
        historicalDiscipline ? `status:${historicalDiscipline.status}` : "",
        historicalDiscipline ? `trust:${historicalDiscipline.trustEffect}` : "",
        historicalDiscipline?.benchmarkVerdict ? `benchmark:${historicalDiscipline.benchmarkVerdict}` : "",
        historicalDiscipline?.source ? `source:${historicalDiscipline.source}` : "",
        historicalDiscipline?.seasons ? `seasons:${historicalDiscipline.seasons}` : "",
        historicalDiscipline ? `fixtures:${historicalDiscipline.fixtures}` : "",
        historicalDiscipline ? `oddsRows:${historicalDiscipline.oddsRows}` : ""
      ],
      uncertainty:
        historicalDiscipline?.trustEffect === "cap-raw-edge"
          ? "Historical market-prior evidence is stronger than the raw model edge."
          : historicalDiscipline?.requiredBeforePromotion[0] ?? "Historical promotion proof is not yet provider-enriched.",
      nextCheck: historicalDiscipline?.requiredBeforePromotion[0] ?? historicalDiscipline?.instruction ?? "Attach public or provider-backed historical evidence before trust can rise.",
      source: "decision.historicalDiscipline"
    }),
    thought({
      id: "data-coverage-doubt",
      label: "Data coverage doubt",
      status: dataCoverage?.requiredBeforeTrust.length ? "needs-evidence" : dataCoverage?.status === "provider-backed" ? "supports" : "questions",
      claim: dataCoverage?.summary ?? "No data coverage audit is available.",
      evidence: [
        dataCoverage ? `score:${dataCoverage.score}` : "",
        dataCoverage ? `providerBacked:${dataCoverage.providerBackedSignals}` : "",
        dataCoverage ? `missing:${dataCoverage.missingSignals}` : "",
        dataCoverage ? `mock:${dataCoverage.mockSignals}` : "",
        ...(dataCoverage?.requiredBeforeTrust.slice(0, 3) ?? [])
      ],
      uncertainty: dataCoverage?.requiredBeforeTrust[0] ?? researchEvidence?.detail ?? "No required-before-trust data gap is currently recorded.",
      nextCheck: dataCoverage?.requiredBeforeTrust[0] ?? researchAgent.nextResearchAction?.evidenceNeeded ?? "Keep provider-backed signal checks current.",
      source: "decision.dataCoverage"
    }),
    thought({
      id: "research-agent",
      label: "Research agent",
      status: researchAgent.status === "ready" ? "supports" : researchAgent.status === "blocked" ? "blocks" : "needs-evidence",
      claim: researchAgent.summary,
      evidence: [
        researchAgent.target ? `target:${researchAgent.target.matchId}` : "",
        `verdict:${researchAgent.verdict}`,
        `questions:${researchAgent.openQuestions.length}`,
        researchAgent.nextResearchAction?.id ?? ""
      ],
      uncertainty: researchAgent.contradictionChecks[0] ?? researchAgent.openQuestions[0]?.prompt ?? "No contradiction check is currently open.",
      nextCheck: researchAgent.nextResearchAction?.evidenceNeeded ?? researchAgent.guardrails[0] ?? "Keep the research dossier bounded to cited evidence.",
      source: "decision.researchAgent"
    }),
    thought({
      id: "metacognition",
      label: "Metacognition",
      status: metacognition.status === "blocked" ? "blocks" : metacognition.status === "watching" ? "questions" : "supports",
      claim: metacognition.summary,
      evidence: [
        metacognition.metacognitionHash,
        `mode:${metacognition.mode}`,
        `blocks:${metacognition.counts.block}`,
        `watch:${metacognition.counts.watch}`
      ],
      uncertainty: metacognition.primaryDoubt,
      nextCheck: metacognition.changeMyMind[0] ?? "Keep asking what would falsify the current belief.",
      source: "decision.metacognition"
    }),
    thought({
      id: "ai-firewall",
      label: "AI firewall",
      status: firewallThoughtStatus(firewall),
      claim: firewall.summary,
      evidence: [
        firewall.firewallHash,
        `handoff:${handoff.status}`,
        `orchestrator:${aiOrchestrator.status}`,
        `reviews:${firewall.counts.reviews}`,
        `blocks:${firewall.counts.block}`
      ],
      uncertainty: highestFirewallConcern?.detail ?? "No AI output has passed through the firewall yet.",
      nextCheck: highestFirewallConcern?.requiredAction ?? aiOrchestrator.runbook.recommendedNextStep,
      source: "decision.aiFirewall"
    }),
    thought({
      id: "authority",
      label: "Decision authority",
      status: authorityThoughtStatus(authority),
      claim: authority.summary,
      evidence: [
        authority.authorityHash,
        `source:${authority.activeDecision.source}`,
        `authorized:${authority.activeDecision.authorizedAction}`,
        `posture:${authority.activeDecision.publicPosture}`
      ],
      uncertainty: highestAuthorityConcern?.detail ?? authority.activeDecision.reason,
      nextCheck: highestAuthorityConcern?.nextAction ?? authority.control.nextSafeCommand ?? "Keep authority in supervised mode.",
      source: "decision.authority"
    }),
    thought({
      id: "activation-runbook",
      label: "Activation runbook",
      status: activationThoughtStatus(activationRunbook),
      claim: activationRunbook.summary,
      evidence: [
        activationRunbook.runbookHash,
        `ready:${activationRunbook.counts.ready}`,
        `waiting:${activationRunbook.counts.waiting}`,
        `blocked:${activationRunbook.counts.blocked}`,
        `done:${activationRunbook.counts.done}`
      ],
      uncertainty: activationRunbook.nextPhase?.reason ?? "No activation phase is selected.",
      nextCheck: activationRunbook.nextPhase?.requiredEvidence ?? "Keep all activation proof attached before write mode.",
      source: "decision.activationRunbook"
    })
  ];
}

export function buildDecisionMind({
  rows,
  date,
  sport,
  brainSlate,
  researchAgent,
  metacognition,
  aiOrchestrator,
  handoff,
  firewall,
  authority,
  activationRunbook
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  brainSlate: DecisionBrainSlate;
  researchAgent: DecisionResearchAgent;
  metacognition: DecisionMetacognition;
  aiOrchestrator: DecisionAIOrchestrator;
  handoff: DecisionAIHandoffPacket;
  firewall: DecisionAIFirewall;
  authority: DecisionAuthority;
  activationRunbook: DecisionActivationRunbook;
}): DecisionMind {
  const row = activeRow({ rows, authority, brainSlate, metacognition, researchAgent });
  const brain = findBrain(brainSlate.topBrains, row?.match.id ?? authority.activeDecision.matchId);
  const decision = row?.prediction.decision ?? null;
  const bestPick = row?.prediction.bestPick ?? null;
  const valueEdge = bestPick?.hasValue ? bestPick.edge : decision?.beliefState.probabilityEdge ?? null;
  const expectedValue = bestPick?.hasValue ? bestPick.expectedValue : decision?.beliefState.expectedValue ?? null;
  const thoughts = buildThoughts({
    row,
    brain,
    researchAgent,
    metacognition,
    aiOrchestrator,
    handoff,
    firewall,
    authority,
    activationRunbook
  });
  const status = statusFor({ researchAgent, metacognition, aiOrchestrator, handoff, firewall, authority, activationRunbook });
  const nextSafeAction = firstSafeAction({ metacognition, aiOrchestrator, handoff, firewall, authority, activationRunbook });
  const blockingThoughts = thoughts.filter((item) => item.status === "blocks");
  const doubts = unique([
    metacognition.primaryDoubt,
    brain?.thesis.dissenting,
    ...(brain?.blockers ?? []),
    ...(decision?.marketMovement.alerts ?? []),
    ...(decision?.dataCoverage.requiredBeforeTrust ?? []),
    decision?.historicalDiscipline.trustEffect === "cap-raw-edge" || decision?.historicalDiscipline.trustEffect === "block"
      ? decision.historicalDiscipline.summary
      : null,
    ...researchAgent.contradictionChecks,
    ...researchAgent.openQuestions.map((item) => item.prompt),
    ...firewall.rules.filter((item) => item.status !== "pass").map((item) => item.detail),
    ...authority.chain.filter((item) => item.status !== "pass").map((item) => item.detail),
    activationRunbook.nextPhase?.reason
  ]);
  const changeMyMind = unique([
    ...metacognition.changeMyMind,
    ...(decision?.dataCoverage.requiredBeforeTrust ?? []),
    ...(decision?.historicalDiscipline.requiredBeforePromotion ?? []),
    ...(decision?.robustness.requiredRechecks ?? []),
    ...researchAgent.openQuestions.map((item) => item.evidenceNeeded),
    ...authority.chain.filter((item) => item.status !== "pass").map((item) => item.nextAction),
    activationRunbook.nextPhase?.requiredEvidence
  ]);
  const aiBlockedBy = unique([
    ...handoff.runbook.blockedBy,
    ...handoff.runbook.missingEnv,
    ...firewall.rules.filter((item) => item.status === "block").map((item) => item.requiredAction),
    ...authority.chain.filter((item) => item.status === "block").map((item) => item.nextAction),
    decision?.historicalDiscipline.trustEffect === "cap-raw-edge" || decision?.historicalDiscipline.trustEffect === "block"
      ? decision.historicalDiscipline.requiredBeforePromotion[0] ?? decision.historicalDiscipline.instruction
      : null,
    ...activationRunbook.phases.filter((item) => item.status === "blocked").map((item) => item.requiredEvidence)
  ]);
  const activeDecision = {
    matchId: row?.match.id ?? authority.activeDecision.matchId,
    match: row ? matchLabel(row) : authority.activeDecision.match,
    league: row?.match.league.name ?? null,
    kickoffTime: row?.match.kickoffTime ?? null,
    selection: bestPick?.hasValue ? bestPick.label : decision?.recommendedSelection ?? null,
    baselineAction: authority.activeDecision.baselineAction,
    revisedAction: authority.activeDecision.revisedAction,
    authorizedAction: authority.activeDecision.authorizedAction,
    publicPosture: authority.activeDecision.publicPosture,
    source: authority.activeDecision.source,
    confidence: authority.activeDecision.confidence,
    risk: authority.activeDecision.risk,
    decisionScore: decision?.decisionScore ?? brain?.decisionScore ?? null,
    valueEdge,
    expectedValue,
    dataQualityScore: row?.match.dataQualityScore ?? null,
    reason: authority.activeDecision.reason
  };
  const belief = {
    summary: brain?.belief.summary ?? decision?.beliefState.summary ?? "No active belief is available.",
    grade: brain?.belief.grade ?? decision?.beliefState.grade ?? null,
    modelProbability: decision?.beliefState.baseModelProbability ?? null,
    marketProbability: decision?.beliefState.marketImpliedProbability ?? null,
    believedProbability: brain?.belief.believedProbability ?? decision?.beliefState.believedProbability ?? null,
    probabilityEdge: valueEdge,
    expectedValue,
    confidenceInterval: {
      low: decision?.beliefState.confidenceInterval.low ?? null,
      high: decision?.beliefState.confidenceInterval.high ?? null
    },
    marketMovement: decision?.marketMovement.summary ?? "No market movement summary is available.",
    oddsIntelligence: decision?.oddsIntelligence.summary ?? "No odds intelligence summary is available.",
    authoritySummary: authority.summary
  };
  const locks = {
    canPromote: false,
    canPersist: false,
    canPublish: false,
    canTrain: false,
    reasons: unique([
      "Decision mind is inspect-only and cannot promote an action.",
      "Supabase writes stay locked until activation proof passes.",
      "Public publishing stays locked until authority and runbook gates pass.",
      "Training stays locked until real corpus, outcome, and backtest proof pass.",
      decision?.historicalDiscipline.trustEffect === "cap-raw-edge"
        ? "Historical discipline caps raw model edge until provider-enriched retests beat market consensus."
        : null,
      ...activationRunbook.operatorChecklist.slice(0, 2),
      ...authority.control.forbiddenActions.slice(0, 2)
    ])
  } satisfies DecisionMind["locks"];
  const aiState = {
    orchestratorStatus: aiOrchestrator.status,
    handoffStatus: handoff.status,
    firewallStatus: firewall.status,
    authorityStatus: authority.status,
    activationStatus: activationRunbook.status,
    openAiConfigured: aiOrchestrator.openAiConfigured,
    canAskOpenAI: metacognition.runbook.canAskOpenAI && handoff.runbook.canSubmitToOpenAI && firewall.status !== "blocked",
    reviewCommand: aiOrchestrator.runbook.firstCommand,
    blockedBy: aiBlockedBy
  } satisfies DecisionMind["aiState"];
  const thinkingTrace = buildThinkingTrace({
    activeDecision,
    belief,
    thoughts,
    doubts,
    changeMyMind,
    aiState,
    researchAgent,
    activationRunbook
  });
  const proofUrls = unique([
    "/api/sports/decision/mind",
    "/predictions/decision-engine",
    "/api/sports/decision/metacognition",
    "/api/sports/decision/activation-runbook",
    "/api/sports/decision/authority",
    "/api/sports/decision/ai-firewall",
    "/api/sports/decision/historical-discipline",
    ...activationRunbook.proofUrls
  ], 14);
  const mindHash = stableHash({
    date,
    sport,
    status,
    activeDecision: {
      matchId: activeDecision.matchId,
      authorizedAction: activeDecision.authorizedAction,
      source: activeDecision.source,
      valueEdge: activeDecision.valueEdge
    },
    thoughts: thoughts.map((item) => ({ id: item.id, status: item.status })),
    thinkingTrace: {
      status: thinkingTrace.status,
      score: thinkingTrace.confidenceBudget.score,
      netScore: thinkingTrace.beliefPressure.netScore,
      nextEvidenceAction: thinkingTrace.nextEvidenceAction
    },
    nextSafeAction: nextSafeAction?.command ?? null,
    locks
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    mode: "active-decision-mind",
    mindHash,
    summary:
      status === "blocked"
        ? `Decision mind is blocked by ${blockingThoughts.length || activationRunbook.counts.blocked} gate(s); it can explain and verify but cannot act.`
        : status === "review-ready"
          ? "Decision mind has enough proof to run the supervised AI review path."
          : status === "waiting-for-evidence"
            ? "Decision mind is waiting for evidence before it can move beyond supervised reasoning."
            : "Decision mind is actively reasoning in read-only mode.",
    activeDecision,
    belief,
    doubts,
    thoughts,
    thinkingTrace,
    changeMyMind,
    aiState,
    nextSafeAction,
    locks,
    proofUrls
  };
}
