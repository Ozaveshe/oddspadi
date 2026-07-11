import type { DecisionAIReviewLedger } from "@/lib/sports/prediction/decisionAIReviewLedger";
import type { DecisionCounterfactualCase, DecisionCounterfactualLab } from "@/lib/sports/prediction/decisionCounterfactualLab";
import type { DecisionProofRunner } from "@/lib/sports/prediction/decisionProofRunner";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { ConfidenceLevel, DecisionAction, Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionBeliefRevisionStatus = "holding" | "weakening" | "retiring" | "needs-evidence";
export type DecisionBeliefRevisionPriority = "critical" | "high" | "medium" | "low";

export type DecisionBeliefRevisionItem = {
  id: string;
  matchId: string;
  match: string;
  baselineAction: DecisionAction;
  revisedAction: DecisionAction;
  status: DecisionBeliefRevisionStatus;
  priority: DecisionBeliefRevisionPriority;
  confidenceBefore: ConfidenceLevel;
  confidenceAfter: ConfidenceLevel;
  beliefGradeBefore: string;
  beliefGradeAfter: string;
  probabilityBefore: number | null;
  probabilityAfter: number | null;
  edgeBefore: number | null;
  edgeAfter: number | null;
  expectedValueBefore: number | null;
  expectedValueAfter: number | null;
  revisionScore: number;
  shockPressure: number;
  evidencePressure: number;
  proofPressure: number;
  reason: string;
  evidence: string[];
  counterfactualIds: string[];
  requiredEvidence: string[];
  command: string;
  verifyUrl: string;
};

export type DecisionBeliefRevision = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionBeliefRevisionStatus;
  summary: string;
  revisionHash: string;
  totalBeliefs: number;
  holding: number;
  weakening: number;
  retiring: number;
  needsEvidence: number;
  averageRevisionScore: number;
  activeRevision: DecisionBeliefRevisionItem | null;
  revisions: DecisionBeliefRevisionItem[];
  policy: {
    canPromote: false;
    canPersist: false;
    canPublish: false;
    actionRankRule: string;
    nextSafeCommand: string | null;
    forbiddenActions: string[];
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

function actionRank(action: DecisionAction): number {
  if (action === "consider") return 2;
  if (action === "monitor") return 1;
  return 0;
}

function safestAction(current: DecisionAction, proposed: DecisionAction): DecisionAction {
  return actionRank(proposed) <= actionRank(current) ? proposed : current;
}

function lowerConfidence(confidence: ConfidenceLevel): ConfidenceLevel {
  if (confidence === "high") return "medium";
  if (confidence === "medium") return "low";
  return "low";
}

function lowerBeliefGrade(grade: string): string {
  if (grade === "strong") return "moderate";
  if (grade === "moderate") return "fragile";
  return "fragile";
}

function matchLabel(row: DecisionRow): string {
  return `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`;
}

function commandFor(matchId: string): string {
  return decisionCurlCommand(`/api/sports/decision/${encodeURIComponent(matchId)}`);
}

function verifyUrl(matchId: string): string {
  return `/api/sports/decision/${encodeURIComponent(matchId)}`;
}

function counterfactualPressure(cases: DecisionCounterfactualCase[]): number {
  return Math.min(
    100,
    cases.reduce((sum, item) => {
      const survival = item.survival === "breaks" ? 28 : item.survival === "downgrades" ? 14 : 2;
      const severity = item.severity === "critical" ? 18 : item.severity === "high" ? 10 : item.severity === "medium" ? 5 : 0;
      const scoreDelta = Math.max(0, -(item.scoreDelta ?? 0));
      return sum + survival + severity + Math.min(12, scoreDelta / 3);
    }, 0)
  );
}

function evidencePressure(row: DecisionRow): number {
  const decision = row.prediction.decision;
  return Math.min(
    100,
    decision.dataCoverage.requiredBeforeTrust.length * 9 +
      decision.missingSignals.length * 6 +
      decision.actionability.blockers.length * 10 +
      decision.controlPolicy.gates.filter((gate) => gate.status === "block").length * 14 +
      decision.controlPolicy.gates.filter((gate) => gate.status === "watch").length * 6 +
      (decision.dataCoverage.status === "mock-backed" ? 18 : decision.dataCoverage.status === "insufficient" ? 24 : 0)
  );
}

function proofPressureForMatch({
  row,
  proofRunner,
  aiReviewLedger
}: {
  row: DecisionRow;
  proofRunner: DecisionProofRunner;
  aiReviewLedger: DecisionAIReviewLedger;
}): number {
  const decision = row.prediction.decision;
  const globalProof = proofRunner.status === "blocked" ? 18 : proofRunner.status === "partial" ? 8 : 0;
  const globalLedger = aiReviewLedger.status === "blocked" ? 12 : aiReviewLedger.status === "needs-config" ? 8 : 0;
  const aiGate = decision.aiProtocol.status === "blocked" ? 12 : decision.aiProtocol.status === "needs-data" ? 7 : 0;
  return Math.min(100, globalProof + globalLedger + aiGate);
}

function statusFromPressures({
  row,
  shockPressure,
  evidencePressureValue,
  proofPressure
}: {
  row: DecisionRow;
  shockPressure: number;
  evidencePressureValue: number;
  proofPressure: number;
}): DecisionBeliefRevisionStatus {
  const decision = row.prediction.decision;
  if (decision.controlPolicy.status === "blocked" || shockPressure >= 70) return "retiring";
  if (evidencePressureValue >= 55 || proofPressure >= 45) return "needs-evidence";
  if (shockPressure >= 28 || evidencePressureValue >= 28 || proofPressure >= 20 || decision.beliefState.grade !== "strong") return "weakening";
  return "holding";
}

function revisedAction(status: DecisionBeliefRevisionStatus, current: DecisionAction): DecisionAction {
  if (status === "retiring") return "avoid";
  if (status === "needs-evidence" || status === "weakening") return safestAction(current, "monitor");
  return current;
}

function priorityFromStatus(status: DecisionBeliefRevisionStatus, score: number): DecisionBeliefRevisionPriority {
  if (status === "retiring" || score >= 78) return "critical";
  if (status === "needs-evidence" || score >= 55) return "high";
  if (status === "weakening" || score >= 28) return "medium";
  return "low";
}

function revisedNumber(value: number | null, penalty: number): number | null {
  if (value === null) return null;
  return Number((value - penalty).toFixed(4));
}

function itemForRow({
  row,
  cases,
  proofRunner,
  aiReviewLedger
}: {
  row: DecisionRow;
  cases: DecisionCounterfactualCase[];
  proofRunner: DecisionProofRunner;
  aiReviewLedger: DecisionAIReviewLedger;
}): DecisionBeliefRevisionItem {
  const decision = row.prediction.decision;
  const relevantCases = cases.filter((item) => item.matchId === row.match.id);
  const shockPressure = counterfactualPressure(relevantCases);
  const evidencePressureValue = evidencePressure(row);
  const proofPressure = proofPressureForMatch({ row, proofRunner, aiReviewLedger });
  const revisionScore = Math.min(100, Math.round(shockPressure * 0.42 + evidencePressureValue * 0.38 + proofPressure * 0.2));
  const status = statusFromPressures({ row, shockPressure, evidencePressureValue, proofPressure });
  const nextAction = revisedAction(status, decision.action);
  const confidenceAfter = status === "holding" ? decision.confidence : lowerConfidence(decision.confidence);
  const beliefGradeAfter = status === "holding" ? decision.beliefState.grade : lowerBeliefGrade(decision.beliefState.grade);
  const penalty = revisionScore / 1000;
  const breakingCase = relevantCases.find((item) => item.survival === "breaks");
  const downgradeCase = relevantCases.find((item) => item.survival === "downgrades");
  const leadingCase = breakingCase ?? downgradeCase ?? relevantCases[0] ?? null;

  return {
    id: `belief-revision-${row.match.id}`,
    matchId: row.match.id,
    match: matchLabel(row),
    baselineAction: decision.action,
    revisedAction: nextAction,
    status,
    priority: priorityFromStatus(status, revisionScore),
    confidenceBefore: decision.confidence,
    confidenceAfter,
    beliefGradeBefore: decision.beliefState.grade,
    beliefGradeAfter,
    probabilityBefore: decision.beliefState.believedProbability,
    probabilityAfter: revisedNumber(decision.beliefState.believedProbability, penalty),
    edgeBefore: decision.beliefState.probabilityEdge,
    edgeAfter: revisedNumber(decision.beliefState.probabilityEdge, penalty),
    expectedValueBefore: decision.beliefState.expectedValue,
    expectedValueAfter: revisedNumber(decision.beliefState.expectedValue, penalty),
    revisionScore,
    shockPressure: Math.round(shockPressure),
    evidencePressure: Math.round(evidencePressureValue),
    proofPressure: Math.round(proofPressure),
    reason:
      status === "holding"
        ? "Current belief can hold under the visible shock and proof evidence."
        : status === "weakening"
          ? "Belief should be weakened because shocks, uncertainty, or evidence gaps reduce trust."
          : status === "needs-evidence"
            ? "Belief needs fresh provider or proof evidence before trust can rise."
            : "Belief should be retired until breaking shocks or blocked control gates are cleared.",
    evidence: [
      decision.beliefState.summary,
      leadingCase ? `${leadingCase.label}: ${leadingCase.survival}` : "",
      decision.dataCoverage.summary,
      proofRunner.summary,
      aiReviewLedger.summary
    ].filter(Boolean),
    counterfactualIds: relevantCases.slice(0, 6).map((item) => item.id),
    requiredEvidence: Array.from(
      new Set([
        ...relevantCases.filter((item) => item.survival !== "survives").flatMap((item) => [item.falsifier, item.mitigation]),
        ...decision.dataCoverage.requiredBeforeTrust,
        ...decision.nextChecks,
        ...proofRunner.runbook.forbiddenActions.slice(0, 1)
      ])
    )
      .filter(Boolean)
      .slice(0, 8),
    command: commandFor(row.match.id),
    verifyUrl: verifyUrl(row.match.id)
  };
}

function sortRevisions(revisions: DecisionBeliefRevisionItem[]): DecisionBeliefRevisionItem[] {
  const priorityRank: Record<DecisionBeliefRevisionPriority, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const statusRank: Record<DecisionBeliefRevisionStatus, number> = { retiring: 4, "needs-evidence": 3, weakening: 2, holding: 1 };
  return revisions.slice().sort((a, b) => {
    const priority = priorityRank[b.priority] - priorityRank[a.priority];
    if (priority !== 0) return priority;
    const status = statusRank[b.status] - statusRank[a.status];
    if (status !== 0) return status;
    return b.revisionScore - a.revisionScore;
  });
}

function overallStatus(revisions: DecisionBeliefRevisionItem[]): DecisionBeliefRevisionStatus {
  if (!revisions.length) return "needs-evidence";
  if (revisions.some((item) => item.status === "retiring")) return "retiring";
  if (revisions.some((item) => item.status === "needs-evidence")) return "needs-evidence";
  if (revisions.some((item) => item.status === "weakening")) return "weakening";
  return "holding";
}

function averageRevisionScore(revisions: DecisionBeliefRevisionItem[]): number {
  if (!revisions.length) return 0;
  return Number((revisions.reduce((sum, item) => sum + item.revisionScore, 0) / revisions.length).toFixed(2));
}

export function buildDecisionBeliefRevision({
  rows,
  date,
  sport,
  counterfactualLab,
  proofRunner,
  aiReviewLedger,
  limit = 10
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  counterfactualLab: DecisionCounterfactualLab;
  proofRunner: DecisionProofRunner;
  aiReviewLedger: DecisionAIReviewLedger;
  limit?: number;
}): DecisionBeliefRevision {
  const allRevisions = sortRevisions(
    rows.map((row) =>
      itemForRow({
        row,
        cases: counterfactualLab.cases,
        proofRunner,
        aiReviewLedger
      })
    )
  );
  const revisions = allRevisions.slice(0, limit);
  const status = overallStatus(allRevisions);
  const activeRevision = revisions[0] ?? null;
  const holding = allRevisions.filter((item) => item.status === "holding").length;
  const weakening = allRevisions.filter((item) => item.status === "weakening").length;
  const retiring = allRevisions.filter((item) => item.status === "retiring").length;
  const needsEvidence = allRevisions.filter((item) => item.status === "needs-evidence").length;
  const revisionHash = stableHash({
    date,
    sport,
    status,
    counterfactualStatus: counterfactualLab.status,
    proofStatus: proofRunner.status,
    ledgerStatus: aiReviewLedger.status,
    revisions: allRevisions.map((item) => ({
      id: item.id,
      status: item.status,
      revisedAction: item.revisedAction,
      revisionScore: item.revisionScore
    }))
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    summary:
      status === "holding"
        ? `Belief revision can hold ${holding} belief(s) under the current evidence.`
        : status === "weakening"
          ? `Belief revision weakens ${weakening} belief(s) until shocks and data gaps are rechecked.`
          : status === "needs-evidence"
            ? `Belief revision needs fresh evidence for ${needsEvidence} belief(s) before trust can rise.`
            : `Belief revision retires ${retiring} belief(s) until breaking shocks or blocked gates are cleared.`,
    revisionHash,
    totalBeliefs: allRevisions.length,
    holding,
    weakening,
    retiring,
    needsEvidence,
    averageRevisionScore: averageRevisionScore(allRevisions),
    activeRevision,
    revisions,
    policy: {
      canPromote: false,
      canPersist: false,
      canPublish: false,
      actionRankRule: "avoid < monitor < consider; belief revision can only keep or lower the baseline action.",
      nextSafeCommand: activeRevision?.command ?? null,
      forbiddenActions: [
        "Do not raise action from belief revision alone.",
        "Do not persist revised beliefs until proof and activation gates pass.",
        "Do not publish a retired or needs-evidence belief as a value candidate.",
        "Do not treat AI text as fresh provider evidence."
      ]
    }
  };
}
