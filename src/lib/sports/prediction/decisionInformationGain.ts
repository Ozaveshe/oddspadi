import type { DecisionBeliefRevision, DecisionBeliefRevisionItem } from "@/lib/sports/prediction/decisionBeliefRevision";
import type { DecisionCounterfactualCase, DecisionCounterfactualLab } from "@/lib/sports/prediction/decisionCounterfactualLab";
import type { DecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import type { DecisionEvidenceRefreshScheduler, DecisionEvidenceRefreshTask } from "@/lib/sports/prediction/decisionEvidenceRefreshScheduler";
import type { DecisionHypothesisExperiment, DecisionHypothesisLab } from "@/lib/sports/prediction/decisionHypothesisLab";
import type { Sport } from "@/lib/sports/types";

export type DecisionInformationGainStatus = "ready" | "waiting" | "blocked";
export type DecisionInformationGainCandidateStatus = "ready" | "needs-env" | "blocked" | "waiting";
export type DecisionInformationGainSource = "evidence-refresh" | "hypothesis-lab" | "counterfactual-lab" | "belief-revision" | "data-intake";
export type DecisionInformationGainMode = "read-only" | "dry-run" | "manual-only";

export type DecisionInformationGainCandidate = {
  id: string;
  rank: number;
  source: DecisionInformationGainSource;
  label: string;
  status: DecisionInformationGainCandidateStatus;
  mode: DecisionInformationGainMode;
  category: string;
  matchId: string | null;
  match: string | null;
  command: string | null;
  verifyUrl: string | null;
  safeToRun: boolean;
  missingEnv: string[];
  expectedEvidence: string;
  decisionImpact: string;
  expectedOutcomes: {
    ifSupports: string;
    ifChallenges: string;
    ifMissing: string;
  };
  scoring: {
    uncertaintyReduction: number;
    blockerReduction: number;
    actionFlipPotential: number;
    learningValue: number;
    costPenalty: number;
    informationGainScore: number;
  };
  reason: string;
};

export type DecisionInformationGainPlanner = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "information-gain-planner";
  status: DecisionInformationGainStatus;
  informationHash: string;
  summary: string;
  nextCandidate: DecisionInformationGainCandidate | null;
  candidates: DecisionInformationGainCandidate[];
  totals: {
    candidates: number;
    ready: number;
    needsEnv: number;
    blocked: number;
    waiting: number;
    safeToRun: number;
    averageInformationGain: number;
    maxInformationGain: number;
  };
  focus: {
    question: string;
    whyNow: string;
    expectedDecisionChange: string;
    proofUrl: string | null;
  };
  controls: {
    canRunReadOnly: boolean;
    canRunDryRun: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canRaiseTrust: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  forbiddenActions: string[];
};

type CandidateDraft = Omit<DecisionInformationGainCandidate, "rank" | "status" | "mode" | "safeToRun" | "reason" | "scoring"> & {
  status?: DecisionInformationGainCandidateStatus;
  mode?: DecisionInformationGainMode;
  safeToRun?: boolean;
  scoring: Omit<DecisionInformationGainCandidate["scoring"], "informationGainScore">;
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

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function compact(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 18): string[] {
  return Array.from(new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))).slice(0, limit);
}

function priorityScore(priority: string): number {
  if (priority === "critical") return 36;
  if (priority === "high") return 27;
  if (priority === "medium") return 17;
  return 9;
}

function modeFor(command: string | null | undefined): DecisionInformationGainMode {
  const lower = command?.toLowerCase() ?? "";
  if (!lower.includes("curl.exe")) return "manual-only";
  if (lower.includes("-x post") || lower.includes("-xpost")) {
    return lower.includes("dryrun=1") || lower.includes("dryrun=true") ? "dry-run" : "manual-only";
  }
  return "read-only";
}

