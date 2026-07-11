import { calculateExpectedValue, calculateValueEdge } from "@/lib/sports/prediction/odds";
import type { FootballProviderLiveFeatureMaterializerReceipt } from "@/lib/sports/training/footballProviderLiveFeatureMaterializer";

type Outcome = "home" | "draw" | "away";
type CandidateAction = "monitor" | "avoid";

export type FootballProviderLiveWatchlistStatus = "watchlist-ready" | "no-live-rows" | "no-positive-edge" | "blocked-evidence";

export type FootballProviderLiveWatchlistCandidate = {
  rank: number;
  fixtureExternalId: string;
  matchLabel: string;
  league: string;
  selection: Outcome;
  selectionLabel: string;
  action: CandidateAction;
  modelProbability: number;
  marketProbability: number;
  edge: number;
  expectedValue: number;
  fairOdds: number | null;
  decimalOdds: number;
  bookmakerMargin: number | null;
  confidence: "low" | "medium" | "high";
  whyModelFavorsIt: string[];
  risks: string[];
  saferAlternatives: Array<{
    market: "double_chance" | "draw_no_bet" | "over_under" | "both_teams_to_score";
    label: string;
    availableInMvp: boolean;
    rationale: string;
  }>;
  publicPickAllowed: false;
};

export type FootballProviderLiveWatchlistReceipt = {
  mode: "football-provider-live-watchlist";
  generatedAt: string;
  status: FootballProviderLiveWatchlistStatus;
  watchlistHash: string;
  summary: string;
  source: {
    materializerHash: string;
    targetDate: string;
    provider: string;
    modelKey: string;
    split: "live";
    sourceRows: number;
  };
  totals: {
    liveRows: number;
    selectionsRanked: number;
    monitorCandidates: number;
    avoidCandidates: number;
    positiveEdges: number;
    positiveExpectedValue: number;
  };
  candidates: FootballProviderLiveWatchlistCandidate[];
  topCandidate: FootballProviderLiveWatchlistCandidate | null;
  risks: string[];
  controls: {
    canInspectReadOnly: true;
    canRankWatchlist: boolean;
    canUseForMonitoring: boolean;
    canWriteFeatureSnapshots: false;
    canPromoteLiveProbabilities: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  nextAction: {
    label: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  locks: string[];
  proofUrls: string[];
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function boolFrom(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function round(value: number | null | undefined, digits = 6): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function textFrom(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function outcomeLabel(selection: Outcome, homeName: string, awayName: string): string {
  if (selection === "home") return homeName;
  if (selection === "away") return awayName;
  return "Draw";
}

function confidenceFor(edge: number, expectedValue: number, evidence: Record<string, unknown>, sourceKind: string | null): "low" | "medium" | "high" {
  const coreEvidence = boolFrom(evidence.fixtureIdentity) && boolFrom(evidence.marketOdds) && boolFrom(evidence.teamStrength);
  if (!coreEvidence) return "low";
  if (sourceKind !== "provider") return "low";
  if (edge >= 0.07 && expectedValue >= 0.08 && boolFrom(evidence.availabilityContext)) return "high";
  if (edge >= 0.035 && expectedValue > 0) return "medium";
  return "low";
}

function selectionReasons(selection: Outcome, edge: number, expectedValue: number, modelProbability: number, marketProbability: number): string[] {
  return [
    `Model probability ${round(modelProbability, 4)} vs no-vig market ${round(marketProbability, 4)}.`,
    `Value edge ${round(edge, 4)} and expected value ${round(expectedValue, 4)} per unit.`,
    selection === "draw" ? "Draw is only monitored when the edge survives model and market comparison." : "Side is monitored only after bookmaker margin removal."
  ];
}

function risksFor(row: Record<string, unknown>, evidence: Record<string, unknown>, sourceKind: string | null): string[] {
  const features = record(row.features);
  const contextCounts = record(features.contextCounts);
  const risks = [
    "Fixture is live/upcoming with pending settlement, so it cannot train models or publish picks.",
    "Closing odds are not available yet; market movement can erase the edge."
  ];
  if (sourceKind !== "provider" || !boolFrom(evidence.rawPayloadLinked)) risks.push("Fixture is not linked to provider raw payload proof yet.");
  if (!boolFrom(evidence.availabilityContext)) risks.push("Injuries, suspensions, and lineups are missing or not provider-proven.");
  if (!boolFrom(evidence.newsWeatherContext)) risks.push("News and weather signals are missing or not provider-proven.");
  if ((numberFrom(contextCounts.liveEvents) ?? 0) === 0) risks.push("No live event feed is attached to this row.");
  return Array.from(new Set(risks));
}

function saferAlternatives(selection: Outcome): FootballProviderLiveWatchlistCandidate["saferAlternatives"] {
  if (selection === "home") {
    return [
      { market: "draw_no_bet", label: "Home draw no bet", availableInMvp: true, rationale: "Reduces draw exposure when the model favors the home side." },
      { market: "double_chance", label: "Home or draw", availableInMvp: true, rationale: "Lower-variance alternative while provider and lineup proof are incomplete." },
      { market: "over_under", label: "Totals watch only", availableInMvp: false, rationale: "Totals need a priced over/under market and goal-line calibration before ranking." }
    ];
  }
  if (selection === "away") {
    return [
      { market: "draw_no_bet", label: "Away draw no bet", availableInMvp: true, rationale: "Reduces draw exposure when the model favors the away side." },
      { market: "double_chance", label: "Away or draw", availableInMvp: true, rationale: "Lower-variance alternative while provider and lineup proof are incomplete." },
      { market: "both_teams_to_score", label: "BTTS watch only", availableInMvp: false, rationale: "BTTS needs a priced market and team scoring calibration before ranking." }
    ];
  }
  return [
    { market: "double_chance", label: "Avoid draw, inspect double chance sides", availableInMvp: true, rationale: "Draw prices are volatile; double chance can express uncertainty with lower variance." },
    { market: "over_under", label: "Under/over watch only", availableInMvp: false, rationale: "Totals need a priced goal line before the MVP can rank them." },
    { market: "both_teams_to_score", label: "BTTS watch only", availableInMvp: false, rationale: "BTTS needs a priced market and scoring split proof before ranking." }
  ];
}

function candidateRows(materializer: FootballProviderLiveFeatureMaterializerReceipt): FootballProviderLiveWatchlistCandidate[] {
  const candidates = materializer.previewRows
    .filter((row) => row.split === "live")
    .flatMap((row) => {
      const features = record(row.features);
      const modelProbabilities = record(features.modelProbabilities);
      const marketProbabilities = record(features.marketProbabilities);
      const odds = record(features.odds);
      const evidence = record(features.evidence);
      const homeTeam = record(features.homeTeam);
      const awayTeam = record(features.awayTeam);
      const league = record(features.league);
      const dataSource = record(features.dataSource);
      const sourceKind = typeof dataSource.kind === "string" ? dataSource.kind : null;
      const homeName = textFrom(homeTeam.name, "Home");
      const awayName = textFrom(awayTeam.name, "Away");
      const matchLabel = `${homeName} vs ${awayName}`;
      const leagueName = textFrom(league.name, "Football");
      const bookmakerMargin = round(numberFrom(features.bookmakerMargin));
      const rowRisks = risksFor(row, evidence, sourceKind);

      return (["home", "draw", "away"] as const).flatMap((selection) => {
        const modelProbability = numberFrom(modelProbabilities[selection]);
        const marketProbability = numberFrom(marketProbabilities[selection]);
        const decimalOdds = numberFrom(odds[selection]);
        if (modelProbability === null || marketProbability === null || decimalOdds === null || decimalOdds <= 1) return [];

        const edge = calculateValueEdge(modelProbability, marketProbability);
        const expectedValue = calculateExpectedValue(modelProbability, decimalOdds);
        const confidence = confidenceFor(edge, expectedValue, evidence, sourceKind);
        const action: CandidateAction = edge > 0 && expectedValue > 0 ? "monitor" : "avoid";

        return [
          {
            rank: 0,
            fixtureExternalId: row.fixture_external_id,
            matchLabel,
            league: leagueName,
            selection,
            selectionLabel: outcomeLabel(selection, homeName, awayName),
            action,
            modelProbability: round(modelProbability) ?? 0,
            marketProbability: round(marketProbability) ?? 0,
            edge: round(edge) ?? 0,
            expectedValue: round(expectedValue) ?? 0,
            fairOdds: modelProbability > 0 ? round(1 / modelProbability, 4) : null,
            decimalOdds: round(decimalOdds, 4) ?? decimalOdds,
            bookmakerMargin,
            confidence,
            whyModelFavorsIt: selectionReasons(selection, edge, expectedValue, modelProbability, marketProbability),
            risks: rowRisks,
            saferAlternatives: saferAlternatives(selection),
            publicPickAllowed: false as const
          }
        ];
      });
    })
    .sort((a, b) => {
      if (b.action !== a.action) return b.action === "monitor" ? 1 : -1;
      if (b.expectedValue !== a.expectedValue) return b.expectedValue - a.expectedValue;
      if (b.edge !== a.edge) return b.edge - a.edge;
      return b.modelProbability - a.modelProbability;
    });

  return candidates.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

function statusFor(liveRows: number, candidates: FootballProviderLiveWatchlistCandidate[]): FootballProviderLiveWatchlistStatus {
  if (liveRows === 0) return "no-live-rows";
  if (candidates.some((candidate) => candidate.action === "monitor")) return "watchlist-ready";
  if (candidates.length > 0) return "no-positive-edge";
  return "blocked-evidence";
}

function summaryFor(status: FootballProviderLiveWatchlistStatus, monitorCandidates: number, liveRows: number): string {
  if (status === "watchlist-ready") return `Ranked ${monitorCandidates} monitor candidate(s) from ${liveRows} live feature row(s); public picks remain locked.`;
  if (status === "no-positive-edge") return `Ranked live feature rows, but no selection has both positive edge and positive EV.`;
  if (status === "blocked-evidence") return "Live rows exist, but evidence is too incomplete to rank priced selections.";
  return "No live feature rows are available for watchlist ranking.";
}

export function buildFootballProviderLiveWatchlistReceipt({
  materializer,
  now = new Date()
}: {
  materializer: FootballProviderLiveFeatureMaterializerReceipt;
  now?: Date;
}): FootballProviderLiveWatchlistReceipt {
  const liveRows = materializer.previewRows.filter((row) => row.split === "live").length;
  const candidates = candidateRows(materializer);
  const monitorCandidates = candidates.filter((candidate) => candidate.action === "monitor").length;
  const avoidCandidates = candidates.filter((candidate) => candidate.action === "avoid").length;
  const status = statusFor(liveRows, candidates);
  const topCandidate = candidates[0] ?? null;
  const risks = Array.from(new Set(candidates.flatMap((candidate) => candidate.risks))).slice(0, 8);

  return {
    mode: "football-provider-live-watchlist",
    generatedAt: now.toISOString(),
    status,
    watchlistHash: stableHash({
      materializerHash: materializer.materializerHash,
      status,
      candidates: candidates.map((candidate) => [
        candidate.fixtureExternalId,
        candidate.selection,
        candidate.action,
        candidate.edge,
        candidate.expectedValue
      ])
    }),
    summary: summaryFor(status, monitorCandidates, liveRows),
    source: {
      materializerHash: materializer.materializerHash,
      targetDate: materializer.request.targetDate,
      provider: materializer.provider,
      modelKey: materializer.request.modelKey,
      split: "live",
      sourceRows: materializer.previewRows.length
    },
    totals: {
      liveRows,
      selectionsRanked: candidates.length,
      monitorCandidates,
      avoidCandidates,
      positiveEdges: candidates.filter((candidate) => candidate.edge > 0).length,
      positiveExpectedValue: candidates.filter((candidate) => candidate.expectedValue > 0).length
    },
    candidates,
    topCandidate,
    risks,
    controls: {
      canInspectReadOnly: true,
      canRankWatchlist: candidates.length > 0,
      canUseForMonitoring: monitorCandidates > 0,
      canWriteFeatureSnapshots: false,
      canPromoteLiveProbabilities: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    nextAction: {
      label: monitorCandidates > 0 ? "Review monitor-only watchlist" : "Refresh odds and context",
      verifyUrl: "/api/sports/decision/training/football-provider-live-watchlist",
      expectedEvidence:
        "Rank split=live feature rows by model probability, no-vig market probability, edge, EV, risks, and safer alternatives without publishing or staking."
    },
    locks: [
      "Live watchlist candidates are monitor-only and cannot become public picks without provider-backed fixture IDs, raw payload links, odds snapshots, and operator-approved evidence.",
      "Pending fixtures cannot train models or apply learned weights until settlement labels exist.",
      "Positive EV is necessary but not sufficient; injuries, lineups, news, weather, closing odds, and market movement remain live blockers.",
      "The watchlist never writes feature snapshots, decisions, stakes, or model thresholds."
    ],
    proofUrls: [
      "/api/sports/decision/training/football-provider-live-watchlist",
      "/api/sports/decision/training/football-provider-live-feature-materializer",
      "/api/sports/decision/training/football-provider-feature-intake-gap",
      "/api/sports/decision/training/football-provider-feature-storage-receipt",
      "/api/sports/decision/training/football-data-provider-learning-activation"
    ]
  };
}
