import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { DecisionWorldModel, DecisionWorldModelCell } from "@/lib/sports/prediction/decisionWorldModel";
import type { Sport } from "@/lib/sports/types";

export type DecisionWorldModelCriticStatus = "ready-readonly" | "needs-proof" | "blocked";
export type DecisionWorldModelCriticVerdict = "observe" | "hold" | "repair" | "block";
export type DecisionWorldModelCriticSignalStatus = "pass" | "watch" | "block";
export type DecisionWorldModelHypothesisStatus = "supported" | "contested" | "weak" | "blocked";

export type DecisionWorldModelHypothesis = {
  id: string;
  cellId: string;
  label: string;
  status: DecisionWorldModelHypothesisStatus;
  confidenceScore: number;
  pressureScore: number;
  support: string[];
  challenge: string[];
  falsifier: string;
  nextObservation: string;
};

export type DecisionWorldModelDebateRole = {
  id: "model-advocate" | "market-skeptic" | "data-steward" | "safety-officer" | "learning-critic";
  stance: "support" | "challenge" | "abstain";
  status: DecisionWorldModelCriticSignalStatus;
  finding: string;
  citedCellIds: string[];
};

export type DecisionWorldModelStressTest = {
  id: string;
  label: string;
  status: DecisionWorldModelCriticSignalStatus;
  severityScore: number;
  shock: string;
  expectedEffect: string;
  fallbackAction: "observe" | "hold" | "repair" | "avoid";
};

export type DecisionWorldModelCritic = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "world-model-critic";
  status: DecisionWorldModelCriticStatus;
  criticHash: string;
  summary: string;
  activeTarget: {
    cellId: string | null;
    label: string;
    pressureScore: number;
    status: DecisionWorldModelCell["status"] | "none";
  };
  verdict: {
    action: DecisionWorldModelCriticVerdict;
    publicAction: "avoid" | "shadow-observe" | "monitor-only";
    reason: string;
    confidenceCeiling: number;
    nextSafeCommand: string;
  };
  hypotheses: DecisionWorldModelHypothesis[];
  debate: DecisionWorldModelDebateRole[];
  stressTests: DecisionWorldModelStressTest[];
  unresolvedQuestions: string[];
  controls: {
    canObserveReadOnly: true;
    canRunDryRun: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canRaiseTrust: false;
    canUpgradePublicAction: false;
    requiresOpenAIKeyForLiveReview: boolean;
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

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 10): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function signalStatus(score: number): DecisionWorldModelCriticSignalStatus {
  if (score >= 72) return "block";
  if (score >= 42) return "watch";
  return "pass";
}

function confidenceForCell(cell: DecisionWorldModelCell): number {
  const statusPenalty = cell.status === "blocked" ? 42 : cell.status === "volatile" ? 26 : cell.status === "uncertain" ? 16 : 4;
  const challengePenalty = Math.min(30, cell.challenge.length * 5);
  const supportCredit = Math.min(18, cell.support.length * 4);
  const beliefUncertainty = cell.belief.uncertainty ?? cell.pressureScore;
  return clamp(100 - cell.pressureScore * 0.48 - beliefUncertainty * 0.22 - statusPenalty - challengePenalty + supportCredit);
}

function hypothesisStatus(cell: DecisionWorldModelCell, confidenceScore: number): DecisionWorldModelHypothesisStatus {
  if (cell.status === "blocked") return "blocked";
  if (confidenceScore >= 68 && cell.challenge.length <= 2) return "supported";
  if (confidenceScore >= 42) return "contested";
  return "weak";
}

function buildHypothesis(cell: DecisionWorldModelCell, index: number): DecisionWorldModelHypothesis {
  const confidenceScore = confidenceForCell(cell);
  const action = cell.action === "hold" ? "hold state" : `${cell.action} action`;

  return {
    id: `world-hypothesis-${index + 1}`,
    cellId: cell.id,
    label: compact(`If ${cell.label} remains true, the agent may keep ${action} in ${cell.kind.replace("-", " ")} mode.`, 180),
    status: hypothesisStatus(cell, confidenceScore),
    confidenceScore,
    pressureScore: cell.pressureScore,
    support: cell.support.slice(0, 4),
    challenge: cell.challenge.slice(0, 4),
    falsifier: compact(cell.falsifier),
    nextObservation: compact(cell.nextObservation)
  };
}

