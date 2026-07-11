import type {
  ContextSignalCategory,
  ContextSignalImpact,
  DecisionDataCoverageSignal,
  DecisionDataSignalCategory,
  DecisionDataSignalStatus,
  Match,
  MatchContextSignal,
  Prediction
} from "@/lib/sports/types";
import type { DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionContextSignalProofStatus = "ready-proof" | "needs-provider" | "blocked";
export type DecisionContextSignalCheckStatus = "pass" | "watch" | "blocked";

export type DecisionContextSignalSlateInput = {
  sport: DecisionMultiSport;
  rows: DecisionRow[];
};

export type DecisionContextSignalCategorySummary = {
  category: DecisionDataSignalCategory;
  label: string;
  totalSignals: number;
  providerBacked: number;
  computed: number;
  mock: number;
  missing: number;
  stale: number;
  notApplicable: number;
  requiredForProduction: boolean;
  readiness: DecisionContextSignalProofStatus;
  modelImpact: string;
  nextAction: string;
};

export type DecisionContextSignalShift = {
  id: string;
  sport: DecisionMultiSport;
  matchId: string;
  match: string;
  league: string;
  category: ContextSignalCategory;
  label: string;
  quality: string;
  source: string;
  impact: ContextSignalImpact;
  confidence: number;
  weight: number;
  homeShift: number;
  drawShift: number | null;
  awayShift: number;
  totalShift: number;
  dataQualityDelta: number;
  applied: boolean;
  riskFlags: string[];
  missingSignals: string[];
  detail: string;
  verifyUrl: string;
};

export type DecisionContextSignalCheck = {
  id:
    | "coverage-categories"
    | "probability-shifts"
    | "injury-news-risk"
    | "lineup-weather-live-gaps"
    | "provider-before-trust"
    | "no-action-upgrade";
  label: string;
  status: DecisionContextSignalCheckStatus;
  detail: string;
};

export type DecisionContextSignalProof = {
  mode: "context-signal-proof";
  generatedAt: string;
  date: string;
  status: DecisionContextSignalProofStatus;
  proofHash: string;
  summary: string;
  totals: {
    sports: number;
    matches: number;
    coverageSignals: number;
    providerBacked: number;
    computed: number;
    mock: number;
    missing: number;
    stale: number;
    contextSignals: number;
    appliedAdjustments: number;
    missingContextSignals: number;
    riskFlags: number;
    averageCoverageScore: number;
    maxAbsSideShift: number;
    maxAbsTotalShift: number;
  };
  categories: DecisionContextSignalCategorySummary[];
  topShifts: DecisionContextSignalShift[];
  checks: DecisionContextSignalCheck[];
  controls: {
    canInspectReadOnly: true;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canRaiseTrust: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
};

const CATEGORY_LABELS: Record<DecisionDataSignalCategory, string> = {
  fixtures: "Fixtures for the day",
  "historical-results": "Team/player historical results",
  standings: "League standings",
  "home-away": "Home/away performance",
  "recent-form": "Recent form",
  injuries: "Injuries",
  suspensions: "Suspensions",
  lineups: "Lineups",
  odds: "Bookmaker odds",
  "live-scores": "Live scores",
  "match-events": "Match events",
  news: "News signals",
  weather: "Weather",
  training: "Historical training corpus"
};

const CATEGORY_ORDER: DecisionDataSignalCategory[] = [
  "fixtures",
  "historical-results",
  "standings",
  "home-away",
  "recent-form",
  "injuries",
  "suspensions",
  "lineups",
  "odds",
  "live-scores",
  "match-events",
  "news",
  "weather",
  "training"
];

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

function statusCount(signals: DecisionDataCoverageSignal[], status: DecisionDataSignalStatus): number {
  return signals.filter((signal) => signal.status === status).length;
}

function readinessFor({ providerBacked, computed, mock, missing, stale, requiredForProduction }: {
  providerBacked: number;
  computed: number;
  mock: number;
  missing: number;
  stale: number;
  requiredForProduction: boolean;
}): DecisionContextSignalProofStatus {
  if (requiredForProduction && missing + stale > 0) return "blocked";
  if (providerBacked + computed > 0 && mock + missing + stale === 0) return "ready-proof";
  return "needs-provider";
}

function categoryModelImpact(category: DecisionDataSignalCategory): string {
  if (category === "injuries" || category === "suspensions" || category === "lineups" || category === "news") {
    return "Can move side probabilities, confidence, actionability, and avoid rules when provider-backed.";
  }
  if (category === "weather" || category === "match-events" || category === "live-scores") {
    return "Can move tempo, totals, live-state, and late abstention gates.";
  }
  if (category === "odds") return "Drives implied probability, no-vig price, value edge, EV, and market movement.";
  if (category === "training" || category === "historical-results") return "Unlocks backtests, calibration, learned guardrails, and model trust.";
  if (category === "standings" || category === "home-away" || category === "recent-form") {
    return "Shapes team/player strength, form weighting, home/away adjustment, and baseline probability.";
  }
  return "Anchors the slate and keeps every prediction tied to a real fixture.";
}

function categoryNextAction(category: DecisionDataSignalCategory, readiness: DecisionContextSignalProofStatus): string {
  if (readiness === "ready-proof") return "Keep refreshing before kickoff and verify freshness after provider updates.";
  if (category === "odds") return "Connect bookmaker provider dry-runs before trusting no-vig edge and EV.";
  if (category === "training" || category === "historical-results") return "Backfill the 10-year corpus before enabling learned guardrails.";
  if (category === "injuries" || category === "suspensions" || category === "lineups" || category === "news") {
    return "Fetch provider availability, lineup, and news signals, then rerun context adjustment.";
  }
  if (category === "weather") return "Connect venue-level weather for outdoor football and tennis tempo markets.";
  if (category === "live-scores" || category === "match-events") return "Connect live score and event feeds before in-play analysis.";
  return "Replace mock/computed coverage with provider-backed evidence before raising trust.";
}

function summarizeCategory(category: DecisionDataSignalCategory, rows: DecisionRow[]): DecisionContextSignalCategorySummary {
  const signals = rows.flatMap((row) => row.prediction.decision.dataCoverage.signals.filter((signal) => signal.category === category));
  const providerBacked = statusCount(signals, "provider-backed");
  const computed = statusCount(signals, "computed");
  const mock = statusCount(signals, "mock");
  const missing = statusCount(signals, "missing");
  const stale = statusCount(signals, "stale");
  const notApplicable = statusCount(signals, "not-applicable");
  const requiredForProduction = signals.some((signal) => signal.requiredForProduction);
  const readiness = readinessFor({ providerBacked, computed, mock, missing, stale, requiredForProduction });

  return {
    category,
    label: CATEGORY_LABELS[category],
    totalSignals: signals.length,
    providerBacked,
    computed,
    mock,
    missing,
    stale,
    notApplicable,
    requiredForProduction,
    readiness,
    modelImpact: categoryModelImpact(category),
    nextAction: categoryNextAction(category, readiness)
  };
}

function signalShiftMagnitude(signal: MatchContextSignal): number {
  return Math.abs(signal.weight * signal.confidence);
}

function topContextSignal(row: DecisionRow): MatchContextSignal | null {
  const signals = row.prediction.contextAdjustment.signals;
  if (!signals.length) return null;
  return signals.slice().sort((a, b) => {
    const magnitude = signalShiftMagnitude(b) - signalShiftMagnitude(a);
    if (magnitude !== 0) return magnitude;
    return b.confidence - a.confidence;
  })[0] ?? null;
}

function contextShift(sport: DecisionMultiSport, row: DecisionRow): DecisionContextSignalShift | null {
  const signal = topContextSignal(row);
  if (!signal) return null;
  const adjustment = row.prediction.contextAdjustment;

  return {
    id: `${sport}:${row.match.id}:${signal.id}`,
    sport,
    matchId: row.match.id,
    match: matchLabel(row.match),
    league: row.match.league.name,
    category: signal.category,
    label: signal.label,
    quality: signal.quality,
    source: signal.source,
    impact: signal.impact,
    confidence: round(signal.confidence),
    weight: round(signal.weight),
    homeShift: round(adjustment.probabilityShift.home),
    drawShift: adjustment.probabilityShift.draw === undefined ? null : round(adjustment.probabilityShift.draw),
    awayShift: round(adjustment.probabilityShift.away),
    totalShift: round(adjustment.totalShift),
    dataQualityDelta: round(adjustment.dataQualityDelta),
    applied: adjustment.applied,
    riskFlags: adjustment.riskFlags.slice(0, 3).map((item) => compact(item, 180)),
    missingSignals: adjustment.missingSignals.slice(0, 5),
    detail: compact(signal.detail, 220),
    verifyUrl: `/api/sports/decision/${encodeURIComponent(row.match.id)}`
  };
}

function proofChecks(categories: DecisionContextSignalCategorySummary[], shifts: DecisionContextSignalShift[]): DecisionContextSignalCheck[] {
  const categoryIds = new Set(categories.filter((category) => category.totalSignals > 0).map((category) => category.category));
  const requiredCategoriesPresent = CATEGORY_ORDER.every((category) => categoryIds.has(category));
  const appliedShiftCount = shifts.filter((shift) => shift.applied).length;
  const injuryNewsRows = categories.filter((category) => ["injuries", "suspensions", "lineups", "news"].includes(category.category));
  const injuryNewsBlocked = injuryNewsRows.some((category) => category.readiness === "blocked");
  const liveWeatherRows = categories.filter((category) => ["lineups", "weather", "live-scores", "match-events"].includes(category.category));
  const liveWeatherBlocked = liveWeatherRows.some((category) => category.readiness === "blocked");
  const providerBlocked = categories.some((category) => category.requiredForProduction && category.readiness === "blocked");

  return [
    {
      id: "coverage-categories",
      label: "Track requested data families",
      status: requiredCategoriesPresent ? "pass" : "blocked",
      detail: requiredCategoriesPresent
        ? "Fixtures, history, standings, home/away, form, injuries, suspensions, lineups, odds, live, events, news, weather, and training are all represented."
        : "One or more requested context/data families is missing from the proof packet."
    },
    {
      id: "probability-shifts",
      label: "Apply bounded context shifts",
      status: appliedShiftCount > 0 ? "pass" : shifts.length ? "watch" : "blocked",
      detail:
        appliedShiftCount > 0
          ? `${appliedShiftCount} match context adjustment(s) moved side, draw, or total probability before market-edge ranking.`
          : "Context signals were reviewed, but no probability adjustment was applied."
    },
    {
      id: "injury-news-risk",
      label: "Separate injuries, suspensions, lineups, and news",
      status: injuryNewsBlocked ? "watch" : "pass",
      detail: injuryNewsBlocked
        ? "Availability and news categories are tracked but still need provider proof before trust can rise."
        : "Availability and news categories are represented without a blocking provider gap."
    },
    {
      id: "lineup-weather-live-gaps",
      label: "Expose lineup, weather, live, and event gaps",
      status: liveWeatherBlocked ? "watch" : "pass",
      detail: liveWeatherBlocked
        ? "Lineup/weather/live/event gaps are visible and must be refreshed before production trust."
        : "Lineup, weather, live, and event coverage has no blocking gap for the current slate state."
    },
    {
      id: "provider-before-trust",
      label: "Keep provider proof before trust rise",
      status: providerBlocked ? "watch" : "pass",
      detail: providerBlocked
        ? "Some production-required categories are missing or stale, so the engine must hold or lower trust."
        : "Production-required categories are not blocking this proof packet."
    },
    {
      id: "no-action-upgrade",
      label: "No action upgrade from context proof",
      status: "pass",
      detail: "The context proof can explain and lower trust, but cannot publish, persist, train, raise trust, or upgrade a public action."
    }
  ];
}

function statusFor(categories: DecisionContextSignalCategorySummary[], shifts: DecisionContextSignalShift[], checks: DecisionContextSignalCheck[]): DecisionContextSignalProofStatus {
  if (!shifts.length || checks.some((check) => check.status === "blocked")) return "blocked";
  if (categories.some((category) => category.requiredForProduction && category.readiness === "blocked")) return "needs-provider";
  return "ready-proof";
}

export function buildDecisionContextSignalProof({
  date,
  slates,
  limit = 12,
  now = new Date()
}: {
  date: string;
  slates: DecisionContextSignalSlateInput[];
  limit?: number;
  now?: Date;
}): DecisionContextSignalProof {
  const rows = slates.flatMap((slate) => slate.rows.map((row) => ({ ...row, sport: slate.sport })));
  const plainRows = rows.map(({ match, prediction }) => ({ match, prediction }));
  const categories = CATEGORY_ORDER.map((category) => summarizeCategory(category, plainRows));
  const allShifts = rows
    .map((row) => contextShift(row.sport, row))
    .filter((shift): shift is DecisionContextSignalShift => Boolean(shift))
    .sort((a, b) => {
      const aMagnitude = Math.max(Math.abs(a.homeShift), Math.abs(a.awayShift), Math.abs(a.totalShift));
      const bMagnitude = Math.max(Math.abs(b.homeShift), Math.abs(b.awayShift), Math.abs(b.totalShift));
      if (bMagnitude !== aMagnitude) return bMagnitude - aMagnitude;
      return b.confidence - a.confidence;
    });
  const topShifts = allShifts.slice(0, Math.max(1, Math.min(40, limit)));
  const checks = proofChecks(categories, allShifts);
  const status = statusFor(categories, allShifts, checks);
  const coverageSignals = categories.reduce((sum, category) => sum + category.totalSignals, 0);
  const providerBacked = categories.reduce((sum, category) => sum + category.providerBacked, 0);
  const computed = categories.reduce((sum, category) => sum + category.computed, 0);
  const mock = categories.reduce((sum, category) => sum + category.mock, 0);
  const missing = categories.reduce((sum, category) => sum + category.missing, 0);
  const stale = categories.reduce((sum, category) => sum + category.stale, 0);
  const appliedAdjustments = rows.filter((row) => row.prediction.contextAdjustment.applied).length;
  const missingContextSignals = rows.reduce((sum, row) => sum + row.prediction.contextAdjustment.missingSignals.length, 0);
  const riskFlags = rows.reduce((sum, row) => sum + row.prediction.contextAdjustment.riskFlags.length, 0);
  const averageCoverageScore = rows.length
    ? round(rows.reduce((sum, row) => sum + row.prediction.decision.dataCoverage.score, 0) / rows.length, 2)
    : 0;
  const maxAbsSideShift = allShifts.length ? round(Math.max(...allShifts.map((shift) => Math.max(Math.abs(shift.homeShift), Math.abs(shift.awayShift))))) : 0;
  const maxAbsTotalShift = allShifts.length ? round(Math.max(...allShifts.map((shift) => Math.abs(shift.totalShift)))) : 0;
  const proofHash = stableHash({
    date,
    status,
    categories: categories.map((category) => [category.category, category.readiness, category.providerBacked, category.mock, category.missing]),
    shifts: topShifts.map((shift) => [shift.sport, shift.matchId, shift.category, shift.homeShift, shift.awayShift, shift.totalShift]),
    checks: checks.map((check) => [check.id, check.status])
  });

  return {
    mode: "context-signal-proof",
    generatedAt: now.toISOString(),
    date,
    status,
    proofHash,
    summary:
      status === "ready-proof"
        ? `Context proof is ready: ${appliedAdjustments} match(es) applied bounded context shifts across ${slates.length} sport(s).`
        : status === "needs-provider"
          ? `Context proof is watch-only: ${missing} missing and ${mock} mock signal(s) still block production trust.`
          : "Context proof is blocked because required context categories or adjustment rows are missing.",
    totals: {
      sports: slates.length,
      matches: rows.length,
      coverageSignals,
      providerBacked,
      computed,
      mock,
      missing,
      stale,
      contextSignals: rows.reduce((sum, row) => sum + row.prediction.contextAdjustment.signals.length, 0),
      appliedAdjustments,
      missingContextSignals,
      riskFlags,
      averageCoverageScore,
      maxAbsSideShift,
      maxAbsTotalShift
    },
    categories,
    topShifts,
    checks,
    controls: {
      canInspectReadOnly: true,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRaiseTrust: false,
      canUpgradePublicAction: false
    },
    proofUrls: ["/api/sports/decision/context-signal-proof", "/api/sports/decision/data-intake", "/api/sports/decision/signal-reliability"],
    locks: [
      "Context proof is read-only and cannot publish, persist decisions, train models, raise trust, or upgrade a public action.",
      "Provider-backed injury, suspension, lineup, news, weather, live-score, event, odds, and training evidence must be refreshed before production trust rises.",
      "Context shifts are bounded inputs to the deterministic model, not standalone betting instructions."
    ]
  };
}
