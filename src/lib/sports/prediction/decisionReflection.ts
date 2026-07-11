import { buildDecisionSlateThinking, type DecisionSlateThinking } from "@/lib/sports/prediction/decisionSlateThinking";
import { buildDecisionWorkingMemory, type DecisionWorkingMemory, type DecisionWorkingMemoryCell } from "@/lib/sports/prediction/decisionWorkingMemory";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionReflectionStatus = "clear" | "watching" | "blocked";
export type DecisionReflectionRisk =
  | "overconfidence"
  | "data-gap"
  | "action-drift"
  | "memory-gap"
  | "market-fragility"
  | "provider-missing"
  | "guardrail-lock";
export type DecisionReflectionItemStatus = "pass" | "watch" | "block";
export type DecisionReflectionPriority = "critical" | "high" | "medium" | "low";

export type DecisionReflectionItem = {
  id: string;
  risk: DecisionReflectionRisk;
  status: DecisionReflectionItemStatus;
  priority: DecisionReflectionPriority;
  question: string;
  finding: string;
  evidence: string[];
  requiredChange: string;
  verifyUrl: string;
  command: string | null;
};

export type DecisionReflection = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionReflectionStatus;
  reflectionHash: string;
  summary: string;
  score: number;
  focus: {
    matchId: string | null;
    match: string | null;
    selection: string | null;
    currentBelief: string;
    reflectionMode: "red-team-working-memory";
  };
  counts: {
    total: number;
    pass: number;
    watch: number;
    block: number;
  };
  items: DecisionReflectionItem[];
  nextReflection: DecisionReflectionItem | null;
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

function boundScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function commandFor(path: string): string {
  return decisionCurlCommand(path);
}

function cellsOf(memory: DecisionWorkingMemory, kind: DecisionWorkingMemoryCell["kind"]): DecisionWorkingMemoryCell[] {
  return memory.cells.filter((item) => item.kind === kind);
}

function cellEvidence(cells: DecisionWorkingMemoryCell[], limit = 5): string[] {
  return unique(
    cells.flatMap((item) => [item.detail, item.evidence[0], item.evidence[1]]),
    limit
  );
}

