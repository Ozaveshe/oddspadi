import type { DecisionAction, DecisionControlVisibility, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: {
    id: string;
    sport: Sport;
    homeTeam: { name: string };
    awayTeam: { name: string };
    league: { name: string };
  };
  prediction: {
    bestPick: {
      hasValue: boolean;
      label: string;
      modelProbability?: number;
      noVigImpliedProbability?: number;
      edge?: number;
      expectedValue?: number;
    };
    decision: {
      action: DecisionAction;
      summary: string;
      recommendedSelection: string | null;
      risks: string[];
      avoidReasons: string[];
      saferAlternatives: Array<{ market: string; selection: string; rationale: string }>;
      nextChecks: string[];
      missingSignals: string[];
      evidence: Array<{ category: string; label: string; quality: string; detail: string }>;
      oddsIntelligence: { summary: string; avoidReasons: string[]; actionableSelections: number };
      dataCoverage: { summary: string; requiredBeforeTrust: string[] };
      actionability: { requiredBeforeAction: string[]; blockers: string[] };
      controlPolicy: {
        publishAllowed: boolean;
        persistAllowed: boolean;
        safeToDisplay: boolean;
        visibility: DecisionControlVisibility;
        summary: string;
      };
      publicReasoningSteps: string[];
    };
  };
};

export type DecisionExplanationAuditStatus = "complete" | "watch" | "blocked";
export type DecisionExplanationAuditCheckStatus = "pass" | "watch" | "block";

export type DecisionExplanationAuditCheck = {
  id: string;
  label: string;
  status: DecisionExplanationAuditCheckStatus;
  detail: string;
  evidence: string[];
};

export type DecisionExplanationAuditRow = {
  matchId: string;
  match: string;
  league: string;
  action: DecisionAction;
  selection: string | null;
  status: DecisionExplanationAuditStatus;
  score: number;
  missingComponents: string[];
  summary: string;
  checks: DecisionExplanationAuditCheck[];
};

