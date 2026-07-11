import type { DecisionDataAuthority } from "@/lib/sports/prediction/decisionDataAuthority";
import type { DecisionAction, Match, Prediction, Sport } from "@/lib/sports/types";

export type DecisionWorldModelStatus = "observe-ready" | "waiting-on-data" | "training-locked" | "blocked";
export type DecisionWorldModelCellKind = "match-belief" | "data-authority" | "market" | "learning" | "supabase";
export type DecisionWorldModelCellStatus = "stable" | "volatile" | "uncertain" | "blocked";

export type DecisionWorldModelCell = {
  id: string;
  kind: DecisionWorldModelCellKind;
  label: string;
  status: DecisionWorldModelCellStatus;
  matchId: string | null;
  action: DecisionAction | "hold";
  pressureScore: number;
  belief: {
    probability: number | null;
    expectedValue: number | null;
    uncertainty: number | null;
  };
  support: string[];
  challenge: string[];
  updateRule: string;
  falsifier: string;
  nextObservation: string;
};

export type DecisionWorldModel = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-world-model";
  status: DecisionWorldModelStatus;
  worldHash: string;
  summary: string;
  cells: DecisionWorldModelCell[];
  topCell: DecisionWorldModelCell | null;
  totals: {
    cells: number;
    stable: number;
    volatile: number;
    uncertain: number;
    blocked: number;
    averagePressure: number;
    maxPressure: number;
  };
  narrative: {
    currentWorld: string;
    biggestUnknown: string;
    fragileAssumption: string;
    nextObservation: string;
    publicPosture: "avoid-only" | "monitor-only" | "shadow-only";
  };
  controls: {
    canObserveReadOnly: boolean;
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

type DecisionRow = {
  match: Match;
  prediction: Prediction;
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

function compact(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 8): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function actionPressure(action: DecisionAction): number {
  if (action === "consider") return 24;
  if (action === "monitor") return 14;
  return 4;
}

function statusFromPressure(pressure: number, blocked: boolean, volatile: boolean): DecisionWorldModelCellStatus {
  if (blocked) return "blocked";
  if (pressure >= 72 || volatile) return "volatile";
  if (pressure >= 45) return "uncertain";
  return "stable";
}

function matchLabel(row: DecisionRow): string {
  return `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`;
}

function buildMatchCell(row: DecisionRow): DecisionWorldModelCell {
  const decision = row.prediction.decision;
  const belief = decision.beliefState;
  const trace = decision.probabilityTrace;
  const graph = decision.reasoningGraph;
  const bestPick = row.prediction.bestPick;
  const unresolved = graph.unresolvedNodes.length;
  const conflicts = decision.contradictionChecks.filter((check) => check.status !== "clear").length;
  const missingSignals = decision.missingSignals.length + decision.dataCoverage.requiredBeforeTrust.length;
  const edgePressure = bestPick.hasValue ? Math.min(24, Math.abs(bestPick.edge) * 300) : 8;
  const pressure = clamp(
    belief.uncertaintyScore * 0.42 +
      actionPressure(decision.action) +
      unresolved * 8 +
      conflicts * 10 +
      missingSignals * 4 +
      edgePressure +
      (decision.decisionBoundary.status === "near-flip" || decision.decisionBoundary.status === "at-risk" ? 16 : 0)
  );
  const blocked = decision.controlPolicy.publishAllowed === false && decision.actionability.status === "blocked";
  const volatile = graph.status !== "coherent" || trace.status !== "ready" || decision.decisionBoundary.status !== "comfortable";
  const support = unique([
    decision.summary,
    trace.summary,
    bestPick.hasValue ? `No-vig edge ${Math.round(bestPick.edge * 1000) / 10}%` : null,
    ...decision.evidence.filter((item) => item.impact === "positive").map((item) => `${item.label}: ${item.detail}`)
  ]);
  const challenge = unique([
    ...decision.evidence.filter((item) => item.impact !== "positive").map((item) => `${item.label}: ${item.detail}`),
    ...decision.contradictionChecks.filter((check) => check.status !== "clear").map((check) => `${check.label}: ${check.detail}`),
    ...decision.decisionBoundary.flipTriggers
  ]);

  return {
    id: `world-match-${row.match.id}`,
    kind: "match-belief",
    label: matchLabel(row),
    status: statusFromPressure(pressure, blocked, volatile),
    matchId: row.match.id,
    action: decision.action,
    pressureScore: pressure,
    belief: {
      probability: trace.posteriorProbability ?? belief.believedProbability,
      expectedValue: trace.posteriorExpectedValue ?? belief.expectedValue,
      uncertainty: belief.uncertaintyScore
    },
    support,
    challenge,
    updateRule: compact(
      `Hold ${decision.action} unless the next provider or market observation changes posterior probability, no-vig edge, missing critical signals, or the decision boundary.`
    ),
    falsifier: compact(decision.notebook.falsifiers[0]?.action ?? decision.decisionBoundary.nearestFlip ?? "Fresh data removes the current model-market thesis."),
    nextObservation: compact(decision.monitoringPlan.tasks[0]?.trigger ?? decision.nextChecks[0] ?? "Refresh odds, lineups, and provider context.")
  };
}

function buildAuthorityCells(dataAuthority: DecisionDataAuthority): DecisionWorldModelCell[] {
  const topFamilies = dataAuthority.families.slice(0, 4);
  const familyCells = topFamilies.map((family): DecisionWorldModelCell => ({
    id: `world-authority-${family.id}`,
    kind: family.category === "training" ? "learning" : family.category === "odds" ? "market" : "data-authority",
    label: family.label,
    status:
      family.status === "blocked" || family.status === "training-blocked"
        ? "blocked"
        : family.status === "live-authorized"
          ? "stable"
          : family.status === "dry-run-ready"
            ? "uncertain"
            : "volatile",
    matchId: null,
    action: "hold",
    pressureScore: clamp(100 - family.authorityScore),
    belief: {
      probability: null,
      expectedValue: null,
      uncertainty: clamp(100 - family.authorityScore)
    },
    support: unique([family.modelImpact, family.decisionImpact]),
    challenge: unique([family.blockers[0], family.missingEnv[0], family.storageTables.join(", ")]),
    updateRule: compact(`Use ${family.label.toLowerCase()} as ${family.liveDecisionUse}; storage is ${family.storageUse}, training is ${family.trainingUse}.`),
    falsifier: compact(family.blockers[0] ?? "Authority proof returns a stricter lock."),
    nextObservation: compact(family.command || family.verifyUrl || family.expectedEvidence)
  }));

  return [
    {
      id: "world-supabase-authority",
      kind: "supabase",
      label: "Supabase and data authority",
      status:
        dataAuthority.status === "live-authorized"
          ? "stable"
          : dataAuthority.status === "blocked" || dataAuthority.status === "training-blocked"
            ? "blocked"
            : "volatile",
      matchId: null,
      action: "hold",
      pressureScore: clamp(100 - dataAuthority.trustScore),
      belief: {
        probability: null,
        expectedValue: null,
        uncertainty: clamp(100 - dataAuthority.trustScore)
      },
      support: unique([dataAuthority.summary, `Trust ${dataAuthority.trustScore}/100`]),
      challenge: unique(dataAuthority.locks),
      updateRule: dataAuthority.decisionPolicy.reason,
      falsifier: dataAuthority.locks[0] ?? "Supabase or provider proof contradicts the current authority state.",
      nextObservation: dataAuthority.nextCommand.command ?? dataAuthority.nextCommand.label
    },
    ...familyCells
  ];
}

function worldStatus(dataAuthority: DecisionDataAuthority, cells: DecisionWorldModelCell[]): DecisionWorldModelStatus {
  if (dataAuthority.status === "blocked") return "blocked";
  if (dataAuthority.status === "training-blocked") return "training-locked";
  if (cells.some((cell) => cell.status === "volatile" || cell.status === "uncertain")) return "observe-ready";
  return "waiting-on-data";
}

function publicPosture(status: DecisionWorldModelStatus, dataAuthority: DecisionDataAuthority): DecisionWorldModel["narrative"]["publicPosture"] {
  if (status === "blocked") return "avoid-only";
  if (!dataAuthority.decisionPolicy.canUseProviderBackedLiveSignals || dataAuthority.status === "training-blocked") return "shadow-only";
  return "monitor-only";
}

export function buildDecisionWorldModel({
  date,
  sport,
  rows,
  dataAuthority,
  now = new Date(),
  limit = 10
}: {
  date: string;
  sport: Sport;
  rows: DecisionRow[];
  dataAuthority: DecisionDataAuthority;
  now?: Date;
  limit?: number;
}): DecisionWorldModel {
  const matchCells = rows.slice(0, Math.max(1, Math.min(20, limit))).map(buildMatchCell);
  const cells = [...buildAuthorityCells(dataAuthority), ...matchCells].sort(
    (a, b) => b.pressureScore - a.pressureScore || a.label.localeCompare(b.label)
  );
  const visibleCells = cells.slice(0, Math.max(1, Math.min(30, limit + 5)));
  const topCell = visibleCells[0] ?? null;
  const status = worldStatus(dataAuthority, visibleCells);
  const pressureScores = visibleCells.map((cell) => cell.pressureScore);
  const posture = publicPosture(status, dataAuthority);
  const worldHash = stableHash({
    date,
    sport,
    status,
    dataAuthority: dataAuthority.authorityHash,
    cells: visibleCells.map((cell) => [cell.id, cell.status, cell.pressureScore, cell.action])
  });

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-world-model",
    status,
    worldHash,
    summary:
      status === "observe-ready"
        ? `World model is observation-ready; top pressure is ${topCell?.label ?? "none"}.`
        : status === "training-locked"
          ? "World model can reason in shadow mode, but training and provider-backed influence remain locked."
          : status === "blocked"
            ? "World model is blocked by authority or schema proof; public decisions must stay avoided."
            : "World model is waiting for stronger live data before changing state.",
    cells: visibleCells,
    topCell,
    totals: {
      cells: cells.length,
      stable: cells.filter((cell) => cell.status === "stable").length,
      volatile: cells.filter((cell) => cell.status === "volatile").length,
      uncertain: cells.filter((cell) => cell.status === "uncertain").length,
      blocked: cells.filter((cell) => cell.status === "blocked").length,
      averagePressure: average(pressureScores),
      maxPressure: pressureScores[0] ?? 0
    },
    narrative: {
      currentWorld: compact(topCell?.support[0] ?? dataAuthority.summary, 260),
      biggestUnknown: compact(topCell?.challenge[0] ?? dataAuthority.locks[0] ?? "No live provider-backed unknown has been cleared yet.", 260),
      fragileAssumption: compact(topCell?.falsifier ?? "The current state has no selected falsifier.", 260),
      nextObservation: compact(topCell?.nextObservation ?? dataAuthority.nextCommand.label, 260),
      publicPosture: posture
    },
    controls: {
      canObserveReadOnly: true,
      canRunDryRun: dataAuthority.controls.canRunProviderDryRun,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRaiseTrust: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique(["/api/sports/decision/world-model", "/api/sports/decision/data-authority", ...dataAuthority.proofUrls], 16),
    forbiddenActions: [
      "Do not publish, persist, train, stake, or raise trust from the world model.",
      "Do not convert shadow-only beliefs into public picks.",
      "Do not let AI text replace provider evidence, odds, or outcome labels.",
      "Do not ignore data-authority locks when a match-level belief looks attractive."
    ]
  };
}
