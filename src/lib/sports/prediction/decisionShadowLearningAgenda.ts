import type { DecisionContradictionLedger } from "@/lib/sports/prediction/decisionContradictionLedger";
import type { DecisionLearningConsolidator } from "@/lib/sports/prediction/decisionLearningConsolidator";
import type { DecisionOutcomeReplay } from "@/lib/sports/prediction/decisionOutcomeReplay";
import type { DecisionResolutionPlanner } from "@/lib/sports/prediction/decisionResolutionPlanner";
import type { DecisionResolutionReceipt } from "@/lib/sports/prediction/decisionResolutionReceipt";
import type { DecisionSettlementImpact } from "@/lib/sports/prediction/decisionSettlementImpact";
import type { DecisionTrustFirewall } from "@/lib/sports/prediction/decisionTrustFirewall";
import type { Sport } from "@/lib/sports/types";

export type DecisionShadowLearningAgendaStatus = "ready-shadow" | "waiting-proof" | "blocked";
export type DecisionShadowLearningAgendaItemStatus = "draft" | "waiting-proof" | "blocked" | "ready-shadow";
export type DecisionShadowLearningAgendaItemSource =
  | "contradiction-ledger"
  | "resolution-receipt"
  | "outcome-replay"
  | "settlement-impact"
  | "learning-consolidator"
  | "trust-firewall";

export type DecisionShadowLearningAgendaItem = {
  id: string;
  source: DecisionShadowLearningAgendaItemSource;
  status: DecisionShadowLearningAgendaItemStatus;
  priority: "critical" | "high" | "medium" | "low";
  label: string;
  hypothesis: string;
  evidenceNeeded: string[];
  expectedLearning: string;
  blockedBy: string[];
  proofUrl: string;
  canPromote: false;
};