function isSafeCommand(command: string | null, mode: DecisionInformationGainMode, missingEnv: string[]): boolean {
  const lower = command?.toLowerCase() ?? "";
  if (!lower.includes("curl.exe")) return false;
  if (lower.includes("persist=1") || lower.includes("persist=true")) return false;
  if (lower.includes("publish=1") || lower.includes("publish=true")) return false;
  if (lower.includes("dryrun=0") || lower.includes("dryrun=false")) return false;
  if (mode === "manual-only") return false;
  if (mode === "dry-run" && missingEnv.length) return false;
  return true;
}

function statusFor({ safeToRun, missingEnv, mode }: { safeToRun: boolean; missingEnv: string[]; mode: DecisionInformationGainMode }): DecisionInformationGainCandidateStatus {
  if (safeToRun) return "ready";
  if (missingEnv.length) return "needs-env";
  if (mode === "manual-only") return "blocked";
  return "waiting";
}

function scoreCandidate(scoring: CandidateDraft["scoring"]): DecisionInformationGainCandidate["scoring"] {
  const informationGainScore = clamp(
    scoring.uncertaintyReduction * 0.35 +
      scoring.blockerReduction * 0.28 +
      scoring.actionFlipPotential * 0.22 +
      scoring.learningValue * 0.15 -
      scoring.costPenalty * 0.4
  );
  return {
    uncertaintyReduction: clamp(scoring.uncertaintyReduction),
    blockerReduction: clamp(scoring.blockerReduction),
    actionFlipPotential: clamp(scoring.actionFlipPotential),
    learningValue: clamp(scoring.learningValue),
    costPenalty: clamp(scoring.costPenalty),
    informationGainScore
  };
}

function finalizeCandidate(input: CandidateDraft): DecisionInformationGainCandidate {
  const mode = input.mode ?? modeFor(input.command);
  const missingEnv = unique(input.missingEnv, 12);
  const safeToRun = input.safeToRun ?? isSafeCommand(input.command, mode, missingEnv);
  const status = input.status ?? statusFor({ safeToRun, missingEnv, mode });
  const scoring = scoreCandidate(input.scoring);
  const reason =
    scoring.informationGainScore >= 70
      ? "High-value evidence: this proof can materially reduce uncertainty or clear a launch blocker."
      : scoring.informationGainScore >= 45
        ? "Useful evidence: this proof can clarify the next action without side effects."
        : "Low-to-moderate evidence value: keep it behind higher-value proof unless the queue is exhausted.";

  return {
    ...input,
    rank: 0,
    mode,
    missingEnv,
    safeToRun,
    status,
    scoring,
    reason
  };
}

function evidenceCandidate(task: DecisionEvidenceRefreshTask): DecisionInformationGainCandidate {
  const uncertaintyReduction = priorityScore(task.priority) + Math.min(18, task.affectedMatches * 2) + (task.source === "signal-reliability" ? 10 : 0);
  const blockerReduction = task.status === "ready" ? 32 : task.status === "blocked" ? 18 : 10;
  const actionFlipPotential = ["odds", "lineups", "injuries", "suspensions", "market", "portfolio"].some((key) => task.category.toLowerCase().includes(key)) ? 28 : 14;
  const learningValue = ["training", "calibration", "model", "odds"].some((key) => task.category.toLowerCase().includes(key)) ? 28 : 8;

  return finalizeCandidate({
    id: `info-refresh-${task.id}`,
    source: "evidence-refresh",
    label: task.label,
    category: task.category,
    matchId: null,
    match: null,
    command: task.command,
    verifyUrl: task.verifyUrl,
    missingEnv: task.missingEnv,
    expectedEvidence: task.expectedEvidence,
    decisionImpact: task.decisionImpact,
    expectedOutcomes: {
      ifSupports: `Reduce evidence-refresh pressure for ${task.label} and rerun the relevant trust gates.`,
      ifChallenges: "Downgrade or hold the current action until the contradiction is resolved.",
      ifMissing: task.riskIfSkipped
    },
    scoring: {
      uncertaintyReduction,
      blockerReduction,
      actionFlipPotential,
      learningValue,
      costPenalty: task.missingEnv.length * 14 + (task.mode === "dry-run" ? 8 : 0) + (task.status === "blocked" ? 10 : 0)
    }
  });
}

