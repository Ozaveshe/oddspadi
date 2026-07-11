import { buildDecisionAgentLoop, type DecisionAgentLoop, type DecisionAgentLoopPhaseId } from "@/lib/sports/prediction/decisionAgentLoop";
import { buildDecisionBrainSlate, type DecisionBrainSlate } from "@/lib/sports/prediction/decisionBrain";
import { buildDecisionRepairPlan, type DecisionRepairPlan } from "@/lib/sports/prediction/decisionRepairPlanner";
import { buildDecisionRepairVerification, type DecisionRepairVerification, type DecisionRepairVerificationItem } from "@/lib/sports/prediction/decisionRepairVerifier";
import { buildDecisionSelfAudit, type DecisionSelfAudit } from "@/lib/sports/prediction/decisionSelfAudit";
import { buildDecisionSupervisorQueue } from "@/lib/sports/prediction/decisionSupervisor";
import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import type { DecisionSupervisorQueue, Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionOperatingCycleStageId = "observe" | "diagnose" | "decide" | "act" | "verify" | "learn";
export type DecisionOperatingCycleStageStatus = "complete" | "active" | "waiting" | "blocked";
export type DecisionOperatingCycleStatus = "clear" | "running" | "verifying" | "blocked";

export type DecisionOperatingCycleStage = {
  id: DecisionOperatingCycleStageId;
  label: string;
  status: DecisionOperatingCycleStageStatus;
  owner: string;
  evidence: string[];
  nextAction: string;
  successSignal: string;
};

export type DecisionOperatingCycleTransition = {
  stageId: DecisionOperatingCycleStageId;
  label: string;
  status: DecisionOperatingCycleStageStatus;
  action: string;
  command: string | null;
  verifyUrl: string;
  expectedEvidence: string;
  canRunNow: boolean;
  blockedBy: string[];
};

export type DecisionOperatingCycle = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionOperatingCycleStatus;
  summary: string;
  activeStageId: DecisionOperatingCycleStageId;
  trustScore: number;
  potentialTrustScore: number;
  stages: DecisionOperatingCycleStage[];
  nextTransition: DecisionOperatingCycleTransition;
  workingMemory: {
    currentBelief: string;
    primaryDoubt: string;
    decisiveUnknown: string;
    guardrail: string;
    learningTarget: string;
  };
  state: {
    activeMatch: string | null;
    activeMatchId: string | null;
    supervisorStatus: DecisionSupervisorQueue["status"];
    runbookStatus: DecisionSupervisorQueue["runbook"]["status"];
    repairStatus: DecisionRepairPlan["status"];
    verificationStatus: DecisionRepairVerification["status"];
    canPublish: boolean;
    canPersist: boolean;
    canRunPrimaryCommand: boolean;
  };
  proofChain: string[];
};

function compact(values: string[], fallback: string, limit = 4): string[] {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  return (cleaned.length ? cleaned : [fallback]).slice(0, limit);
}

function statusFromAgentPhase(status: DecisionAgentLoop["phases"][number]["status"] | undefined): DecisionOperatingCycleStageStatus {
  if (status === "blocked") return "blocked";
  if (status === "active") return "active";
  if (status === "waiting") return "waiting";
  return "complete";
}

function statusFromAudit(audit: DecisionSelfAudit): DecisionOperatingCycleStageStatus {
  if (audit.status === "fail") return "blocked";
  if (audit.status === "watch") return "active";
  return "complete";
}

function statusFromRunbook(runbook: DecisionSupervisorQueue["runbook"]): DecisionOperatingCycleStageStatus {
  if (runbook.status === "blocked") return "blocked";
  if (runbook.status === "waiting") return "waiting";
  return "active";
}

function statusFromVerification(verification: DecisionRepairVerification): DecisionOperatingCycleStageStatus {
  if (verification.status === "blocked") return "blocked";
  if (verification.status === "verifying") return "active";
  return "complete";
}