export type DecisionExplanationAudit = {
  mode: "decision-explanation-audit";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionExplanationAuditStatus;
  auditHash: string;
  summary: string;
  totals: {
    matches: number;
    complete: number;
    watch: number;
    blocked: number;
    averageScore: number;
  };
  rows: DecisionExplanationAuditRow[];
  controls: {
    canInspectReadOnly: true;
    canUseAsPublicCopy: boolean;
    canCallOpenAI: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canUpgradePublicAction: false;
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

function compact(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function check(input: DecisionExplanationAuditCheck): DecisionExplanationAuditCheck {
  return { ...input, evidence: unique(input.evidence, 5) };
}

function hasEvidence(row: DecisionRow, categories: string[]): boolean {
  return row.prediction.decision.evidence.some((item) => categories.includes(item.category));
}

function buildChecks(row: DecisionRow): DecisionExplanationAuditCheck[] {
  const decision = row.prediction.decision;
  const bestPick = row.prediction.bestPick;
  const hasMarketMath = bestPick.hasValue
    ? typeof bestPick.edge === "number" && typeof bestPick.expectedValue === "number"
    : decision.oddsIntelligence.avoidReasons.length > 0 || decision.avoidReasons.length > 0;
  const hasContextCaveat =
    hasEvidence(row, ["team-news", "lineups", "weather", "live-state"]) ||
    decision.missingSignals.some((signal) => /injur|lineup|weather|news|suspension|live/i.test(signal)) ||
    decision.dataCoverage.requiredBeforeTrust.some((signal) => /injur|lineup|weather|news|suspension|live/i.test(signal));
  const explainsAvoid = decision.action !== "avoid" || (decision.recommendedSelection === null && decision.avoidReasons.length > 0);
  const noOverreach = !decision.controlPolicy.publishAllowed && !decision.controlPolicy.persistAllowed;

  return [
    check({
      id: "model-thesis",
      label: "Model thesis",
      status: decision.summary && decision.publicReasoningSteps.length >= 6 && hasEvidence(row, ["model"]) ? "pass" : "block",
      detail: decision.summary || "No model-backed decision summary is present.",
      evidence: [decision.summary, `reasoningSteps:${decision.publicReasoningSteps.length}`]
    }),
    check({
      id: "market-edge",
      label: "Market edge",
      status: hasMarketMath ? "pass" : "block",
      detail: bestPick.hasValue
        ? `${bestPick.label} includes model probability, no-vig probability, edge, and expected value.`
        : decision.oddsIntelligence.summary,
      evidence: [decision.oddsIntelligence.summary, ...decision.oddsIntelligence.avoidReasons]
    }),
    check({
      id: "risk-disclosure",
      label: "Risk disclosure",
      status: decision.risks.length >= 2 ? "pass" : decision.risks.length ? "watch" : "block",
      detail: decision.risks[0] ?? "No risk disclosure is present.",
      evidence: decision.risks
    }),
    check({
      id: "news-context",
      label: "News and context caveat",
      status: hasContextCaveat ? "pass" : "watch",
      detail: hasContextCaveat
        ? "Explanation names team-news, lineup, weather, live-state, or missing context signals."
        : "Explanation should name which news, lineup, weather, or live-state signals could change the match.",
      evidence: [
        ...decision.evidence.filter((item) => ["team-news", "lineups", "weather", "live-state"].includes(item.category)).map((item) => `${item.label}: ${item.detail}`),
        ...decision.missingSignals,
        ...decision.dataCoverage.requiredBeforeTrust
      ]
    }),
    check({
      id: "avoid-logic",
      label: "Avoid logic",
      status: explainsAvoid ? "pass" : "block",
      detail: decision.action === "avoid" ? decision.avoidReasons[0] ?? "Avoid action has no reason." : "Selection is not avoid; no avoid explanation required.",
      evidence: decision.avoidReasons
    }),
    check({
      id: "safer-alternatives",
      label: "Safer alternatives",
      status: decision.saferAlternatives.length >= 2 ? "pass" : decision.saferAlternatives.length ? "watch" : "block",
      detail: decision.saferAlternatives[0]
        ? `${decision.saferAlternatives[0].market}: ${decision.saferAlternatives[0].selection} - ${decision.saferAlternatives[0].rationale}`
        : "No safer alternative is present.",
      evidence: decision.saferAlternatives.map((item) => `${item.market}:${item.selection}:${item.rationale}`)
    }),
    check({
      id: "next-checks",
      label: "Next checks",
      status: decision.nextChecks.length >= 4 ? "pass" : decision.nextChecks.length ? "watch" : "block",
      detail: decision.nextChecks[0] ?? "No next checks are present.",
      evidence: decision.nextChecks
    }),
    check({
      id: "no-action-overreach",
      label: "No action overreach",
      status: noOverreach ? "pass" : "block",
      detail: decision.controlPolicy.summary,
      evidence: [
        `publish:${decision.controlPolicy.publishAllowed}`,
        `persist:${decision.controlPolicy.persistAllowed}`,
        `safeToDisplay:${decision.controlPolicy.safeToDisplay}`,
        `visibility:${decision.controlPolicy.visibility}`
      ]
    })
  ];
}

function rowStatus(checks: DecisionExplanationAuditCheck[]): DecisionExplanationAuditStatus {
  if (checks.some((item) => item.status === "block")) return "blocked";
  if (checks.some((item) => item.status === "watch")) return "watch";
  return "complete";
}

function rowScore(checks: DecisionExplanationAuditCheck[]): number {
  const raw = checks.reduce((sum, item) => sum + (item.status === "pass" ? 1 : item.status === "watch" ? 0.5 : 0), 0);
  return Math.round((raw / checks.length) * 100);
}

function auditRow(row: DecisionRow): DecisionExplanationAuditRow {
  const checks = buildChecks(row);
  const status = rowStatus(checks);
  const score = rowScore(checks);
  const missingComponents = checks.filter((item) => item.status !== "pass").map((item) => item.label);
  return {
    matchId: row.match.id,
    match: `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`,
    league: row.match.league.name,
    action: row.prediction.decision.action,
    selection: row.prediction.decision.recommendedSelection,
    status,
    score,
    missingComponents,
    summary:
      status === "complete"
        ? "Explanation covers model thesis, market math, risks, context caveats, safer alternatives, next checks, and no-action locks."
        : `Explanation needs attention on ${missingComponents.join(", ")}.`,
    checks
  };
}

export function buildDecisionExplanationAudit({
  rows,
  date,
  sport,
  limit = 20,
  now = new Date()
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  limit?: number;
  now?: Date;
}): DecisionExplanationAudit {
  const auditedRows = rows.slice(0, limit).map(auditRow);
  const totals = {
    matches: auditedRows.length,
    complete: auditedRows.filter((row) => row.status === "complete").length,
    watch: auditedRows.filter((row) => row.status === "watch").length,
    blocked: auditedRows.filter((row) => row.status === "blocked").length,
    averageScore: auditedRows.length ? Math.round(auditedRows.reduce((sum, row) => sum + row.score, 0) / auditedRows.length) : 0
  };
  const status: DecisionExplanationAuditStatus = totals.blocked ? "blocked" : totals.watch ? "watch" : "complete";

  return {
    mode: "decision-explanation-audit",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    auditHash: stableHash({
      date,
      sport,
      rows: auditedRows.map((row) => [row.matchId, row.status, row.score, row.missingComponents])
    }),
    summary:
      status === "complete"
        ? `All ${totals.matches} audited explanation(s) cover the required decision narrative.`
        : status === "watch"
          ? `${totals.watch} explanation(s) need copy or context attention before public use.`
          : `${totals.blocked} explanation(s) are missing required model, market, risk, avoid, safer-alternative, or control evidence.`,
    totals,
    rows: auditedRows,
    controls: {
      canInspectReadOnly: true,
      canUseAsPublicCopy: false,
      canCallOpenAI: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canUpgradePublicAction: false
    },
    proofUrls: ["/api/sports/decision/explanation-audit", "/api/sports/decision", "/api/sports/decision/odds-intelligence-proof"],
    locks: [
      "Explanation audit is read-only and never calls OpenAI.",
      status === "complete"
        ? "Complete explanations are internal copy candidates only; public use remains locked until publish gates clear."
        : "Incomplete explanations stay internal and cannot be used as public copy.",
      "The audit cannot persist, publish, train, stake, or upgrade public action."
    ]
  };
}
