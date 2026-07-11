import type { DecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import type { DecisionEvidenceRefreshScheduler, DecisionEvidenceRefreshTask } from "@/lib/sports/prediction/decisionEvidenceRefreshScheduler";
import type { DecisionModelTrust } from "@/lib/sports/prediction/decisionModelTrust";
import type { DecisionOddsBoard } from "@/lib/sports/prediction/decisionOddsBoard";
import type { DecisionPortfolioRisk } from "@/lib/sports/prediction/decisionPortfolioRisk";
import type { DecisionSignalReliability } from "@/lib/sports/prediction/decisionSignalReliability";
import type { Sport } from "@/lib/sports/types";

export type DecisionEvidenceRefreshVerificationStatus = "verified" | "verifying" | "blocked";
export type DecisionEvidenceRefreshReceiptStatus = "verified" | "ready-to-check" | "blocked" | "waiting";

export type DecisionEvidenceRefreshReceipt = {
  id: string;
  taskId: string;
  source: DecisionEvidenceRefreshTask["source"];
  label: string;
  status: DecisionEvidenceRefreshReceiptStatus;
  proof: string;
  currentEvidence: string[];
  expectedEvidence: string;
  command: string;
  verifyUrl: string;
  safeToRun: boolean;
  missingEnv: string[];
  nextCheck: string;
};

export type DecisionEvidenceRefreshVerifier = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionEvidenceRefreshVerificationStatus;
  verificationHash: string;
  summary: string;
  receipts: DecisionEvidenceRefreshReceipt[];
  nextReceipt: DecisionEvidenceRefreshReceipt | null;
  counts: {
    receipts: number;
    verified: number;
    readyToCheck: number;
    blocked: number;
    waiting: number;
  };
  runtimeEvidence: {
    scheduler: string;
    signalReliability: string;
    dataIntake: string;
    modelTrust: string;
    portfolioRisk: string;
    oddsBoard: string;
  };
  policy: {
    canRaiseTrust: false;
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

function compact(values: Array<string | null | undefined>, limit = 5): string[] {
  return values
    .map((value) => value?.replace(/\s+/g, " ").trim() ?? "")
    .filter(Boolean)
    .slice(0, limit);
}

function runtimeEvidence({
  scheduler,
  signalReliability,
  dataIntake,
  modelTrust,
  portfolioRisk,
  oddsBoard
}: {
  scheduler: DecisionEvidenceRefreshScheduler;
  signalReliability: DecisionSignalReliability;
  dataIntake: DecisionDataIntakeQueue;
  modelTrust: DecisionModelTrust;
  portfolioRisk: DecisionPortfolioRisk;
  oddsBoard: DecisionOddsBoard;
}): DecisionEvidenceRefreshVerifier["runtimeEvidence"] {
  return {
    scheduler: `${scheduler.status}: ${scheduler.totals.ready} ready, ${scheduler.totals.blocked} blocked, ${scheduler.totals.safeToRun} safe proof task(s).`,
    signalReliability: `${signalReliability.status}: ${signalReliability.reliabilityScore}/100, ${signalReliability.totals.requiredGaps} required gap(s).`,
    dataIntake: `${dataIntake.status}: ${dataIntake.readyItems} ready, ${dataIntake.blockedItems} blocked, ${dataIntake.coverageScore}/100 coverage.`,
    modelTrust: `${modelTrust.status}: ${modelTrust.trustScore}/100, ${modelTrust.counts.block} block gate(s).`,
    portfolioRisk: `${portfolioRisk.status}: ${portfolioRisk.totals.candidates} candidate(s), ${portfolioRisk.totals.capped} capped, ${portfolioRisk.totals.excluded} excluded.`,
    oddsBoard: `${oddsBoard.status}: ${oddsBoard.totals.value} value, ${oddsBoard.totals.watch} watch, ${oddsBoard.totals.avoid} avoid.`
  };
}

function statusFromTask(task: DecisionEvidenceRefreshTask, proven: boolean): DecisionEvidenceRefreshReceiptStatus {
  if (proven) return "verified";
  if (task.missingEnv.length || !task.safeToRun || task.status === "blocked") return "blocked";
  if (task.status === "waiting") return "waiting";
  return "ready-to-check";
}

function proofText(status: DecisionEvidenceRefreshReceiptStatus, task: DecisionEvidenceRefreshTask): string {
  if (status === "verified") return "Current evidence satisfies this refresh task.";
  if (status === "blocked") {
    return task.missingEnv.length ? `Blocked by missing env: ${task.missingEnv.join(", ")}.` : "Blocked because the task is not safe to run in read-only/dry-run mode.";
  }
  if (status === "waiting") return "Waiting for operator review or external provider state before proof can change.";
  return "Safe proof can be checked now, but current evidence has not satisfied the expected condition yet.";
}

function signalReceipt(task: DecisionEvidenceRefreshTask, reliability: DecisionSignalReliability): DecisionEvidenceRefreshReceipt {
  const signal = reliability.signals.find((item) => item.category === task.category || item.id === task.category);
  const proven = Boolean(signal && (signal.status === "fresh" || signal.status === "usable") && signal.requiredGaps === 0 && signal.missingEnv.length === 0);
  const status = statusFromTask(task, proven);

  return {
    id: `receipt-${task.id}`,
    taskId: task.id,
    source: task.source,
    label: task.label,
    status,
    proof: proofText(status, task),
    currentEvidence: compact([
      signal ? `${signal.label}: ${signal.status}, ${signal.reliabilityScore}/100 reliability.` : "Signal was not found in the reliability board.",
      signal ? `${signal.requiredGaps} required gap(s), ${signal.missingEnv.length} missing env key(s).` : null,
      signal?.exampleMatches[0] ?? task.decisionImpact
    ]),
    expectedEvidence: task.expectedEvidence,
    command: task.command,
    verifyUrl: task.verifyUrl,
    safeToRun: task.safeToRun,
    missingEnv: task.missingEnv,
    nextCheck: proven ? "Keep this proof with the decision run." : task.command
  };
}

function dataIntakeReceipt(task: DecisionEvidenceRefreshTask, dataIntake: DecisionDataIntakeQueue): DecisionEvidenceRefreshReceipt {
  const item = dataIntake.items.find((entry) => entry.category === task.category);
  const proven = Boolean(item && item.status === "ready" && item.mockSignals + item.missingSignals + item.staleSignals === 0);
  const status = statusFromTask(task, proven);

  return {
    id: `receipt-${task.id}`,
    taskId: task.id,
    source: task.source,
    label: task.label,
    status,
    proof: proofText(status, task),
    currentEvidence: compact([
      item ? `${item.label}: ${item.status}, provider ${item.provider}.` : "Data-intake item was not found.",
      item ? `${item.providerBackedSignals} provider-backed, ${item.mockSignals} mock, ${item.missingSignals} missing, ${item.staleSignals} stale.` : null,
      item?.exampleMatches[0] ?? task.decisionImpact
    ]),
    expectedEvidence: task.expectedEvidence,
    command: task.command,
    verifyUrl: task.verifyUrl,
    safeToRun: task.safeToRun,
    missingEnv: task.missingEnv,
    nextCheck: proven ? "Keep this provider proof with the decision run." : task.command
  };
}

function modelTrustReceipt(task: DecisionEvidenceRefreshTask, modelTrust: DecisionModelTrust): DecisionEvidenceRefreshReceipt {
  const gateId = task.id.replace(/^model-trust-/, "");
  const gate = modelTrust.gates.find((item) => item.id === gateId);
  const proven = gate?.status === "pass";
  const status = statusFromTask(task, proven);

  return {
    id: `receipt-${task.id}`,
    taskId: task.id,
    source: task.source,
    label: task.label,
    status,
    proof: proofText(status, task),
    currentEvidence: compact([
      gate ? `${gate.label}: ${gate.status}, ${gate.score}/100.` : "Model-trust gate was not found.",
      gate?.detail,
      gate?.requiredAction ? `Required: ${gate.requiredAction}` : null
    ]),
    expectedEvidence: task.expectedEvidence,
    command: task.command,
    verifyUrl: task.verifyUrl,
    safeToRun: task.safeToRun,
    missingEnv: task.missingEnv,
    nextCheck: proven ? "Keep this trust proof with the decision run." : task.command
  };
}

function portfolioReceipt(task: DecisionEvidenceRefreshTask, portfolioRisk: DecisionPortfolioRisk): DecisionEvidenceRefreshReceipt {
  const proven = portfolioRisk.status === "paper-ready";
  const status = statusFromTask(task, proven);

  return {
    id: `receipt-${task.id}`,
    taskId: task.id,
    source: task.source,
    label: task.label,
    status,
    proof: proofText(status, task),
    currentEvidence: compact([portfolioRisk.summary, `${portfolioRisk.totals.capped} capped, ${portfolioRisk.totals.excluded} excluded.`]),
    expectedEvidence: task.expectedEvidence,
    command: task.command,
    verifyUrl: task.verifyUrl,
    safeToRun: task.safeToRun,
    missingEnv: task.missingEnv,
    nextCheck: proven ? "Keep this portfolio proof with the decision run." : task.command
  };
}

function oddsBoardReceipt(task: DecisionEvidenceRefreshTask, oddsBoard: DecisionOddsBoard): DecisionEvidenceRefreshReceipt {
  const avoidDominates = oddsBoard.totals.avoid > oddsBoard.totals.value + oddsBoard.totals.watch;
  const proven = oddsBoard.status === "value-found" && !avoidDominates && oddsBoard.totals.averageMargin !== null;
  const status = statusFromTask(task, proven);

  return {
    id: `receipt-${task.id}`,
    taskId: task.id,
    source: task.source,
    label: task.label,
    status,
    proof: proofText(status, task),
    currentEvidence: compact([
      oddsBoard.summary,
      `${oddsBoard.totals.value} value, ${oddsBoard.totals.watch} watch, ${oddsBoard.totals.avoid} avoid.`,
      oddsBoard.totals.averageMargin === null ? "Average bookmaker margin is not available." : `Average margin ${oddsBoard.totals.averageMargin}.`
    ]),
    expectedEvidence: task.expectedEvidence,
    command: task.command,
    verifyUrl: task.verifyUrl,
    safeToRun: task.safeToRun,
    missingEnv: task.missingEnv,
    nextCheck: proven ? "Keep this odds-board proof with the decision run." : task.command
  };
}

function receiptForTask({
  task,
  signalReliability,
  dataIntake,
  modelTrust,
  portfolioRisk,
  oddsBoard
}: {
  task: DecisionEvidenceRefreshTask;
  signalReliability: DecisionSignalReliability;
  dataIntake: DecisionDataIntakeQueue;
  modelTrust: DecisionModelTrust;
  portfolioRisk: DecisionPortfolioRisk;
  oddsBoard: DecisionOddsBoard;
}): DecisionEvidenceRefreshReceipt {
  if (task.source === "signal-reliability") return signalReceipt(task, signalReliability);
  if (task.source === "data-intake") return dataIntakeReceipt(task, dataIntake);
  if (task.source === "model-trust") return modelTrustReceipt(task, modelTrust);
  if (task.source === "portfolio-risk") return portfolioReceipt(task, portfolioRisk);
  return oddsBoardReceipt(task, oddsBoard);
}

export function buildDecisionEvidenceRefreshVerifier({
  scheduler,
  signalReliability,
  dataIntake,
  modelTrust,
  portfolioRisk,
  oddsBoard,
  now = new Date()
}: {
  scheduler: DecisionEvidenceRefreshScheduler;
  signalReliability: DecisionSignalReliability;
  dataIntake: DecisionDataIntakeQueue;
  modelTrust: DecisionModelTrust;
  portfolioRisk: DecisionPortfolioRisk;
  oddsBoard: DecisionOddsBoard;
  now?: Date;
}): DecisionEvidenceRefreshVerifier {
  const receipts = scheduler.tasks.map((task) =>
    receiptForTask({ task, signalReliability, dataIntake, modelTrust, portfolioRisk, oddsBoard })
  );
  const verified = receipts.filter((item) => item.status === "verified").length;
  const readyToCheck = receipts.filter((item) => item.status === "ready-to-check").length;
  const blocked = receipts.filter((item) => item.status === "blocked").length;
  const waiting = receipts.filter((item) => item.status === "waiting").length;
  const status: DecisionEvidenceRefreshVerificationStatus = blocked ? "blocked" : readyToCheck || waiting ? "verifying" : "verified";
  const nextReceipt =
    receipts.find((item) => item.status === "ready-to-check") ??
    receipts.find((item) => item.status === "blocked") ??
    receipts.find((item) => item.status === "waiting") ??
    receipts[0] ??
    null;
  const verificationHash = stableHash({
    scheduler: scheduler.refreshHash,
    status,
    receipts: receipts.map((item) => [item.taskId, item.status, item.currentEvidence, item.missingEnv])
  });

  return {
    generatedAt: now.toISOString(),
    date: scheduler.date,
    sport: scheduler.sport,
    status,
    verificationHash,
    summary:
      status === "verified"
        ? `Evidence refresh verification is clean: ${verified} receipt(s) are satisfied.`
        : status === "verifying"
          ? `Evidence refresh verification has ${readyToCheck + waiting} receipt(s) ready or waiting for proof.`
          : `Evidence refresh verification is blocked by ${blocked} receipt(s); missing provider/admin/Supabase proof still caps trust.`,
    receipts,
    nextReceipt,
    counts: {
      receipts: receipts.length,
      verified,
      readyToCheck,
      blocked,
      waiting
    },
    runtimeEvidence: runtimeEvidence({ scheduler, signalReliability, dataIntake, modelTrust, portfolioRisk, oddsBoard }),
    policy: {
      canRaiseTrust: false,
      canWrite: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      rule:
        "Evidence refresh verification can only compare the current proof state with scheduled tasks. It cannot raise trust, write to Supabase, persist decisions, publish picks, or train models by itself.",
      verificationUrl: `/api/sports/decision/evidence-refresh-verification?date=${encodeURIComponent(scheduler.date)}&sport=${encodeURIComponent(scheduler.sport)}`
    }
  };
}
