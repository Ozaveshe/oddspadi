import type { DecisionDataSourceCoverage, DecisionDataSourceCoverageCell } from "@/lib/sports/prediction/decisionDataSourceCoverage";
import type { DecisionEplOddsDryRunReceipt } from "@/lib/sports/prediction/decisionEplOddsDryRunReceipt";
import type { DecisionEplPreKickoffRehearsal } from "@/lib/sports/prediction/decisionEplPreKickoffRehearsal";
import type { DecisionEplProviderDryRunReceipt } from "@/lib/sports/prediction/decisionEplProviderDryRunReceipt";
import type { DecisionFinalAnswerCouncil } from "@/lib/sports/prediction/decisionFinalAnswerCouncil";
import type { DecisionProviderActivationQueue } from "@/lib/sports/prediction/decisionProviderActivationQueue";
import type { DecisionProviderIngestionEvidence, DecisionProviderIngestionSignal } from "@/lib/sports/prediction/decisionProviderIngestionEvidence";
import type { DecisionDataSignalCategory, Sport } from "@/lib/sports/types";
import type { TrainingCorpusProof } from "@/lib/sports/training/trainingCorpusProof";
import type { TrainingReadiness } from "@/lib/sports/training/trainingReadiness";

export type DecisionProviderEvidenceLedgerStatus = "evidence-ready" | "dry-run-ready" | "needs-keys" | "blocked";
export type DecisionProviderEvidenceFeedStatus =
  | "provider-backed"
  | "dry-run-ready"
  | "needs-env"
  | "needs-storage-proof"
  | "missing"
  | "watch"
  | "blocked";

export type DecisionProviderEvidenceFeed = {
  id: string;
  label: string;
  category: DecisionDataSignalCategory | "ten-year-history" | "backtests";
  status: DecisionProviderEvidenceFeedStatus;
  provider: string;
  requiredEnv: string[];
  storageTables: string[];
  currentEvidence: string;
  nextProof: string;
  verifyUrl: string;
  decisionImpact: string;
  modelImpact: string;
  counts: {
    providerBackedSignals: number;
    computedSignals: number;
    mockSignals: number;
    missingSignals: number;
    dryRunObservedRows: number;
    trainingRows: number;
    oddsSnapshots: number;
    backtestRuns: number;
  };
};

export type DecisionProviderEvidenceLedger = {
  mode: "decision-provider-evidence-ledger";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionProviderEvidenceLedgerStatus;
  ledgerHash: string;
  summary: string;
  totals: {
    feeds: number;
    providerBacked: number;
    dryRunReady: number;
    needsEnv: number;
    needsStorageProof: number;
    missing: number;
    watch: number;
    blocked: number;
  };
  firstBlockingFeed: DecisionProviderEvidenceFeed | null;
  feeds: DecisionProviderEvidenceFeed[];
  epl2026: {
    tracked: boolean;
    season: string;
    startDate: string;
    fixtures: number;
    providerDryRunStatus: DecisionEplProviderDryRunReceipt["status"];
    oddsDryRunStatus: DecisionEplOddsDryRunReceipt["status"];
  };
  finalAnswerGate: {
    status: DecisionFinalAnswerCouncil["status"];
    action: DecisionFinalAnswerCouncil["finalPublicAction"];
    canPublish: false;
    canStake: false;
    canUpgradePublicAction: false;
    reason: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrain: false;
    canPublish: false;
    canStake: false;
    canUpgradePublicAction: false;
  };
  locks: string[];
  proofUrls: string[];
};

const FEED_ORDER: Array<DecisionDataSignalCategory | "ten-year-history" | "backtests"> = [
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
  "ten-year-history",
  "backtests"
];

const LABELS: Record<DecisionDataSignalCategory | "ten-year-history" | "backtests", string> = {
  fixtures: "Fixtures for the day",
  "historical-results": "Team/player historical results",
  standings: "League standings",
  "home-away": "Home/away performance",
  "recent-form": "Recent form",
  injuries: "Injuries",
  suspensions: "Suspensions",
  lineups: "Lineups when available",
  odds: "Bookmaker odds",
  "live-scores": "Live scores",
  "match-events": "Match events",
  news: "News signals",
  weather: "Weather for football",
  training: "Training corpus",
  "ten-year-history": "10-year historical corpus",
  backtests: "Backtests and settlement learning"
};