function firstCell(cells: DecisionWorldModelCell[], predicate: (cell: DecisionWorldModelCell) => boolean): DecisionWorldModelCell | null {
  return cells.find(predicate) ?? null;
}

function roleStatusFromCell(cell: DecisionWorldModelCell | null): DecisionWorldModelCriticSignalStatus {
  if (!cell) return "watch";
  if (cell.status === "blocked") return "block";
  if (cell.status === "volatile" || cell.pressureScore >= 72) return "watch";
  return "pass";
}

function buildDebate(worldModel: DecisionWorldModel): DecisionWorldModelDebateRole[] {
  const cells = worldModel.cells;
  const matchCell = firstCell(cells, (cell) => cell.kind === "match-belief");
  const marketCell = firstCell(cells, (cell) => cell.kind === "market") ?? matchCell;
  const authorityCell = firstCell(cells, (cell) => cell.kind === "supabase" || cell.kind === "data-authority");
  const learningCell = firstCell(cells, (cell) => cell.kind === "learning");
  const blockerCount = worldModel.totals.blocked;
  const posture = worldModel.narrative.publicPosture;

  return [
    {
      id: "model-advocate",
      stance: matchCell && matchCell.status !== "blocked" ? "support" : "abstain",
      status: roleStatusFromCell(matchCell),
      finding: compact(matchCell?.support[0] ?? "No match-level belief is strong enough to advocate yet."),
      citedCellIds: matchCell ? [matchCell.id] : []
    },
    {
      id: "market-skeptic",
      stance: "challenge",
      status: roleStatusFromCell(marketCell),
      finding: compact(marketCell?.challenge[0] ?? "Market edge still needs a live odds refresh before trust can rise."),
      citedCellIds: marketCell ? [marketCell.id] : []
    },
    {
      id: "data-steward",
      stance: authorityCell && authorityCell.status === "stable" ? "support" : "challenge",
      status: roleStatusFromCell(authorityCell),
      finding: compact(authorityCell?.challenge[0] ?? authorityCell?.support[0] ?? "Data authority has not produced a stronger live proof yet."),
      citedCellIds: authorityCell ? [authorityCell.id] : []
    },
    {
      id: "safety-officer",
      stance: posture === "shadow-only" || blockerCount > 0 ? "challenge" : "support",
      status: posture === "avoid-only" || blockerCount > 0 ? "block" : posture === "shadow-only" ? "watch" : "pass",
      finding:
        posture === "avoid-only"
          ? "Public posture is avoid-only, so the critic blocks any public pick."
          : posture === "shadow-only"
            ? "Public posture is shadow-only, so the critic can observe but cannot publish or upgrade."
            : "Public posture allows monitoring only after read-only proof remains clean.",
      citedCellIds: worldModel.topCell ? [worldModel.topCell.id] : []
    },
    {
      id: "learning-critic",
      stance: learningCell && learningCell.status !== "stable" ? "challenge" : "abstain",
      status: roleStatusFromCell(learningCell),
      finding: compact(learningCell?.challenge[0] ?? "Training remains gated until the 10-year corpus and backtests are proven."),
      citedCellIds: learningCell ? [learningCell.id] : []
    }
  ];
}

function severityFromCells(cells: DecisionWorldModelCell[], predicate: (cell: DecisionWorldModelCell) => boolean, fallback: number): number {
  const selected = cells.filter(predicate);
  if (!selected.length) return fallback;
  return clamp(Math.max(...selected.map((cell) => cell.pressureScore)));
}

