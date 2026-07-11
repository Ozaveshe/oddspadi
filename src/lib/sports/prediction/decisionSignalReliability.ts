import type { DecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import type { DecisionDataCoverageSignal, DecisionDataSignalCategory, Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionSignalReliabilityStatus = "ready" | "degraded" | "blocked";
export type DecisionSignalReliabilitySignalStatus = "fresh" | "usable" | "degraded" | "blocked";

export type DecisionSignalReliabilitySignal = {
  id: string;
  category: DecisionDataSignalCategory;
  label: string;
  status: DecisionSignalReliabilitySignalStatus;
  reliabilityScore: number;
  freshnessScore: number;
  providerBackedRatio: number;
  totalSignals: number;
  providerBackedSignals: number;
  computedSignals: number;
  mockSignals: number;
  missingSignals: number;
  staleSignals: number;
  notApplicableSignals: number;
  requiredGaps: number;
  affectedMatches: number;
  sources: string[];
  freshness: string[];
  exampleMatches: string[];
  missingEnv: string[];
  nextAction: string;
  verifyUrl: string;
  decisionImpact: string;
};

export type DecisionSignalReliability = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionSignalReliabilityStatus;
  reliabilityHash: string;
  reliabilityScore: number;
  summary: string;
  totals: {
    matches: number;
    signals: number;
    ready: number;
    degraded: number;
    blocked: number;
    providerBacked: number;
    computed: number;
    mock: number;
    missing: number;
    stale: number;
    requiredGaps: number;
  };
  nextSignal: DecisionSignalReliabilitySignal | null;
  signals: DecisionSignalReliabilitySignal[];
  policy: {
    canRaiseTrust: false;
    canPromote: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    rule: string;
    verificationUrl: string;
  };
};

type SignalAccumulator = {
  id: string;
  category: DecisionDataSignalCategory;
  label: string;
  totalWeight: number;
  weightedStatusScore: number;
  weightedFreshnessScore: number;
  totalSignals: number;
  providerBackedSignals: number;
  computedSignals: number;
  mockSignals: number;
  missingSignals: number;
  staleSignals: number;
  notApplicableSignals: number;
  requiredGaps: number;
  affectedMatchIds: Set<string>;
  sources: Set<string>;
  freshness: Set<string>;
  exampleMatches: string[];
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

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function compact(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function matchLabel(match: Match): string {
  return `${match.homeTeam.name} vs ${match.awayTeam.name}`;
}

function statusScore(signal: DecisionDataCoverageSignal): number {
  if (signal.status === "provider-backed" || signal.status === "not-applicable") return 100;
  if (signal.status === "computed") return 74;
  if (signal.status === "mock") return 42;
  if (signal.status === "stale") return 20;
  return 0;
}

function freshnessScore(signal: DecisionDataCoverageSignal): number {
  if (signal.freshness === "current") return 100;
  if (signal.freshness === "pre-match") return 82;
  if (signal.freshness === "historical") return 78;
  if (signal.freshness === "not-applicable") return 100;
  if (signal.freshness === "stale") return 18;
  if (signal.freshness === "mock") return 36;
  return 0;
}

function accumulatorFor(signal: DecisionDataCoverageSignal): SignalAccumulator {
  return {
    id: signal.id,
    category: signal.category,
    label: signal.label,
    totalWeight: 0,
    weightedStatusScore: 0,
    weightedFreshnessScore: 0,
    totalSignals: 0,
    providerBackedSignals: 0,
    computedSignals: 0,
    mockSignals: 0,
    missingSignals: 0,
    staleSignals: 0,
    notApplicableSignals: 0,
    requiredGaps: 0,
    affectedMatchIds: new Set<string>(),
    sources: new Set<string>(),
    freshness: new Set<string>(),
    exampleMatches: []
  };
}

function addSignal(acc: SignalAccumulator, signal: DecisionDataCoverageSignal, match: Match) {
  const weight = Math.max(0.1, signal.weight || 0.1);
  acc.totalWeight += weight;
  acc.weightedStatusScore += statusScore(signal) * weight;
  acc.weightedFreshnessScore += freshnessScore(signal) * weight;
  acc.totalSignals += 1;
  if (signal.status === "provider-backed") acc.providerBackedSignals += 1;
  if (signal.status === "computed") acc.computedSignals += 1;
  if (signal.status === "mock") acc.mockSignals += 1;
  if (signal.status === "missing") acc.missingSignals += 1;
  if (signal.status === "stale") acc.staleSignals += 1;
  if (signal.status === "not-applicable") acc.notApplicableSignals += 1;
  acc.sources.add(signal.source);
  acc.freshness.add(signal.freshness);

  if (signal.requiredForProduction && (signal.status === "missing" || signal.status === "mock" || signal.status === "stale")) {
    acc.requiredGaps += 1;
    acc.affectedMatchIds.add(match.id);
    if (acc.exampleMatches.length < 4) acc.exampleMatches.push(`${matchLabel(match)}: ${signal.detail}`);
  }
}

function dataIntakeByCategory(queue: DecisionDataIntakeQueue): Map<DecisionDataSignalCategory, DecisionDataIntakeQueue["items"][number]> {
  return new Map(queue.items.map((item) => [item.category, item]));
}

function signalStatus({
  reliabilityScore,
  requiredGaps,
  missingEnv,
  missingSignals,
  staleSignals,
  mockSignals
}: {
  reliabilityScore: number;
  requiredGaps: number;
  missingEnv: string[];
  missingSignals: number;
  staleSignals: number;
  mockSignals: number;
}): DecisionSignalReliabilitySignalStatus {
  if ((requiredGaps > 0 && missingEnv.length > 0) || reliabilityScore < 35) return "blocked";
  if (requiredGaps > 0 || missingSignals > 0 || staleSignals > 0 || mockSignals > 0 || reliabilityScore < 75) return "degraded";
  if (reliabilityScore < 90) return "usable";
  return "fresh";
}

function buildReliabilitySignal(acc: SignalAccumulator, queue: DecisionDataIntakeQueue): DecisionSignalReliabilitySignal {
  const intake = dataIntakeByCategory(queue).get(acc.category);
  const baseStatusScore = acc.totalWeight ? acc.weightedStatusScore / acc.totalWeight : 0;
  const baseFreshnessScore = acc.totalWeight ? acc.weightedFreshnessScore / acc.totalWeight : 0;
  const providerBackedRatio = acc.totalSignals ? acc.providerBackedSignals / acc.totalSignals : 0;
  const missingEnv = intake?.missingEnv ?? [];
  const reliabilityScore = Math.max(
    0,
    Math.min(100, baseStatusScore * 0.62 + baseFreshnessScore * 0.23 + providerBackedRatio * 15 - acc.requiredGaps * 3 - missingEnv.length * 4)
  );
  const status = signalStatus({
    reliabilityScore,
    requiredGaps: acc.requiredGaps,
    missingEnv,
    missingSignals: acc.missingSignals,
    staleSignals: acc.staleSignals,
    mockSignals: acc.mockSignals
  });
  const nextAction =
    intake?.command ??
    (acc.requiredGaps > 0 ? `Refresh ${acc.label.toLowerCase()} with provider-backed evidence.` : `Keep ${acc.label.toLowerCase()} current.`);

  return {
    id: acc.id,
    category: acc.category,
    label: acc.label,
    status,
    reliabilityScore: round(reliabilityScore, 1),
    freshnessScore: round(baseFreshnessScore, 1),
    providerBackedRatio: round(providerBackedRatio, 4),
    totalSignals: acc.totalSignals,
    providerBackedSignals: acc.providerBackedSignals,
    computedSignals: acc.computedSignals,
    mockSignals: acc.mockSignals,
    missingSignals: acc.missingSignals,
    staleSignals: acc.staleSignals,
    notApplicableSignals: acc.notApplicableSignals,
    requiredGaps: acc.requiredGaps,
    affectedMatches: acc.affectedMatchIds.size,
    sources: Array.from(acc.sources).slice(0, 6),
    freshness: Array.from(acc.freshness).slice(0, 6),
    exampleMatches: acc.exampleMatches,
    missingEnv,
    nextAction,
    verifyUrl: intake?.verifyUrl ?? `/api/sports/decision/data-intake?date=${encodeURIComponent(queue.date)}&sport=${encodeURIComponent(queue.sport)}`,
    decisionImpact: intake?.decisionImpact ?? `${acc.label} reliability affects whether the agent can raise trust.`
  };
}

function sortSignals(signals: DecisionSignalReliabilitySignal[]): DecisionSignalReliabilitySignal[] {
  const statusRank: Record<DecisionSignalReliabilitySignalStatus, number> = { blocked: 4, degraded: 3, usable: 2, fresh: 1 };
  return signals.slice().sort((a, b) => {
    const status = statusRank[b.status] - statusRank[a.status];
    if (status !== 0) return status;
    if (a.reliabilityScore !== b.reliabilityScore) return a.reliabilityScore - b.reliabilityScore;
    if (b.requiredGaps !== a.requiredGaps) return b.requiredGaps - a.requiredGaps;
    return a.label.localeCompare(b.label);
  });
}

function overallStatus(signals: DecisionSignalReliabilitySignal[], score: number): DecisionSignalReliabilityStatus {
  if (signals.some((signal) => signal.status === "blocked") || score < 45) return "blocked";
  if (signals.some((signal) => signal.status === "degraded") || score < 80) return "degraded";
  return "ready";
}

export function buildDecisionSignalReliability({
  rows,
  date,
  sport,
  dataIntake
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  dataIntake: DecisionDataIntakeQueue;
}): DecisionSignalReliability {
  const bySignal = new Map<string, SignalAccumulator>();

  for (const row of rows) {
    for (const signal of row.prediction.decision.dataCoverage.signals) {
      const acc = bySignal.get(signal.id) ?? accumulatorFor(signal);
      addSignal(acc, signal, row.match);
      bySignal.set(signal.id, acc);
    }
  }

  const signals = sortSignals(Array.from(bySignal.values()).map((acc) => buildReliabilitySignal(acc, dataIntake)));
  const reliabilityScore = signals.length ? round(signals.reduce((sum, signal) => sum + signal.reliabilityScore, 0) / signals.length, 1) : 0;
  const status = overallStatus(signals, reliabilityScore);
  const blocked = signals.filter((signal) => signal.status === "blocked").length;
  const degraded = signals.filter((signal) => signal.status === "degraded").length;
  const ready = signals.filter((signal) => signal.status === "fresh" || signal.status === "usable").length;
  const nextSignal = signals.find((signal) => signal.status === "blocked" || signal.status === "degraded") ?? signals[0] ?? null;
  const reliabilityHash = stableHash({
    date,
    sport,
    status,
    signals: signals.map((signal) => [signal.id, signal.status, signal.reliabilityScore, signal.requiredGaps, signal.missingEnv])
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    reliabilityHash,
    reliabilityScore,
    summary:
      status === "ready"
        ? `Signal reliability is ready at ${reliabilityScore}/100 across ${signals.length} data feed(s).`
        : status === "degraded"
          ? `Signal reliability is degraded at ${reliabilityScore}/100; ${degraded} feed(s) need stronger provider proof.`
          : `Signal reliability is blocked at ${reliabilityScore}/100; ${blocked} feed(s) have missing env, stale, mock, or missing production evidence.`,
    totals: {
      matches: rows.length,
      signals: signals.length,
      ready,
      degraded,
      blocked,
      providerBacked: signals.reduce((sum, signal) => sum + signal.providerBackedSignals, 0),
      computed: signals.reduce((sum, signal) => sum + signal.computedSignals, 0),
      mock: signals.reduce((sum, signal) => sum + signal.mockSignals, 0),
      missing: signals.reduce((sum, signal) => sum + signal.missingSignals, 0),
      stale: signals.reduce((sum, signal) => sum + signal.staleSignals, 0),
      requiredGaps: signals.reduce((sum, signal) => sum + signal.requiredGaps, 0)
    },
    nextSignal,
    signals,
    policy: {
      canRaiseTrust: false,
      canPromote: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      rule: "Signal reliability can only cap trust and name provider refresh work; it cannot promote, persist, publish, train, or invent unavailable data.",
      verificationUrl: `/api/sports/decision/signal-reliability?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`
    }
  };
}
