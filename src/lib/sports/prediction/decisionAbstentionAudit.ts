import type { DecisionMarketAuditMatrix, DecisionMarketAuditMatrixRow } from "@/lib/sports/prediction/decisionMarketAuditMatrix";
import type { DecisionOddsIntelligenceProof } from "@/lib/sports/prediction/decisionOddsIntelligenceProof";
import type { DecisionPreMatchTrustCandidate, DecisionPreMatchTrustGate } from "@/lib/sports/prediction/decisionPreMatchTrustGate";
import type { DecisionTrustFirewall } from "@/lib/sports/prediction/decisionTrustFirewall";
import type { Sport } from "@/lib/sports/types";

export type DecisionAbstentionAuditStatus = "ready-shadow" | "monitor-only" | "action-blocked" | "blocked";
export type DecisionAbstentionCandidateDecision = "shadow-only" | "monitor-only" | "avoid" | "blocked";

export type DecisionAbstentionCandidate = {
  id: string;
  rank: number;
  sport: Sport;
  matchId: string;
  match: string;
  league: string;
  market: string;
  selection: string;
  marketVerdict: DecisionMarketAuditMatrixRow["verdict"];
  publicDecision: DecisionAbstentionCandidateDecision;
  trustCeiling: DecisionPreMatchTrustCandidate["trustCeiling"] | "not-scored";
  modelProbability: number;
  noVigProbability: number;
  edge: number;
  expectedValue: number;
  decimalOdds: number;
  whyModelLikesIt: string;
  whyAvoidOrWait: string;
  risks: string[];
  missingEvidence: string[];
  saferAlternatives: string[];
  nextAction: string;
  proofUrl: string;
};

