import { hasAnyConfiguredEnv } from "@/lib/env";
import type { DecisionEplProviderFixtureMap } from "@/lib/sports/prediction/decisionEplProviderFixtureMap";
import type { DecisionOddsIntelligenceProof } from "@/lib/sports/prediction/decisionOddsIntelligenceProof";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

type EnvMap = Record<string, string | undefined>;

export type DecisionEplOddsMarketMapStatus =
  | "waiting-odds-key"
  | "waiting-fixture-provider"
  | "ready-odds-dry-run"
  | "waiting-storage-proof"
  | "mapped-shadow"
  | "blocked";

export type DecisionEplOddsMarketMapRowStatus = "needs-odds-key" | "needs-fixture-provider" | "ready-market-dry-run" | "needs-storage" | "mapped-shadow";

export type DecisionEplOddsMarketTemplate = {
  id: "h2h" | "spreads" | "totals" | "double-chance" | "draw-no-bet";
  label: string;
  source: "the-odds-api" | "derived-alternative";
  providerMarketKey: "h2h" | "spreads" | "totals" | null;
  status: "required" | "coverage-watch" | "derived";
  selections: string[];
  useInValueEdge: boolean;
  note: string;
};

export type DecisionEplOddsMarketMapRow = {
  id: string;
  fixtureId: string;
  date: string;
  match: string;
  status: DecisionEplOddsMarketMapRowStatus;
  sportKey: string;
  eventSearchKey: string;
  oddsEndpointPath: string;
  regions: string[];
  markets: string[];
  snapshotPlan: Array<{
    id: "opening" | "pre-kickoff" | "closing";
    label: string;
    required: boolean;
    storageTable: "op_odds_snapshots";
    nextAction: string;
  }>;
  valueEdgePlan: {
    rawImpliedProbability: "1 / decimalOdds";
    noVigProbability: "rawImpliedProbability / sum(rawImpliedProbability for market)";
    bookmakerMargin: "sum(rawImpliedProbability for market) - 1";
    edge: "modelProbability - noVigProbability";
    expectedValue: "modelProbability * decimalOdds - 1";
    minEdge: number;
    minExpectedValue: number;
    maxBookmakerMargin: number;
  };
  storageTargets: string[];
  missing: string[];
  nextAction: string;
};