function learnStatus(agentLoop: DecisionAgentLoop, readiness: DecisionEngineReadiness | null): DecisionOperatingCycleStageStatus {
  const phase = agentLoop.phases.find((item) => item.id === "learn");
  if (phase?.status === "blocked") return "blocked";
  if (readiness?.supabase.status === "blocked") return "blocked";
  if (readiness?.trainingData.status === "ready" && readiness.supabase.status === "ready") return "complete";
  if (phase?.status === "waiting" || readiness?.trainingData.status === "warning" || readiness?.supabase.status === "warning") return "waiting";
  return statusFromAgentPhase(phase?.status);
}

function firstFinding(audit: DecisionSelfAudit): string {
  const finding = audit.findings[0];
  return finding ? `${finding.title}: ${finding.failureMode}` : "No self-audit finding is currently blocking the slate.";
}

function activeDecision(rows: DecisionRow[], agentLoop: DecisionAgentLoop): Prediction["decision"] | null {
  const matchId = agentLoop.activeFocus?.matchId;
  if (!matchId) return rows[0]?.prediction.decision ?? null;
  return rows.find((row) => row.match.id === matchId)?.prediction.decision ?? rows[0]?.prediction.decision ?? null;
}

function transitionFromRepairItem(item: DecisionRepairVerificationItem, stageId: DecisionOperatingCycleStageId): DecisionOperatingCycleTransition {
  const blockedBy = item.status === "blocked" ? item.currentEvidence : [];
  return {
    stageId,
    label: item.title,
    status: item.status === "blocked" ? "blocked" : item.status === "waiting" ? "waiting" : "active",
    action: item.nextCheck,
    command: item.nextCheck.startsWith("curl.exe ") ? item.nextCheck : null,
    verifyUrl: item.verifyUrl,
    expectedEvidence: item.proof,
    canRunNow: item.status === "ready-to-run",
    blockedBy
  };
}

function chooseNextTransition({
  selfAudit,
  repairVerification,
  supervisorQueue,
  agentLoop
}: {
  selfAudit: DecisionSelfAudit;
  repairVerification: DecisionRepairVerification;
  supervisorQueue: DecisionSupervisorQueue;
  agentLoop: DecisionAgentLoop;
}): DecisionOperatingCycleTransition {
  const nextVerification = repairVerification.nextVerification;
  if (nextVerification && nextVerification.status !== "verified") {
    return transitionFromRepairItem(nextVerification, nextVerification.status === "ready-to-run" ? "act" : "verify");
  }

  if (selfAudit.status !== "pass") {
    return {
      stageId: "diagnose",
      label: "Self-audit owns the next transition",
      status: selfAudit.status === "fail" ? "blocked" : "active",
      action: selfAudit.nextAuditAction,
      command: null,
      verifyUrl: `/api/sports/decision/self-audit?date=${encodeURIComponent(selfAudit.date)}&sport=${encodeURIComponent(selfAudit.sport)}`,
      expectedEvidence: "Self-audit returns fewer high/critical findings or a higher trust score.",
      canRunNow: true,
      blockedBy: selfAudit.findings.slice(0, 3).map((finding) => finding.failureMode)
    };
  }

  if (supervisorQueue.runbook.primaryCommand) {
    return {
      stageId: "act",
      label: supervisorQueue.runbook.title,
      status: statusFromRunbook(supervisorQueue.runbook),
      action: supervisorQueue.runbook.summary,
      command: supervisorQueue.runbook.primaryCommand,
      verifyUrl: supervisorQueue.runbook.steps.at(-1)?.url ?? agentLoop.verification.verifyUrl,
      expectedEvidence: supervisorQueue.runbook.expectedStateChange,
      canRunNow: supervisorQueue.runbook.preflight.canRunPrimaryCommand,
      blockedBy: supervisorQueue.runbook.preflight.missingEnv
    };
  }

  return {
    stageId: "learn",
    label: "Learning loop owns the next transition",
    status: agentLoop.actionContract.persistAllowed ? "active" : "waiting",
    action: agentLoop.phases.find((phase) => phase.id === "learn")?.nextAction ?? "Store decision evidence and settle outcomes when results arrive.",
    command: null,
    verifyUrl: "/api/sports/decision/memory",
    expectedEvidence: "Stored decisions, settled outcomes, calibration, and case-memory reads become available.",
    canRunNow: agentLoop.actionContract.persistAllowed,
    blockedBy: agentLoop.actionContract.persistAllowed ? [] : ["Persistence is not allowed until control policy and Supabase readiness agree."]
  };
}

