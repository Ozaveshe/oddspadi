import type { DecisionActivationAudit, DecisionActivationGate, DecisionActivationGateStatus } from "@/lib/sports/prediction/decisionActivationAudit";
import type { DecisionAutopilot, DecisionAutopilotAction } from "@/lib/sports/prediction/decisionAutopilot";
import type { DecisionTraceLedger, DecisionTraceNode, DecisionTraceReplayStep } from "@/lib/sports/prediction/decisionTraceLedger";
import type { Sport } from "@/lib/sports/types";

export type DecisionProofRunnerStatus = "verified" | "partial" | "blocked";
export type DecisionProofReceiptStatus = "verified" | "needs-run" | "blocked" | "contradicted";
export type DecisionProofReceiptKind = "activation-gate" | "trace-node" | "replay-step" | "autopilot-action";

export type DecisionProofReceipt = {
  id: string;
  kind: DecisionProofReceiptKind;
  status: DecisionProofReceiptStatus;
  label: string;
  claim: string;
  observedEvidence: string;
  expectedEvidence: string;
  command: string | null;
  verifyUrl: string;
  safeToRun: boolean;
  missingEnv: string[];
  evidenceHash: string;
};

export type DecisionProofRunner = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionProofRunnerStatus;
  mode: "supervised-read-only";
  summary: string;
  receipts: DecisionProofReceipt[];
  nextReceipt: DecisionProofReceipt | null;
  verifiedReceipts: number;
  needsRunReceipts: number;
  blockedReceipts: number;
  contradictedReceipts: number;
  coverageScore: number;
  runbook: {
    canRunAnything: boolean;
    safeReadOnlyCommands: number;
    unsafeOrBlockedCommands: number;
    firstSafeCommand: string | null;
    firstVerificationUrl: string | null;
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

function commandIsSafe(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return false;
  if (lower.includes("persist=1") || lower.includes("persist=true")) return false;
  if (lower.includes("dryrun=0") || lower.includes("dryrun=false")) return false;
  if (!lower.includes("-x post") && !lower.includes("-xpost")) return true;
  return lower.includes("dryrun=1");
}

function receipt(input: Omit<DecisionProofReceipt, "evidenceHash">): DecisionProofReceipt {
  return {
    ...input,
    evidenceHash: stableHash({
      id: input.id,
      status: input.status,
      observedEvidence: input.observedEvidence,
      expectedEvidence: input.expectedEvidence,
      verifyUrl: input.verifyUrl
    })
  };
}

function statusFromGate(status: DecisionActivationGateStatus): DecisionProofReceiptStatus {
  if (status === "pass") return "verified";
  if (status === "watch") return "needs-run";
  return "blocked";
}

function activationReceipt(gate: DecisionActivationGate): DecisionProofReceipt {
  return receipt({
    id: `activation-${gate.id}`,
    kind: "activation-gate",
    status: statusFromGate(gate.status),
    label: gate.label,
    claim: gate.requiredEvidence,
    observedEvidence: gate.detail,
    expectedEvidence: gate.nextAction,
    command: gate.command,
    verifyUrl: gate.verifyUrl,
    safeToRun: commandIsSafe(gate.command),
    missingEnv: gate.missingEnv
  });
}

function traceNodeReceipt(node: DecisionTraceNode): DecisionProofReceipt {
  const status: DecisionProofReceiptStatus = node.status === "pass" ? "verified" : node.status === "watch" ? "needs-run" : "blocked";
  return receipt({
    id: `trace-${node.id}`,
    kind: "trace-node",
    status,
    label: node.claim,
    claim: node.claim,
    observedEvidence: node.evidence,
    expectedEvidence: `Verify ${node.verifyUrl}.`,
    command: node.command,
    verifyUrl: node.verifyUrl,
    safeToRun: commandIsSafe(node.command),
    missingEnv: node.missingEnv
  });
}

function replayStepReceipt(step: DecisionTraceReplayStep): DecisionProofReceipt {
  return receipt({
    id: `replay-${step.id}`,
    kind: "replay-step",
    status: step.blockedBy.length ? "blocked" : step.canReplay ? "needs-run" : "blocked",
    label: step.label,
    claim: step.expectedEvidence,
    observedEvidence: step.canReplay ? "Replay command is read-only or dryRun=1." : "Replay command is not safe for supervised run mode.",
    expectedEvidence: step.expectedEvidence,
    command: step.command,
    verifyUrl: step.verifyUrl,
    safeToRun: step.canReplay && commandIsSafe(step.command),
    missingEnv: step.blockedBy
  });
}

function autopilotActionReceipt(action: DecisionAutopilotAction): DecisionProofReceipt {
  return receipt({
    id: `autopilot-${action.id}`,
    kind: "autopilot-action",
    status: action.status === "ready" && action.canAutoRun ? "needs-run" : action.status === "ready" ? "needs-run" : "blocked",
    label: action.label,
    claim: action.rationale,
    observedEvidence: action.safeToRun ? "Autopilot action is safe for supervised read-only/dry-run handling." : "Autopilot action is not safe to run automatically.",
    expectedEvidence: action.expectedEvidence,
    command: action.command,
    verifyUrl: action.verifyUrl,
    safeToRun: action.safeToRun && commandIsSafe(action.command),
    missingEnv: action.missingEnv
  });
}

function receiptRank(item: DecisionProofReceipt): number {
  const statusRank = { contradicted: 4, blocked: 3, "needs-run": 2, verified: 1 }[item.status];
  const kindRank = { "activation-gate": 4, "trace-node": 3, "replay-step": 2, "autopilot-action": 1 }[item.kind];
  return statusRank * 10 + kindRank;
}

export function buildDecisionProofRunner({
  date,
  sport,
  activationAudit,
  traceLedger,
  autopilot,
  limit = 18
}: {
  date: string;
  sport: Sport;
  activationAudit: DecisionActivationAudit;
  traceLedger: DecisionTraceLedger;
  autopilot: DecisionAutopilot;
  limit?: number;
}): DecisionProofRunner {
  const activationReceipts = activationAudit.gates.map(activationReceipt);
  const traceReceipts = traceLedger.nodes.map(traceNodeReceipt);
  const replayReceipts = traceLedger.replaySteps.map(replayStepReceipt);
  const autopilotReceipts = autopilot.actions.map(autopilotActionReceipt);
  const allReceipts = [...activationReceipts, ...traceReceipts, ...replayReceipts, ...autopilotReceipts].sort(
    (a, b) => receiptRank(b) - receiptRank(a) || a.id.localeCompare(b.id)
  );
  const receipts = allReceipts.slice(0, limit);

  const verifiedReceipts = allReceipts.filter((item) => item.status === "verified").length;
  const needsRunReceipts = allReceipts.filter((item) => item.status === "needs-run").length;
  const blockedReceipts = allReceipts.filter((item) => item.status === "blocked").length;
  const contradictedReceipts = allReceipts.filter((item) => item.status === "contradicted").length;
  const safeReceipts = allReceipts.filter((item) => item.safeToRun && !item.missingEnv.length);
  const nextReceipt = allReceipts.find((item) => item.status === "blocked") ?? allReceipts.find((item) => item.status === "needs-run") ?? null;
  const status: DecisionProofRunnerStatus = contradictedReceipts || blockedReceipts ? "blocked" : needsRunReceipts ? "partial" : "verified";
  const coverageScore = allReceipts.length ? Math.round((verifiedReceipts / allReceipts.length) * 100) : 0;

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    mode: "supervised-read-only",
    summary:
      status === "verified"
        ? `Proof runner verified ${verifiedReceipts} receipt(s); the current decision path is ready for the next supervised transition.`
        : status === "partial"
          ? `Proof runner has ${needsRunReceipts} receipt(s) that need a safe read-only or dry-run verification.`
          : `Proof runner is blocked by ${blockedReceipts + contradictedReceipts} receipt(s); do not enable autonomous write or publish mode.`,
    receipts,
    nextReceipt,
    verifiedReceipts,
    needsRunReceipts,
    blockedReceipts,
    contradictedReceipts,
    coverageScore,
    runbook: {
      canRunAnything: safeReceipts.length > 0,
      safeReadOnlyCommands: safeReceipts.length,
      unsafeOrBlockedCommands: allReceipts.length - safeReceipts.length,
      firstSafeCommand: safeReceipts[0]?.command ?? null,
      firstVerificationUrl: safeReceipts[0]?.verifyUrl ?? null,
      forbiddenActions: [
        "Do not execute write-mode imports from this proof runner.",
        "Do not persist mock-backed predictions into production memory.",
        "Do not bypass activation gates with missing provider or Supabase evidence.",
        "Do not treat OpenAI text as evidence unless it cites supplied IDs."
      ]
    }
  };
}
