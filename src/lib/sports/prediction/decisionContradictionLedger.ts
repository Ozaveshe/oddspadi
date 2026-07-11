import type { DecisionEvidenceFreshnessGate } from "@/lib/sports/prediction/decisionEvidenceFreshnessGate";
import type { DecisionMarketAuditMatrix } from "@/lib/sports/prediction/decisionMarketAuditMatrix";
import type { DecisionModelTrust } from "@/lib/sports/prediction/decisionModelTrust";
import type { DecisionOddsIntelligenceProof } from "@/lib/sports/prediction/decisionOddsIntelligenceProof";
import type { DecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";
import type { DecisionTrustFirewall } from "@/lib/sports/prediction/decisionTrustFirewall";
import type { Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionContradictionLedgerStatus = "coherent" | "needs-review" | "contradicted";
export type DecisionContradictionStatus = "resolved" | "watch" | "contradiction";
export type DecisionContradictionSeverity = "critical" | "high" | "medium" | "low";

export type DecisionContradictionItem = {
  id: string;
  label: string;
  status: DecisionContradictionStatus;
  severity: DecisionContradictionSeverity;
  claim: string;
  tension: string;
  resolution: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionContradictionLedger = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-contradiction-ledger";
  status: DecisionContradictionLedgerStatus;
  ledgerHash: string;
  summary: string;
  activeContradiction: DecisionContradictionItem | null;
  items: DecisionContradictionItem[];
  totals: {
    items: number;
    resolved: number;
    watch: number;
    contradictions: number;
    critical: number;
    candidatePositiveEv: boolean;
    maximumPublicAction: DecisionTrustFirewall["actionContract"]["maximumPublicAction"];
  };
  controls: {
    canResolveAutomatically: false;
    canRaiseConfidence: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
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

function unique(values: Array<string | null | undefined>, limit = 30): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, max = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3).trim()}...` : normalized;
}

function item(input: DecisionContradictionItem): DecisionContradictionItem {
  return {
    ...input,
    claim: compact(input.claim),
    tension: compact(input.tension),
    resolution: compact(input.resolution),
    nextAction: compact(input.nextAction),
    evidence: unique(input.evidence, 8)
  };
}

function activeRow(rows: DecisionRow[], trustFirewall: DecisionTrustFirewall): DecisionRow | null {
  const matchId = trustFirewall.selectedCandidate.matchId;
  if (matchId) return rows.find((row) => row.match.id === matchId) ?? rows[0] ?? null;
  return rows[0] ?? null;
}

function statusFromItems(items: DecisionContradictionItem[]): DecisionContradictionLedgerStatus {
  if (items.some((entry) => entry.status === "contradiction" && (entry.severity === "critical" || entry.severity === "high"))) return "contradicted";
  if (items.some((entry) => entry.status !== "resolved")) return "needs-review";
  return "coherent";
}

function rank(entry: DecisionContradictionItem): number {
  const statusRank = { contradiction: 3, watch: 2, resolved: 1 }[entry.status];
  const severityRank = { critical: 4, high: 3, medium: 2, low: 1 }[entry.severity];
  return statusRank * 10 + severityRank;
}

function summaryFor(status: DecisionContradictionLedgerStatus, totals: DecisionContradictionLedger["totals"]): string {
  if (status === "coherent") return `Contradiction ledger is coherent across ${totals.items} claim checks.`;
  if (status === "needs-review") return `Contradiction ledger has ${totals.watch} watch item(s); keep the slate supervised.`;
  return `Contradiction ledger found ${totals.contradictions} contradiction(s); maximum public action remains ${totals.maximumPublicAction}.`;
}

function buildItems({
  rows,
  evidenceFreshnessGate,
  marketAuditMatrix,
  oddsIntelligenceProof,
  modelTrust,
  openAiKeyDiagnostic,
  trustFirewall
}: {
  rows: DecisionRow[];
  evidenceFreshnessGate: DecisionEvidenceFreshnessGate;
  marketAuditMatrix: DecisionMarketAuditMatrix;
  oddsIntelligenceProof: DecisionOddsIntelligenceProof;
  modelTrust: DecisionModelTrust;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
  trustFirewall: DecisionTrustFirewall;
}): DecisionContradictionItem[] {
  const row = activeRow(rows, trustFirewall);
  const candidatePositiveEv = (trustFirewall.selectedCandidate.expectedValue ?? 0) > 0 && trustFirewall.selectedCandidate.verdict === "positive-ev";
  const maxAction = trustFirewall.actionContract.maximumPublicAction;
  const candidateClaim = trustFirewall.selectedCandidate.selection
    ? `${trustFirewall.selectedCandidate.selection} has ${trustFirewall.selectedCandidate.verdict ?? "unknown"} market status with EV ${trustFirewall.selectedCandidate.expectedValue ?? "none"}.`
    : "No priced candidate is selected.";

  return [
    item({
      id: "edge-vs-action",
      label: "Market edge versus action",
      status: candidatePositiveEv && maxAction === "avoid" ? "contradiction" : candidatePositiveEv && maxAction === "monitor" ? "watch" : "resolved",
      severity: "critical",
      claim: candidateClaim,
      tension:
        candidatePositiveEv && maxAction !== "consider"
          ? `The market layer sees positive EV but the trust firewall caps public action at ${maxAction}.`
          : "The market candidate and maximum public action are aligned.",
      resolution:
        candidatePositiveEv && maxAction !== "consider"
          ? "Treat the candidate as evidence for investigation only; do not publish, stake, or raise confidence until the blocking gates clear."
          : "Keep the candidate inside the current action contract.",
      evidence: [
        trustFirewall.firewallHash,
        marketAuditMatrix.matrixHash,
        oddsIntelligenceProof.proofHash,
        `maxAction:${maxAction}`,
        `positiveEv:${marketAuditMatrix.totals.positiveEv}`
      ],
      nextAction: trustFirewall.gates.find((gate) => gate.status === "block")?.nextAction ?? "Keep market and trust evidence synchronized."
    }),
    item({
      id: "freshness-vs-model",
      label: "Freshness versus model",
      status: evidenceFreshnessGate.status === "blocked" && modelTrust.status !== "trusted-shadow" ? "contradiction" : evidenceFreshnessGate.status !== "fresh-enough" ? "watch" : "resolved",
      severity: "critical",
      claim: row ? row.prediction.decision.summary : "No deterministic model row is available.",
      tension:
        evidenceFreshnessGate.status === "blocked"
          ? "Required live evidence is missing or mock-backed while the model still produces deterministic probabilities."
          : evidenceFreshnessGate.status === "needs-refresh"
            ? "The model can calculate, but one or more live signals need refresh before trust rises."
            : "Model calculations are not contradicted by freshness gates.",
      resolution:
        "Allow deterministic math to explain the slate, but use freshness gates to cap actionability and confidence.",
      evidence: [
        evidenceFreshnessGate.freshnessHash,
        modelTrust.trustHash,
        `freshness:${evidenceFreshnessGate.status}`,
        `modelTrust:${modelTrust.status}`,
        `blockedFreshness:${evidenceFreshnessGate.totals.blocked}`
      ],
      nextAction: evidenceFreshnessGate.selectedCheck?.nextAction ?? modelTrust.nextActions[0] ?? "Refresh required live evidence before trust can rise."
    }),
    item({
      id: "ai-vs-deterministic",
      label: "AI readiness versus deterministic engine",
      status: openAiKeyDiagnostic.status === "ready-to-request" ? "resolved" : openAiKeyDiagnostic.status === "blocked" || openAiKeyDiagnostic.status === "suspicious-key" ? "contradiction" : "watch",
      severity: "high",
      claim: "The decision engine can run deterministic reasoning while optional AI review remains separately gated.",
      tension:
        openAiKeyDiagnostic.status === "ready-to-request"
          ? "AI review is available through guarded run routes."
          : `AI review is ${openAiKeyDiagnostic.status}, so AI critique cannot be treated as live support.`,
      resolution:
        "Keep deterministic reasoning active, but label AI review as unavailable or pending until the OpenAI gate passes.",
      evidence: [
        openAiKeyDiagnostic.diagnosticHash,
        `openAi:${openAiKeyDiagnostic.status}`,
        `key:${openAiKeyDiagnostic.runtime.keyShape}`,
        `canRequest:${trustFirewall.controls.canRequestAIReview}`
      ],
      nextAction: openAiKeyDiagnostic.nextStep.expectedEvidence
    }),
    item({
      id: "confidence-vs-learning",
      label: "Confidence versus learning",
      status: modelTrust.confidenceBudget.calibrationSampleSize === 0 || modelTrust.confidenceBudget.realFinishedFixtures === 0 ? "watch" : "resolved",
      severity: "medium",
      claim: `Model trust score is ${modelTrust.trustScore}/100 with max public confidence ${modelTrust.confidenceBudget.maxPublicConfidence}.`,
      tension:
        modelTrust.confidenceBudget.calibrationSampleSize === 0 || modelTrust.confidenceBudget.realFinishedFixtures === 0
          ? "The engine has model scores, but calibration and historical corpus proof are not strong enough to let confidence rise."
          : "Calibration and corpus proof are present for supervised interpretation.",
      resolution:
        "Use outcomes and historical corpus only as shadow evidence until calibration, backtest, and promotion gates pass.",
      evidence: [
        modelTrust.trustHash,
        `calibration:${modelTrust.confidenceBudget.calibrationSampleSize}`,
        `fixtures:${modelTrust.confidenceBudget.realFinishedFixtures}`,
        `odds:${modelTrust.confidenceBudget.realOddsSnapshots}`
      ],
      nextAction: modelTrust.nextActions[0] ?? "Collect settled outcomes and real historical fixtures before promoting learned confidence."
    }),
    item({
      id: "explanation-vs-locks",
      label: "Explanation versus locks",
      status: trustFirewall.status === "blocked" && trustFirewall.controls.canDisplayInternalCandidate ? "contradiction" : "resolved",
      severity: "high",
      claim: trustFirewall.summary,
      tension:
        trustFirewall.status === "blocked" && trustFirewall.controls.canDisplayInternalCandidate
          ? "The firewall says blocked but still allows candidate display."
          : "Display permissions align with the trust firewall status.",
      resolution:
        "Keep blocked candidates internal-only and route users to proof APIs rather than public picks.",
      evidence: [
        trustFirewall.firewallHash,
        `status:${trustFirewall.status}`,
        `internal:${trustFirewall.controls.canDisplayInternalCandidate}`,
        `publish:${trustFirewall.controls.canPublishPick}`,
        `stake:${trustFirewall.controls.canStake}`
      ],
      nextAction: "Preserve the no-publish/no-stake locks until all critical gates pass."
    })
  ];
}

export function buildDecisionContradictionLedger({
  date,
  sport,
  rows,
  evidenceFreshnessGate,
  marketAuditMatrix,
  oddsIntelligenceProof,
  modelTrust,
  openAiKeyDiagnostic,
  trustFirewall,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  rows: DecisionRow[];
  evidenceFreshnessGate: DecisionEvidenceFreshnessGate;
  marketAuditMatrix: DecisionMarketAuditMatrix;
  oddsIntelligenceProof: DecisionOddsIntelligenceProof;
  modelTrust: DecisionModelTrust;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
  trustFirewall: DecisionTrustFirewall;
  now?: Date;
}): DecisionContradictionLedger {
  const items = buildItems({
    rows,
    evidenceFreshnessGate,
    marketAuditMatrix,
    oddsIntelligenceProof,
    modelTrust,
    openAiKeyDiagnostic,
    trustFirewall
  }).sort((a, b) => rank(b) - rank(a) || a.label.localeCompare(b.label));
  const status = statusFromItems(items);
  const totals = {
    items: items.length,
    resolved: items.filter((entry) => entry.status === "resolved").length,
    watch: items.filter((entry) => entry.status === "watch").length,
    contradictions: items.filter((entry) => entry.status === "contradiction").length,
    critical: items.filter((entry) => entry.severity === "critical" && entry.status === "contradiction").length,
    candidatePositiveEv: (trustFirewall.selectedCandidate.expectedValue ?? 0) > 0 && trustFirewall.selectedCandidate.verdict === "positive-ev",
    maximumPublicAction: trustFirewall.actionContract.maximumPublicAction
  };

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-contradiction-ledger",
    status,
    ledgerHash: stableHash({
      date,
      sport,
      trust: trustFirewall.firewallHash,
      items: items.map((entry) => [entry.id, entry.status, entry.evidence])
    }),
    summary: summaryFor(status, totals),
    activeContradiction: items.find((entry) => entry.status === "contradiction") ?? items.find((entry) => entry.status === "watch") ?? null,
    items,
    totals,
    controls: {
      canResolveAutomatically: false,
      canRaiseConfidence: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/contradiction-ledger",
      "/api/sports/decision/trust-firewall",
      "/api/sports/decision/evidence-freshness-gate",
      "/api/sports/decision/market-audit-matrix",
      "/api/sports/decision/model-trust",
      "/api/sports/decision/openai-key-diagnostic",
      ...trustFirewall.proofUrls
    ]),
    locks: [
      "Contradiction ledger is read-only and cannot resolve gates, raise confidence, persist, publish, train, stake, or call OpenAI.",
      "Positive expected value is treated as a claim to test, not permission to act, when trust or freshness gates disagree.",
      "AI review absence is surfaced as a contradiction/watch item but does not stop deterministic math from running."
    ]
  };
}
