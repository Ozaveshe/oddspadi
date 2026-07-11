import { buildDecisionAgentLoop, type DecisionAgentLoop, type DecisionAgentLoopPhaseId } from "@/lib/sports/prediction/decisionAgentLoop";
import type { Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionSelfAuditStatus = "pass" | "watch" | "fail";
export type DecisionSelfAuditSeverity = "low" | "medium" | "high" | "critical";
export type DecisionSelfAuditCategory = "runtime" | "data" | "tools" | "market" | "memory" | "learning" | "actionability" | "safety";

export type DecisionSelfAuditFinding = {
  id: string;
  category: DecisionSelfAuditCategory;
  severity: DecisionSelfAuditSeverity;
  status: DecisionSelfAuditStatus;
  title: string;
  failureMode: string;
  affectedMatches: number;
  evidence: string[];
  mitigation: string;
  ownerPhase: DecisionAgentLoopPhaseId;
};

export type DecisionSelfAuditQuestion = {
  id: string;
  label: string;
  status: DecisionSelfAuditStatus;
  answer: string;
  evidence: string;
};

export type DecisionSelfAudit = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionSelfAuditStatus;
  summary: string;
  trustScore: number;
  canPublishSlate: boolean;
  totalFindings: number;
  criticalFindings: number;
  highFindings: number;
  affectedMatches: number;
  findings: DecisionSelfAuditFinding[];
  questions: DecisionSelfAuditQuestion[];
  nextAuditAction: string;
};