function hypothesisCandidate(experiment: DecisionHypothesisExperiment): DecisionInformationGainCandidate {
  const actionFlipPotential = experiment.actionIfFails !== experiment.actionIfPasses || experiment.projectedAction !== experiment.actionIfPasses ? 34 : 14;
  return finalizeCandidate({
    id: `info-hypothesis-${experiment.id}`,
    source: "hypothesis-lab",
    label: `Test ${experiment.hypothesisId}`,
    category: "hypothesis",
    matchId: experiment.matchId,
    match: experiment.match,
    command: experiment.command,
    verifyUrl: experiment.verifyUrl,
    missingEnv: [],
    expectedEvidence: experiment.expectedSignal,
    decisionImpact: experiment.test,
    expectedOutcomes: {
      ifSupports: `Keep ${experiment.actionIfPasses} only if the falsifier stays false and evidence supports the thesis.`,
      ifChallenges: `Move toward ${experiment.actionIfFails} if the falsifier is observed.`,
      ifMissing: "Keep the hypothesis in needs-evidence mode and do not raise trust."
    },
    scoring: {
      uncertaintyReduction: experiment.impactScore * 0.7,
      blockerReduction: experiment.status === "blocked" ? 8 : experiment.status === "needs-data" ? 22 : 28,
      actionFlipPotential,
      learningValue: 10,
      costPenalty: experiment.status === "blocked" ? 12 : 0
    }
  });
}

function counterfactualCandidate(item: DecisionCounterfactualCase): DecisionInformationGainCandidate {
  const severityValue = item.severity === "critical" ? 42 : item.severity === "high" ? 32 : item.severity === "medium" ? 20 : 8;
  const actionFlipPotential = item.survival === "breaks" ? 44 : item.survival === "downgrades" ? 30 : 10;
  return finalizeCandidate({
    id: `info-counterfactual-${item.id}`,
    source: "counterfactual-lab",
    label: item.label,
    category: item.type,
    matchId: item.matchId,
    match: item.match,
    command: item.command,
    verifyUrl: item.verifyUrl,
    missingEnv: [],
    expectedEvidence: item.falsifier,
    decisionImpact: item.mitigation,
    expectedOutcomes: {
      ifSupports: `The current ${item.baselineAction} action survives this ${item.type} shock but still cannot be promoted by one proof.`,
      ifChallenges: `Move toward ${item.actionAfterShock} because the ${item.type} shock ${item.survival}.`,
      ifMissing: "Keep the shock in watch mode and require a narrower provider or market proof."
    },
    scoring: {
      uncertaintyReduction: severityValue + Math.max(0, -(item.scoreDelta ?? 0)) * 0.6,
      blockerReduction: item.survival === "breaks" ? 30 : item.survival === "downgrades" ? 18 : 6,
      actionFlipPotential,
      learningValue: 8,
      costPenalty: 0
    }
  });
}

