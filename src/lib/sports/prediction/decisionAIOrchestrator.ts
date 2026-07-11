import type { DecisionAgentLoop } from "@/lib/sports/prediction/decisionAgentLoop";
import { runOpenAIDecisionCouncilReview, type DecisionAICouncil } from "@/lib/sports/prediction/decisionAICouncil";
import type { DecisionBrainSlate } from "@/lib/sports/prediction/decisionBrain";
import type { DecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import type { DecisionSelfAudit } from "@/lib/sports/prediction/decisionSelfAudit";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import type { DecisionAction, DecisionAiAgentStatus, Match, Prediction, Sport } from "@/lib/sports/types";
import { runOpenAIDecisionAgentReview } from "./openaiDecisionAgent";
import { getDecisionOpenAIModel } from "./openaiModel";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionAIOrchestratorStatus = "ready-to-review" | "needs-config" | "blocked" | "reviewed";
export type DecisionAIOrchestratorScope = "slate" | "active-match";
export type DecisionAIOrchestratorRunScope = "none" | "slate" | "active-match" | "all";
export type DecisionAIOrchestratorRoleStatus = "ready" | "waiting" | "blocked";

export type DecisionAIOrchestratorTarget = {
  id: string;
  scope: DecisionAIOrchestratorScope;
  label: string;
  priority: "critical" | "high" | "medium";
  matchId: string | null;
  command: string;
  verifyUrl: string;
  safeToRun: boolean;
  missingEnv: string[];
  expectedEvidence: string;
  reason: string;
};

export type DecisionAIOrchestratorRole = {
  id: string;
  role: string;
  status: DecisionAIOrchestratorRoleStatus;
  objective: string;
  inputEvidence: string[];
  expectedOutput: string;
  stopCondition: string;
};

export type DecisionAIOrchestratorRunItem = {
  requested: boolean;
  scope: DecisionAIOrchestratorScope;
  provider: "openai" | "deterministic";
  status: DecisionAiAgentStatus | "not-requested";
  model: string | null;
  reviewVerdict: string | null;
  appliedAction: DecisionAction | null;
  reason: string | null;
  safeNoPersistence: boolean;
};

export type DecisionAIOrchestrator = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionAIOrchestratorStatus;
  mode: "guarded-openai-supervisor";
  summary: string;
  openAiConfigured: boolean;
  model: string;
  activeTarget: DecisionAIOrchestratorTarget | null;
  targets: DecisionAIOrchestratorTarget[];
  thinkingProtocol: DecisionAIOrchestratorRole[];
  evidenceContract: {
    mustCiteEvidenceIds: boolean;
    noUpgrade: boolean;
    noPersistence: boolean;
    allowedEvidenceSources: string[];
    outputSchemas: string[];
    forbiddenClaims: string[];
  };
  runbook: {
    canRunReview: boolean;
    safeCommands: number;
    firstCommand: string | null;
    firstVerifyUrl: string | null;
    recommendedNextStep: string;
    forbiddenActions: string[];
  };
  latestRun: {
    requested: boolean;
    scope: DecisionAIOrchestratorRunScope;
    items: DecisionAIOrchestratorRunItem[];
  };
};

function actionRank(action: DecisionAction): number {
  if (action === "consider") return 2;
  if (action === "monitor") return 1;
  return 0;
}

function rowScore(row: DecisionRow): number {
  const decision = row.prediction.decision;
  const bestPick = row.prediction.bestPick;
  const actionWeight = decision.action === "consider" ? 220 : decision.action === "monitor" ? 110 : 0;
  const valueWeight = bestPick.hasValue ? Math.max(0, bestPick.expectedValue) * 100 + Math.max(0, bestPick.edge) * 100 : 0;
  return actionWeight + decision.decisionScore + valueWeight + row.match.dataQualityScore * 8 - actionRank(decision.action) * decision.beliefState.uncertaintyScore;
}

function baseUrl(url: string | undefined): string {
  return (url || decisionSiteOrigin()).replace(/\/$/, "");
}

function missingOpenAI(env: Record<string, string | undefined>): string[] {
  return env.OPENAI_API_KEY ? [] : ["OPENAI_API_KEY"];
}

function safeReviewCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return lower.includes("curl.exe") && !lower.includes("persist=1") && !lower.includes("persist=true") && !lower.includes("-x post");
}