function uniqueCount(values: string[]): number {
  return new Set(values).size;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function severityWeight(severity: DecisionSelfAuditSeverity): number {
  if (severity === "critical") return 26;
  if (severity === "high") return 18;
  if (severity === "medium") return 10;
  return 5;
}

function findingStatus(severity: DecisionSelfAuditSeverity): DecisionSelfAuditStatus {
  if (severity === "critical" || severity === "high") return "fail";
  if (severity === "medium") return "watch";
  return "pass";
}

function matchLabel(row: DecisionRow): string {
  return `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`;
}

function compactEvidence(values: string[], fallback: string): string[] {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  return (cleaned.length ? cleaned : [fallback]).slice(0, 5);
}

function makeFinding(input: Omit<DecisionSelfAuditFinding, "status">): DecisionSelfAuditFinding {
  return {
    ...input,
    status: findingStatus(input.severity)
  };
}

function dataCoverageFinding(rows: DecisionRow[]): DecisionSelfAuditFinding | null {
  const affected = rows.filter((row) => {
    const coverage = row.prediction.decision.dataCoverage;
    return coverage.status === "insufficient" || coverage.missingSignals > 0 || coverage.staleSignals > 0 || coverage.mockSignals > 0;
  });
  if (!affected.length) return null;

  const missingTotal = affected.reduce((sum, row) => sum + row.prediction.decision.dataCoverage.missingSignals, 0);
  const mockTotal = affected.reduce((sum, row) => sum + row.prediction.decision.dataCoverage.mockSignals, 0);
  const severity: DecisionSelfAuditSeverity = missingTotal > rows.length || affected.length / Math.max(1, rows.length) > 0.5 ? "critical" : "high";

  return makeFinding({
    id: "data-coverage-risk",
    category: "data",
    severity,
    title: "Data coverage can invalidate the slate",
    failureMode: `The agent is still carrying ${plural(missingTotal, "missing signal")} and ${plural(mockTotal, "mock signal")} across ${plural(affected.length, "match")}.`,
    affectedMatches: affected.length,
    evidence: compactEvidence(
      affected.map((row) => `${matchLabel(row)}: ${row.prediction.decision.dataCoverage.summary}`),
      "No data-coverage evidence was available."
    ),
    mitigation: "Fetch or verify required fixtures, lineups, injuries, odds, live events, news, weather, and training signals before raising trust.",
    ownerPhase: "observe"
  });
}

function toolExecutionFinding(rows: DecisionRow[]): DecisionSelfAuditFinding | null {
  const affected = rows.filter((row) => row.prediction.decision.toolExecution.status === "blocked" || row.prediction.decision.toolExecution.blockedTasks > 0);
  if (!affected.length) return null;

  return makeFinding({
    id: "tool-execution-risk",
    category: "tools",
    severity: affected.length > rows.length / 2 ? "critical" : "high",
    title: "Required tools are blocked",
    failureMode: `Tool execution is blocked or incomplete for ${plural(affected.length, "match")}, so the agent may be reasoning over stale or fallback evidence.`,
    affectedMatches: affected.length,
    evidence: compactEvidence(
      affected.map((row) => `${matchLabel(row)}: ${row.prediction.decision.toolExecution.nextRun}`),
      "No tool-execution evidence was available."
    ),
    mitigation: "Run the supervisor command or configure the missing provider/admin/Supabase environment before trusting the next action.",
    ownerPhase: "act"
  });
}

function runtimeFinding(loop: DecisionAgentLoop): DecisionSelfAuditFinding | null {
  if (loop.autonomy.status !== "blocked" && !loop.autonomy.missingEnv.length) return null;

  return makeFinding({
    id: "runtime-autonomy-risk",
    category: "runtime",
    severity: loop.autonomy.status === "blocked" ? "critical" : "high",
    title: "Agent autonomy is blocked by runtime configuration",
    failureMode: loop.autonomy.missingEnv.length
      ? `The loop has a next command but cannot safely run it because ${loop.autonomy.missingEnv.join(", ")} is missing.`
      : loop.autonomy.summary,
    affectedMatches: loop.activeFocus ? 1 : 0,
    evidence: compactEvidence([loop.summary, loop.autonomy.summary, loop.autonomy.primaryCommand ?? ""], "No runtime evidence was available."),
    mitigation: "Set the missing environment values, restart the app, and re-run the agent-loop verification endpoint.",
    ownerPhase: "act"
  });
}

function marketFinding(rows: DecisionRow[]): DecisionSelfAuditFinding | null {
  const affected = rows.filter((row) => {
    const odds = row.prediction.decision.oddsIntelligence;
    return odds.totalMarkets === 0 || odds.actionableSelections === 0 || (odds.averageBookmakerMargin ?? 0) > 0.08;
  });
  if (!affected.length) return null;

  return makeFinding({
    id: "market-intelligence-risk",
    category: "market",
    severity: affected.length > rows.length / 2 ? "high" : "medium",
    title: "Market evidence is thin or expensive",
    failureMode: `${plural(affected.length, "match")} lack actionable priced selections or carry high bookmaker-margin pressure.`,
    affectedMatches: affected.length,
    evidence: compactEvidence(
      affected.map((row) => `${matchLabel(row)}: ${row.prediction.decision.oddsIntelligence.summary}`),
      "No market evidence was available."
    ),
    mitigation: "Refresh bookmaker odds, remove margin, and avoid selections where no-vig edge and EV do not both clear the guardrails.",
    ownerPhase: "orient"
  });
}

function memoryFinding(rows: DecisionRow[]): DecisionSelfAuditFinding | null {
  const affected = rows.filter((row) => {
    const memory = row.prediction.decision.caseMemory;
    return memory.status === "not-configured" || memory.status === "no-memory" || memory.status === "failed" || memory.adjustment !== "none";
  });
  if (!affected.length) return null;

  const failed = affected.some((row) => row.prediction.decision.caseMemory.status === "failed");
  return makeFinding({
    id: "case-memory-risk",
    category: "memory",
    severity: failed ? "high" : "medium",
    title: "Case memory cannot fully check similar decisions",
    failureMode: `${plural(affected.length, "match")} cannot rely on strong similar-case memory, so repeated weak patterns may not be discounted enough.`,
    affectedMatches: affected.length,
    evidence: compactEvidence(
      affected.map((row) => `${matchLabel(row)}: ${row.prediction.decision.caseMemory.summary}`),
      "No case-memory evidence was available."
    ),
    mitigation: "Persist decisions, settle outcomes, and restore Supabase memory reads so similar-case reliability can downgrade bad patterns.",
    ownerPhase: "learn"
  });
}

function learningFinding(rows: DecisionRow[]): DecisionSelfAuditFinding | null {
  const affected = rows.filter((row) => {
    const profile = row.prediction.decision.learningProfile;
    return !profile?.active || profile.sampleSize < profile.minimumRecommendedFixtures;
  });
  if (!affected.length) return null;

  return makeFinding({
    id: "learning-corpus-risk",
    category: "learning",
    severity: affected.length > rows.length / 2 ? "high" : "medium",
    title: "Historical learning is not strong enough yet",
    failureMode: `${plural(affected.length, "match")} are using inactive, demo-only, or undersized historical learning profiles.`,
    affectedMatches: affected.length,
    evidence: compactEvidence(
      affected.map((row) => {
        const profile = row.prediction.decision.learningProfile;
        return `${matchLabel(row)}: ${profile?.reason ?? "No learning profile is active."}`;
      }),
      "No learning-profile evidence was available."
    ),
    mitigation: "Complete the 10-year provider backfill, run backtests, and only apply learned thresholds after real-data sample size clears the minimum.",
    ownerPhase: "learn"
  });
}

function actionabilityFinding(rows: DecisionRow[]): DecisionSelfAuditFinding | null {
  const contradictions = rows.filter((row) => {
    const decision = row.prediction.decision;
    return decision.controlPolicy.publishAllowed && (decision.actionability.status !== "actionable" || decision.action !== "consider");
  });
  const blockedValue = rows.filter((row) => {
    const decision = row.prediction.decision;
    return row.prediction.bestPick.hasValue && decision.action !== "consider";
  });
  if (!contradictions.length && !blockedValue.length) return null;

  return makeFinding({
    id: "actionability-risk",
    category: "actionability",
    severity: contradictions.length ? "critical" : "medium",
    title: contradictions.length ? "Publish contract has an internal contradiction" : "Positive model value is still blocked",
    failureMode: contradictions.length
      ? `${plural(contradictions.length, "match")} are publishable without a matching actionable consider decision.`
      : `${plural(blockedValue.length, "match")} have a positive best pick but remain blocked by risk, data, memory, or control gates.`,
    affectedMatches: contradictions.length || blockedValue.length,
    evidence: compactEvidence(
      [...contradictions, ...blockedValue].map((row) => `${matchLabel(row)}: ${row.prediction.decision.actionability.summary}`),
      "No actionability evidence was available."
    ),
    mitigation: "Keep the lower-risk control-policy action unless actionability, committee, robustness, and responsible-use gates agree.",
    ownerPhase: "decide"
  });
}

function safetyFinding(rows: DecisionRow[]): DecisionSelfAuditFinding | null {
  const affected = rows.filter((row) => {
    const decision = row.prediction.decision;
    return decision.aiProtocol.status === "needs-data" || decision.aiProtocol.status === "blocked" || decision.controlPolicy.aiReviewRequired;
  });
  if (!affected.length) return null;

  return makeFinding({
    id: "ai-review-safety-risk",
    category: "safety",
    severity: affected.some((row) => row.prediction.decision.aiProtocol.status === "blocked") ? "high" : "medium",
    title: "Guarded AI review has not cleared the slate",
    failureMode: `${plural(affected.length, "match")} still need the AI protocol, missing-tool requests, or reviewer guardrails cleared before public confidence can rise.`,
    affectedMatches: affected.length,
    evidence: compactEvidence(
      affected.map((row) => `${matchLabel(row)}: ${row.prediction.decision.aiProtocol.summary}`),
      "No AI-protocol evidence was available."
    ),
    mitigation: "Run the guarded reviewer only after deterministic evidence is ready, and accept only cited downgrades or needs-data outcomes.",
    ownerPhase: "orient"
  });
}

function buildQuestions(rows: DecisionRow[], findings: DecisionSelfAuditFinding[], loop: DecisionAgentLoop): DecisionSelfAuditQuestion[] {
  const publishable = rows.filter((row) => row.prediction.decision.controlPolicy.publishAllowed).length;
  const critical = findings.filter((finding) => finding.severity === "critical").length;
  const dataFinding = findings.find((finding) => finding.category === "data");
  const runtime = findings.find((finding) => finding.category === "runtime");
  const learning = findings.find((finding) => finding.category === "learning" || finding.category === "memory");

  return [
    {
      id: "can-publish",
      label: "Can the slate publish?",
      status: critical || !publishable ? "fail" : findings.some((finding) => finding.status === "fail") ? "watch" : "pass",
      answer: critical
        ? "No. At least one critical audit finding must be cleared first."
        : publishable
          ? `Maybe. ${plural(publishable, "match")} are publishable, but audit findings still control the public posture.`
          : "No. No match is currently publishable.",
      evidence: loop.summary
    },
    {
      id: "what-could-break",
      label: "What could break the recommendation?",
      status: dataFinding ? dataFinding.status : "pass",
      answer: dataFinding?.failureMode ?? "No major data-coverage breaker is visible in the current slate.",
      evidence: dataFinding?.evidence[0] ?? "Data coverage has no major failure finding."
    },
    {
      id: "can-act",
      label: "Can the agent act now?",
      status: runtime ? runtime.status : loop.autonomy.canRunPrimaryCommand ? "pass" : "watch",
      answer: runtime?.failureMode ?? (loop.autonomy.canRunPrimaryCommand ? "Yes, the supervisor primary command can run." : loop.autonomy.summary),
      evidence: loop.autonomy.primaryCommand ?? loop.autonomy.summary
    },
    {
      id: "can-learn",
      label: "Will this improve future predictions?",
      status: learning ? learning.status : "pass",
      answer: learning?.failureMode ?? "Yes. Memory and learning gates have no major failure finding in this slate.",
      evidence: learning?.evidence[0] ?? "Learning loop has no major failure finding."
    }
  ];
}

export function buildDecisionSelfAudit({
  rows,
  date,
  sport,
  agentLoop
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  agentLoop?: DecisionAgentLoop;
}): DecisionSelfAudit {
  const loop = agentLoop ?? buildDecisionAgentLoop({ rows, date, sport });
  const findings = [
    runtimeFinding(loop),
    dataCoverageFinding(rows),
    toolExecutionFinding(rows),
    marketFinding(rows),
    memoryFinding(rows),
    learningFinding(rows),
    actionabilityFinding(rows),
    safetyFinding(rows)
  ].filter((finding): finding is DecisionSelfAuditFinding => Boolean(finding));

  const totalPenalty = findings.reduce((sum, finding) => sum + severityWeight(finding.severity), 0);
  const trustScore = Math.max(0, Math.min(100, 100 - totalPenalty));
  const criticalFindings = findings.filter((finding) => finding.severity === "critical").length;
  const highFindings = findings.filter((finding) => finding.severity === "high").length;
  const status: DecisionSelfAuditStatus = criticalFindings ? "fail" : highFindings ? "watch" : "pass";
  const affectedMatches = uniqueCount(findings.flatMap((finding) => finding.evidence.map((item) => item.split(":")[0] ?? "").filter(Boolean)));
  const questions = buildQuestions(rows, findings, loop);
  const nextAuditAction =
    findings[0]?.mitigation ??
    (loop.autonomy.primaryCommand ? `Run and verify ${loop.autonomy.primaryCommand}.` : "Keep monitoring the slate and rerun the self-audit after fixture or provider changes.");

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    summary:
      status === "fail"
        ? `Self-audit failed with ${criticalFindings} critical finding(s); the agent should not raise public trust yet.`
        : status === "watch"
          ? `Self-audit is on watch with ${highFindings} high finding(s); keep the slate internal or monitored.`
          : "Self-audit passed without high or critical findings.",
    trustScore,
    canPublishSlate: status === "pass" && rows.some((row) => row.prediction.decision.controlPolicy.publishAllowed),
    totalFindings: findings.length,
    criticalFindings,
    highFindings,
    affectedMatches,
    findings,
    questions,
    nextAuditAction
  };
}