function buildStressTests(worldModel: DecisionWorldModel): DecisionWorldModelStressTest[] {
  const cells = worldModel.cells;
  const marketSeverity = severityFromCells(cells, (cell) => cell.kind === "market" || cell.kind === "match-belief", 48);
  const authoritySeverity = severityFromCells(cells, (cell) => cell.kind === "supabase" || cell.kind === "data-authority", 64);
  const volatilitySeverity = clamp(worldModel.totals.volatile * 18 + worldModel.totals.uncertain * 10 + worldModel.totals.blocked * 20);
  const learningSeverity = severityFromCells(cells, (cell) => cell.kind === "learning", worldModel.status === "training-locked" ? 82 : 38);

  return [
    {
      id: "market-reprice",
      label: "Market reprices against the model",
      status: signalStatus(marketSeverity),
      severityScore: marketSeverity,
      shock: "Bookmaker no-vig probability moves enough to erase the positive expected value.",
      expectedEffect: "Downgrade any value thesis to monitor or avoid until the odds board refreshes.",
      fallbackAction: marketSeverity >= 72 ? "repair" : "hold"
    },
    {
      id: "authority-regression",
      label: "Data authority proof regresses",
      status: signalStatus(authoritySeverity),
      severityScore: authoritySeverity,
      shock: "Supabase project proof, provider dry-run proof, or schema verification returns a blocker.",
      expectedEffect: "Keep all live provider-backed influence in shadow mode and require operator proof.",
      fallbackAction: authoritySeverity >= 72 ? "repair" : "hold"
    },
    {
      id: "signal-volatility",
      label: "Missing signals become decisive",
      status: signalStatus(volatilitySeverity),
      severityScore: volatilitySeverity,
      shock: "Lineups, injuries, suspensions, weather, news, or match events contradict the current belief cell.",
      expectedEffect: "Retire the hypothesis or route to a safer alternative before any public action.",
      fallbackAction: volatilitySeverity >= 72 ? "avoid" : "hold"
    },
    {
      id: "learning-gap",
      label: "Training evidence is still insufficient",
      status: signalStatus(learningSeverity),
      severityScore: learningSeverity,
      shock: "The 10-year corpus, backtests, or calibration history are unavailable or not representative.",
      expectedEffect: "Cap trust and forbid training-derived upgrades until corpus proof is complete.",
      fallbackAction: learningSeverity >= 72 ? "repair" : "hold"
    }
  ];
}

function verdictFor(worldModel: DecisionWorldModel, debate: DecisionWorldModelDebateRole[], stressTests: DecisionWorldModelStressTest[]): DecisionWorldModelCritic["verdict"] {
  const blockingRoles = debate.filter((role) => role.status === "block").length;
  const blockingStress = stressTests.filter((test) => test.status === "block").length;
  const maxStress = Math.max(0, ...stressTests.map((test) => test.severityScore));
  const topPressure = worldModel.topCell?.pressureScore ?? 0;
  const confidenceCeiling = clamp(100 - Math.max(topPressure, maxStress) * 0.58 - blockingRoles * 12 - blockingStress * 10);
  const nextSafeCommand = decisionCurlCommand(`/api/sports/decision/world-model?date=${encodeURIComponent(worldModel.date)}&sport=${encodeURIComponent(worldModel.sport)}`);

  if (worldModel.status === "blocked" || worldModel.narrative.publicPosture === "avoid-only") {
    return {
      action: "block",
      publicAction: "avoid",
      reason: "The critic blocks public action because the world model is blocked or avoid-only.",
      confidenceCeiling,
      nextSafeCommand
    };
  }

  if (blockingRoles > 0 || blockingStress > 0 || worldModel.totals.blocked > 0) {
    return {
      action: "repair",
      publicAction: "shadow-observe",
      reason: "The critic found blocking pressure, so the next move is repair or proof collection in shadow mode.",
      confidenceCeiling,
      nextSafeCommand
    };
  }

  if (worldModel.narrative.publicPosture === "shadow-only" || worldModel.status === "training-locked" || confidenceCeiling < 45) {
    return {
      action: "hold",
      publicAction: "shadow-observe",
      reason: "The critic holds public action because authority, training, or confidence ceilings still cap trust.",
      confidenceCeiling,
      nextSafeCommand
    };
  }

  return {
    action: "observe",
    publicAction: "monitor-only",
    reason: "The critic allows read-only observation, but still forbids persistence, publishing, training, and upgrades.",
    confidenceCeiling,
    nextSafeCommand
  };
}