function buildMatchTarget({
  row,
  env,
  siteUrl
}: {
  row: DecisionRow;
  env: Record<string, string | undefined>;
  siteUrl: string;
}): DecisionAIOrchestratorTarget {
  const verifyUrl = `${siteUrl}/api/sports/decision/${encodeURIComponent(row.match.id)}?enhance=1&agent=1`;
  const command = `curl.exe -sS "${verifyUrl}"`;
  const missingEnv = missingOpenAI(env);
  return {
    id: `active-match-${row.match.id}`,
    scope: "active-match",
    label: `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`,
    priority: row.prediction.decision.controlPolicy.aiReviewRequired ? "critical" : "high",
    matchId: row.match.id,
    command,
    verifyUrl,
    safeToRun: !missingEnv.length && safeReviewCommand(command),
    missingEnv,
    expectedEvidence:
      "OpenAI agent returns a cited review, evidenceChecks, safetyGates, and the same-or-safer final action without writing a decision run.",
    reason: row.prediction.decision.controlPolicy.nextBestAction
  };
}

function buildSlateTarget({
  date,
  sport,
  env,
  siteUrl,
  council
}: {
  date: string;
  sport: Sport;
  env: Record<string, string | undefined>;
  siteUrl: string;
  council: DecisionAICouncil;
}): DecisionAIOrchestratorTarget {
  const verifyUrl = `${siteUrl}/api/sports/decision/ai-council?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}&ai=1`;
  const command = `curl.exe -sS "${verifyUrl}"`;
  const missingEnv = missingOpenAI(env);
  return {
    id: `slate-${date}-${sport}`,
    scope: "slate",
    label: `${sport} slate council`,
    priority: council.status === "blocked" ? "critical" : "medium",
    matchId: null,
    command,
    verifyUrl,
    safeToRun: !missingEnv.length && safeReviewCommand(command),
    missingEnv,
    expectedEvidence:
      "OpenAI council returns a slate-level review, role notes, unsupportedClaims, dataGaps, and a same-or-safer final action.",
    reason: council.nextOperation.expectedEvidence
  };
}

function buildThinkingProtocol({
  openAiConfigured,
  activeRow,
  readiness,
  brainSlate,
  selfAudit,
  agentLoop,
  dataIntake,
  council
}: {
  openAiConfigured: boolean;
  activeRow: DecisionRow | null;
  readiness: DecisionEngineReadiness | null;
  brainSlate: DecisionBrainSlate;
  selfAudit: DecisionSelfAudit;
  agentLoop: DecisionAgentLoop;
  dataIntake: DecisionDataIntakeQueue;
  council: DecisionAICouncil;
}): DecisionAIOrchestratorRole[] {
  const baseStatus: DecisionAIOrchestratorRoleStatus = activeRow ? (openAiConfigured ? "ready" : "waiting") : "blocked";
  return [
    {
      id: "evidence-loader",
      role: "Evidence loader",
      status: activeRow ? "ready" : "blocked",
      objective: "Assemble the deterministic match packet, brain slate, data intake state, and council evidence docket.",
      inputEvidence: [
        activeRow ? activeRow.match.id : "no-active-match",
        `readiness:${readiness?.dataProviders.status ?? "unknown"}`,
        `data-intake:${dataIntake.status}`,
        `brain-slate:${brainSlate.status}`
      ],
      expectedOutput: "A bounded JSON packet with supplied evidence IDs only.",
      stopCondition: "Stop if no fixture, market, or deterministic decision row exists."
    },
    {
      id: "model-reasoner",
      role: "Model reasoner",
      status: baseStatus,
      objective: "Check whether model probability, calibration, uncertainty, and decision boundary support the selected action.",
      inputEvidence: [
        activeRow ? `decision-score:${activeRow.prediction.decision.decisionScore}` : "decision-score:none",
        activeRow ? `belief:${activeRow.prediction.decision.beliefState.grade}` : "belief:none",
        `self-audit:${selfAudit.status}`
      ],
      expectedOutput: "EvidenceChecks for model probability, uncertainty, and calibration.",
      stopCondition: "Do not invent a model signal that is absent from the deterministic report."
    },
    {
      id: "market-skeptic",
      role: "Market skeptic",
      status: baseStatus,
      objective: "Validate no-vig implied probability, edge, expected value, market movement, and price sensitivity.",
      inputEvidence: [
        activeRow?.prediction.bestPick.hasValue ? `edge:${activeRow.prediction.bestPick.edge}` : "edge:none",
        activeRow ? `odds:${activeRow.prediction.decision.oddsIntelligence.status}` : "odds:none",
        activeRow ? `market:${activeRow.prediction.decision.marketMovement.status}` : "market:none"
      ],
      expectedOutput: "Risk flags when value depends on thin or stale market data.",
      stopCondition: "Downgrade or abstain if market evidence is missing or unsupported."
    },
    {
      id: "red-team",
      role: "Red-team reviewer",
      status: baseStatus,
      objective: "Find unsupported claims, missing lineups, injuries, weather, news, live-state, and contradiction risks.",
      inputEvidence: [
        `questions:${selfAudit.questions.filter((item) => item.status !== "pass").length}`,
        `blockers:${agentLoop.autonomy.missingEnv.length}`,
        `council:${council.status}`
      ],
      expectedOutput: "UnsupportedClaims, dataGaps, and safetyGates.",
      stopCondition: "Block public value language if required evidence is missing."
    },
    {
      id: "final-arbiter",
      role: "Final arbiter",
      status: baseStatus,
      objective: "Apply the same-or-safer guardrail and choose consider, monitor, or avoid.",
      inputEvidence: [
        activeRow ? `local-action:${activeRow.prediction.decision.action}` : "local-action:none",
        `council-action:${council.finalAction}`,
        `publishable:${council.canPublishSlate}`
      ],
      expectedOutput: "A final action that is never stronger than the deterministic local action.",
      stopCondition: "Never upgrade monitor or avoid from AI text alone."
    }
  ];
}