export type DecisionAbstentionAudit = {
  mode: "decision-abstention-audit";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionAbstentionAuditStatus;
  auditHash: string;
  summary: string;
  totals: {
    candidates: number;
    positiveEvBlocked: number;
    watchOnly: number;
    avoidOnly: number;
    blocked: number;
    missingEvidenceItems: number;
    saferAlternatives: number;
  };
  topCandidate: DecisionAbstentionCandidate | null;
  candidates: DecisionAbstentionCandidate[];
  controls: {
    canInspectReadOnly: true;
    canUseForAiPrompt: true;
    canApplyToLiveDecision: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
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
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function unique(values: Array<string | null | undefined>, limit = 24): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function trustFor(row: DecisionMarketAuditMatrixRow, preMatchTrustGate: DecisionPreMatchTrustGate): DecisionPreMatchTrustCandidate | null {
  return preMatchTrustGate.candidates.find((candidate) => candidate.matchId === row.matchId) ?? null;
}

function publicDecisionFor(row: DecisionMarketAuditMatrixRow, trust: DecisionPreMatchTrustCandidate | null): DecisionAbstentionCandidateDecision {
  if (!trust) return "blocked";
  if (trust.publicAction === "monitor-only" && row.verdict === "positive-ev") return "monitor-only";
  if (trust.trustCeiling === "shadow-analysis") return "shadow-only";
  if (trust.publicAction === "avoid-only") return "avoid";
  return "blocked";
}

function risksFor(row: DecisionMarketAuditMatrixRow, trust: DecisionPreMatchTrustCandidate | null, trustFirewall: DecisionTrustFirewall): string[] {
  return unique([
    row.riskNote,
    row.avoidReason,
    trust?.engineInstruction,
    ...trustFirewall.gates.filter((gate) => gate.status !== "pass").map((gate) => `${gate.label}: ${gate.detail}`)
  ], 8);
}

function missingEvidenceFor(trust: DecisionPreMatchTrustCandidate | null, trustFirewall: DecisionTrustFirewall): string[] {
  return unique([
    ...(trust?.requiredNextEvidence ?? []),
    ...(trust?.gates.filter((gate) => gate.status !== "pass").map((gate) => `${gate.label}: ${gate.nextAction}`) ?? []),
    ...trustFirewall.gates.filter((gate) => gate.status !== "pass").map((gate) => `${gate.label}: ${gate.nextAction}`)
  ], 10);
}

function whyAvoidOrWait({
  row,
  trust,
  publicDecision,
  missingEvidence
}: {
  row: DecisionMarketAuditMatrixRow;
  trust: DecisionPreMatchTrustCandidate | null;
  publicDecision: DecisionAbstentionCandidateDecision;
  missingEvidence: string[];
}): string {
  if (!trust) return "No pre-match trust score exists for this market, so the engine must block public action.";
  if (publicDecision === "monitor-only") {
    return compact(`The model sees value, but public action is capped at monitor-only until ${missingEvidence[0] ?? "fresh provider and backtest proof"} clears.`);
  }
  if (publicDecision === "shadow-only") {
    return compact(`The edge can be discussed only as shadow analysis because the trust ceiling is ${trust.trustCeiling}; ${missingEvidence[0] ?? row.riskNote}`);
  }
  if (publicDecision === "avoid") {
    return compact(row.avoidReason ?? `Avoid because ${missingEvidence[0] ?? "the current evidence gates do not support a public recommendation"}.`);
  }
  return compact(`Blocked by ${missingEvidence[0] ?? "unresolved trust-firewall gates"}; no pick, publish, stake, or training update is allowed.`);
}

function candidateFor(
  row: DecisionMarketAuditMatrixRow,
  rank: number,
  preMatchTrustGate: DecisionPreMatchTrustGate,
  trustFirewall: DecisionTrustFirewall
): DecisionAbstentionCandidate {
  const trust = trustFor(row, preMatchTrustGate);
  const publicDecision = publicDecisionFor(row, trust);
  const missingEvidence = missingEvidenceFor(trust, trustFirewall);
  const risks = risksFor(row, trust, trustFirewall);
  return {
    id: `abstention:${row.id}`,
    rank,
    sport: row.sport,
    matchId: row.matchId,
    match: row.match,
    league: row.league,
    market: row.marketName,
    selection: row.selection,
    marketVerdict: row.verdict,
    publicDecision,
    trustCeiling: trust?.trustCeiling ?? "not-scored",
    modelProbability: row.modelProbability,
    noVigProbability: row.noVigProbability,
    edge: row.edge,
    expectedValue: row.expectedValue,
    decimalOdds: row.decimalOdds,
    whyModelLikesIt: row.whyModelFavorsIt,
    whyAvoidOrWait: whyAvoidOrWait({ row, trust, publicDecision, missingEvidence }),
    risks,
    missingEvidence,
    saferAlternatives: row.saferAlternatives,
    nextAction: missingEvidence[0] ?? row.riskNote,
    proofUrl: row.proofUrl
  };
}

function rankRow(row: DecisionMarketAuditMatrixRow): number {
  const verdictScore = row.verdict === "positive-ev" ? 300 : row.verdict === "watch" ? 170 : row.verdict === "avoid" ? 60 : 0;
  return verdictScore + Math.max(0, row.expectedValue) * 100 + Math.max(0, row.edge) * 80 + row.valueRankScore;
}

function statusFor(candidates: DecisionAbstentionCandidate[]): DecisionAbstentionAuditStatus {
  if (!candidates.length) return "blocked";
  if (candidates.some((candidate) => candidate.publicDecision === "monitor-only")) return "monitor-only";
  if (candidates.some((candidate) => candidate.publicDecision === "shadow-only")) return "ready-shadow";
  if (candidates.some((candidate) => candidate.publicDecision === "avoid")) return "action-blocked";
  return "blocked";
}

export function buildDecisionAbstentionAudit({
  date,
  sport,
  marketAuditMatrix,
  oddsIntelligenceProof,
  preMatchTrustGate,
  trustFirewall,
  limit = 8,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  marketAuditMatrix: DecisionMarketAuditMatrix;
  oddsIntelligenceProof: DecisionOddsIntelligenceProof;
  preMatchTrustGate: DecisionPreMatchTrustGate;
  trustFirewall: DecisionTrustFirewall;
  limit?: number;
  now?: Date;
}): DecisionAbstentionAudit {
  const scopedRows = marketAuditMatrix.rows.filter((row) => row.sport === sport);
  const candidateRows = scopedRows.length ? scopedRows : marketAuditMatrix.rows;
  const candidates = candidateRows
    .slice()
    .sort((a, b) => rankRow(b) - rankRow(a))
    .slice(0, Math.max(1, limit))
    .map((row, index) => candidateFor(row, index + 1, preMatchTrustGate, trustFirewall));
  const status = statusFor(candidates);
  const totals = {
    candidates: candidates.length,
    positiveEvBlocked: candidates.filter((candidate) => candidate.marketVerdict === "positive-ev" && candidate.publicDecision !== "monitor-only").length,
    watchOnly: candidates.filter((candidate) => candidate.publicDecision === "monitor-only" || candidate.publicDecision === "shadow-only").length,
    avoidOnly: candidates.filter((candidate) => candidate.publicDecision === "avoid").length,
    blocked: candidates.filter((candidate) => candidate.publicDecision === "blocked").length,
    missingEvidenceItems: candidates.reduce((sum, candidate) => sum + candidate.missingEvidence.length, 0),
    saferAlternatives: candidates.reduce((sum, candidate) => sum + candidate.saferAlternatives.length, 0)
  };
  const auditHash = stableHash({
    date,
    sport,
    status,
    market: marketAuditMatrix.matrixHash,
    odds: oddsIntelligenceProof.proofHash,
    trust: preMatchTrustGate.trustHash,
    firewall: trustFirewall.firewallHash,
    candidates: candidates.map((candidate) => [
      candidate.id,
      candidate.marketVerdict,
      candidate.publicDecision,
      candidate.edge,
      candidate.expectedValue,
      candidate.missingEvidence.slice(0, 3)
    ])
  });

  return {
    mode: "decision-abstention-audit",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    auditHash,
    summary:
      status === "monitor-only"
        ? `Abstention audit found monitored value, but public action remains capped across ${candidates.length} candidate(s).`
        : status === "ready-shadow"
          ? `Abstention audit found ${totals.watchOnly} shadow-only candidate(s); the engine must explain wait conditions before any pick.`
          : status === "action-blocked"
            ? `Abstention audit explains why ${totals.avoidOnly} candidate(s) should be avoided until missing evidence clears.`
            : "Abstention audit is blocked because no auditable market candidates are available.",
    totals,
    topCandidate: candidates[0] ?? null,
    candidates,
    controls: {
      canInspectReadOnly: true,
      canUseForAiPrompt: true,
      canApplyToLiveDecision: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: [
      "/api/sports/decision/abstention-audit",
      "/api/sports/decision/market-audit-matrix",
      "/api/sports/decision/odds-intelligence-proof",
      "/api/sports/decision/pre-match-trust-gate",
      "/api/sports/decision/trust-firewall"
    ],
    locks: [
      "Abstention audit is read-only: it can explain avoid, monitor, or shadow-only decisions but cannot change the live prediction.",
      "Positive EV cannot become a recommendation while provider freshness, injuries/news, lineups, storage, backtests, and trust gates remain unresolved.",
      "Publishing, staking, persistence, provider writes, and training remain locked."
    ]
  };
}