export type DecisionEplOddsMarketMap = {
  generatedAt: string;
  date: string;
  sport: "football";
  mode: "decision-epl-odds-market-map";
  status: DecisionEplOddsMarketMapStatus;
  mapHash: string;
  summary: string;
  source: {
    provider: "the-odds-api";
    sportKey: string;
    docsUrl: string;
    supportedStandardMarkets: string[];
    coverageNote: string;
  };
  totals: {
    fixtures: number;
    readyMarketDryRun: number;
    needsOddsKey: number;
    needsFixtureProvider: number;
    needsStorage: number;
    mappedShadow: number;
    requiredSnapshots: number;
  };
  marketTemplates: DecisionEplOddsMarketTemplate[];
  rows: DecisionEplOddsMarketMapRow[];
  selectedRow: DecisionEplOddsMarketMapRow | null;
  proofLink: {
    oddsIntelligenceProofHash: string;
    currentPositiveValue: number;
    currentWatch: number;
    currentAverageMargin: number | null;
  };
  dryRunPlan: {
    command: string | null;
    verifyUrl: string;
    requiresOddsKey: true;
    writes: false;
    marketsParam: string;
    regionsParam: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRequestOddsDryRun: boolean;
    canWriteOddsSnapshots: false;
    canPersistDecisions: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
};

const ODDS_API_DOCS_URL = "https://the-odds-api.com/liveapi/guides/v4/";

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function hasAny(env: EnvMap, keys: string[]): boolean {
  return hasAnyConfiguredEnv(env, keys);
}

function marketTemplates(): DecisionEplOddsMarketTemplate[] {
  return [
    {
      id: "h2h",
      label: "1X2 moneyline",
      source: "the-odds-api",
      providerMarketKey: "h2h",
      status: "required",
      selections: ["home", "draw", "away"],
      useInValueEdge: true,
      note: "Primary EPL market for model-vs-market comparison."
    },
    {
      id: "spreads",
      label: "Asian/handicap spread",
      source: "the-odds-api",
      providerMarketKey: "spreads",
      status: "coverage-watch",
      selections: ["home handicap", "away handicap"],
      useInValueEdge: true,
      note: "Provider documentation lists spreads, but availability can vary by sport/bookmaker."
    },
    {
      id: "totals",
      label: "Goals over/under",
      source: "the-odds-api",
      providerMarketKey: "totals",
      status: "coverage-watch",
      selections: ["over", "under"],
      useInValueEdge: true,
      note: "Use for expected-goals total checks when the market is returned."
    },
    {
      id: "double-chance",
      label: "Double chance",
      source: "derived-alternative",
      providerMarketKey: null,
      status: "derived",
      selections: ["1X", "12", "X2"],
      useInValueEdge: false,
      note: "Safer-alternative explanation derived from 1X2 probabilities unless a provider-specific market is available."
    },
    {
      id: "draw-no-bet",
      label: "Draw no bet",
      source: "derived-alternative",
      providerMarketKey: null,
      status: "derived",
      selections: ["home DNB", "away DNB"],
      useInValueEdge: false,
      note: "Safer-alternative explanation derived from 1X2 probabilities unless a provider-specific market is available."
    }
  ];
}

function statusFor({
  oddsReady,
  fixtureProviderReady,
  storageReady
}: {
  oddsReady: boolean;
  fixtureProviderReady: boolean;
  storageReady: boolean;
}): DecisionEplOddsMarketMapStatus {
  if (!oddsReady) return "waiting-odds-key";
  if (!fixtureProviderReady) return "waiting-fixture-provider";
  if (!storageReady) return "ready-odds-dry-run";
  return "mapped-shadow";
}

function rowStatus({
  oddsReady,
  fixtureProviderReady,
  storageReady
}: {
  oddsReady: boolean;
  fixtureProviderReady: boolean;
  storageReady: boolean;
}): DecisionEplOddsMarketMapRowStatus {
  if (!oddsReady) return "needs-odds-key";
  if (!fixtureProviderReady) return "needs-fixture-provider";
  if (!storageReady) return "ready-market-dry-run";
  return "mapped-shadow";
}

function summaryFor(status: DecisionEplOddsMarketMapStatus, totals: DecisionEplOddsMarketMap["totals"]): string {
  if (status === "waiting-odds-key") return "EPL odds market map is waiting for THE_ODDS_API_KEY or ODDS_API_KEY.";
  if (status === "waiting-fixture-provider") return "EPL odds market map needs provider fixture mapping before bookmaker event IDs can be trusted.";
  if (status === "ready-odds-dry-run") return `EPL odds market map is ready to dry-run ${totals.fixtures} opening fixture market lookups with writes locked.`;
  if (status === "waiting-storage-proof") return "EPL odds market map has provider odds access but is waiting for storage proof.";
  if (status === "mapped-shadow") return "EPL odds market map is shadow-mapped and waiting for operator storage review before snapshots can be written.";
  return "EPL odds market map is blocked by unsafe provider, fixture, or storage state.";
}

export function buildDecisionEplOddsMarketMap({
  fixtureMap,
  oddsIntelligenceProof,
  env = process.env,
  now = new Date()
}: {
  fixtureMap: DecisionEplProviderFixtureMap;
  oddsIntelligenceProof: DecisionOddsIntelligenceProof;
  env?: EnvMap;
  now?: Date;
}): DecisionEplOddsMarketMap {
  const oddsReady = hasAny(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]);
  const sportKey = env.ODDS_API_FOOTBALL_SPORT_KEY?.trim() || fixtureMap.selectedRow?.oddsLookup.sportKey || "soccer_epl";
  const regions = ["uk", "eu"];
  const markets = ["h2h", "spreads", "totals"];
  const fixtureProviderReady =
    fixtureMap.status === "ready-admin-dry-run" ||
    fixtureMap.status === "waiting-storage-proof" ||
    fixtureMap.status === "waiting-provider-proof";
  const storageReady = fixtureMap.controls.canUseProviderProofForStorageReview;
  const templates = marketTemplates();
  const rows = fixtureMap.rows.map((fixture): DecisionEplOddsMarketMapRow => {
    const status = rowStatus({ oddsReady, fixtureProviderReady, storageReady });
    const missing = unique([
      ...(oddsReady ? [] : ["THE_ODDS_API_KEY or ODDS_API_KEY"]),
      ...(fixtureProviderReady ? [] : ["provider fixture map"]),
      ...(storageReady ? [] : ["OddsPadi op_odds_snapshots storage proof"]),
      "opening odds snapshot",
      "pre-kickoff odds snapshot",
      "closing odds snapshot"
    ]);
    return {
      id: `odds-${fixture.id}`,
      fixtureId: fixture.id,
      date: fixture.date,
      match: fixture.match,
      status,
      sportKey,
      eventSearchKey: fixture.oddsLookup.eventKey,
      oddsEndpointPath: `/v4/sports/${sportKey}/odds?regions=${regions.join(",")}&markets=${markets.join(",")}&oddsFormat=decimal&dateFormat=iso`,
      regions,
      markets,
      snapshotPlan: [
        {
          id: "opening",
          label: "Opening price",
          required: true,
          storageTable: "op_odds_snapshots",
          nextAction: "Store the first returned bookmaker price with source timestamp and event ID."
        },
        {
          id: "pre-kickoff",
          label: "Pre-kickoff price",
          required: true,
          storageTable: "op_odds_snapshots",
          nextAction: "Refresh close to kickoff after lineups, injuries, weather, and news gates update."
        },
        {
          id: "closing",
          label: "Closing price",
          required: true,
          storageTable: "op_odds_snapshots",
          nextAction: "Store final observed price for CLV and settlement calibration."
        }
      ],
      valueEdgePlan: {
        rawImpliedProbability: "1 / decimalOdds",
        noVigProbability: "rawImpliedProbability / sum(rawImpliedProbability for market)",
        bookmakerMargin: "sum(rawImpliedProbability for market) - 1",
        edge: "modelProbability - noVigProbability",
        expectedValue: "modelProbability * decimalOdds - 1",
        minEdge: 0.03,
        minExpectedValue: 0.02,
        maxBookmakerMargin: 0.08
      },
      storageTargets: ["op_odds_snapshots", "op_provider_ingestion_runs", "op_raw_provider_payloads", "op_training_feature_snapshots"],
      missing,
      nextAction:
        status === "needs-odds-key"
          ? "Configure THE_ODDS_API_KEY or ODDS_API_KEY before odds market dry-runs."
          : status === "needs-fixture-provider"
            ? "Prove provider fixture mapping before trusting bookmaker event matches."
            : status === "ready-market-dry-run"
              ? "Run read-only odds lookup, match bookmaker events to official EPL fixture names, and keep snapshots out of storage."
              : status === "needs-storage"
                ? "Prove op_odds_snapshots storage before writing bookmaker snapshots."
                : "Keep odds mapped shadow-only until operator storage review approves writes."
    };
  });
  const totals = {
    fixtures: rows.length,
    readyMarketDryRun: rows.filter((row) => row.status === "ready-market-dry-run").length,
    needsOddsKey: rows.filter((row) => row.status === "needs-odds-key").length,
    needsFixtureProvider: rows.filter((row) => row.status === "needs-fixture-provider").length,
    needsStorage: rows.filter((row) => row.status === "needs-storage").length,
    mappedShadow: rows.filter((row) => row.status === "mapped-shadow").length,
    requiredSnapshots: rows.reduce((sum, row) => sum + row.snapshotPlan.filter((snapshot) => snapshot.required).length, 0)
  };
  const status = statusFor({ oddsReady, fixtureProviderReady, storageReady });
  const selectedRow = rows.find((row) => row.status === "ready-market-dry-run") ?? rows[0] ?? null;
  const verifyUrl = `/api/sports/decision/epl-odds-market-map?date=${encodeURIComponent(fixtureMap.date)}`;
  const mapHash = stableHash({
    date: fixtureMap.date,
    fixtureMap: fixtureMap.mapHash,
    oddsProof: oddsIntelligenceProof.proofHash,
    status,
    totals,
    rows: rows.map((row) => [row.fixtureId, row.status, row.sportKey, row.markets, row.missing])
  });

  return {
    generatedAt: now.toISOString(),
    date: fixtureMap.date,
    sport: "football",
    mode: "decision-epl-odds-market-map",
    status,
    mapHash,
    summary: summaryFor(status, totals),
    source: {
      provider: "the-odds-api",
      sportKey,
      docsUrl: ODDS_API_DOCS_URL,
      supportedStandardMarkets: ["h2h", "spreads", "totals", "outrights"],
      coverageNote: "Use h2h as required for EPL 1X2; spreads and totals are requested as coverage-watch markets because availability varies by sport and bookmaker."
    },
    totals,
    marketTemplates: templates,
    rows,
    selectedRow,
    proofLink: {
      oddsIntelligenceProofHash: oddsIntelligenceProof.proofHash,
      currentPositiveValue: oddsIntelligenceProof.totals.positiveValue,
      currentWatch: oddsIntelligenceProof.totals.watch,
      currentAverageMargin: oddsIntelligenceProof.totals.averageMargin
    },
    dryRunPlan: {
      command: oddsReady ? decisionCurlCommand(verifyUrl) : null,
      verifyUrl,
      requiresOddsKey: true,
      writes: false,
      marketsParam: markets.join(","),
      regionsParam: regions.join(",")
    },
    controls: {
      canInspectReadOnly: true,
      canRequestOddsDryRun: status === "ready-odds-dry-run",
      canWriteOddsSnapshots: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/epl-odds-market-map",
      "/api/sports/decision/epl-provider-fixture-map",
      "/api/sports/decision/odds-intelligence-proof",
      "/api/sports/decision/market-audit-matrix",
      ...fixtureMap.proofUrls,
      ...oddsIntelligenceProof.proofUrls
    ]),
    locks: unique([
      "EPL odds market map is read-only and cannot write odds snapshots, decisions, or training rows.",
      "No-vig probability, bookmaker margin, edge, and EV can be calculated only after real decimal odds are returned.",
      "Positive EV cannot publish or stake without provider freshness, context gates, storage proof, backtests, and operator approval.",
      "Double chance and draw-no-bet stay derived safer alternatives unless a provider-specific market is proven.",
      ...fixtureMap.locks,
      ...oddsIntelligenceProof.locks
    ])
  };
}
