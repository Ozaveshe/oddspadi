import type { DecisionDataIntakeItem, DecisionDataIntakeQueue, DecisionDataIntakePriority } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import type { DecisionModelTrust, DecisionModelTrustGate } from "@/lib/sports/prediction/decisionModelTrust";
import type { DecisionOddsBoard } from "@/lib/sports/prediction/decisionOddsBoard";
import type { DecisionPortfolioRisk } from "@/lib/sports/prediction/decisionPortfolioRisk";
import type { DecisionSignalReliability, DecisionSignalReliabilitySignal } from "@/lib/sports/prediction/decisionSignalReliability";
import { decisionApiUrl } from "@/lib/sports/prediction/decisionUrls";
import type { Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionEvidenceRefreshStatus = "ready" | "waiting" | "blocked";
export type DecisionEvidenceRefreshTaskStatus = "ready" | "waiting" | "blocked";
export type DecisionEvidenceRefreshTaskPriority = "critical" | "high" | "medium" | "low";
export type DecisionEvidenceRefreshTaskSource = "signal-reliability" | "data-intake" | "model-trust" | "portfolio-risk" | "odds-board";
export type DecisionEvidenceRefreshTaskMode = "read-only" | "dry-run" | "write-gated";

export type DecisionEvidenceRefreshTask = {
  id: string;
  rank: number;
  source: DecisionEvidenceRefreshTaskSource;
  category: string;
  label: string;
  status: DecisionEvidenceRefreshTaskStatus;
  priority: DecisionEvidenceRefreshTaskPriority;
  mode: DecisionEvidenceRefreshTaskMode;
  command: string;
  verifyUrl: string;
  safeToRun: boolean;
  missingEnv: string[];
  affectedMatches: number;
  expectedEvidence: string;
  decisionImpact: string;
  unlocks: string[];
  riskIfSkipped: string;
};

export type DecisionEvidenceRefreshScheduler = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionEvidenceRefreshStatus;
  refreshHash: string;
  summary: string;
  tasks: DecisionEvidenceRefreshTask[];
  nextTask: DecisionEvidenceRefreshTask | null;
  totals: {
    tasks: number;
    ready: number;
    waiting: number;
    blocked: number;
    critical: number;
    safeToRun: number;
    readOnly: number;
    dryRun: number;
    missingEnv: number;
    affectedMatches: number;
  };
  cadence: {
    refreshWindowMinutes: number;
    staleAfterMinutes: number;
    nextReviewAt: string;
  };
  policy: {
    canRunReadOnly: boolean;
    canRunDryRun: boolean;
    canWrite: false;
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

function localUrl(path: string): string {
  return decisionApiUrl(path);
}

function getCommand(path: string): string {
  return `curl.exe -sS "${localUrl(path)}"`;
}

function commandMode(command: string): DecisionEvidenceRefreshTaskMode {
  const lower = command.toLowerCase();
  if (lower.includes("-x post") || lower.includes("-xpost")) {
    return lower.includes("dryrun=1") || lower.includes("dryrun=true") ? "dry-run" : "write-gated";
  }
  return "read-only";
}

function commandIsSafe(command: string, mode: DecisionEvidenceRefreshTaskMode, missingEnv: string[]): boolean {
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return false;
  if (lower.includes("persist=1") || lower.includes("persist=true")) return false;
  if (lower.includes("dryrun=0") || lower.includes("dryrun=false")) return false;
  if (mode === "write-gated") return false;
  if (mode === "dry-run" && missingEnv.length) return false;
  return true;
}

function taskStatus({
  mode,
  safeToRun,
  missingEnv,
  defaultStatus = "ready"
}: {
  mode: DecisionEvidenceRefreshTaskMode;
  safeToRun: boolean;
  missingEnv: string[];
  defaultStatus?: DecisionEvidenceRefreshTaskStatus;
}): DecisionEvidenceRefreshTaskStatus {
  if (safeToRun) return defaultStatus;
  if (missingEnv.length || mode === "write-gated") return "blocked";
  return "waiting";
}

function task(input: Omit<DecisionEvidenceRefreshTask, "rank" | "mode" | "safeToRun" | "status"> & { defaultStatus?: DecisionEvidenceRefreshTaskStatus }): DecisionEvidenceRefreshTask {
  const mode = commandMode(input.command);
  const safeToRun = commandIsSafe(input.command, mode, input.missingEnv);
  return {
    ...input,
    rank: 0,
    mode,
    safeToRun,
    status: taskStatus({ mode, safeToRun, missingEnv: input.missingEnv, defaultStatus: input.defaultStatus }),
    missingEnv: unique(input.missingEnv)
  };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function compact(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function priorityRank(priority: DecisionEvidenceRefreshTaskPriority): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[priority];
}

function sourceRank(source: DecisionEvidenceRefreshTaskSource): number {
  return {
    "signal-reliability": 5,
    "model-trust": 4,
    "data-intake": 3,
    "portfolio-risk": 2,
    "odds-board": 1
  }[source];
}

function statusRank(status: DecisionEvidenceRefreshTaskStatus): number {
  return { ready: 3, blocked: 2, waiting: 1 }[status];
}

function taskSort(a: DecisionEvidenceRefreshTask, b: DecisionEvidenceRefreshTask): number {
  return (
    statusRank(b.status) - statusRank(a.status) ||
    priorityRank(b.priority) - priorityRank(a.priority) ||
    Number(b.safeToRun) - Number(a.safeToRun) ||
    sourceRank(b.source) - sourceRank(a.source) ||
    b.affectedMatches - a.affectedMatches ||
    a.label.localeCompare(b.label)
  );
}

function visibleTasks(tasks: DecisionEvidenceRefreshTask[], limit: number): DecisionEvidenceRefreshTask[] {
  const pinned = [
    ...tasks.filter((item) => item.source === "signal-reliability").slice(0, 4),
    ...tasks.filter((item) => item.source === "model-trust").slice(0, 2),
    ...tasks.filter((item) => item.source === "data-intake").slice(0, 3),
    ...tasks.filter((item) => item.source === "portfolio-risk").slice(0, 1),
    ...tasks.filter((item) => item.source === "odds-board").slice(0, 1)
  ];
  return Array.from(new Map([...pinned, ...tasks].map((item) => [item.id, item])).values())
    .slice(0, Math.max(1, Math.min(40, limit)))
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function signalPriority(signal: DecisionSignalReliabilitySignal): DecisionEvidenceRefreshTaskPriority {
  if (signal.status === "blocked" || signal.category === "odds" || signal.category === "training") return "critical";
  if (signal.requiredGaps > 2 || signal.category === "injuries" || signal.category === "lineups") return "high";
  if (signal.status === "degraded") return "medium";
  return "low";
}

function dataPriority(priority: DecisionDataIntakePriority): DecisionEvidenceRefreshTaskPriority {
  return priority;
}

function signalTasks({
  reliability,
  dataIntake
}: {
  reliability: DecisionSignalReliability;
  dataIntake: DecisionDataIntakeQueue;
}): DecisionEvidenceRefreshTask[] {
  const intakeByCategory = new Map(dataIntake.items.map((item) => [item.category, item]));
  return reliability.signals
    .filter((signal) => signal.status === "blocked" || signal.status === "degraded")
    .map((signal) => {
      const intake = intakeByCategory.get(signal.category);
      return task({
        id: `signal-${signal.category}`,
        source: "signal-reliability",
        category: signal.category,
        label: `${signal.label} reliability proof`,
        priority: signalPriority(signal),
        command: getCommand(reliability.policy.verificationUrl),
        verifyUrl: reliability.policy.verificationUrl,
        missingEnv: signal.missingEnv,
        affectedMatches: signal.affectedMatches || reliability.totals.matches,
        expectedEvidence: `Reliability rerun shows ${signal.label.toLowerCase()} as fresh or usable, with lower required gaps and provider-backed proof.`,
        decisionImpact: signal.decisionImpact,
        unlocks: [
          `May reduce ${signal.requiredGaps} required ${signal.label.toLowerCase()} gap(s).`,
          intake ? `Points at provider command: ${compact(intake.command, 140)}` : "Keeps trust capped until provider-backed evidence is available."
        ],
        riskIfSkipped: `Trust stays capped because ${signal.label.toLowerCase()} remains ${signal.status}.`
      });
    });
}

function dataIntakeTasks(items: DecisionDataIntakeItem[]): DecisionEvidenceRefreshTask[] {
  return items
    .filter((item) => item.status !== "ready")
    .map((item) =>
      task({
        id: `refresh-${item.category}`,
        source: "data-intake",
        category: item.category,
        label: item.label,
        priority: dataPriority(item.priority),
        command: item.command,
        verifyUrl: item.verifyUrl,
        missingEnv: item.missingEnv,
        affectedMatches: item.affectedMatches,
        defaultStatus: item.status === "watch" ? "waiting" : "ready",
        expectedEvidence: item.expectedEvidence,
        decisionImpact: item.decisionImpact,
        unlocks: [
          "Can turn mock, missing, or stale signals into provider-backed evidence.",
          "Can lower model-trust and signal-reliability blockers after the verification route changes."
        ],
        riskIfSkipped: `The slate continues to carry weak ${item.label.toLowerCase()} evidence across ${item.affectedMatches} match(es).`
      })
    );
}

function modelTrustPriority(gate: DecisionModelTrustGate): DecisionEvidenceRefreshTaskPriority {
  if (gate.status === "block" && (gate.category === "training" || gate.category === "runtime" || gate.category === "calibration")) return "critical";
  if (gate.status === "block") return "high";
  if (gate.status === "watch") return "medium";
  return "low";
}

function modelTrustTasks({ trust, date, sport }: { trust: DecisionModelTrust; date: string; sport: Sport }): DecisionEvidenceRefreshTask[] {
  const path = `/api/sports/decision/model-trust?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`;
  return trust.gates
    .filter((gate) => gate.status !== "pass")
    .map((gate) =>
      task({
        id: `model-trust-${gate.id}`,
        source: "model-trust",
        category: gate.category,
        label: gate.label,
        priority: modelTrustPriority(gate),
        command: getCommand(path),
        verifyUrl: path,
        missingEnv: [],
        affectedMatches: 0,
        expectedEvidence: `Model trust rerun shows ${gate.label.toLowerCase()} improving from ${gate.status}, with a higher gate score.`,
        decisionImpact: gate.detail,
        unlocks: [
          gate.requiredAction ?? "Recheck trust after provider and Supabase evidence improves.",
          "May lift confidence caps only after all hard gates pass."
        ],
        riskIfSkipped: "The agent may keep stale confidence caps or miss that the trust gate is still blocked."
      })
    );
}

function portfolioTasks(portfolio: DecisionPortfolioRisk): DecisionEvidenceRefreshTask[] {
  if (portfolio.status === "paper-ready") return [];
  return [
    task({
      id: "portfolio-risk-proof",
      source: "portfolio-risk",
      category: "portfolio",
      label: "Portfolio pressure proof",
      priority: portfolio.status === "blocked" ? "high" : "medium",
      command: getCommand(`/api/sports/decision/portfolio-risk?date=${encodeURIComponent(portfolio.date)}&limit=12`),
      verifyUrl: portfolio.policy.verificationUrl,
      missingEnv: [],
      affectedMatches: portfolio.totals.matches,
      expectedEvidence: "Portfolio rerun shows paper-only units, cap reasons, exclusions, and concentration pressure after fresh odds and trust gates update.",
      decisionImpact: portfolio.summary,
      unlocks: ["May reduce cap-exposure warnings.", "Keeps staking, publishing, persistence, and training locked."],
      riskIfSkipped: "The slate can over-concentrate paper candidates in one sport, market, or match without a current cap check."
    })
  ];
}

function oddsBoardTasks(board: DecisionOddsBoard): DecisionEvidenceRefreshTask[] {
  const avoidDominates = board.totals.avoid > board.totals.value + board.totals.watch;
  if (board.status === "value-found" && !avoidDominates && board.totals.averageMargin !== null) return [];
  return [
    task({
      id: "odds-board-proof",
      source: "odds-board",
      category: "odds",
      label: "Odds board proof",
      priority: board.status === "blocked" ? "high" : "medium",
      command: getCommand(`/api/sports/decision/odds-board?date=${encodeURIComponent(board.date)}&limit=40`),
      verifyUrl: board.policy.verificationUrl,
      missingEnv: [],
      affectedMatches: board.totals.matches,
      expectedEvidence: "Odds board rerun shows current value/watch/avoid counts, bookmaker margins, and best value candidate after market refresh.",
      decisionImpact: board.summary,
      unlocks: ["May change which selections remain positive EV.", "May reduce avoid pressure after fresh market data arrives."],
      riskIfSkipped: "The agent can keep ranking stale market edges after prices or no-vig margins move."
    })
  ];
}

function refreshWindowMinutes(tasks: DecisionEvidenceRefreshTask[]): number {
  if (tasks.some((item) => item.priority === "critical" && item.status === "ready")) return 10;
  if (tasks.some((item) => item.priority === "critical")) return 15;
  if (tasks.some((item) => item.priority === "high")) return 30;
  return 60;
}

function schedulerStatus(tasks: DecisionEvidenceRefreshTask[]): DecisionEvidenceRefreshStatus {
  if (tasks.some((item) => item.status === "ready")) return "ready";
  if (tasks.some((item) => item.status === "waiting")) return "waiting";
  return "blocked";
}

export function buildDecisionEvidenceRefreshScheduler({
  rows,
  date,
  sport,
  dataIntake,
  signalReliability,
  modelTrust,
  oddsBoard,
  portfolioRisk,
  now = new Date(),
  limit = 14
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  dataIntake: DecisionDataIntakeQueue;
  signalReliability: DecisionSignalReliability;
  modelTrust: DecisionModelTrust;
  oddsBoard: DecisionOddsBoard;
  portfolioRisk: DecisionPortfolioRisk;
  now?: Date;
  limit?: number;
}): DecisionEvidenceRefreshScheduler {
  const allTasks = [
    ...signalTasks({ reliability: signalReliability, dataIntake }),
    ...modelTrustTasks({ trust: modelTrust, date, sport }),
    ...dataIntakeTasks(dataIntake.items),
    ...portfolioTasks(portfolioRisk),
    ...oddsBoardTasks(oddsBoard)
  ].sort(taskSort);
  const tasks = visibleTasks(allTasks, limit);
  const status = schedulerStatus(allTasks);
  const ready = allTasks.filter((item) => item.status === "ready").length;
  const waiting = allTasks.filter((item) => item.status === "waiting").length;
  const blocked = allTasks.filter((item) => item.status === "blocked").length;
  const safeToRun = allTasks.filter((item) => item.safeToRun).length;
  const dryRun = allTasks.filter((item) => item.mode === "dry-run").length;
  const readOnly = allTasks.filter((item) => item.mode === "read-only").length;
  const missingEnv = unique(allTasks.flatMap((item) => item.missingEnv));
  const refreshWindow = refreshWindowMinutes(allTasks);
  const nextTask = allTasks.find((item) => item.status === "ready") ?? allTasks.find((item) => item.status === "blocked") ?? allTasks[0] ?? null;
  const refreshHash = stableHash({
    date,
    sport,
    status,
    rows: rows.length,
    tasks: allTasks.map((item) => [item.id, item.status, item.priority, item.mode, item.missingEnv])
  });

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    refreshHash,
    summary:
      status === "ready"
        ? `Evidence refresh has ${ready} safe proof task(s) ready; start with ${nextTask?.label ?? "the top task"}. Provider writes remain locked.`
        : status === "waiting"
          ? `Evidence refresh is waiting on ${waiting} task(s); no writes, persistence, publishing, or training are allowed.`
          : `Evidence refresh is blocked by ${blocked} task(s), mostly missing provider, admin, or Supabase proof.`,
    tasks,
    nextTask,
    totals: {
      tasks: allTasks.length,
      ready,
      waiting,
      blocked,
      critical: allTasks.filter((item) => item.priority === "critical").length,
      safeToRun,
      readOnly,
      dryRun,
      missingEnv: missingEnv.length,
      affectedMatches: rows.length
    },
    cadence: {
      refreshWindowMinutes: refreshWindow,
      staleAfterMinutes: refreshWindow * 2,
      nextReviewAt: new Date(now.getTime() + refreshWindow * 60000).toISOString()
    },
    policy: {
      canRunReadOnly: allTasks.some((item) => item.safeToRun && item.mode === "read-only"),
      canRunDryRun: allTasks.some((item) => item.safeToRun && item.mode === "dry-run"),
      canWrite: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      rule:
        "Evidence refresh schedules read-only proof and dry-run checks only. It cannot execute write-mode imports, persist decisions, publish picks, train models, or bypass Supabase/provider gates.",
      verificationUrl: `/api/sports/decision/evidence-refresh?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`
    }
  };
}
