import type { DecisionDataSourceCellStatus, DecisionDataSourceCoverage, DecisionDataSourceCoverageCell } from "@/lib/sports/prediction/decisionDataSourceCoverage";
import type { DecisionEvidenceRefreshScheduler } from "@/lib/sports/prediction/decisionEvidenceRefreshScheduler";
import type { DecisionDataSignalCategory, Sport } from "@/lib/sports/types";

export type DecisionEvidenceFreshnessStatus = "fresh-enough" | "needs-refresh" | "blocked";
export type DecisionEvidenceFreshnessCheckStatus = "fresh" | "stale" | "missing" | "blocked" | "not-applicable";

export type DecisionEvidenceFreshnessCheck = {
  id: string;
  sport: Sport;
  category: DecisionDataSignalCategory;
  label: string;
  status: DecisionEvidenceFreshnessCheckStatus;
  urgency: "critical" | "high" | "medium" | "low";
  requiredForLive: boolean;
  freshnessScore: number;
  sourceStatus: DecisionDataSourceCellStatus;
  provider: string;
  storageTables: string[];
  observedSignals: number;
  providerBackedSignals: number;
  staleSignals: number;
  missingSignals: number;
  mockSignals: number;
  computedSignals: number;
  missingEnv: string[];
  maxAgeMinutes: number | null;
  nextAction: string;
  proofUrl: string;
};

export type DecisionEvidenceFreshnessGate = {
  generatedAt: string;
  date: string;
  mode: "decision-evidence-freshness-gate";
  status: DecisionEvidenceFreshnessStatus;
  freshnessHash: string;
  summary: string;
  checks: DecisionEvidenceFreshnessCheck[];
  selectedCheck: DecisionEvidenceFreshnessCheck | null;
  totals: {
    checks: number;
    required: number;
    fresh: number;
    stale: number;
    missing: number;
    blocked: number;
    notApplicable: number;
    providerBackedRequired: number;
    averageFreshnessScore: number;
    refreshTasksReady: number;
    refreshTasksBlocked: number;
  };
  policy: {
    canTrustLiveSlate: boolean;
    canRunReadOnlyRefresh: boolean;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
    rule: string;
  };
  proofUrls: string[];
  locks: string[];
};