function beliefCandidate(item: DecisionBeliefRevisionItem): DecisionInformationGainCandidate {
  const actionFlipPotential = item.revisedAction !== item.baselineAction ? 36 : 10;
  return finalizeCandidate({
    id: `info-belief-${item.id}`,
    source: "belief-revision",
    label: `${item.match} belief revision`,
    category: item.status,
    matchId: item.matchId,
    match: item.match,
    command: item.command,
    verifyUrl: item.verifyUrl,
    missingEnv: [],
    expectedEvidence: item.requiredEvidence[0] ?? item.reason,
    decisionImpact: item.reason,
    expectedOutcomes: {
      ifSupports: `Hold or weaken no further only if evidence supports the revised ${item.revisedAction} posture.`,
      ifChallenges: `Move from ${item.baselineAction} toward ${item.revisedAction} or avoid if the proof contradicts the belief.`,
      ifMissing: "Keep the belief capped and require the next evidence item before trust can rise."
    },
    scoring: {
      uncertaintyReduction: item.revisionScore * 0.65,
      blockerReduction: item.status === "retiring" ? 36 : item.status === "needs-evidence" ? 30 : item.status === "weakening" ? 16 : 6,
      actionFlipPotential,
      learningValue: item.requiredEvidence.some((value) => value.toLowerCase().includes("calibration") || value.toLowerCase().includes("learning")) ? 24 : 10,
      costPenalty: 0
    }
  });
}

function dataIntakeCandidate(dataIntake: DecisionDataIntakeQueue): DecisionInformationGainCandidate | null {
  const item = dataIntake.nextItem;
  if (!item) return null;
  return finalizeCandidate({
    id: `info-data-intake-${item.category}`,
    source: "data-intake",
    label: item.label,
    category: item.category,
    matchId: null,
    match: null,
    command: item.command,
    verifyUrl: item.verifyUrl,
    missingEnv: item.missingEnv,
    expectedEvidence: item.expectedEvidence,
    decisionImpact: item.decisionImpact,
    expectedOutcomes: {
      ifSupports: `Convert ${item.label.toLowerCase()} from weak evidence into provider-backed input for affected matches.`,
      ifChallenges: "Keep the slate in avoid/monitor until provider data quality is repaired.",
      ifMissing: "Leave trust capped because the data-intake blocker remains unresolved."
    },
    scoring: {
      uncertaintyReduction: priorityScore(item.priority) + Math.min(24, item.affectedMatches * 2),
      blockerReduction: item.status === "blocked" ? 30 : item.status === "needs-provider" ? 24 : 10,
      actionFlipPotential: ["odds", "lineups", "injuries", "suspensions"].includes(item.category) ? 34 : 14,
      learningValue: item.category === "training" || item.category === "historical-results" ? 32 : 8,
      costPenalty: item.missingEnv.length * 14
    }
  });
}

function candidateSort(a: DecisionInformationGainCandidate, b: DecisionInformationGainCandidate): number {
  const statusRank: Record<DecisionInformationGainCandidateStatus, number> = { ready: 4, waiting: 3, "needs-env": 2, blocked: 1 };
  return (
    b.scoring.informationGainScore - a.scoring.informationGainScore ||
    statusRank[b.status] - statusRank[a.status] ||
    Number(b.safeToRun) - Number(a.safeToRun) ||
    a.label.localeCompare(b.label)
  );
}

