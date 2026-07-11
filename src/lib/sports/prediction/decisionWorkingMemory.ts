import { buildDecisionSlateThinking, type DecisionSlateThinking, type DecisionSlateThoughtPriority } from "@/lib/sports/prediction/decisionSlateThinking";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionWorkingMemoryStatus = "ready" | "needs-evidence" | "blocked";
export type DecisionWorkingMemoryMode = "read-only-blackboard";
export type DecisionWorkingMemoryCellKind = "fact" | "assumption" | "doubt" | "blocker" | "next-action" | "learning" | "guardrail";
export type DecisionWorkingMemoryCellStatus = "known" | "assumed" | "open" | "blocked" | "queued" | "locked";
export type DecisionWorkingMemoryPriority = "critical" | "high" | "medium" | "low";

export type DecisionWorkingMemoryCell = {
  id: string;
  kind: DecisionWorkingMemoryCellKind;
  status: DecisionWorkingMemoryCellStatus;
  priority: DecisionWorkingMemoryPriority;
  label: string;
  source: string;
  matchId: string | null;
  detail: string;
  evidence: string[];
  command: string | null;
  verifyUrl: string | null;
};

export type DecisionWorkingMemoryFocus = {
  matchId: string | null;
  match: string | null;
  selection: string | null;
  thoughtStatus: string | null;
  workScore: number | null;
  nextEvidenceAction: string;
};