const MODEL_IMPACT: Record<DecisionDataSignalCategory | "ten-year-history" | "backtests", string> = {
  fixtures: "Anchors the slate, kickoff windows, provider event IDs, and market matching.",
  "historical-results": "Feeds Poisson priors, Elo updates, form windows, player history, and calibration labels.",
  standings: "Adds competition-strength and table-pressure context before confidence can rise.",
  "home-away": "Turns home advantage into team, venue, or surface-specific evidence.",
  "recent-form": "Weights short-horizon momentum while keeping stale or mock form from lifting trust.",
  injuries: "Adjusts expected goals, efficiency, or hold/break assumptions when key players are unavailable.",
  suspensions: "Blocks neutral treatment of known availability losses.",
  lineups: "Downgrades picks when starters, formations, rotations, or participants contradict the base model.",
  odds: "Unlocks no-vig probability, value edge, expected value, market movement, and closing-line validation.",
  "live-scores": "Supports in-play recalculation and prevents pre-match assumptions from surviving live-state changes.",
  "match-events": "Adds goals, cards, substitutions, injuries, pace, and event replay for live decisions and learning.",
  news: "Gives the AI reviewer source-grounded context while blocking unsupported team-news claims.",
  weather: "Adjusts football totals, tempo, and risk when outdoor conditions matter.",
  training: "Keeps training and learned-weight claims locked until real corpus proof exists.",
  "ten-year-history": "Creates the real historical spine needed for model calibration instead of demo rows.",
  backtests: "Proves ROI, Brier/log-loss, CLV, settlement behavior, and learned threshold safety before trust upgrades."
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

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function footballCell(coverage: DecisionDataSourceCoverage, category: DecisionDataSignalCategory): DecisionDataSourceCoverageCell | undefined {
  return coverage.cells.find((cell) => cell.sport === "football" && cell.category === category);
}

function signalFor(evidence: DecisionProviderIngestionEvidence, category: DecisionDataSignalCategory): DecisionProviderIngestionSignal | undefined {
  return evidence.providerSignals.find((signal) => signal.category === category);
}

function dryRunObservedRows(category: DecisionDataSignalCategory, providerReceipt: DecisionEplProviderDryRunReceipt, oddsReceipt: DecisionEplOddsDryRunReceipt): number {
  if (category === "odds") return oddsReceipt.observation.normalizedOddsRows;
  if (category === "fixtures" || category === "historical-results") return providerReceipt.observation.counts.fixtures;
  if (category === "standings") return providerReceipt.observation.counts.standings;
  if (category === "injuries" || category === "suspensions") return providerReceipt.observation.counts.availability;
  if (category === "lineups") return providerReceipt.observation.counts.lineups;
  if (category === "news") return providerReceipt.observation.counts.news;
  if (category === "weather") return providerReceipt.observation.counts.weather;
  if (category === "live-scores" || category === "match-events") return providerReceipt.observation.counts.events;
  if (category === "home-away" || category === "recent-form") return providerReceipt.observation.counts.featureRows;
  return 0;
}

function feedStatus({
  cell,
  signal,
  observedRows
}: {
  cell: DecisionDataSourceCoverageCell | undefined;
  signal: DecisionProviderIngestionSignal | undefined;
  observedRows: number;
}): DecisionProviderEvidenceFeedStatus {
  if (observedRows > 0 || cell?.status === "provider-backed") return "provider-backed";
  if (signal?.status === "blocked") return "blocked";
  if (signal?.status === "needs-supabase-proof") return "needs-storage-proof";
  if (signal?.status === "needs-env") return "needs-env";
  if (signal?.status === "ready") return "dry-run-ready";
  if (cell?.status === "computed") return "watch";
  if (cell?.status === "mock" || cell?.status === "missing") return "missing";
  if (cell?.status === "not-applicable") return "watch";
  return "missing";
}

function feedForCategory({
  category,
  coverage,
  providerIngestionEvidence,
  providerReceipt,
  oddsReceipt
}: {
  category: DecisionDataSignalCategory;
  coverage: DecisionDataSourceCoverage;
  providerIngestionEvidence: DecisionProviderIngestionEvidence;
  providerReceipt: DecisionEplProviderDryRunReceipt;
  oddsReceipt: DecisionEplOddsDryRunReceipt;
}): DecisionProviderEvidenceFeed {
  const cell = footballCell(coverage, category);
  const signal = signalFor(providerIngestionEvidence, category);
  const observedRows = dryRunObservedRows(category, providerReceipt, oddsReceipt);
  const status = feedStatus({ cell, signal, observedRows });

  return {
    id: category,
    label: LABELS[category],
    category,
    status,
    provider: signal?.provider ?? cell?.provider ?? "Provider not selected",
    requiredEnv: unique([...(signal?.missingEnv ?? []), ...(cell?.missingEnv ?? [])]),
    storageTables: unique([...(signal?.storageTables ?? []), ...(cell?.storageTables ?? [])]),
    currentEvidence: `coverage:${cell?.status ?? "missing"} provider:${signal?.status ?? "not-attached"} dryRunRows:${observedRows}`,
    nextProof: signal?.expectedEvidence ?? cell?.nextAction ?? "Attach provider evidence and storage proof before this feed can influence trust.",
    verifyUrl: signal?.verifyUrl ?? cell?.proofUrl ?? "/api/sports/decision/provider-evidence-ledger",
    decisionImpact: signal?.decisionImpact ?? cell?.requirement ?? "Required evidence for decision safety.",
    modelImpact: MODEL_IMPACT[category],
    counts: {
      providerBackedSignals: cell?.evidence.providerBacked ?? 0,
      computedSignals: cell?.evidence.computed ?? 0,
      mockSignals: cell?.evidence.mock ?? 0,
      missingSignals: cell?.evidence.missing ?? 0,
      dryRunObservedRows: observedRows,
      trainingRows: cell?.evidence.realTrainingRows ?? 0,
      oddsSnapshots: cell?.evidence.realOddsSnapshots ?? 0,
      backtestRuns: 0
    }
  };
}

function historicalFeed(trainingCorpusProof: TrainingCorpusProof, trainingReadiness: TrainingReadiness): DecisionProviderEvidenceFeed {
  const trainingRows = trainingCorpusProof.totals.realFinishedFixtures;
  const oddsSnapshots = trainingCorpusProof.totals.realOddsSnapshots;
  const status: DecisionProviderEvidenceFeedStatus =
    trainingRows > 0 && oddsSnapshots > 0
      ? "provider-backed"
      : trainingCorpusProof.status === "blocked-supabase" || trainingReadiness.status === "blocked"
        ? "needs-storage-proof"
        : trainingCorpusProof.controls.canRunProviderDryRun || trainingReadiness.controls.canRunBackfillDryRun
          ? "dry-run-ready"
          : "missing";

  return {
    id: "ten-year-history",
    label: LABELS["ten-year-history"],
    category: "ten-year-history",
    status,
    provider: "OddsPadi Supabase op_ corpus",
    requiredEnv: unique([...(trainingCorpusProof.nextProof.missingEnv ?? []), ...(trainingReadiness.nextSafeCommand.missingEnv ?? [])]),
    storageTables: ["op_fixtures", "op_odds_snapshots", "op_training_feature_snapshots", "op_raw_provider_payloads"],
    currentEvidence: `fixtures:${trainingRows}/${trainingCorpusProof.targets.minimumFixturesPerSport} odds:${oddsSnapshots} features:${trainingCorpusProof.totals.featureSnapshots}`,
    nextProof: trainingReadiness.nextSafeCommand.expectedEvidence || trainingCorpusProof.nextProof.expectedEvidence,
    verifyUrl: trainingReadiness.nextSafeCommand.verifyUrl || "/api/sports/decision/training/corpus-proof",
    decisionImpact: "Real history must exist before learned weights, confidence upgrades, or training claims can affect the public answer.",
    modelImpact: MODEL_IMPACT["ten-year-history"],
    counts: {
      providerBackedSignals: trainingRows > 0 ? 1 : 0,
      computedSignals: 0,
      mockSignals: 0,
      missingSignals: trainingRows > 0 ? 0 : 1,
      dryRunObservedRows: 0,
      trainingRows,
      oddsSnapshots,
      backtestRuns: trainingCorpusProof.totals.backtestRuns
    }
  };
}

function backtestFeed(trainingCorpusProof: TrainingCorpusProof, trainingReadiness: TrainingReadiness): DecisionProviderEvidenceFeed {
  const backtestRuns = trainingCorpusProof.totals.backtestRuns;
  const status: DecisionProviderEvidenceFeedStatus =
    backtestRuns > 0
      ? "provider-backed"
      : trainingCorpusProof.status === "blocked-supabase" || trainingReadiness.status === "blocked"
        ? "needs-storage-proof"
        : trainingReadiness.controls.canRunBackfillDryRun
          ? "dry-run-ready"
          : "missing";

  return {
    id: "backtests",
    label: LABELS.backtests,
    category: "backtests",
    status,
    provider: "OddsPadi backtest runner",
    requiredEnv: unique([...(trainingCorpusProof.nextProof.missingEnv ?? []), ...(trainingReadiness.nextSafeCommand.missingEnv ?? [])]),
    storageTables: ["op_backtest_runs", "op_training_feature_snapshots", "op_odds_snapshots"],
    currentEvidence: `backtests:${backtestRuns} fixtureDeficit:${trainingReadiness.totals.fixtureDeficit} oddsDeficit:${trainingReadiness.totals.oddsDeficit}`,
    nextProof: trainingReadiness.nextSafeCommand.expectedEvidence || "Run a real-data backtest after historical fixtures, features, and odds are present.",
    verifyUrl: trainingReadiness.nextSafeCommand.verifyUrl || "/api/sports/decision/training/readiness",
    decisionImpact: "Backtests decide whether model probabilities are calibrated enough to graduate from monitor-only to trusted recommendations.",
    modelImpact: MODEL_IMPACT.backtests,
    counts: {
      providerBackedSignals: backtestRuns > 0 ? 1 : 0,
      computedSignals: 0,
      mockSignals: 0,
      missingSignals: backtestRuns > 0 ? 0 : 1,
      dryRunObservedRows: 0,
      trainingRows: trainingCorpusProof.totals.realFinishedFixtures,
      oddsSnapshots: trainingCorpusProof.totals.realOddsSnapshots,
      backtestRuns
    }
  };
}

function statusFor(totals: DecisionProviderEvidenceLedger["totals"]): DecisionProviderEvidenceLedgerStatus {
  if (totals.blocked || totals.needsStorageProof || totals.missing) return "blocked";
  if (totals.needsEnv) return "needs-keys";
  if (totals.dryRunReady || totals.watch) return "dry-run-ready";
  return "evidence-ready";
}

function summaryFor(status: DecisionProviderEvidenceLedgerStatus, totals: DecisionProviderEvidenceLedger["totals"]): string {
  if (status === "evidence-ready") return `All ${totals.feeds} provider evidence feeds are backed by observed rows or storage proof.`;
  if (status === "dry-run-ready") return `${totals.dryRunReady} feed(s) can move through read-only dry-runs, but publish, staking, training, and write modes remain locked.`;
  if (status === "needs-keys") return `${totals.needsEnv} feed(s) need provider or admin environment keys before real dry-runs can prove coverage.`;
  return `${totals.missing + totals.needsStorageProof + totals.blocked} feed(s) still block a trusted final answer because storage, provider rows, or backtests are not proven.`;
}

export function buildDecisionProviderEvidenceLedger({
  date,
  sport,
  dataSourceCoverage,
  providerIngestionEvidence,
  providerActivationQueue,
  eplPreKickoffRehearsal,
  eplProviderDryRunReceipt,
  eplOddsDryRunReceipt,
  trainingCorpusProof,
  trainingReadiness,
  finalAnswerCouncil,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  dataSourceCoverage: DecisionDataSourceCoverage;
  providerIngestionEvidence: DecisionProviderIngestionEvidence;
  providerActivationQueue: DecisionProviderActivationQueue;
  eplPreKickoffRehearsal: DecisionEplPreKickoffRehearsal;
  eplProviderDryRunReceipt: DecisionEplProviderDryRunReceipt;
  eplOddsDryRunReceipt: DecisionEplOddsDryRunReceipt;
  trainingCorpusProof: TrainingCorpusProof;
  trainingReadiness: TrainingReadiness;
  finalAnswerCouncil: DecisionFinalAnswerCouncil;
  now?: Date;
}): DecisionProviderEvidenceLedger {
  const feeds = FEED_ORDER.map((category) => {
    if (category === "ten-year-history") return historicalFeed(trainingCorpusProof, trainingReadiness);
    if (category === "backtests") return backtestFeed(trainingCorpusProof, trainingReadiness);
    return feedForCategory({
      category,
      coverage: dataSourceCoverage,
      providerIngestionEvidence,
      providerReceipt: eplProviderDryRunReceipt,
      oddsReceipt: eplOddsDryRunReceipt
    });
  });
  const totals = {
    feeds: feeds.length,
    providerBacked: feeds.filter((feed) => feed.status === "provider-backed").length,
    dryRunReady: feeds.filter((feed) => feed.status === "dry-run-ready").length,
    needsEnv: feeds.filter((feed) => feed.status === "needs-env").length,
    needsStorageProof: feeds.filter((feed) => feed.status === "needs-storage-proof").length,
    missing: feeds.filter((feed) => feed.status === "missing").length,
    watch: feeds.filter((feed) => feed.status === "watch").length,
    blocked: feeds.filter((feed) => feed.status === "blocked").length
  };
  const status = statusFor(totals);
  const firstBlockingFeed =
    feeds.find((feed) => ["blocked", "needs-storage-proof", "missing", "needs-env"].includes(feed.status)) ??
    feeds.find((feed) => feed.status === "dry-run-ready") ??
    null;
  const canRunProviderDryRun =
    providerActivationQueue.controls.canRunDryRun ||
    providerIngestionEvidence.controls.canRunProviderDryRun ||
    eplPreKickoffRehearsal.controls.canRunFixtureDryRun ||
    eplPreKickoffRehearsal.controls.canRunOddsDryRun;
  const ledgerHash = stableHash({
    date,
    sport,
    status,
    feeds: feeds.map((feed) => [feed.id, feed.status, feed.currentEvidence]),
    providerQueue: providerActivationQueue.queueHash,
    finalAnswerCouncil: finalAnswerCouncil.councilHash
  });

  return {
    mode: "decision-provider-evidence-ledger",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    ledgerHash,
    summary: summaryFor(status, totals),
    totals,
    firstBlockingFeed,
    feeds,
    epl2026: {
      tracked: true,
      season: eplPreKickoffRehearsal.season.season,
      startDate: eplPreKickoffRehearsal.season.seasonStartDate,
      fixtures: eplPreKickoffRehearsal.totals.openingFixtures,
      providerDryRunStatus: eplProviderDryRunReceipt.status,
      oddsDryRunStatus: eplOddsDryRunReceipt.status
    },
    finalAnswerGate: {
      status: finalAnswerCouncil.status,
      action: finalAnswerCouncil.finalPublicAction,
      canPublish: false,
      canStake: false,
      canUpgradePublicAction: false,
      reason:
        status === "evidence-ready"
          ? "Provider evidence can support monitor review, but final council controls still decide public action."
          : firstBlockingFeed
            ? `${firstBlockingFeed.label} blocks trust: ${firstBlockingFeed.nextProof}`
            : finalAnswerCouncil.summary
    },
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrain: false,
      canPublish: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    locks: unique([
      "Provider evidence ledger is read-only and cannot write provider rows, persist decisions, train models, publish picks, stake, or upgrade public action.",
      "Fixtures, odds, context, historical rows, and backtests must be source-stamped before the model can treat them as trust evidence.",
      "Dry-run readiness is not evidence of stored rows; observed counts and Supabase schema proof must be reviewed before write mode.",
      "EPL 2026/27 fixtures stay tracked as mutable until kickoff changes, TV moves, provider event IDs, and odds markets are proven.",
      ...providerActivationQueue.locks,
      ...finalAnswerCouncil.locks
    ]),
    proofUrls: unique([
      "/api/sports/decision/provider-evidence-ledger",
      "/api/sports/decision/provider-activation-queue",
      "/api/sports/decision/provider-ingestion-evidence",
      "/api/sports/decision/epl-provider-dry-run-receipt",
      "/api/sports/decision/epl-odds-dry-run-receipt",
      "/api/sports/decision/epl-pre-kickoff-rehearsal",
      "/api/sports/decision/training/corpus-proof",
      "/api/sports/decision/training/readiness",
      "/api/sports/decision/final-answer-council",
      ...providerIngestionEvidence.proofUrls,
      ...trainingCorpusProof.proofUrls,
      ...trainingReadiness.proofUrls
    ])
  };
}