export type DecisionShadowLearningAgenda = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-shadow-learning-agenda";
  status: DecisionShadowLearningAgendaStatus;
  agendaHash: string;
  summary: string;
  selectedItem: DecisionShadowLearningAgendaItem | null;
  items: DecisionShadowLearningAgendaItem[];
  totals: {
    items: number;
    readyShadow: number;
    waitingProof: number;
    blocked: number;
    memoryDrafts: number;
    trainingDrafts: number;
    outcomeDrafts: number;
  };
  memoryDraft: {
    canPersist: false;
    label: string;
    summary: string;
    tags: string[];
    evidenceIds: string[];
  };
  controls: {
    canInspectReadOnly: true;
    canPersistMemory: false;
    canPersistOutcomes: false;
    canRunCalibration: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canRaiseConfidence: false;
    canResolveContradictions: false;
    canPublishPicks: false;
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

function unique(values: Array<string | null | undefined>, limit = 28): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, max = 280): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3).trim()}...` : normalized;
}

function agendaItem(
  input: Omit<DecisionShadowLearningAgendaItem, "hypothesis" | "evidenceNeeded" | "expectedLearning" | "blockedBy" | "canPromote"> & {
    hypothesis: string;
    evidenceNeeded: Array<string | null | undefined>;
    expectedLearning: string;
    blockedBy?: Array<string | null | undefined>;
  }
): DecisionShadowLearningAgendaItem {
  return {
    ...input,
    hypothesis: compact(input.hypothesis),
    evidenceNeeded: unique(input.evidenceNeeded, 8),
    expectedLearning: compact(input.expectedLearning),
    blockedBy: unique(input.blockedBy ?? [], 8),
    canPromote: false
  };
}

function statusFromItems(items: DecisionShadowLearningAgendaItem[]): DecisionShadowLearningAgendaStatus {
  if (items.every((item) => item.status === "blocked")) return "blocked";
  if (items.every((item) => item.status === "ready-shadow")) return "ready-shadow";
  return "waiting-proof";
}

function selectedItem(items: DecisionShadowLearningAgendaItem[]): DecisionShadowLearningAgendaItem | null {
  const rank = { critical: 4, high: 3, medium: 2, low: 1 };
  return (
    items
      .slice()
      .sort((a, b) => {
        const statusRank = { blocked: 4, "waiting-proof": 3, draft: 2, "ready-shadow": 1 };
        return statusRank[b.status] - statusRank[a.status] || rank[b.priority] - rank[a.priority] || a.label.localeCompare(b.label);
      })[0] ?? null
  );
}

function summaryFor(status: DecisionShadowLearningAgendaStatus, totals: DecisionShadowLearningAgenda["totals"]): string {
  if (status === "ready-shadow") return `Shadow learning agenda has ${totals.readyShadow} item(s) ready for read-only memory review.`;
  if (status === "blocked") return "Shadow learning agenda is blocked; every candidate learning signal still lacks required proof.";
  return `Shadow learning agenda prepared ${totals.items} draft(s); ${totals.waitingProof} still need proof before memory or training can be considered.`;
}

function buildItems({
  contradictionLedger,
  resolutionPlanner,
  resolutionReceipt,
  trustFirewall,
  outcomeReplay,
  settlementImpact,
  learningConsolidator
}: {
  contradictionLedger: DecisionContradictionLedger;
  resolutionPlanner: DecisionResolutionPlanner;
  resolutionReceipt: DecisionResolutionReceipt;
  trustFirewall: DecisionTrustFirewall;
  outcomeReplay: DecisionOutcomeReplay;
  settlementImpact: DecisionSettlementImpact;
  learningConsolidator: DecisionLearningConsolidator;
}): DecisionShadowLearningAgendaItem[] {
  const activeContradiction = contradictionLedger.activeContradiction;
  const activeSignal = learningConsolidator.activeSignal;
  const receiptReady = resolutionReceipt.status === "verified";
  const receiptCanObserve = resolutionReceipt.target.allowed;
  const hasReplayRows = outcomeReplay.rows.length > 0;
  const hasBacktest = Boolean(outcomeReplay.historicalSignal.backtestId);
  const gradeableNow = settlementImpact.totals.gradeableNow > 0;
  const freshnessGate = trustFirewall.gates.find((gate) => gate.id === "evidence-freshness");

  return [
    agendaItem({
      id: "contradiction-memory",
      source: "contradiction-ledger",
      status: contradictionLedger.totals.contradictions > 0 ? (receiptReady ? "ready-shadow" : "waiting-proof") : "ready-shadow",
      priority: contradictionLedger.totals.critical > 0 ? "critical" : "high",
      label: activeContradiction?.label ?? "Contradiction memory",
      hypothesis: activeContradiction
        ? `Future slates should remember that ${activeContradiction.claim} conflicted with ${activeContradiction.tension}`
        : "Future slates can reuse this coherent contradiction check as a baseline memory pattern.",
      evidenceNeeded: [contradictionLedger.ledgerHash, activeContradiction?.id, resolutionReceipt.receiptHash],
      expectedLearning:
        "Create a replayable memory pattern for conflicts between market edge, model confidence, freshness, AI readiness, and public action locks.",
      blockedBy: contradictionLedger.totals.contradictions > 0 && !receiptReady ? ["Resolution receipt has not verified the selected proof route."] : [],
      proofUrl: "/api/sports/decision/contradiction-ledger"
    }),
    agendaItem({
      id: "resolution-proof",
      source: "resolution-receipt",
      status: receiptReady ? "ready-shadow" : receiptCanObserve ? "waiting-proof" : "blocked",
      priority: "critical",
      label: resolutionReceipt.selectedStep.label ?? resolutionPlanner.nextStep?.label ?? "Resolution proof",
      hypothesis: resolutionReceipt.summary,
      evidenceNeeded: [resolutionReceipt.receiptHash, resolutionReceipt.target.path, resolutionPlanner.plannerHash],
      expectedLearning:
        "Use the receipt as proof that the agent can inspect a safe route before any contradiction is treated as resolved.",
      blockedBy: receiptReady ? [] : [resolutionReceipt.target.reason],
      proofUrl: "/api/sports/decision/resolution-receipt"
    }),
    agendaItem({
      id: "settlement-label",
      source: "settlement-impact",
      status: gradeableNow ? "ready-shadow" : settlementImpact.rows.length ? "waiting-proof" : "blocked",
      priority: "high",
      label: "Settlement label agenda",
      hypothesis: settlementImpact.rows[0]?.recommendedNext ?? settlementImpact.summary,
      evidenceNeeded: [settlementImpact.impactHash, settlementImpact.rows[0]?.settlementPreviewUrl, String(settlementImpact.totals.gradeableNow)],
      expectedLearning:
        "Prepare outcome labels that later support Brier score, ROI, closing-line value, and calibration without writing outcomes from this route.",
      blockedBy: gradeableNow ? [] : [settlementImpact.rows[0]?.requiredFields.join(", ") ?? "No settlement candidate is available."],
      proofUrl: "/api/sports/decision/settlement-impact"
    }),
    agendaItem({
      id: "calibration-target",
      source: "outcome-replay",
      status: hasBacktest && hasReplayRows ? "ready-shadow" : hasReplayRows ? "waiting-proof" : "blocked",
      priority: "high",
      label: "Calibration target agenda",
      hypothesis: outcomeReplay.summary,
      evidenceNeeded: [outcomeReplay.replayHash, outcomeReplay.historicalSignal.backtestId, String(outcomeReplay.totals.pendingOutcomeTickets)],
      expectedLearning:
        "Turn replay pressure, Brier/log-loss deltas, ROI, and closing-line value into future calibration targets after real backtests exist.",
      blockedBy: hasBacktest ? [] : [outcomeReplay.learningFeedback.nextEvidence],
      proofUrl: "/api/sports/decision/outcome-replay"
    }),
    agendaItem({
      id: "provider-freshness",
      source: "trust-firewall",
      status: freshnessGate?.status === "pass" ? "ready-shadow" : freshnessGate?.status === "watch" ? "waiting-proof" : "blocked",
      priority: "critical",
      label: freshnessGate?.label ?? "Provider freshness agenda",
      hypothesis: freshnessGate?.detail ?? trustFirewall.summary,
      evidenceNeeded: [trustFirewall.firewallHash, freshnessGate?.evidence.join(" "), freshnessGate?.nextAction],
      expectedLearning:
        "Record which provider freshness signals must be present before the engine treats market prices or model outputs as trustworthy.",
      blockedBy: freshnessGate?.status === "pass" ? [] : [freshnessGate?.nextAction ?? "Freshness gate is missing."],
      proofUrl: "/api/sports/decision/trust-firewall"
    }),
    agendaItem({
      id: "trust-firewall",
      source: "learning-consolidator",
      status: activeSignal?.status === "draft" && trustFirewall.status !== "blocked" ? "ready-shadow" : activeSignal ? "waiting-proof" : "blocked",
      priority: "medium",
      label: activeSignal?.label ?? "Learning consolidator agenda",
      hypothesis: activeSignal?.detail ?? learningConsolidator.summary,
      evidenceNeeded: [learningConsolidator.consolidatorHash, activeSignal?.id, trustFirewall.actionContract.maximumPublicAction],
      expectedLearning:
        "Keep the highest-priority learning signal attached to the trust firewall so future cycles know whether memory, outcome, calibration, or training proof is missing.",
      blockedBy: activeSignal && trustFirewall.status !== "blocked" ? [] : [trustFirewall.actionContract.reason],
      proofUrl: "/api/sports/decision/learning-consolidator"
    })
  ];
}

export function buildDecisionShadowLearningAgenda({
  date,
  sport,
  contradictionLedger,
  resolutionPlanner,
  resolutionReceipt,
  trustFirewall,
  outcomeReplay,
  settlementImpact,
  learningConsolidator,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  contradictionLedger: DecisionContradictionLedger;
  resolutionPlanner: DecisionResolutionPlanner;
  resolutionReceipt: DecisionResolutionReceipt;
  trustFirewall: DecisionTrustFirewall;
  outcomeReplay: DecisionOutcomeReplay;
  settlementImpact: DecisionSettlementImpact;
  learningConsolidator: DecisionLearningConsolidator;
  now?: Date;
}): DecisionShadowLearningAgenda {
  const items = buildItems({
    contradictionLedger,
    resolutionPlanner,
    resolutionReceipt,
    trustFirewall,
    outcomeReplay,
    settlementImpact,
    learningConsolidator
  });
  const status = statusFromItems(items);
  const active = selectedItem(items);
  const totals = {
    items: items.length,
    readyShadow: items.filter((item) => item.status === "ready-shadow").length,
    waitingProof: items.filter((item) => item.status === "waiting-proof" || item.status === "draft").length,
    blocked: items.filter((item) => item.status === "blocked").length,
    memoryDrafts: items.filter((item) => item.source === "contradiction-ledger" || item.source === "learning-consolidator").length,
    trainingDrafts: items.filter((item) => item.id === "calibration-target" || item.id === "provider-freshness").length,
    outcomeDrafts: items.filter((item) => item.id === "settlement-label").length
  };
  const agendaHash = stableHash({
    date,
    sport,
    contradiction: contradictionLedger.ledgerHash,
    receipt: resolutionReceipt.receiptHash,
    replay: outcomeReplay.replayHash,
    settlement: settlementImpact.impactHash,
    learning: learningConsolidator.consolidatorHash,
    items: items.map((item) => [item.id, item.status, item.evidenceNeeded])
  });

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-shadow-learning-agenda",
    status,
    agendaHash,
    summary: summaryFor(status, totals),
    selectedItem: active,
    items,
    totals,
    memoryDraft: {
      canPersist: false,
      label: active ? `Shadow agenda: ${active.label}` : "Shadow agenda",
      summary: compact(
        `${active?.expectedLearning ?? "No active learning item."} This is a draft only; persistence, training, promotion, publishing, staking, and confidence upgrades are locked.`
      ),
      tags: unique([sport, status, active?.id, active?.source, contradictionLedger.status, trustFirewall.status, learningConsolidator.status], 10),
      evidenceIds: unique([agendaHash, contradictionLedger.ledgerHash, resolutionReceipt.receiptHash, outcomeReplay.replayHash, settlementImpact.impactHash, learningConsolidator.consolidatorHash], 12)
    },
    controls: {
      canInspectReadOnly: true,
      canPersistMemory: false,
      canPersistOutcomes: false,
      canRunCalibration: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canRaiseConfidence: false,
      canResolveContradictions: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/shadow-learning-agenda",
      "/api/sports/decision/resolution-receipt",
      "/api/sports/decision/resolution-planner",
      "/api/sports/decision/contradiction-ledger",
      "/api/sports/decision/outcome-replay",
      "/api/sports/decision/settlement-impact",
      "/api/sports/decision/learning-consolidator",
      "/api/sports/decision/trust-firewall",
      ...resolutionReceipt.proofUrls,
      ...contradictionLedger.proofUrls,
      ...outcomeReplay.proofUrls,
      ...settlementImpact.proofUrls,
      ...learningConsolidator.proofUrls
    ], 34),
    locks: unique([
      "Shadow learning agenda is read-only and cannot persist memory, outcomes, calibration rows, training rows, or model weights.",
      "Resolution receipts can prove route observation, but cannot resolve contradictions or raise confidence.",
      "Learning drafts exclude hidden chain-of-thought and stay limited to public evidence labels.",
      "No agenda item can publish picks, stake, apply learned weights, or upgrade the maximum public action.",
      ...resolutionReceipt.locks,
      ...learningConsolidator.locks,
      ...trustFirewall.locks
    ], 30)
  };
}
