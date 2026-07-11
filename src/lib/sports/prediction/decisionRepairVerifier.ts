import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import type { DecisionRepairAction, DecisionRepairPlan } from "@/lib/sports/prediction/decisionRepairPlanner";
import type { DecisionSelfAudit } from "@/lib/sports/prediction/decisionSelfAudit";
import type { Sport } from "@/lib/sports/types";

export type DecisionRepairVerificationStatus = "verified" | "ready-to-run" | "blocked" | "needs-rerun" | "waiting";

export type DecisionRepairVerificationItem = {
  id: string;
  actionId: string;
  title: string;
  status: DecisionRepairVerificationStatus;
  proof: string;
  currentEvidence: string[];
  nextCheck: string;
  verifyUrl: string;
};

export type DecisionRepairVerification = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: "clear" | "verifying" | "blocked";
  summary: string;
  verified: number;
  readyToRun: number;
  blocked: number;
  needsRerun: number;
  items: DecisionRepairVerificationItem[];
  runtimeEvidence: {
    supabase: string;
    providers: string;
    openAi: string;
    training: string;
  };
  nextVerification: DecisionRepairVerificationItem | null;
};

function compact(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean).slice(0, 5);
}

function readinessEvidence(readiness: DecisionEngineReadiness | null): DecisionRepairVerification["runtimeEvidence"] {
  if (!readiness) {
    return {
      supabase: "Readiness snapshot was not supplied.",
      providers: "Readiness snapshot was not supplied.",
      openAi: "Readiness snapshot was not supplied.",
      training: "Readiness snapshot was not supplied."
    };
  }

  return {
    supabase: `${readiness.supabase.status}: ${readiness.supabase.schema.detail}`,
    providers: `${readiness.dataProviders.status}: ${readiness.dataProviders.configuredSignalCoverage}/100 configured coverage, ${readiness.dataProviders.liveRuntimeSignalCoverage}/100 live coverage.`,
    openAi: `${readiness.openAi.status}: ${readiness.openAi.detail}`,
    training: `${readiness.trainingData.status}: ${readiness.trainingData.detail}`
  };
}

function evidenceForAction(action: DecisionRepairAction, readiness: DecisionEngineReadiness | null): string[] {
  const runtime = readinessEvidence(readiness);
  if (action.category === "runtime" || action.category === "memory") return compact([runtime.supabase, action.expectedEvidence]);
  if (action.category === "data" || action.category === "tools" || action.category === "market") return compact([runtime.providers, action.expectedEvidence]);
  if (action.category === "learning") return compact([runtime.training, runtime.supabase, action.expectedEvidence]);
  if (action.category === "safety") return compact([runtime.openAi, action.expectedEvidence]);
  return compact([action.expectedEvidence]);
}

function itemStatus({
  action,
  findingStillPresent
}: {
  action: DecisionRepairAction;
  findingStillPresent: boolean;
}): DecisionRepairVerificationStatus {
  if (!findingStillPresent) return "verified";
  if (action.missingEnv.length || action.status === "blocked") return "blocked";
  if (action.status === "ready") return "ready-to-run";
  if (action.status === "waiting") return "waiting";
  return "needs-rerun";
}

function statusSummary(status: DecisionRepairVerificationStatus, action: DecisionRepairAction): string {
  if (status === "verified") return "The original audit finding is no longer present.";
  if (status === "blocked") return action.missingEnv.length ? `Blocked by missing env: ${action.missingEnv.join(", ")}.` : "Blocked by the current repair-plan status.";
  if (status === "ready-to-run") return action.command ? "The repair command is ready to run, then self-audit must be rerun." : "The repair is ready for operator verification.";
  if (status === "waiting") return "Waiting for operator review or external provider state.";
  return "Run the verification URL and confirm the finding clears or downgrades.";
}

function verificationItem(action: DecisionRepairAction, audit: DecisionSelfAudit, readiness: DecisionEngineReadiness | null): DecisionRepairVerificationItem {
  const findingStillPresent = audit.findings.some((finding) => finding.id === action.findingId);
  const status = itemStatus({ action, findingStillPresent });

  return {
    id: `verify-${action.id}`,
    actionId: action.id,
    title: action.title,
    status,
    proof: statusSummary(status, action),
    currentEvidence: evidenceForAction(action, readiness),
    nextCheck: status === "verified" ? "Keep the repair evidence with the decision run." : action.command ?? action.detail,
    verifyUrl: action.verifyUrl
  };
}

export function buildDecisionRepairVerification({
  repairPlan,
  selfAudit,
  readiness = null
}: {
  repairPlan: DecisionRepairPlan;
  selfAudit: DecisionSelfAudit;
  readiness?: DecisionEngineReadiness | null;
}): DecisionRepairVerification {
  const items = repairPlan.actions.map((action) => verificationItem(action, selfAudit, readiness));
  const verified = items.filter((item) => item.status === "verified").length;
  const readyToRun = items.filter((item) => item.status === "ready-to-run").length;
  const blocked = items.filter((item) => item.status === "blocked").length;
  const needsRerun = items.filter((item) => item.status === "needs-rerun").length;
  const waiting = items.filter((item) => item.status === "waiting").length;
  const status: DecisionRepairVerification["status"] = blocked ? "blocked" : readyToRun || needsRerun || waiting ? "verifying" : "clear";
  const nextVerification =
    items.find((item) => item.status === "ready-to-run") ??
    items.find((item) => item.status === "blocked") ??
    items.find((item) => item.status === "needs-rerun") ??
    items[0] ??
    null;

  return {
    generatedAt: new Date().toISOString(),
    date: repairPlan.date,
    sport: repairPlan.sport,
    status,
    summary:
      status === "clear"
        ? "Repair verification is clear; no queued repair remains unproven."
        : status === "verifying"
          ? `Repair verification has ${readyToRun + needsRerun + waiting} item(s) ready or waiting for proof.`
          : `Repair verification is blocked on ${blocked} repair proof item(s).`,
    verified,
    readyToRun,
    blocked,
    needsRerun,
    items,
    runtimeEvidence: readinessEvidence(readiness),
    nextVerification
  };
}
