import type { DecisionDataBackbone } from "@/lib/sports/prediction/decisionDataBackbone";
import type { DecisionDataSourceCoverage, DecisionDataSourceCoverageCell } from "@/lib/sports/prediction/decisionDataSourceCoverage";
import type { DecisionEvidenceFreshnessGate } from "@/lib/sports/prediction/decisionEvidenceFreshnessGate";
import type { DecisionPreMatchTrustGate } from "@/lib/sports/prediction/decisionPreMatchTrustGate";
import type { DecisionProviderIngestionEvidence, DecisionProviderIngestionSignal } from "@/lib/sports/prediction/decisionProviderIngestionEvidence";
import type { DecisionDataSignalCategory, Sport } from "@/lib/sports/types";

export type DecisionEvidenceInfluenceLedgerStatus = "decision-eligible" | "shadow-only" | "blocked";
export type DecisionEvidenceInfluenceState = "influence-allowed" | "shadow-only" | "blocked";

export type DecisionEvidenceInfluenceEntry = {
  id: string;
  sport: Sport;
  category: DecisionDataSignalCategory;
  label: string;
  state: DecisionEvidenceInfluenceState;
  requiredForLive: boolean;
  sourceStatus: DecisionDataSourceCoverageCell["status"];
  freshnessStatus: string;
  providerStatus: DecisionProviderIngestionSignal["status"] | "not-mapped";
  provider: string;
  influenceScore: number;
  blockers: string[];
  watches: string[];
  allowedUses: Array<"ai-context" | "shadow-model" | "deterministic-model" | "public-explanation">;
  forbiddenUses: Array<"publish-pick" | "raise-trust" | "stake" | "train-model" | "persist-decision" | "claim-provider-proof">;
  storageTables: string[];
  nextAction: string;
  proofUrls: string[];
};