function priorityRank(priority: DecisionReflectionPriority): number {
  if (priority === "critical") return 4;
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function statusRank(status: DecisionReflectionItemStatus): number {
  if (status === "block") return 3;
  if (status === "watch") return 2;
  return 1;
}

function item(input: DecisionReflectionItem): DecisionReflectionItem {
  return {
    ...input,
    finding: compact(input.finding, 260),
    requiredChange: compact(input.requiredChange, 240),
    evidence: unique(input.evidence, 6).map((value) => compact(value, 220))
  };
}

function sortItems(items: DecisionReflectionItem[]): DecisionReflectionItem[] {
  return items.slice().sort((a, b) => {
    const status = statusRank(b.status) - statusRank(a.status);
    if (status !== 0) return status;
    const priority = priorityRank(b.priority) - priorityRank(a.priority);
    if (priority !== 0) return priority;
    return a.id.localeCompare(b.id);
  });
}

function reflectionStatus(items: DecisionReflectionItem[]): DecisionReflectionStatus {
  if (items.some((entry) => entry.status === "block")) return "blocked";
  if (items.some((entry) => entry.status === "watch")) return "watching";
  return "clear";
}

function itemCounts(items: DecisionReflectionItem[]): DecisionReflection["counts"] {
  return {
    total: items.length,
    pass: items.filter((entry) => entry.status === "pass").length,
    watch: items.filter((entry) => entry.status === "watch").length,
    block: items.filter((entry) => entry.status === "block").length
  };
}

function evidenceText(row: DecisionRow): string {
  const decision = row.prediction.decision;
  const bestPick = row.prediction.bestPick;
  return unique([
    bestPick.hasValue ? `value edge ${bestPick.edge.toFixed(4)} and EV ${bestPick.expectedValue.toFixed(4)}` : "no positive-EV best pick",
    decision.beliefState.summary,
    decision.dataCoverage.summary,
    decision.marketMovement.summary,
    decision.controlPolicy.summary
  ]).join(" | ");
}

function buildReflectionItems({
  rows,
  memory,
  slate
}: {
  rows: DecisionRow[];
  memory: DecisionWorkingMemory;
  slate: DecisionSlateThinking;
}): DecisionReflectionItem[] {
  const blockerCells = cellsOf(memory, "blocker");
  const guardrailCells = cellsOf(memory, "guardrail");
  const assumptionCells = cellsOf(memory, "assumption");
  const doubtCells = cellsOf(memory, "doubt");
  const nextActionCells = cellsOf(memory, "next-action");
  const learningCells = cellsOf(memory, "learning");
  const focusThought = slate.nextThought;
  const focusRow = focusThought ? rows.find((row) => row.match.id === focusThought.matchId) : rows[0];
  const providerGapRows = rows.filter(
    (row) =>
      row.prediction.decision.dataCoverage.status !== "provider-backed" ||
      row.prediction.decision.dataCoverage.mockSignals > 0 ||
      row.prediction.decision.dataCoverage.missingSignals > 0
  );
  const fragileRows = rows.filter(
    (row) =>
      row.prediction.decision.marketMovement.status === "fragile" ||
      row.prediction.decision.marketMovement.status === "sensitive" ||
      row.prediction.decision.robustness.status !== "robust"
  );
  const valueRows = rows.filter(
    (row) =>
      row.prediction.bestPick.hasValue &&
      (row.prediction.bestPick.edge >= 0.02 || row.prediction.bestPick.expectedValue >= 0.03 || row.prediction.decision.decisionScore >= 70)
  );
  const memoryGapRows = rows.filter(
    (row) =>
      row.prediction.decision.caseMemory.status === "not-configured" ||
      row.prediction.decision.caseMemory.status === "no-memory" ||
      row.prediction.decision.calibration.health !== "stable"
  );
  const items: DecisionReflectionItem[] = [];

  items.push(
    item({
      id: "reflection-guardrail-lock",
      risk: "guardrail-lock",
      status: blockerCells.length > 0 || memory.status === "blocked" ? "block" : "pass",
      priority: blockerCells.length > 0 ? "critical" : "medium",
      question: "Do control-policy guardrails allow this slate to be trusted yet?",
      finding:
        blockerCells.length > 0
          ? `Working memory has ${blockerCells.length} visible blocker cell(s) and ${guardrailCells.length} locked guardrail cell(s).`
          : `No blocker cells are visible, but ${guardrailCells.length} guardrail cell(s) still keep the slate inspect-only.`,
      evidence: cellEvidence([...blockerCells, ...guardrailCells], 6),
      requiredChange: "Clear the blocking control-policy gates with provider-backed evidence before any promotion, persistence, publishing, or training.",
      verifyUrl: memory.policy.verificationUrl,
      command: commandFor(memory.policy.verificationUrl)
    })
  );

  items.push(
    item({
      id: "reflection-action-drift",
      risk: "action-drift",
      status: focusThought?.status === "blocked" || memory.status === "blocked" ? "block" : focusThought?.status === "contested" || focusThought?.status === "unproven" ? "watch" : "pass",
      priority: focusThought?.status === "blocked" || memory.status === "blocked" ? "critical" : "high",
      question: "Would acting on the current focus drift beyond the safest authorized posture?",
      finding: focusThought
        ? `${focusThought.match} is ${focusThought.status}; selection ${focusThought.selection ?? "none"} cannot outrun the current control state.`
        : "No slate focus exists, so the engine has nothing safe to act on.",
      evidence: unique([focusThought?.synthesis, focusThought?.nextEvidenceAction, memory.attention.whyNow, focusRow ? evidenceText(focusRow) : null], 6),
      requiredChange: "Re-run the focused decision and require authority, firewall, and control policy to remain same-or-safer before showing stronger posture.",
      verifyUrl: focusThought?.verifyUrl ?? memory.attention.verifyUrl ?? memory.policy.verificationUrl,
      command: focusThought?.safeCommand ?? memory.attention.safeCommand ?? commandFor(memory.policy.verificationUrl)
    })
  );

  items.push(
    item({
      id: "reflection-data-gap",
      risk: "data-gap",
      status: assumptionCells.length > 0 || nextActionCells.length > 0 ? "block" : "pass",
      priority: assumptionCells.length > 0 || nextActionCells.length > 0 ? "high" : "medium",
      question: "Which unproven assumptions could flip the current model-market edge?",
      finding:
        assumptionCells.length > 0 || nextActionCells.length > 0
          ? `The blackboard still carries ${assumptionCells.length} assumption cell(s) and ${nextActionCells.length} queued evidence action(s).`
          : "No assumption or queued-evidence cells are visible in working memory.",
      evidence: cellEvidence([...assumptionCells, ...nextActionCells], 6),
      requiredChange: "Resolve the first data gap with fixture, odds, lineup, injury/news, standings, or historical-corpus proof before trust rises.",
      verifyUrl: memory.attention.verifyUrl ?? memory.policy.verificationUrl,
      command: memory.attention.safeCommand ?? commandFor(memory.policy.verificationUrl)
    })
  );

  items.push(
    item({
      id: "reflection-provider-missing",
      risk: "provider-missing",
      status: providerGapRows.length > 0 ? "block" : "pass",
      priority: providerGapRows.length > 0 ? "high" : "medium",
      question: "Is the slate relying on mock, missing, or partial provider signals?",
      finding:
        providerGapRows.length > 0
          ? `${providerGapRows.length} match(es) still need stronger provider-backed fixture, odds, context, or training signals.`
          : "Every inspected match reports provider-backed data coverage.",
      evidence: unique(providerGapRows.slice(0, 4).map(evidenceText), 6),
      requiredChange: "Run the provider dry-run or corpus backfill proof and keep write-mode disabled until the provider records are verified.",
      verifyUrl: "/api/sports/decision/data-intake",
      command: commandFor("/api/sports/decision/data-intake")
    })
  );

  items.push(
    item({
      id: "reflection-market-fragility",
      risk: "market-fragility",
      status: fragileRows.length > 0 || doubtCells.length > 0 ? "watch" : "pass",
      priority: fragileRows.length > 0 ? "high" : "medium",
      question: "Would a realistic price move, lineup shock, or robustness case erase the edge?",
      finding:
        fragileRows.length > 0 || doubtCells.length > 0
          ? `${fragileRows.length} match(es) have market or robustness fragility, with ${doubtCells.length} open doubt cell(s).`
          : "No visible market fragility or robustness doubt owns the slate.",
      evidence: unique([...fragileRows.slice(0, 4).map(evidenceText), ...cellEvidence(doubtCells, 4)], 6),
      requiredChange: "Refresh odds, rerun counterfactual shocks, and keep the pick watch-only if fair-odds buffer or robustness survival weakens.",
      verifyUrl: "/api/sports/decision/counterfactual-lab",
      command: commandFor("/api/sports/decision/counterfactual-lab")
    })
  );

  items.push(
    item({
      id: "reflection-memory-gap",
      risk: "memory-gap",
      status: memoryGapRows.length > 0 || learningCells.length > 0 ? "watch" : "pass",
      priority: memoryGapRows.length > 0 ? "high" : "medium",
      question: "Does historical memory or calibration justify letting this belief grow stronger?",
      finding:
        memoryGapRows.length > 0 || learningCells.length > 0
          ? `${memoryGapRows.length} match(es) lack healthy memory/calibration support, with ${learningCells.length} learning target(s) queued.`
          : "Case memory and calibration do not currently create a visible learning gap.",
      evidence: unique([...memoryGapRows.slice(0, 4).map(evidenceText), ...cellEvidence(learningCells, 4)], 6),
      requiredChange: "Read recent decision memory, settle outcomes, and run calibration/backtest proof before learned guardrails can affect live decisions.",
      verifyUrl: "/api/sports/decision/memory",
      command: commandFor("/api/sports/decision/memory")
    })
  );

  items.push(
    item({
      id: "reflection-overconfidence",
      risk: "overconfidence",
      status: valueRows.length > 0 && (memory.counts.blockers > 0 || memory.counts.assumptions > 0 || memory.counts.doubts > 0) ? "watch" : "pass",
      priority: valueRows.length > 0 ? "high" : "medium",
      question: "Is a positive EV number making the agent ignore blockers, assumptions, or doubts?",
      finding:
        valueRows.length > 0
          ? `${valueRows.length} positive-looking value candidate(s) must still be discounted by ${memory.counts.blockers} blocker(s), ${memory.counts.assumptions} assumption(s), and ${memory.counts.doubts} doubt(s).`
          : "No high-edge candidate is visible enough to create overconfidence pressure.",
      evidence: unique(valueRows.slice(0, 5).map(evidenceText), 6),
      requiredChange: "Keep the action at the same or safer level until data gaps, odds movement, and guardrail checks are reverified after the latest market/context refresh.",
      verifyUrl: "/api/sports/decision/model-ensemble",
      command: commandFor("/api/sports/decision/model-ensemble")
    })
  );

  return sortItems(items);
}

export function buildDecisionReflection({
  rows,
  date,
  sport,
  workingMemory,
  slateThinking,
  limit = 8
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  workingMemory?: DecisionWorkingMemory;
  slateThinking?: DecisionSlateThinking;
  limit?: number;
}): DecisionReflection {
  const slate = slateThinking ?? buildDecisionSlateThinking({ rows, date, sport, limit: Math.max(8, limit) });
  const memory = workingMemory ?? buildDecisionWorkingMemory({ rows, date, sport, slateThinking: slate, limit: Math.max(24, limit * 3) });
  const allItems = buildReflectionItems({ rows, memory, slate });
  const items = allItems.slice(0, Math.max(1, Math.min(20, limit)));
  const counts = itemCounts(allItems);
  const status = reflectionStatus(allItems);
  const score = boundScore(100 - counts.block * 12 - counts.watch * 5 - memory.counts.blockers * 4 - memory.counts.assumptions * 2 - memory.counts.doubts * 2);
  const nextReflection = items.find((entry) => entry.status === "block") ?? items.find((entry) => entry.status === "watch") ?? items[0] ?? null;
  const reflectionHash = stableHash({
    date,
    sport,
    memory: memory.memoryHash,
    slate: slate.thinkingHash,
    score,
    status,
    items: allItems.map((entry) => [entry.id, entry.status, entry.priority, entry.finding])
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    reflectionHash,
    summary: nextReflection
      ? `Reflection is ${status}; the agent must answer "${nextReflection.question}" before trust can rise.`
      : "Reflection is clear; no red-team item owns the slate.",
    score,
    focus: {
      matchId: memory.focus.matchId,
      match: memory.focus.match,
      selection: memory.focus.selection,
      currentBelief: memory.attention.currentBelief,
      reflectionMode: "red-team-working-memory"
    },
    counts,
    items,
    nextReflection,
    policy: {
      canPromote: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      rule: "Reflection can lower trust or demand proof; it cannot promote, persist, publish, train, or override control policy.",
      verificationUrl: `/api/sports/decision/reflection?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`
    }
  };
}