function cycleStatus(stages: DecisionOperatingCycleStage[], transition: DecisionOperatingCycleTransition): DecisionOperatingCycleStatus {
  if (transition.status === "blocked" || stages.some((stage) => stage.status === "blocked" && stage.id !== "diagnose")) return "blocked";
  if (transition.stageId === "verify") return "verifying";
  if (stages.some((stage) => stage.status === "active" || stage.status === "waiting")) return "running";
  return "clear";
}

export function buildDecisionOperatingCycle({
  rows,
  date,
  sport,
  readiness = null,
  brainSlate,
  supervisorQueue,
  agentLoop,
  selfAudit,
  repairPlan,
  repairVerification
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  readiness?: DecisionEngineReadiness | null;
  brainSlate?: DecisionBrainSlate;
  supervisorQueue?: DecisionSupervisorQueue;
  agentLoop?: DecisionAgentLoop;
  selfAudit?: DecisionSelfAudit;
  repairPlan?: DecisionRepairPlan;
  repairVerification?: DecisionRepairVerification;
}): DecisionOperatingCycle {
  const slate = brainSlate ?? buildDecisionBrainSlate({ rows, date, sport, limit: 6 });
  const queue = supervisorQueue ?? buildDecisionSupervisorQueue({ rows, date, sport, limit: 8 });
  const loop = agentLoop ?? buildDecisionAgentLoop({ rows, date, sport, limit: 6, brainSlate: slate, supervisorQueue: queue });
  const audit = selfAudit ?? buildDecisionSelfAudit({ rows, date, sport, agentLoop: loop });
  const plan = repairPlan ?? buildDecisionRepairPlan({ rows, date, sport, agentLoop: loop, selfAudit: audit });
  const verification = repairVerification ?? buildDecisionRepairVerification({ repairPlan: plan, selfAudit: audit, readiness });
  const decision = activeDecision(rows, loop);
  const observePhase = loop.phases.find((phase) => phase.id === "observe");
  const decidePhase = loop.phases.find((phase) => phase.id === "decide");
  const learnPhase = loop.phases.find((phase) => phase.id === "learn");
  const transition = chooseNextTransition({ selfAudit: audit, repairVerification: verification, supervisorQueue: queue, agentLoop: loop });
  const stages: DecisionOperatingCycleStage[] = [
    {
      id: "observe",
      label: "Observe",
      status: statusFromAgentPhase(observePhase?.status),
      owner: "agent-loop.observe",
      evidence: compact([observePhase?.evidence[0] ?? "", decision?.dataCoverage.summary ?? ""], "No observation evidence is available."),
      nextAction: observePhase?.nextAction ?? "Refresh fixtures, odds, and context signals.",
      successSignal: observePhase?.successSignal ?? "Required inputs are available."
    },
    {
      id: "diagnose",
      label: "Diagnose",
      status: statusFromAudit(audit),
      owner: "self-audit",
      evidence: compact([audit.summary, firstFinding(audit)], "No diagnostic evidence is available."),
      nextAction: audit.nextAuditAction,
      successSignal: "Trust score rises and high/critical failure modes clear."
    },
    {
      id: "decide",
      label: "Decide",
      status: statusFromAgentPhase(decidePhase?.status),
      owner: "control-policy",
      evidence: compact([decision?.controlPolicy.summary ?? "", decision?.actionability.summary ?? ""], "No decision-policy evidence is available."),
      nextAction: decidePhase?.nextAction ?? "Apply control-policy gates.",
      successSignal: decidePhase?.successSignal ?? "A bounded consider, monitor, or avoid action is selected."
    },
    {
      id: "act",
      label: "Act",
      status: statusFromRunbook(queue.runbook),
      owner: "supervisor-runbook",
      evidence: compact([queue.runbook.summary, queue.runbook.preflight.summary], "No runbook evidence is available."),
      nextAction: queue.runbook.primaryCommand ?? queue.runbook.summary,
      successSignal: queue.runbook.expectedStateChange
    },
    {
      id: "verify",
      label: "Verify",
      status: statusFromVerification(verification),
      owner: "repair-verification",
      evidence: compact([verification.summary, verification.nextVerification?.proof ?? ""], "No verification evidence is available."),
      nextAction: verification.nextVerification?.nextCheck ?? "Keep verification evidence with the decision run.",
      successSignal: "Repair verifier reports verified or self-audit no longer reports the original finding."
    },
    {
      id: "learn",
      label: "Learn",
      status: learnStatus(loop, readiness),
      owner: "memory-calibration-training",
      evidence: compact([learnPhase?.evidence[0] ?? "", readiness?.trainingData.detail ?? "", readiness?.supabase.schema.detail ?? ""], "No learning evidence is available."),
      nextAction: learnPhase?.nextAction ?? "Persist decisions, settle outcomes, and run calibration.",
      successSignal: learnPhase?.successSignal ?? "Decision memory, outcomes, and backtests update future guardrails."
    }
  ];
  const status = cycleStatus(stages, transition);
  const activeStageId = transition.stageId;

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    summary:
      status === "clear"
        ? "Operating cycle is clear; no stage currently owns a blocking action."
        : status === "verifying"
          ? `Operating cycle is verifying proof for ${transition.label}.`
          : status === "running"
            ? `Operating cycle is running ${transition.stageId}: ${transition.label}.`
            : `Operating cycle is blocked at ${transition.stageId}: ${transition.label}.`,
    activeStageId,
    trustScore: audit.trustScore,
    potentialTrustScore: plan.potentialTrustScore,
    stages,
    nextTransition: transition,
    workingMemory: {
      currentBelief: decision?.beliefState.summary ?? "No active belief is available yet.",
      primaryDoubt: audit.findings[0]?.failureMode ?? decision?.deliberation.dissentingThesis ?? "No primary doubt is currently recorded.",
      decisiveUnknown:
        decision?.dataCoverage.requiredBeforeTrust[0] ??
        decision?.missingSignals[0] ??
        queue.runbook.preflight.missingEnv[0] ??
        "No decisive unknown is currently recorded.",
      guardrail: decision?.controlPolicy.primaryDirective ?? transition.expectedEvidence,
      learningTarget: decision?.evaluationPlan.learningQuestions[0] ?? "Measure settlement, closing-line value, calibration, and missed context after the match."
    },
    state: {
      activeMatch: loop.activeFocus?.match ?? null,
      activeMatchId: loop.activeFocus?.matchId ?? null,
      supervisorStatus: queue.status,
      runbookStatus: queue.runbook.status,
      repairStatus: plan.status,
      verificationStatus: verification.status,
      canPublish: loop.actionContract.publishAllowed,
      canPersist: loop.actionContract.persistAllowed,
      canRunPrimaryCommand: queue.runbook.preflight.canRunPrimaryCommand
    },
    proofChain: compact(
      [
        `Agent loop: ${loop.status}`,
        `Self-audit: ${audit.status}, trust ${audit.trustScore}/100`,
        `Repair verification: ${verification.status}, ${verification.blocked} blocked`,
        readiness ? `Readiness: Supabase ${readiness.supabase.status}, providers ${readiness.dataProviders.status}` : "",
        `Verify: ${transition.verifyUrl}`
      ],
      "No proof chain is available.",
      6
    )
  };
}