function dedupeCandidates(candidates: DecisionInformationGainCandidate[]): DecisionInformationGainCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.command ?? candidate.verifyUrl ?? candidate.id}:${candidate.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function plannerStatus(candidates: DecisionInformationGainCandidate[]): DecisionInformationGainStatus {
  if (candidates.some((item) => item.safeToRun && item.status === "ready")) return "ready";
  if (candidates.some((item) => item.status === "waiting" || item.status === "needs-env")) return "waiting";
  return "blocked";
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

export function buildDecisionInformationGainPlanner({
  date,
  sport,
  dataIntake,
  evidenceRefresh,
  hypothesisLab,
  counterfactualLab,
  beliefRevision,
  now = new Date(),
  limit = 12
}: {
  date: string;
  sport: Sport;
  dataIntake: DecisionDataIntakeQueue;
  evidenceRefresh: DecisionEvidenceRefreshScheduler;
  hypothesisLab: DecisionHypothesisLab;
  counterfactualLab: DecisionCounterfactualLab;
  beliefRevision?: DecisionBeliefRevision | null;
  now?: Date;
  limit?: number;
}): DecisionInformationGainPlanner {
  const dataCandidate = dataIntakeCandidate(dataIntake);
  const allCandidates = dedupeCandidates(
    [
      ...evidenceRefresh.tasks.map(evidenceCandidate),
      ...hypothesisLab.experiments.map(hypothesisCandidate),
      ...counterfactualLab.cases.map(counterfactualCandidate),
      ...(beliefRevision?.revisions.map(beliefCandidate) ?? []),
      ...(dataCandidate ? [dataCandidate] : [])
    ].sort(candidateSort)
  );
  const candidates = allCandidates.slice(0, Math.max(1, Math.min(40, limit))).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const nextCandidate = candidates.find((item) => item.safeToRun && item.status === "ready") ?? candidates[0] ?? null;
  const status = plannerStatus(candidates);
  const informationHash = stableHash({
    date,
    sport,
    status,
    evidenceRefresh: evidenceRefresh.refreshHash,
    hypothesis: [hypothesisLab.status, hypothesisLab.nextExperiment?.id],
    counterfactual: [counterfactualLab.status, counterfactualLab.activeCase?.id],
    beliefRevision: beliefRevision?.revisionHash ?? null,
    candidates: candidates.map((item) => [item.id, item.status, item.scoring.informationGainScore])
  });
  const scores = candidates.map((item) => item.scoring.informationGainScore);

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "information-gain-planner",
    status,
    informationHash,
    summary:
      status === "ready"
        ? `Information-gain planner found ${candidates.filter((item) => item.safeToRun).length} runnable proof candidate(s); next is ${nextCandidate?.label ?? "none"}.`
        : status === "waiting"
          ? `Information-gain planner is waiting on env or evidence for ${candidates.filter((item) => item.status === "needs-env" || item.status === "waiting").length} candidate(s).`
          : "Information-gain planner is blocked; no candidate can safely reduce uncertainty right now.",
    nextCandidate,
    candidates,
    totals: {
      candidates: allCandidates.length,
      ready: allCandidates.filter((item) => item.status === "ready").length,
      needsEnv: allCandidates.filter((item) => item.status === "needs-env").length,
      blocked: allCandidates.filter((item) => item.status === "blocked").length,
      waiting: allCandidates.filter((item) => item.status === "waiting").length,
      safeToRun: allCandidates.filter((item) => item.safeToRun).length,
      averageInformationGain: average(scores),
      maxInformationGain: scores[0] ?? 0
    },
    focus: {
      question: nextCandidate ? `Which evidence would most change the ${sport} decision state?` : "No evidence candidate is available.",
      whyNow: nextCandidate ? compact(nextCandidate.reason) : "No candidate survived information-gain ranking.",
      expectedDecisionChange: nextCandidate
        ? compact(`${nextCandidate.expectedOutcomes.ifSupports} ${nextCandidate.expectedOutcomes.ifChallenges}`, 300)
        : "No decision change is allowed.",
      proofUrl: nextCandidate?.verifyUrl ?? null
    },
    controls: {
      canRunReadOnly: allCandidates.some((item) => item.safeToRun && item.mode === "read-only"),
      canRunDryRun: allCandidates.some((item) => item.safeToRun && item.mode === "dry-run"),
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRaiseTrust: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique(
      [
        "/api/sports/decision/information-gain",
        "/api/sports/decision/evidence-refresh",
        "/api/sports/decision/hypothesis-lab",
        "/api/sports/decision/counterfactual-lab",
        "/api/sports/decision/belief-revision",
        ...candidates.map((item) => item.verifyUrl)
      ],
      18
    ),
    forbiddenActions: [
      "Do not treat information-gain score as permission to publish, persist, train, stake, or raise trust.",
      "Do not run dry-run provider commands while required environment variables are missing.",
      "Do not upgrade the public action from a single proof candidate.",
      "Do not replace provider evidence with AI-generated text."
    ]
  };
}