function summarizeStatus(status: DecisionAIOrchestratorStatus, targets: DecisionAIOrchestratorTarget[], openAiConfigured: boolean): string {
  if (status === "reviewed") return "AI orchestrator completed at least one guarded OpenAI review without persistence.";
  if (status === "blocked") return "AI orchestrator is blocked because no reviewable decision target is available.";
  if (!openAiConfigured) return "AI orchestrator is wired but waiting for OPENAI_API_KEY before real model review can run.";
  return `AI orchestrator is ready to run ${targets.length} guarded review target(s) without persistence.`;
}

function buildLatestRun(scope: DecisionAIOrchestratorRunScope, items: DecisionAIOrchestratorRunItem[] = []) {
  return {
    requested: scope !== "none",
    scope,
    items
  };
}

export function buildDecisionAIOrchestrator({
  rows,
  date,
  sport,
  readiness = null,
  brainSlate,
  selfAudit,
  agentLoop,
  dataIntake,
  council,
  env = process.env,
  siteUrl = process.env.NEXT_PUBLIC_SITE_URL
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  readiness?: DecisionEngineReadiness | null;
  brainSlate: DecisionBrainSlate;
  selfAudit: DecisionSelfAudit;
  agentLoop: DecisionAgentLoop;
  dataIntake: DecisionDataIntakeQueue;
  council: DecisionAICouncil;
  env?: Record<string, string | undefined>;
  siteUrl?: string;
}): DecisionAIOrchestrator {
  const openAiConfigured = Boolean(env.OPENAI_API_KEY);
  const model = getDecisionOpenAIModel(env);
  const rankedRows = rows.slice().sort((a, b) => rowScore(b) - rowScore(a));
  const activeRow = council.activeCandidate
    ? rankedRows.find((row) => row.match.id === council.activeCandidate?.matchId) ?? rankedRows[0] ?? null
    : rankedRows[0] ?? null;
  const url = baseUrl(siteUrl);
  const targets = [
    ...(activeRow ? [buildMatchTarget({ row: activeRow, env, siteUrl: url })] : []),
    buildSlateTarget({ date, sport, env, siteUrl: url, council })
  ].filter((target) => target.scope === "slate" || activeRow);
  const activeTarget = targets[0] ?? null;
  const status: DecisionAIOrchestratorStatus = !activeTarget ? "blocked" : openAiConfigured ? "ready-to-review" : "needs-config";
  const safeTargets = targets.filter((target) => target.safeToRun);

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    mode: "guarded-openai-supervisor",
    summary: summarizeStatus(status, targets, openAiConfigured),
    openAiConfigured,
    model,
    activeTarget,
    targets,
    thinkingProtocol: buildThinkingProtocol({
      openAiConfigured,
      activeRow,
      readiness,
      brainSlate,
      selfAudit,
      agentLoop,
      dataIntake,
      council
    }),
    evidenceContract: {
      mustCiteEvidenceIds: true,
      noUpgrade: true,
      noPersistence: true,
      allowedEvidenceSources: [
        "deterministic decision report",
        "AI council evidence docket",
        "brain slate",
        "data intake queue",
        "readiness checks",
        "self-audit findings",
        "tool execution plan",
        "market odds intelligence"
      ],
      outputSchemas: ["OddsPadiAiDecisionAgentReview", "OddsPadiSlateAICouncilReview"],
      forbiddenClaims: [
        "Do not invent injuries, lineups, suspensions, weather, news, odds, scores, or bookmaker moves.",
        "Do not claim a bet is guaranteed or risk-free.",
        "Do not upgrade a monitor or avoid decision into consider from AI text alone.",
        "Do not persist or publish from this orchestrator."
      ]
    },
    runbook: {
      canRunReview: safeTargets.length > 0,
      safeCommands: safeTargets.length,
      firstCommand: safeTargets[0]?.command ?? null,
      firstVerifyUrl: safeTargets[0]?.verifyUrl ?? null,
      recommendedNextStep: openAiConfigured
        ? safeTargets[0]?.expectedEvidence ?? "No safe OpenAI review target is currently available."
        : "Add OPENAI_API_KEY to enable real OpenAI review; keep deterministic guardrails active until reviewed.",
      forbiddenActions: [
        "Do not add persist=1 to orchestrator review commands.",
        "Do not use AI output as a source for injuries, lineups, news, odds, or scores.",
        "Do not let AI increase the action above the deterministic baseline.",
        "Do not show a public value candidate while controlPolicy blocks display."
      ]
    },
    latestRun: buildLatestRun("none")
  };
}