function statusFor(verdict: DecisionWorldModelCritic["verdict"]): DecisionWorldModelCriticStatus {
  if (verdict.action === "block") return "blocked";
  if (verdict.action === "repair" || verdict.action === "hold") return "needs-proof";
  return "ready-readonly";
}

function summaryFor(status: DecisionWorldModelCriticStatus, verdict: DecisionWorldModelCritic["verdict"], target: DecisionWorldModelCritic["activeTarget"]): string {
  if (status === "blocked") return `World-model critic blocks public action around ${target.label}; ${verdict.reason}`;
  if (status === "needs-proof") return `World-model critic keeps the agent in proof mode around ${target.label}; ${verdict.reason}`;
  return `World-model critic allows read-only monitoring around ${target.label}; ${verdict.reason}`;
}

export function buildDecisionWorldModelCritic({
  worldModel,
  now = new Date(),
  openAiConfigured = Boolean(process.env.OPENAI_API_KEY?.trim()),
  limit = 6
}: {
  worldModel: DecisionWorldModel;
  now?: Date;
  openAiConfigured?: boolean;
  limit?: number;
}): DecisionWorldModelCritic {
  const hypothesisLimit = Math.max(1, Math.min(10, limit));
  const hypotheses = worldModel.cells.slice(0, hypothesisLimit).map(buildHypothesis);
  const debate = buildDebate(worldModel);
  const stressTests = buildStressTests(worldModel);
  const verdict = verdictFor(worldModel, debate, stressTests);
  const status = statusFor(verdict);
  const activeTarget = {
    cellId: worldModel.topCell?.id ?? null,
    label: worldModel.topCell?.label ?? "No selected world cell",
    pressureScore: worldModel.topCell?.pressureScore ?? 0,
    status: worldModel.topCell?.status ?? ("none" as const)
  };
  const unresolvedQuestions = unique(
    [
      worldModel.narrative.biggestUnknown,
      worldModel.narrative.fragileAssumption,
      ...hypotheses.flatMap((hypothesis) => hypothesis.challenge),
      ...stressTests.filter((test) => test.status !== "pass").map((test) => test.shock)
    ],
    10
  );
  const criticHash = stableHash({
    worldHash: worldModel.worldHash,
    status,
    verdict,
    hypotheses: hypotheses.map((hypothesis) => [hypothesis.cellId, hypothesis.status, hypothesis.confidenceScore]),
    debate: debate.map((role) => [role.id, role.status, role.stance]),
    stress: stressTests.map((test) => [test.id, test.status, test.severityScore])
  });

  return {
    generatedAt: now.toISOString(),
    date: worldModel.date,
    sport: worldModel.sport,
    mode: "world-model-critic",
    status,
    criticHash,
    summary: summaryFor(status, verdict, activeTarget),
    activeTarget,
    verdict,
    hypotheses,
    debate,
    stressTests,
    unresolvedQuestions,
    controls: {
      canObserveReadOnly: true,
      canRunDryRun: worldModel.controls.canRunDryRun,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRaiseTrust: false,
      canUpgradePublicAction: false,
      requiresOpenAIKeyForLiveReview: !openAiConfigured
    },
    proofUrls: unique(["/api/sports/decision/world-model-critic", ...worldModel.proofUrls], 20),
    locks: [
      "World-model critic is deterministic and cannot create provider facts.",
      "World-model critic cannot publish, persist, train, stake, or raise trust.",
      "World-model critic cannot upgrade public action beyond the world-model posture.",
      "Live OpenAI review remains locked until OPENAI_API_KEY is configured and the operator requests run=1."
    ]
  };
}