export type DecisionWorkingMemory = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionWorkingMemoryStatus;
  mode: DecisionWorkingMemoryMode;
  memoryHash: string;
  summary: string;
  focus: DecisionWorkingMemoryFocus;
  counts: {
    total: number;
    facts: number;
    assumptions: number;
    doubts: number;
    blockers: number;
    nextActions: number;
    learning: number;
    guardrails: number;
  };
  attention: {
    currentBelief: string;
    primaryDoubt: string;
    decisiveUnknown: string;
    safestNextAction: string;
    safeCommand: string | null;
    verifyUrl: string | null;
    whyNow: string;
  };
  cells: DecisionWorkingMemoryCell[];
  policy: {
    canPromote: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    rule: string;
    verificationUrl: string;
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

function compact(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 8): string[] {
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

function matchLabel(row: DecisionRow): string {
  return `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`;
}

function commandFor(matchId: string): string {
  return decisionCurlCommand(`/api/sports/decision/${encodeURIComponent(matchId)}`);
}

function verifyUrl(matchId: string): string {
  return `/api/sports/decision/${encodeURIComponent(matchId)}`;
}

function priorityFromSlate(priority: DecisionSlateThoughtPriority): DecisionWorkingMemoryPriority {
  return priority;
}

function cell(input: DecisionWorkingMemoryCell): DecisionWorkingMemoryCell {
  return {
    ...input,
    detail: compact(input.detail, 260),
    evidence: unique(input.evidence, 6)
  };
}

function rowCells(row: DecisionRow, slate: DecisionSlateThinking): DecisionWorkingMemoryCell[] {
  const decision = row.prediction.decision;
  const bestPick = row.prediction.bestPick;
  const match = matchLabel(row);
  const thought = slate.thoughts.find((item) => item.matchId === row.match.id) ?? slate.nextThought;
  const priority = thought ? priorityFromSlate(thought.priority) : decision.controlPolicy.status === "blocked" ? "critical" : "medium";
  const evidenceGaps = unique([
    ...decision.dataCoverage.requiredBeforeTrust,
    ...decision.researchBrief.dataGaps,
    ...decision.researchBrief.requiredChecks,
    ...decision.nextChecks
  ]);
  const blockers = unique([
    ...decision.actionability.blockers,
    ...decision.controlPolicy.gates.filter((gate) => gate.status === "block").map((gate) => `${gate.label}: ${gate.detail}`),
    decision.controlPolicy.status === "blocked" ? decision.controlPolicy.primaryDirective : null,
    decision.aiProtocol.status === "blocked" ? decision.aiProtocol.summary : null
  ]);
  const doubts = unique([
    decision.deliberation.dissentingThesis,
    decision.uncertainty.primaryUncertainty,
    ...decision.marketMovement.alerts,
    ...decision.robustness.requiredRechecks,
    ...decision.committee.unresolvedDisagreements
  ]);
  const assumptions = unique([
    ...decision.notebook.assumptions.map((item) => `${item.label}: ${item.detail}`),
    decision.dataCoverage.mockSignals > 0 ? `${decision.dataCoverage.mockSignals} mock signal(s) still influence this decision.` : null,
    decision.caseMemory.status === "not-configured" || decision.caseMemory.status === "no-memory" ? decision.caseMemory.summary : null
  ]);
  const learningTarget =
    decision.evaluationPlan.learningQuestions[0] ??
    decision.evaluationPlan.postMatchActions[0] ??
    "Track settlement, closing-line value, and calibration after the match.";

  return [
    cell({
      id: `fact-belief-${row.match.id}`,
      kind: "fact",
      status: "known",
      priority: "low",
      label: `${match} belief`,
      source: "decision.beliefState",
      matchId: row.match.id,
      detail: decision.beliefState.summary,
      evidence: [
        bestPick.hasValue ? `best:${bestPick.label}` : "No clear value found",
        bestPick.hasValue ? `edge:${bestPick.edge.toFixed(4)}` : "",
        bestPick.hasValue ? `ev:${bestPick.expectedValue.toFixed(4)}` : "",
        `confidence:${decision.confidence}`,
        `risk:${decision.risk}`
      ],
      command: commandFor(row.match.id),
      verifyUrl: verifyUrl(row.match.id)
    }),
    cell({
      id: `fact-odds-${row.match.id}`,
      kind: "fact",
      status: "known",
      priority: "low",
      label: `${match} odds intelligence`,
      source: "decision.oddsIntelligence",
      matchId: row.match.id,
      detail: decision.oddsIntelligence.summary,
      evidence: [
        `status:${decision.oddsIntelligence.status}`,
        `markets:${decision.oddsIntelligence.totalMarkets}`,
        `actionable:${decision.oddsIntelligence.actionableSelections}`,
        decision.marketMovement.summary
      ],
      command: commandFor(row.match.id),
      verifyUrl: verifyUrl(row.match.id)
    }),
    cell({
      id: `assumption-data-${row.match.id}`,
      kind: "assumption",
      status: decision.dataCoverage.status === "provider-backed" ? "known" : "assumed",
      priority: decision.dataCoverage.requiredBeforeTrust.length ? "high" : decision.dataCoverage.status === "provider-backed" ? "low" : "medium",
      label: `${match} data coverage`,
      source: "decision.dataCoverage",
      matchId: row.match.id,
      detail: decision.dataCoverage.summary,
      evidence: [
        `score:${decision.dataCoverage.score}`,
        `provider:${decision.dataCoverage.providerBackedSignals}`,
        `mock:${decision.dataCoverage.mockSignals}`,
        `missing:${decision.dataCoverage.missingSignals}`,
        ...assumptions
      ],
      command: commandFor(row.match.id),
      verifyUrl: verifyUrl(row.match.id)
    }),
    ...doubts.slice(0, 2).map((detail, index) =>
      cell({
        id: `doubt-${row.match.id}-${index + 1}`,
        kind: "doubt",
        status: "open",
        priority: index === 0 ? priority : "medium",
        label: `${match} doubt ${index + 1}`,
        source: index === 0 ? "decision.deliberation" : "decision.risk",
        matchId: row.match.id,
        detail,
        evidence: [decision.deliberation.dissentingThesis, decision.uncertainty.summary, decision.robustness.summary],
        command: commandFor(row.match.id),
        verifyUrl: verifyUrl(row.match.id)
      })
    ),
    ...blockers.slice(0, 3).map((detail, index) =>
      cell({
        id: `blocker-${row.match.id}-${index + 1}`,
        kind: "blocker",
        status: "blocked",
        priority: index === 0 ? "critical" : "high",
        label: `${match} blocker ${index + 1}`,
        source: "decision.controlPolicy",
        matchId: row.match.id,
        detail,
        evidence: [decision.controlPolicy.summary, decision.actionability.summary, decision.aiProtocol.summary],
        command: commandFor(row.match.id),
        verifyUrl: verifyUrl(row.match.id)
      })
    ),
    cell({
      id: `next-action-${row.match.id}`,
      kind: "next-action",
      status: "queued",
      priority,
      label: `${match} next evidence`,
      source: "decisionWorkingMemory",
      matchId: row.match.id,
      detail: thought?.nextEvidenceAction ?? evidenceGaps[0] ?? decision.controlPolicy.nextBestAction ?? "Re-run the decision with fresh evidence.",
      evidence: [thought?.synthesis ?? "", ...evidenceGaps, decision.controlPolicy.nextBestAction ?? ""],
      command: commandFor(row.match.id),
      verifyUrl: verifyUrl(row.match.id)
    }),
    cell({
      id: `learning-${row.match.id}`,
      kind: "learning",
      status: "queued",
      priority: decision.evaluationPlan.status === "track-value" ? "medium" : "low",
      label: `${match} learning target`,
      source: "decision.evaluationPlan",
      matchId: row.match.id,
      detail: learningTarget,
      evidence: [decision.evaluationPlan.summary, decision.caseMemory.summary, decision.calibration.detail],
      command: null,
      verifyUrl: "/api/sports/decision/memory"
    }),
    cell({
      id: `guardrail-${row.match.id}`,
      kind: "guardrail",
      status: "locked",
      priority: decision.controlPolicy.publishAllowed || decision.controlPolicy.persistAllowed ? "medium" : "high",
      label: `${match} guardrail`,
      source: "decision.controlPolicy",
      matchId: row.match.id,
      detail: decision.controlPolicy.primaryDirective,
      evidence: [...decision.controlPolicy.forbiddenActions.slice(0, 3), ...decision.controlPolicy.releaseCriteria.slice(0, 2)],
      command: null,
      verifyUrl: verifyUrl(row.match.id)
    })
  ];
}

function sortCells(cells: DecisionWorkingMemoryCell[]): DecisionWorkingMemoryCell[] {
  const priorityRank: Record<DecisionWorkingMemoryPriority, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const kindRank: Record<DecisionWorkingMemoryCellKind, number> = {
    blocker: 7,
    "next-action": 6,
    doubt: 5,
    assumption: 4,
    guardrail: 3,
    learning: 2,
    fact: 1
  };
  return cells.slice().sort((a, b) => {
    const priority = priorityRank[b.priority] - priorityRank[a.priority];
    if (priority !== 0) return priority;
    const kind = kindRank[b.kind] - kindRank[a.kind];
    if (kind !== 0) return kind;
    return a.id.localeCompare(b.id);
  });
}

function counts(cells: DecisionWorkingMemoryCell[]): DecisionWorkingMemory["counts"] {
  return {
    total: cells.length,
    facts: cells.filter((item) => item.kind === "fact").length,
    assumptions: cells.filter((item) => item.kind === "assumption").length,
    doubts: cells.filter((item) => item.kind === "doubt").length,
    blockers: cells.filter((item) => item.kind === "blocker").length,
    nextActions: cells.filter((item) => item.kind === "next-action").length,
    learning: cells.filter((item) => item.kind === "learning").length,
    guardrails: cells.filter((item) => item.kind === "guardrail").length
  };
}

function statusFromCounts(value: DecisionWorkingMemory["counts"]): DecisionWorkingMemoryStatus {
  if (value.blockers > 0 || value.total === 0) return "blocked";
  if (value.doubts > 0 || value.assumptions > 0 || value.nextActions > 0) return "needs-evidence";
  return "ready";
}

export function buildDecisionWorkingMemory({
  rows,
  date,
  sport,
  slateThinking,
  limit = 24
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  slateThinking?: DecisionSlateThinking;
  limit?: number;
}): DecisionWorkingMemory {
  const slate = slateThinking ?? buildDecisionSlateThinking({ rows, date, sport, limit: Math.max(8, limit) });
  const focusThought = slate.nextThought;
  const sortedCells = sortCells(rows.flatMap((row) => rowCells(row, slate)));
  const cells = sortedCells.slice(0, Math.max(1, Math.min(80, limit)));
  const cellCounts = counts(sortedCells);
  const status = statusFromCounts(cellCounts);
  const primaryBlocker = sortedCells.find((item) => item.kind === "blocker");
  const primaryDoubt = sortedCells.find((item) => item.kind === "doubt");
  const primaryUnknown = sortedCells.find((item) => item.kind === "next-action" || item.kind === "assumption");
  const firstFact = sortedCells.find((item) => item.kind === "fact");
  const safeAction = focusThought?.nextEvidenceAction ?? primaryUnknown?.detail ?? "Re-run the decision workspace with fresh evidence.";
  const safeCommand = focusThought?.safeCommand ?? primaryUnknown?.command ?? null;
  const verify = focusThought?.verifyUrl ?? primaryUnknown?.verifyUrl ?? "/api/sports/decision/working-memory";
  const memoryHash = stableHash({
    date,
    sport,
    status,
    slate: slate.thinkingHash,
    cells: sortedCells.map((item) => [item.id, item.kind, item.status, item.priority, item.detail])
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    mode: "read-only-blackboard",
    memoryHash,
    summary:
      status === "blocked"
        ? `Working memory is blocked by ${cellCounts.blockers} blocker(s); safest next evidence is ${safeAction}`
        : status === "needs-evidence"
          ? `Working memory needs evidence across ${cellCounts.doubts + cellCounts.assumptions + cellCounts.nextActions} open item(s); safest next evidence is ${safeAction}`
          : "Working memory is ready; no blocker or open evidence item owns the slate.",
    focus: {
      matchId: focusThought?.matchId ?? null,
      match: focusThought?.match ?? null,
      selection: focusThought?.selection ?? null,
      thoughtStatus: focusThought?.status ?? null,
      workScore: focusThought?.workScore ?? null,
      nextEvidenceAction: safeAction
    },
    counts: cellCounts,
    attention: {
      currentBelief: firstFact?.detail ?? "No current belief has been loaded.",
      primaryDoubt: primaryDoubt?.detail ?? "No primary doubt is currently open.",
      decisiveUnknown: primaryUnknown?.detail ?? "No decisive unknown is currently open.",
      safestNextAction: safeAction,
      safeCommand,
      verifyUrl: verify,
      whyNow: primaryBlocker?.detail ?? focusThought?.synthesis ?? "The blackboard is waiting for the next proof signal."
    },
    cells,
    policy: {
      canPromote: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      rule: "Working memory is inspect-only: it can focus attention and verify evidence, but it cannot promote, persist, publish, or train.",
      verificationUrl: `/api/sports/decision/working-memory?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`
    }
  };
}