function scopesToRun(scope: DecisionAIOrchestratorRunScope): Set<DecisionAIOrchestratorScope> {
  if (scope === "all") return new Set(["active-match", "slate"]);
  if (scope === "active-match" || scope === "slate") return new Set([scope]);
  return new Set();
}

function notConfiguredItem(scope: DecisionAIOrchestratorScope): DecisionAIOrchestratorRunItem {
  return {
    requested: true,
    scope,
    provider: "deterministic",
    status: "not-configured",
    model: null,
    reviewVerdict: null,
    appliedAction: null,
    reason: "OPENAI_API_KEY is not configured.",
    safeNoPersistence: true
  };
}

export async function runDecisionAIOrchestrator({
  rows,
  date,
  sport,
  readiness = null,
  brainSlate,
  selfAudit,
  agentLoop,
  dataIntake,
  council,
  env = process.env,
  siteUrl = process.env.NEXT_PUBLIC_SITE_URL,
  runScope = "none",
  fetchImpl = fetch
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  readiness?: DecisionEngineReadiness | null;
  brainSlate: DecisionBrainSlate;
  selfAudit: DecisionSelfAudit;
  agentLoop: DecisionAgentLoop;
  dataIntake: DecisionDataIntakeQueue;
  council: DecisionAICouncil;
  env?: Record<string, string | undefined>;
  siteUrl?: string;
  runScope?: DecisionAIOrchestratorRunScope;
  fetchImpl?: typeof fetch;
}): Promise<DecisionAIOrchestrator> {
  const base = buildDecisionAIOrchestrator({
    rows,
    date,
    sport,
    readiness,
    brainSlate,
    selfAudit,
    agentLoop,
    dataIntake,
    council,
    env,
    siteUrl
  });
  const requestedScopes = scopesToRun(runScope);
  if (!requestedScopes.size) return base;

  const items: DecisionAIOrchestratorRunItem[] = [];
  if (!env.OPENAI_API_KEY) {
    for (const scope of requestedScopes) items.push(notConfiguredItem(scope));
    return {
      ...base,
      latestRun: buildLatestRun(runScope, items)
    };
  }

  const activeMatchTarget = base.targets.find((target) => target.scope === "active-match");
  const activeRow = activeMatchTarget ? rows.find((row) => row.match.id === activeMatchTarget.matchId) ?? null : null;

  if (requestedScopes.has("active-match") && activeRow) {
    const result = await runOpenAIDecisionAgentReview({
      match: activeRow.match,
      prediction: activeRow.prediction,
      apiKey: env.OPENAI_API_KEY,
      model: base.model,
      fetchImpl
    });
    items.push({
      requested: true,
      scope: "active-match",
      provider: result.provider,
      status: result.status,
      model: result.model ?? null,
      reviewVerdict: result.review?.reviewVerdict ?? null,
      appliedAction: result.decision.action,
      reason: result.reason ?? null,
      safeNoPersistence: true
    });
  }

  if (requestedScopes.has("slate")) {
    const reviewedCouncil = await runOpenAIDecisionCouncilReview({
      council,
      apiKey: env.OPENAI_API_KEY,
      model: base.model,
      fetchImpl
    });
    items.push({
      requested: true,
      scope: "slate",
      provider: reviewedCouncil.reviewStatus === "not-configured" ? "deterministic" : "openai",
      status: reviewedCouncil.reviewStatus === "reviewed" ? "reviewed" : reviewedCouncil.reviewStatus,
      model: reviewedCouncil.model,
      reviewVerdict: reviewedCouncil.aiReview?.reviewVerdict ?? null,
      appliedAction: reviewedCouncil.finalAction,
      reason: reviewedCouncil.reviewFailureReason,
      safeNoPersistence: true
    });
  }

  const reviewed = items.some((item) => item.status === "reviewed");
  return {
    ...base,
    status: reviewed ? "reviewed" : base.status,
    summary: reviewed ? summarizeStatus("reviewed", base.targets, base.openAiConfigured) : base.summary,
    latestRun: buildLatestRun(runScope, items)
  };
}