export type DecisionEvidenceInfluenceLedger = {
  mode: "evidence-influence-ledger";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionEvidenceInfluenceLedgerStatus;
  ledgerHash: string;
  summary: string;
  entries: DecisionEvidenceInfluenceEntry[];
  selectedEntry: DecisionEvidenceInfluenceEntry | null;
  totals: {
    entries: number;
    influenceAllowed: number;
    shadowOnly: number;
    blocked: number;
    requiredBlocked: number;
    averageInfluenceScore: number;
  };
  activeTarget: {
    matchId: string | null;
    match: string | null;
    trustCeiling: string;
    publicAction: string;
  };
  aiInstructions: string[];
  controls: {
    canInspectReadOnly: true;
    canUseLedgerForAI: true;
    canUseSignalsForDeterministicModel: boolean;
    canRaiseTrustFromLedger: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
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

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return 0;
  return clamp(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

function unique(values: Array<string | null | undefined>, limit = 32): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function statusFor(entries: DecisionEvidenceInfluenceEntry[]): DecisionEvidenceInfluenceLedgerStatus {
  if (entries.some((entry) => entry.requiredForLive && entry.state === "blocked")) return "blocked";
  if (entries.some((entry) => entry.state === "shadow-only")) return "shadow-only";
  return "decision-eligible";
}

function summaryFor(status: DecisionEvidenceInfluenceLedgerStatus, totals: DecisionEvidenceInfluenceLedger["totals"]): string {
  if (status === "decision-eligible") {
    return `${totals.influenceAllowed}/${totals.entries} required signal(s) are allowed to influence deterministic reasoning.`;
  }
  if (status === "shadow-only") {
    return `${totals.shadowOnly} signal(s) can be used only for shadow reasoning until provider freshness, storage, or trust gates improve.`;
  }
  return `${totals.requiredBlocked} required signal(s) are blocked from influencing model trust or public decisions.`;
}

function scoreFor({
  state,
  sourceStatus,
  freshnessStatus,
  providerStatus
}: {
  state: DecisionEvidenceInfluenceState;
  sourceStatus: DecisionDataSourceCoverageCell["status"];
  freshnessStatus: string;
  providerStatus: DecisionEvidenceInfluenceEntry["providerStatus"];
}): number {
  if (state === "blocked") return 0;
  let score = sourceStatus === "provider-backed" ? 70 : sourceStatus === "computed" ? 42 : 20;
  if (freshnessStatus === "fresh") score += 15;
  if (freshnessStatus === "stale") score -= 15;
  if (providerStatus === "ready") score += 10;
  if (providerStatus === "watch") score += 3;
  if (state === "shadow-only") score = Math.min(score, 59);
  return clamp(score);
}

function buildEntry({
  cell,
  freshness,
  providerSignal,
  dataBackbone,
  preMatchTrustGate
}: {
  cell: DecisionDataSourceCoverageCell;
  freshness: DecisionEvidenceFreshnessGate["checks"][number] | undefined;
  providerSignal: DecisionProviderIngestionSignal | undefined;
  dataBackbone: DecisionDataBackbone;
  preMatchTrustGate: DecisionPreMatchTrustGate;
}): DecisionEvidenceInfluenceEntry {
  const blockers = unique([
    cell.status === "missing" ? "source coverage is missing" : null,
    cell.status === "mock" ? "source coverage is mock-backed" : null,
    freshness?.status === "missing" ? "freshness proof is missing" : null,
    freshness?.status === "blocked" ? "freshness proof is blocked" : null,
    providerSignal?.status === "blocked" ? "provider signal is blocked" : null,
    providerSignal?.status === "needs-env" ? `provider env missing: ${providerSignal.missingEnv.join(", ")}` : null,
    providerSignal?.status === "needs-supabase-proof" ? `storage proof missing: ${providerSignal.storageMissing.join(", ")}` : null,
    dataBackbone.status === "blocked-credentials" ? "Supabase server credential is rejected" : null,
    dataBackbone.status === "blocked-cross-project" ? "Supabase project evidence is cross-project" : null,
    preMatchTrustGate.status === "blocked" ? "pre-match trust gate is blocked" : null
  ]);
  const watches = unique([
    cell.status === "computed" ? "computed signal may support shadow reasoning only" : null,
    freshness?.status === "stale" ? "freshness proof is stale" : null,
    dataBackbone.status !== "ready-provider-dry-run" ? `data backbone is ${dataBackbone.status}` : null,
    preMatchTrustGate.status !== "shadow-ready" ? `pre-match trust is ${preMatchTrustGate.status}` : null,
    providerSignal?.dryRunOnly ? "provider path is dry-run only" : null
  ]);
  const state: DecisionEvidenceInfluenceState =
    blockers.length > 0
      ? "blocked"
      : cell.status === "provider-backed" && freshness?.status === "fresh" && dataBackbone.status === "ready-provider-dry-run" && preMatchTrustGate.status !== "blocked"
        ? "influence-allowed"
        : "shadow-only";
  const freshnessStatus = freshness?.status ?? "not-mapped";
  const providerStatus = providerSignal?.status ?? "not-mapped";
  const allowedUses: DecisionEvidenceInfluenceEntry["allowedUses"] =
    state === "influence-allowed" ? ["ai-context", "shadow-model", "deterministic-model", "public-explanation"] : state === "shadow-only" ? ["ai-context", "shadow-model"] : ["ai-context"];

  return {
    id: `evidence-influence:${cell.sport}:${cell.category}`,
    sport: cell.sport,
    category: cell.category,
    label: cell.label,
    state,
    requiredForLive: cell.requiredForLive,
    sourceStatus: cell.status,
    freshnessStatus,
    providerStatus,
    provider: cell.provider,
    influenceScore: scoreFor({ state, sourceStatus: cell.status, freshnessStatus, providerStatus }),
    blockers,
    watches,
    allowedUses,
    forbiddenUses: ["publish-pick", "raise-trust", "stake", "train-model", "persist-decision", "claim-provider-proof"],
    storageTables: cell.storageTables,
    nextAction: blockers[0] ?? watches[0] ?? cell.nextAction,
    proofUrls: unique([cell.proofUrl, freshness?.proofUrl, providerSignal?.verifyUrl, "/api/sports/decision/data-backbone", "/api/sports/decision/pre-match-trust-gate"], 8)
  };
}

export function buildDecisionEvidenceInfluenceLedger({
  date,
  sport,
  dataSourceCoverage,
  evidenceFreshnessGate,
  providerIngestionEvidence,
  dataBackbone,
  preMatchTrustGate,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  dataSourceCoverage: DecisionDataSourceCoverage;
  evidenceFreshnessGate: DecisionEvidenceFreshnessGate;
  providerIngestionEvidence: DecisionProviderIngestionEvidence;
  dataBackbone: DecisionDataBackbone;
  preMatchTrustGate: DecisionPreMatchTrustGate;
  now?: Date;
}): DecisionEvidenceInfluenceLedger {
  const entries = dataSourceCoverage.cells
    .filter((cell) => cell.sport === sport && cell.requiredForLive)
    .map((cell) =>
      buildEntry({
        cell,
        freshness: evidenceFreshnessGate.checks.find((check) => check.sport === cell.sport && check.category === cell.category),
        providerSignal: providerIngestionEvidence.providerSignals.find((signal) => signal.category === cell.category),
        dataBackbone,
        preMatchTrustGate
      })
    )
    .sort((a, b) => {
      const rank = { blocked: 3, "shadow-only": 2, "influence-allowed": 1 };
      return rank[b.state] - rank[a.state] || a.influenceScore - b.influenceScore || a.label.localeCompare(b.label);
    });
  const totals = {
    entries: entries.length,
    influenceAllowed: entries.filter((entry) => entry.state === "influence-allowed").length,
    shadowOnly: entries.filter((entry) => entry.state === "shadow-only").length,
    blocked: entries.filter((entry) => entry.state === "blocked").length,
    requiredBlocked: entries.filter((entry) => entry.requiredForLive && entry.state === "blocked").length,
    averageInfluenceScore: average(entries.map((entry) => entry.influenceScore))
  };
  const status = statusFor(entries);
  const selectedEntry = entries.find((entry) => entry.state === "blocked") ?? entries.find((entry) => entry.state === "shadow-only") ?? entries[0] ?? null;
  const activeTarget = preMatchTrustGate.topCandidate;

  return {
    mode: "evidence-influence-ledger",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    ledgerHash: stableHash({
      date,
      sport,
      coverage: dataSourceCoverage.coverageHash,
      freshness: evidenceFreshnessGate.freshnessHash,
      provider: providerIngestionEvidence.evidenceHash,
      backbone: dataBackbone.backboneHash,
      trust: preMatchTrustGate.trustHash,
      entries: entries.map((entry) => [entry.id, entry.state, entry.influenceScore, entry.blockers])
    }),
    summary: summaryFor(status, totals),
    entries,
    selectedEntry,
    totals,
    activeTarget: {
      matchId: activeTarget?.matchId ?? null,
      match: activeTarget?.match ?? null,
      trustCeiling: activeTarget?.trustCeiling ?? "blocked",
      publicAction: activeTarget?.publicAction ?? "blocked"
    },
    aiInstructions: [
      "Use blocked evidence only to explain why trust cannot rise; do not use it as support for a pick.",
      "Use shadow-only evidence for hypotheses, counterarguments, and evidence acquisition, not for public recommendations.",
      "Only influence-allowed evidence may support deterministic model confidence, and it still cannot publish, stake, persist, train, or raise trust by itself.",
      "Do not claim provider-backed injuries, lineups, odds, live scores, news, weather, or historical corpus unless the matching ledger entry is influence-allowed."
    ],
    controls: {
      canInspectReadOnly: true,
      canUseLedgerForAI: true,
      canUseSignalsForDeterministicModel: status === "decision-eligible",
      canRaiseTrustFromLedger: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    nextAction: {
      label: status === "decision-eligible" ? "Inspect allowed evidence" : status === "shadow-only" ? "Promote shadow evidence with provider proof" : "Clear evidence influence blockers",
      command: `curl.exe -sS "http://127.0.0.1:3025/api/sports/decision/evidence-influence-ledger?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}"`,
      verifyUrl: "/api/sports/decision/evidence-influence-ledger",
      safeToRun: true,
      expectedEvidence: selectedEntry
        ? `${selectedEntry.label}: ${selectedEntry.state}; next ${selectedEntry.nextAction}`
        : "Ledger returns required signal influence states and locked side-effect controls."
    },
    proofUrls: unique([
      "/api/sports/decision/evidence-influence-ledger",
      "/api/sports/decision/data-source-coverage",
      "/api/sports/decision/evidence-freshness-gate",
      "/api/sports/decision/provider-ingestion-evidence",
      "/api/sports/decision/data-backbone",
      "/api/sports/decision/pre-match-trust-gate"
    ]),
    locks: [
      "Evidence influence is a permission ledger, not a data-ingestion write path.",
      "Blocked evidence cannot raise trust, support a pick, publish, stake, persist, or train.",
      "Shadow-only evidence can guide acquisition and AI critique, but cannot become public confidence.",
      "Provider-backed claims require matching influence-allowed entries."
    ]
  };
}