const MAX_AGE_MINUTES: Partial<Record<DecisionDataSignalCategory, number>> = {
  fixtures: 30,
  odds: 10,
  "live-scores": 2,
  "match-events": 2,
  injuries: 180,
  suspensions: 180,
  lineups: 45,
  news: 240,
  weather: 180,
  standings: 1440,
  "recent-form": 1440,
  "home-away": 10080,
  "historical-results": 10080,
  training: 10080
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

function unique(values: Array<string | null | undefined>, limit = 32): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function freshnessScore(cell: DecisionDataSourceCoverageCell): number {
  if (!cell.requiredForLive || cell.status === "not-applicable") return 100;
  const evidence = cell.evidence;
  if (cell.status === "provider-backed") return 100;
  if (cell.status === "computed") return Math.max(42, 68 - evidence.stale * 12 - evidence.missing * 8);
  if (cell.status === "mock") return Math.max(18, 38 - evidence.stale * 10 - evidence.missing * 6);
  return Math.max(0, 20 - evidence.missing * 6 - evidence.stale * 8);
}

function urgencyFor(cell: DecisionDataSourceCoverageCell): DecisionEvidenceFreshnessCheck["urgency"] {
  if (!cell.requiredForLive) return "low";
  if (cell.category === "odds" || cell.category === "fixtures" || cell.category === "live-scores" || cell.category === "match-events") return "critical";
  if (cell.category === "injuries" || cell.category === "lineups" || cell.category === "news" || cell.category === "training") return "high";
  if (cell.category === "weather" || cell.category === "standings" || cell.category === "recent-form") return "medium";
  return "low";
}

function statusFor(cell: DecisionDataSourceCoverageCell, score: number): DecisionEvidenceFreshnessCheckStatus {
  if (!cell.requiredForLive || cell.status === "not-applicable") return "not-applicable";
  if (cell.status === "missing") return "missing";
  if (cell.status === "mock") return "blocked";
  if (cell.evidence.stale > 0) return "stale";
  if (score >= 70) return "fresh";
  return "stale";
}

function nextActionFor(cell: DecisionDataSourceCoverageCell, status: DecisionEvidenceFreshnessCheckStatus): string {
  if (status === "fresh") return `Keep ${cell.label.toLowerCase()} refreshed within ${MAX_AGE_MINUTES[cell.category] ?? 1440} minute(s).`;
  if (status === "not-applicable") return "No freshness proof is required for this sport/category right now.";
  if (cell.missingEnv.length) return `Configure ${cell.missingEnv.join(", ")} before the next freshness proof.`;
  if (status === "blocked") return `Replace mock ${cell.label.toLowerCase()} with provider-backed evidence before trusting this slate.`;
  if (status === "missing") return cell.nextAction;
  return `Refresh ${cell.label.toLowerCase()} and attach timestamp/source proof before raising trust.`;
}

function checkFromCell(cell: DecisionDataSourceCoverageCell): DecisionEvidenceFreshnessCheck {
  const score = round(freshnessScore(cell));
  const status = statusFor(cell, score);
  return {
    id: `${cell.id}:freshness`,
    sport: cell.sport,
    category: cell.category,
    label: cell.label,
    status,
    urgency: urgencyFor(cell),
    requiredForLive: cell.requiredForLive,
    freshnessScore: score,
    sourceStatus: cell.status,
    provider: cell.provider,
    storageTables: cell.storageTables,
    observedSignals: cell.evidence.totalSignals,
    providerBackedSignals: cell.evidence.providerBacked,
    staleSignals: cell.evidence.stale,
    missingSignals: cell.evidence.missing,
    mockSignals: cell.evidence.mock,
    computedSignals: cell.evidence.computed,
    missingEnv: cell.missingEnv,
    maxAgeMinutes: MAX_AGE_MINUTES[cell.category] ?? null,
    nextAction: nextActionFor(cell, status),
    proofUrl: cell.proofUrl
  };
}

function rank(check: DecisionEvidenceFreshnessCheck): number {
  const statusRank = { blocked: 5, missing: 4, stale: 3, fresh: 1, "not-applicable": 0 }[check.status];
  const urgencyRank = { critical: 4, high: 3, medium: 2, low: 1 }[check.urgency];
  return statusRank * 10 + urgencyRank;
}

function gateStatus(checks: DecisionEvidenceFreshnessCheck[]): DecisionEvidenceFreshnessStatus {
  const required = checks.filter((check) => check.requiredForLive);
  if (required.some((check) => check.status === "blocked" || check.status === "missing")) return "blocked";
  if (required.some((check) => check.status === "stale")) return "needs-refresh";
  return "fresh-enough";
}

function summaryFor(status: DecisionEvidenceFreshnessStatus, totals: DecisionEvidenceFreshnessGate["totals"]): string {
  if (status === "fresh-enough") return `Evidence freshness is good enough across ${totals.providerBackedRequired}/${totals.required} required live signal(s).`;
  if (status === "needs-refresh") return `Evidence freshness needs refresh on ${totals.stale} stale required signal(s) before trust can rise.`;
  return `Evidence freshness is blocked by ${totals.blocked + totals.missing} missing or mock-backed required signal(s).`;
}

export function buildDecisionEvidenceFreshnessGate({
  date,
  dataSourceCoverage,
  evidenceRefreshScheduler,
  now = new Date(),
  limit = 18
}: {
  date: string;
  dataSourceCoverage: DecisionDataSourceCoverage;
  evidenceRefreshScheduler: DecisionEvidenceRefreshScheduler;
  now?: Date;
  limit?: number;
}): DecisionEvidenceFreshnessGate {
  const allChecks = dataSourceCoverage.cells.map(checkFromCell);
  const checks = allChecks
    .slice()
    .sort((a, b) => rank(b) - rank(a) || a.sport.localeCompare(b.sport) || a.label.localeCompare(b.label))
    .slice(0, Math.max(1, limit));
  const required = allChecks.filter((check) => check.requiredForLive);
  const totals = {
    checks: allChecks.length,
    required: required.length,
    fresh: allChecks.filter((check) => check.status === "fresh").length,
    stale: allChecks.filter((check) => check.status === "stale").length,
    missing: allChecks.filter((check) => check.status === "missing").length,
    blocked: allChecks.filter((check) => check.status === "blocked").length,
    notApplicable: allChecks.filter((check) => check.status === "not-applicable").length,
    providerBackedRequired: required.filter((check) => check.sourceStatus === "provider-backed").length,
    averageFreshnessScore: round(required.reduce((sum, check) => sum + check.freshnessScore, 0) / Math.max(1, required.length)),
    refreshTasksReady: evidenceRefreshScheduler.totals.ready,
    refreshTasksBlocked: evidenceRefreshScheduler.totals.blocked
  };
  const status = gateStatus(allChecks);
  const selectedCheck = checks.find((check) => check.status === "blocked" || check.status === "missing" || check.status === "stale") ?? checks[0] ?? null;

  return {
    generatedAt: now.toISOString(),
    date,
    mode: "decision-evidence-freshness-gate",
    status,
    freshnessHash: stableHash({
      date,
      coverage: dataSourceCoverage.coverageHash,
      refresh: evidenceRefreshScheduler.refreshHash,
      checks: allChecks.map((check) => [check.id, check.status, check.freshnessScore, check.missingEnv])
    }),
    summary: summaryFor(status, totals),
    checks,
    selectedCheck,
    totals,
    policy: {
      canTrustLiveSlate: status === "fresh-enough",
      canRunReadOnlyRefresh: evidenceRefreshScheduler.policy.canRunReadOnly,
      canRunProviderDryRun: evidenceRefreshScheduler.policy.canRunDryRun,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      rule: "A required live signal must be provider-backed or explicitly refreshed before it can raise trust. Mock, missing, or stale evidence can only lower or hold trust."
    },
    proofUrls: unique([
      "/api/sports/decision/evidence-freshness-gate",
      "/api/sports/decision/data-source-coverage",
      "/api/sports/decision/evidence-refresh",
      ...dataSourceCoverage.proofUrls,
      evidenceRefreshScheduler.policy.verificationUrl
    ]),
    locks: [
      "Freshness gate is read-only and cannot write provider rows, persist decisions, train models, publish picks, stake, or call OpenAI.",
      "Missing, stale, computed, or mock evidence may downgrade trust but cannot increase public action.",
      "Provider dry-runs remain separate from write-mode ingestion and require explicit operator/admin approval before storage."
    ]
  };
}
