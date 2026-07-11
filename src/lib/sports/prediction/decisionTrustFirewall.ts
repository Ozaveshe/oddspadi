import type { DecisionEvidenceFreshnessGate } from "@/lib/sports/prediction/decisionEvidenceFreshnessGate";
import type { DecisionMarketAuditMatrix, DecisionMarketAuditMatrixRow } from "@/lib/sports/prediction/decisionMarketAuditMatrix";
import type { DecisionModelTrust } from "@/lib/sports/prediction/decisionModelTrust";
import type { DecisionOddsIntelligenceProof } from "@/lib/sports/prediction/decisionOddsIntelligenceProof";
import type { DecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";
import type { DecisionPortfolioRisk } from "@/lib/sports/prediction/decisionPortfolioRisk";
import type { DecisionSettlementImpact } from "@/lib/sports/prediction/decisionSettlementImpact";
import type { DecisionAction, Sport } from "@/lib/sports/types";

export type DecisionTrustFirewallStatus = "actionable-shadow" | "watchlist-only" | "blocked";
export type DecisionTrustFirewallGateStatus = "pass" | "watch" | "block";
export type DecisionTrustFirewallGateId =
  | "evidence-freshness"
  | "market-edge"
  | "model-trust"
  | "portfolio-risk"
  | "ai-review"
  | "settlement-learning"
  | "operator-lock";

export type DecisionTrustFirewallGate = {
  id: DecisionTrustFirewallGateId;
  label: string;
  status: DecisionTrustFirewallGateStatus;
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
  nextAction: string;
  evidence: string[];
};

export type DecisionTrustFirewall = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-trust-firewall";
  status: DecisionTrustFirewallStatus;
  firewallHash: string;
  summary: string;
  selectedCandidate: {
    matchId: string | null;
    match: string | null;
    market: string | null;
    selection: string | null;
    action: string | null;
    verdict: string | null;
    edge: number | null;
    expectedValue: number | null;
    confidence: string | null;
    risk: string | null;
    proofUrl: string | null;
  };
  actionContract: {
    maximumPublicAction: DecisionAction;
    internalPosture: "shadow-candidate" | "watchlist" | "blocked";
    reason: string;
    trustScore: number;
    trustGrade: "high" | "medium" | "low";
  };
  gates: DecisionTrustFirewallGate[];
  totals: {
    gates: number;
    pass: number;
    watch: number;
    block: number;
    criticalBlocks: number;
    positiveEvSelections: number;
    freshnessBlocked: number;
    modelBlocks: number;
    aiReady: boolean;
  };
  controls: {
    canDisplayInternalCandidate: boolean;
    canDisplayWatchlist: boolean;
    canRequestAIReview: boolean;
    canRaiseConfidence: false;
    canPersistDecision: false;
    canPublishPick: false;
    canTrainModels: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
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

function round(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function unique(values: Array<string | null | undefined>, limit = 28): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, max = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3).trim()}...` : normalized;
}

function gate(input: DecisionTrustFirewallGate): DecisionTrustFirewallGate {
  return {
    ...input,
    detail: compact(input.detail),
    nextAction: compact(input.nextAction),
    evidence: unique(input.evidence, 8)
  };
}

function selectedCandidate(marketAuditMatrix: DecisionMarketAuditMatrix, sport: Sport): DecisionMarketAuditMatrixRow | null {
  return (
    marketAuditMatrix.rows
      .filter((row) => row.sport === sport)
      .slice()
      .sort((a, b) => {
        const verdictRank = { "positive-ev": 3, watch: 2, avoid: 1, unpriced: 0 } as const;
        const verdictDiff = verdictRank[b.verdict] - verdictRank[a.verdict];
        if (verdictDiff !== 0) return verdictDiff;
        if (b.expectedValue !== a.expectedValue) return b.expectedValue - a.expectedValue;
        if (b.edge !== a.edge) return b.edge - a.edge;
        return b.valueRankScore - a.valueRankScore;
      })[0] ?? null
  );
}

function evidenceGate(evidenceFreshnessGate: DecisionEvidenceFreshnessGate): DecisionTrustFirewallGate {
  return gate({
    id: "evidence-freshness",
    label: "Evidence freshness",
    status: evidenceFreshnessGate.status === "fresh-enough" ? "pass" : evidenceFreshnessGate.status === "needs-refresh" ? "watch" : "block",
    severity: "critical",
    detail: evidenceFreshnessGate.summary,
    nextAction: evidenceFreshnessGate.selectedCheck?.nextAction ?? "Keep live evidence checks attached before evaluating any candidate.",
    evidence: [
      evidenceFreshnessGate.freshnessHash,
      `required:${evidenceFreshnessGate.totals.required}`,
      `blocked:${evidenceFreshnessGate.totals.blocked}`,
      `missing:${evidenceFreshnessGate.totals.missing}`,
      `stale:${evidenceFreshnessGate.totals.stale}`
    ]
  });
}

function marketGate(marketAuditMatrix: DecisionMarketAuditMatrix, oddsIntelligenceProof: DecisionOddsIntelligenceProof, candidate: DecisionMarketAuditMatrixRow | null): DecisionTrustFirewallGate {
  const hasPositiveEv = marketAuditMatrix.totals.positiveEv > 0 && (marketAuditMatrix.totals.bestExpectedValue ?? 0) > 0;
  const hasWatch = marketAuditMatrix.totals.watch > 0 || (marketAuditMatrix.totals.bestEdge ?? 0) > 0;
  return gate({
    id: "market-edge",
    label: "Market edge",
    status: hasPositiveEv ? "pass" : hasWatch ? "watch" : "block",
    severity: "critical",
    detail: candidate
      ? `${candidate.selection} in ${candidate.marketName} is ${candidate.verdict} with EV ${round(candidate.expectedValue)} and edge ${round(candidate.edge)}.`
      : marketAuditMatrix.summary,
    nextAction: hasPositiveEv
      ? "Keep the candidate in shadow while non-market trust gates are checked."
      : hasWatch
        ? "Do not upgrade from watch until EV, edge, and bookmaker margin all clear."
        : "Avoid the slate until at least one priced selection has positive expected value.",
    evidence: [
      marketAuditMatrix.matrixHash,
      oddsIntelligenceProof.proofHash,
      `positiveEv:${marketAuditMatrix.totals.positiveEv}`,
      `bestEV:${marketAuditMatrix.totals.bestExpectedValue ?? "none"}`,
      `bestEdge:${marketAuditMatrix.totals.bestEdge ?? "none"}`
    ]
  });
}

function modelGate(modelTrust: DecisionModelTrust): DecisionTrustFirewallGate {
  return gate({
    id: "model-trust",
    label: "Model trust",
    status: modelTrust.status === "trusted-shadow" ? "pass" : modelTrust.status === "needs-evidence" ? "watch" : "block",
    severity: "critical",
    detail: modelTrust.summary,
    nextAction: modelTrust.nextActions[0] ?? "Keep model trust capped until calibration, corpus, and runtime gates improve.",
    evidence: [
      modelTrust.trustHash,
      `score:${modelTrust.trustScore}`,
      `blocks:${modelTrust.counts.block}`,
      `confidence:${modelTrust.confidenceBudget.maxPublicConfidence}`,
      `calibration:${modelTrust.confidenceBudget.calibrationSampleSize}`
    ]
  });
}

function portfolioGate(portfolioRisk: DecisionPortfolioRisk): DecisionTrustFirewallGate {
  const stressFailures = portfolioRisk.stressTests.filter((scenario) => scenario.status === "fails");
  const stressReviews = portfolioRisk.stressTests.filter((scenario) => scenario.status === "review");
  const status: DecisionTrustFirewallGateStatus =
    stressFailures.length > 0 ? "block" : portfolioRisk.status === "paper-ready" && stressReviews.length === 0 ? "pass" : "watch";
  const largestDrawdown = Math.max(0, ...portfolioRisk.stressTests.map((scenario) => scenario.drawdownUnits));
  const firstFailure = stressFailures[0] ?? stressReviews[0] ?? portfolioRisk.stressTests[0] ?? null;

  return gate({
    id: "portfolio-risk",
    label: "Portfolio stress",
    status,
    severity: "critical",
    detail: `${portfolioRisk.status.replaceAll("-", " ")} with ${stressFailures.length} failed stress test(s), ${stressReviews.length} review stress test(s), ${portfolioRisk.budget.suggestedPaperUnits.toFixed(2)} paper unit(s), and max stressed drawdown ${largestDrawdown.toFixed(2)}u.`,
    nextAction:
      firstFailure?.status === "fails"
        ? `Downgrade the candidate until ${firstFailure.label.toLowerCase()} no longer fails.`
        : firstFailure?.status === "review"
          ? `Keep candidate watch-only while reviewing ${firstFailure.label.toLowerCase()}.`
          : "Keep stake, publish, persist, train, and public-action upgrades locked while monitoring portfolio stress.",
    evidence: [
      portfolioRisk.portfolioHash,
      `status:${portfolioRisk.status}`,
      `paperUnits:${portfolioRisk.budget.suggestedPaperUnits}`,
      `stressFailures:${stressFailures.length}`,
      `stressReviews:${stressReviews.length}`,
      `maxDrawdown:${largestDrawdown}`
    ]
  });
}

function aiGate(openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic): DecisionTrustFirewallGate {
  const status =
    openAiKeyDiagnostic.status === "ready-to-request" ? "pass" : openAiKeyDiagnostic.status === "missing-key" || openAiKeyDiagnostic.status === "contract-waiting" ? "watch" : "block";
  return gate({
    id: "ai-review",
    label: "AI review",
    status,
    severity: "high",
    detail: openAiKeyDiagnostic.summary,
    nextAction: openAiKeyDiagnostic.nextStep.expectedEvidence,
    evidence: [
      openAiKeyDiagnostic.diagnosticHash,
      `status:${openAiKeyDiagnostic.status}`,
      `key:${openAiKeyDiagnostic.runtime.keyShape}`,
      `lanesReady:${openAiKeyDiagnostic.runtime.lanesReady}/${openAiKeyDiagnostic.runtime.lanes}`
    ]
  });
}

function settlementGate(settlementImpact: DecisionSettlementImpact): DecisionTrustFirewallGate {
  const status =
    settlementImpact.status === "ready-scenarios" && settlementImpact.totals.worstCaseQuarantines === 0
      ? "pass"
      : settlementImpact.status === "blocked"
        ? "block"
        : "watch";
  return gate({
    id: "settlement-learning",
    label: "Settlement learning",
    status,
    severity: "medium",
    detail: settlementImpact.summary,
    nextAction:
      settlementImpact.rows[0]?.recommendedNext ??
      "Keep learning as shadow-only until outcome settlement and calibration proof can grade the candidate.",
    evidence: [
      settlementImpact.impactHash,
      `candidates:${settlementImpact.totals.candidates}`,
      `gradeable:${settlementImpact.totals.gradeableNow}`,
      `quarantines:${settlementImpact.totals.worstCaseQuarantines}`
    ]
  });
}

function operatorGate(): DecisionTrustFirewallGate {
  return gate({
    id: "operator-lock",
    label: "Operator lock",
    status: "watch",
    severity: "low",
    detail: "The firewall is a read-only actionability contract. It cannot persist decisions, publish picks, train models, stake, or use hidden chain-of-thought.",
    nextAction: "Use the proof URLs to inspect the candidate; unlock writes only through explicit provider, Supabase, outcome, and deployment gates.",
    evidence: ["persist:false", "publish:false", "train:false", "stake:false", "hidden-cot:false"]
  });
}

function scoreFor(gates: DecisionTrustFirewallGate[]): number {
  const weights = { critical: 24, high: 16, medium: 10, low: 6 };
  const statusScore = { pass: 1, watch: 0.52, block: 0 };
  const max = gates.reduce((sum, item) => sum + weights[item.severity], 0);
  const scored = gates.reduce((sum, item) => sum + weights[item.severity] * statusScore[item.status], 0);
  return Math.round((scored / Math.max(1, max)) * 100);
}

function statusFor(gates: DecisionTrustFirewallGate[], candidate: DecisionMarketAuditMatrixRow | null): DecisionTrustFirewallStatus {
  const criticalBlock = gates.some((item) => item.severity === "critical" && item.status === "block");
  if (criticalBlock || !candidate || candidate.verdict === "avoid" || candidate.verdict === "unpriced") return "blocked";
  if (gates.some((item) => item.status !== "pass") || candidate.verdict === "watch") return "watchlist-only";
  return "actionable-shadow";
}

function summaryFor(status: DecisionTrustFirewallStatus, gates: DecisionTrustFirewallGate[], candidate: DecisionMarketAuditMatrixRow | null): string {
  const blockers = gates.filter((item) => item.status === "block").length;
  const watches = gates.filter((item) => item.status === "watch").length;
  if (status === "actionable-shadow") {
    return `${candidate?.selection ?? "Top candidate"} clears the read-only trust firewall as a shadow candidate; publishing and staking remain locked.`;
  }
  if (status === "watchlist-only") {
    return `${candidate?.selection ?? "Top candidate"} is watchlist-only because ${watches} gate(s) still need evidence before confidence can rise.`;
  }
  return `Decision trust is blocked by ${blockers} gate(s); the engine must avoid public action until evidence, model, and market gates clear.`;
}

export function buildDecisionTrustFirewall({
  date,
  sport,
  evidenceFreshnessGate,
  marketAuditMatrix,
  oddsIntelligenceProof,
  modelTrust,
  portfolioRisk,
  openAiKeyDiagnostic,
  settlementImpact,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  evidenceFreshnessGate: DecisionEvidenceFreshnessGate;
  marketAuditMatrix: DecisionMarketAuditMatrix;
  oddsIntelligenceProof: DecisionOddsIntelligenceProof;
  modelTrust: DecisionModelTrust;
  portfolioRisk: DecisionPortfolioRisk;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
  settlementImpact: DecisionSettlementImpact;
  now?: Date;
}): DecisionTrustFirewall {
  const candidate = selectedCandidate(marketAuditMatrix, sport);
  const gates = [
    evidenceGate(evidenceFreshnessGate),
    marketGate(marketAuditMatrix, oddsIntelligenceProof, candidate),
    modelGate(modelTrust),
    portfolioGate(portfolioRisk),
    aiGate(openAiKeyDiagnostic),
    settlementGate(settlementImpact),
    operatorGate()
  ];
  const status = statusFor(gates, candidate);
  const trustScore = scoreFor(gates);
  const pass = gates.filter((item) => item.status === "pass").length;
  const watch = gates.filter((item) => item.status === "watch").length;
  const block = gates.filter((item) => item.status === "block").length;
  const maximumPublicAction: DecisionAction = status === "actionable-shadow" ? "consider" : status === "watchlist-only" ? "monitor" : "avoid";
  const internalPosture = status === "actionable-shadow" ? "shadow-candidate" : status === "watchlist-only" ? "watchlist" : "blocked";

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-trust-firewall",
    status,
    firewallHash: stableHash({
      date,
      sport,
      candidate: candidate ? [candidate.id, candidate.verdict, candidate.expectedValue, candidate.edge] : null,
      gates: gates.map((item) => [item.id, item.status, item.evidence])
    }),
    summary: summaryFor(status, gates, candidate),
    selectedCandidate: {
      matchId: candidate?.matchId ?? null,
      match: candidate?.match ?? null,
      market: candidate?.marketName ?? null,
      selection: candidate?.selection ?? null,
      action: candidate?.action ?? null,
      verdict: candidate?.verdict ?? null,
      edge: candidate?.edge ?? null,
      expectedValue: candidate?.expectedValue ?? null,
      confidence: candidate?.confidence ?? null,
      risk: candidate?.risk ?? null,
      proofUrl: candidate?.proofUrl ?? null
    },
    actionContract: {
      maximumPublicAction,
      internalPosture,
      reason: summaryFor(status, gates, candidate),
      trustScore,
      trustGrade: trustScore >= 76 ? "high" : trustScore >= 52 ? "medium" : "low"
    },
    gates,
    totals: {
      gates: gates.length,
      pass,
      watch,
      block,
      criticalBlocks: gates.filter((item) => item.severity === "critical" && item.status === "block").length,
      positiveEvSelections: marketAuditMatrix.totals.positiveEv,
      freshnessBlocked: evidenceFreshnessGate.totals.blocked + evidenceFreshnessGate.totals.missing,
      modelBlocks: modelTrust.counts.block,
      aiReady: openAiKeyDiagnostic.status === "ready-to-request"
    },
    controls: {
      canDisplayInternalCandidate: status !== "blocked",
      canDisplayWatchlist: status !== "blocked",
      canRequestAIReview: openAiKeyDiagnostic.status === "ready-to-request",
      canRaiseConfidence: false,
      canPersistDecision: false,
      canPublishPick: false,
      canTrainModels: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/trust-firewall",
      "/api/sports/decision/evidence-freshness-gate",
      "/api/sports/decision/market-audit-matrix",
      "/api/sports/decision/odds-intelligence-proof",
      "/api/sports/decision/model-trust",
      "/api/sports/decision/portfolio-risk",
      "/api/sports/decision/openai-key-diagnostic",
      "/api/sports/decision/settlement-impact",
      candidate?.proofUrl,
      ...evidenceFreshnessGate.proofUrls,
      ...marketAuditMatrix.proofUrls,
      ...oddsIntelligenceProof.proofUrls,
      ...settlementImpact.proofUrls
    ]),
    locks: [
      "Trust firewall is read-only and cannot persist decisions, publish picks, train models, stake, or call OpenAI.",
      "A market edge can only become a shadow candidate after required live evidence and model trust gates clear.",
      "Portfolio stress failures downgrade the candidate even when edge and EV are positive.",
      "AI review may add critique only through explicit guarded run routes; it cannot upgrade the maximum public action.",
      "Outcome settlement and learning remain shadow-only until admin-gated labels, calibration, and training proof exist."
    ]
  };
}
