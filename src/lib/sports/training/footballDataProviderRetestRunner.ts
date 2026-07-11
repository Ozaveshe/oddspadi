import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { FootballDataProviderRetestContract } from "@/lib/sports/training/footballDataProviderRetestContract";
import { buildProbabilityCalibration, type ProbabilityCalibrationBucket } from "@/lib/sports/training/probabilityCalibration";

export type FootballDataProviderRetestOutcome = "home" | "draw" | "away";
export type FootballDataProviderRetestStatus =
  | "blocked-contract"
  | "no-provider-rows"
  | "missing-evidence"
  | "thin-sample"
  | "failed-market-gates"
  | "passed-shadow-retest";

export type FootballDataProviderRetestRow = {
  fixtureExternalId: string;
  kickoffAt: string;
  actualOutcome: FootballDataProviderRetestOutcome;
  modelProbabilities: Record<FootballDataProviderRetestOutcome, number>;
  marketProbabilities: Record<FootballDataProviderRetestOutcome, number>;
  odds: Record<FootballDataProviderRetestOutcome, number>;
  closingOdds?: Partial<Record<FootballDataProviderRetestOutcome, number>>;
  evidence: {
    fixtureIdentity: boolean;
    marketOdds: boolean;
    teamStrength: boolean;
    availabilityContext: boolean;
    newsWeatherContext: boolean;
    liveAndSettlement: boolean;
    featureSnapshot: boolean;
    rawPayloadLinked: boolean;
  };
};

export type FootballDataProviderRetestPick = {
  fixtureExternalId: string;
  selection: FootballDataProviderRetestOutcome;
  modelProbability: number;
  marketProbability: number;
  edge: number;
  odds: number;
  closingOdds: number | null;
  won: boolean;
  unitReturn: number;
  closingLineValue: number | null;
};

export type FootballDataProviderRetestRunner = {
  mode: "football-data-provider-retest-runner";
  generatedAt: string;
  status: FootballDataProviderRetestStatus;
  runnerHash: string;
  summary: string;
  request: {
    dryRun: true;
    selectedSegmentId: string | null;
    minEdge: number | null;
    minModelProbability: number | null;
    minHoldoutRows: number;
  };
  corpus: {
    inputRows: number;
    usableRows: number;
    rejectedRows: number;
    pickCount: number;
    evidenceCoverage: Record<keyof FootballDataProviderRetestRow["evidence"], number>;
    missingEvidence: string[];
  };
  model: {
    brierScore: number | null;
    logLoss: number | null;
    calibrationError: number | null;
    calibrationBuckets: ProbabilityCalibrationBucket[];
  };
  market: {
    brierScore: number | null;
    logLoss: number | null;
  };
  picks: {
    yield: number | null;
    roiUnits: number;
    averageEdge: number | null;
    closingLineValue: number | null;
    sample: FootballDataProviderRetestPick[];
  };
  gateResults: Array<{
    id: string;
    label: string;
    status: "pass" | "block";
    detail: string;
  }>;
  controls: {
    canInspectReadOnly: true;
    canWriteProviderRows: false;
    canPersistBacktestMemory: false;
    canPromoteToShadow: boolean;
    canApplyThresholds: false;
    canPublishPicks: false;
    canStake: false;
  };
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  locks: string[];
  proofUrls: string[];
};

const EVIDENCE_KEYS = [
  "fixtureIdentity",
  "marketOdds",
  "teamStrength",
  "availabilityContext",
  "newsWeatherContext",
  "liveAndSettlement",
  "featureSnapshot",
  "rawPayloadLinked"
] as const;
const REQUIRED_EVIDENCE_KEYS = EVIDENCE_KEYS.filter((key) => key !== "newsWeatherContext");

function round(value: number | null | undefined, digits = 6): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function metricBrier(probabilities: Record<FootballDataProviderRetestOutcome, number>, actual: FootballDataProviderRetestOutcome): number {
  return (
    ((probabilities.home - (actual === "home" ? 1 : 0)) ** 2 +
      (probabilities.draw - (actual === "draw" ? 1 : 0)) ** 2 +
      (probabilities.away - (actual === "away" ? 1 : 0)) ** 2) /
    3
  );
}

function metricLogLoss(probabilities: Record<FootballDataProviderRetestOutcome, number>, actual: FootballDataProviderRetestOutcome): number {
  return -Math.log(clamp(probabilities[actual], 0.000001, 0.999999));
}

function validProbabilities(probabilities: Record<FootballDataProviderRetestOutcome, number>): boolean {
  const values = [probabilities.home, probabilities.draw, probabilities.away];
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) && total > 0.96 && total < 1.04;
}

function rowHasRequiredEvidence(row: FootballDataProviderRetestRow): boolean {
  return (
    row.evidence.fixtureIdentity &&
    row.evidence.marketOdds &&
    row.evidence.teamStrength &&
    row.evidence.availabilityContext &&
    row.evidence.liveAndSettlement &&
    row.evidence.featureSnapshot &&
    row.evidence.rawPayloadLinked
  );
}

function selectPick({
  row,
  minEdge,
  minModelProbability
}: {
  row: FootballDataProviderRetestRow;
  minEdge: number;
  minModelProbability: number;
}): FootballDataProviderRetestPick | null {
  const candidate = (["home", "draw", "away"] as const)
    .map((selection) => {
      const modelProbability = row.modelProbabilities[selection];
      const marketProbability = row.marketProbabilities[selection];
      return {
        selection,
        modelProbability,
        marketProbability,
        edge: modelProbability - marketProbability,
        odds: row.odds[selection],
        closingOdds: row.closingOdds?.[selection] ?? null
      };
    })
    .filter((pick) => pick.edge >= minEdge && pick.modelProbability >= minModelProbability && pick.odds > 1)
    .sort((a, b) => b.edge - a.edge || b.modelProbability - a.modelProbability)[0];

  if (!candidate) return null;
  const won = row.actualOutcome === candidate.selection;
  const unitReturn = won ? candidate.odds - 1 : -1;
  const closingLineValue = candidate.closingOdds && candidate.closingOdds > 1 ? candidate.odds / candidate.closingOdds - 1 : null;

  return {
    fixtureExternalId: row.fixtureExternalId,
    selection: candidate.selection,
    modelProbability: round(candidate.modelProbability) ?? candidate.modelProbability,
    marketProbability: round(candidate.marketProbability) ?? candidate.marketProbability,
    edge: round(candidate.edge) ?? candidate.edge,
    odds: round(candidate.odds, 4) ?? candidate.odds,
    closingOdds: round(candidate.closingOdds, 4),
    won,
    unitReturn: round(unitReturn) ?? unitReturn,
    closingLineValue: round(closingLineValue)
  };
}

function gate(status: "pass" | "block", id: string, label: string, detail: string): FootballDataProviderRetestRunner["gateResults"][number] {
  return { id, label, status, detail };
}

function statusFromGates({
  contract,
  rows,
  usableRows,
  evidenceMissing,
  gates
}: {
  contract: FootballDataProviderRetestContract;
  rows: FootballDataProviderRetestRow[];
  usableRows: number;
  evidenceMissing: string[];
  gates: FootballDataProviderRetestRunner["gateResults"];
}): FootballDataProviderRetestStatus {
  if (!contract.controls.canQueueProviderRetest) return "blocked-contract";
  if (!rows.length) return "no-provider-rows";
  if (evidenceMissing.length || usableRows < rows.length) return "missing-evidence";
  if (usableRows < contract.segment.minHoldoutRows) return "thin-sample";
  if (gates.some((item) => item.status === "block")) return "failed-market-gates";
  return "passed-shadow-retest";
}

function summaryFor(status: FootballDataProviderRetestStatus, pickCount: number): string {
  if (status === "passed-shadow-retest") return `Provider-enriched retest passed all shadow gates with ${pickCount} qualifying pick(s); live/public actions remain locked.`;
  if (status === "failed-market-gates") return "Provider-enriched rows were available, but model metrics did not beat the no-vig market gates.";
  if (status === "thin-sample") return "Provider-enriched rows exist, but the holdout sample is too thin for market-learning promotion.";
  if (status === "missing-evidence") return "Provider rows are missing required pre-match evidence, raw payload links, or settlement proof.";
  if (status === "no-provider-rows") return "No provider-enriched retest rows were supplied yet; ingest fixtures, odds, context, features, and outcomes first.";
  return "The market-learning contract is not ready to queue a provider-enriched retest.";
}

function nextAction(status: FootballDataProviderRetestStatus): FootballDataProviderRetestRunner["nextAction"] {
  const verifyUrl = "/api/sports/decision/training/football-data-provider-retest-runner?seasonFrom=2016&seasonTo=2025&maxSeasons=10&trainRatio=0.7&minPickCount=75&dryRun=1";
  return {
    label:
      status === "passed-shadow-retest"
        ? "Store read-back proof before shadow promotion"
        : status === "failed-market-gates"
          ? "Keep market prior dominant"
          : status === "blocked-contract"
            ? "Clear provider retest contract"
            : "Ingest provider-enriched retest rows",
    command: decisionCurlCommand(verifyUrl),
    verifyUrl,
    expectedEvidence:
      status === "passed-shadow-retest"
        ? "Persisted op_backtest_runs, op_calibration_runs, and op_shadow_memory_replay receipts can be read back before promotion gates consume them."
        : "Provider-enriched rows cover fixture identity, odds, team strength, availability, context, feature snapshots, raw payloads, and settlement."
  };
}

export function runFootballDataProviderRetest({
  contract,
  rows = [],
  now = new Date()
}: {
  contract: FootballDataProviderRetestContract;
  rows?: FootballDataProviderRetestRow[];
  now?: Date;
}): FootballDataProviderRetestRunner {
  const minEdge = contract.segment.minEdge ?? Number.POSITIVE_INFINITY;
  const minModelProbability = contract.segment.minModelProbability ?? Number.POSITIVE_INFINITY;
  const usableRows = rows.filter(
    (row) =>
      rowHasRequiredEvidence(row) &&
      validProbabilities(row.modelProbabilities) &&
      validProbabilities(row.marketProbabilities) &&
      ["home", "draw", "away"].includes(row.actualOutcome)
  );
  const rejectedRows = rows.length - usableRows.length;
  const evidenceCoverage = Object.fromEntries(
    EVIDENCE_KEYS.map((key) => [key, rows.filter((row) => row.evidence[key]).length])
  ) as FootballDataProviderRetestRunner["corpus"]["evidenceCoverage"];
  const missingEvidence = REQUIRED_EVIDENCE_KEYS.filter((key) => evidenceCoverage[key] < rows.length).map((key) =>
    key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
  );
  const modelBriers = usableRows.map((row) => metricBrier(row.modelProbabilities, row.actualOutcome));
  const modelLosses = usableRows.map((row) => metricLogLoss(row.modelProbabilities, row.actualOutcome));
  const marketBriers = usableRows.map((row) => metricBrier(row.marketProbabilities, row.actualOutcome));
  const marketLosses = usableRows.map((row) => metricLogLoss(row.marketProbabilities, row.actualOutcome));
  const picks = usableRows.flatMap((row) => {
    const pick = selectPick({ row, minEdge, minModelProbability });
    return pick ? [pick] : [];
  });
  const roiUnits = picks.reduce((sum, pick) => sum + pick.unitReturn, 0);
  const modelBrierScore = round(average(modelBriers));
  const modelLogLoss = round(average(modelLosses));
  const marketBrierScore = round(average(marketBriers));
  const marketLogLoss = round(average(marketLosses));
  const yieldValue = round(picks.length ? roiUnits / picks.length : null);
  const averageEdge = round(average(picks.map((pick) => pick.edge)));
  const closingLineValue = round(average(picks.map((pick) => pick.closingLineValue).filter((value): value is number => value !== null)));
  const calibration = buildProbabilityCalibration(
    usableRows.flatMap((row) =>
      (["home", "draw", "away"] as const).map((selection) => ({
        probability: row.modelProbabilities[selection],
        occurred: row.actualOutcome === selection
      }))
    )
  );
  const calibrationError = calibration.expectedCalibrationError;
  const gates = [
    gate(usableRows.length >= contract.segment.minHoldoutRows ? "pass" : "block", "sample-size", "Holdout sample", `${usableRows.length}/${contract.segment.minHoldoutRows} usable provider-enriched row(s).`),
    gate(
      modelBrierScore !== null && marketBrierScore !== null && modelBrierScore < marketBrierScore ? "pass" : "block",
      "brier-score",
      "Brier beats market",
      `Model ${modelBrierScore ?? "N/A"} vs market ${marketBrierScore ?? "N/A"}.`
    ),
    gate(
      modelLogLoss !== null && marketLogLoss !== null && modelLogLoss < marketLogLoss ? "pass" : "block",
      "log-loss",
      "Log-loss beats market",
      `Model ${modelLogLoss ?? "N/A"} vs market ${marketLogLoss ?? "N/A"}.`
    ),
    gate(closingLineValue !== null && closingLineValue > 0 ? "pass" : "block", "closing-line-value", "Positive CLV", `Average CLV ${closingLineValue ?? "N/A"}.`),
    gate(yieldValue !== null && yieldValue > 0 ? "pass" : "block", "yield", "Positive yield", `Yield ${yieldValue ?? "N/A"} across ${picks.length} pick(s).`),
    gate(calibrationError !== null && calibrationError <= 0.08 ? "pass" : "block", "calibration-error", "Calibration error", `ECE ${calibrationError ?? "N/A"}; threshold 0.08.`),
    gate(picks.length > 0 && averageEdge !== null && averageEdge >= minEdge ? "pass" : "block", "market-disagreement", "Market disagreement audit", `Average selected edge ${averageEdge ?? "N/A"}; minimum ${contract.segment.minEdge ?? "N/A"}.`)
  ];
  const status = statusFromGates({ contract, rows, usableRows: usableRows.length, evidenceMissing: missingEvidence, gates });

  return {
    mode: "football-data-provider-retest-runner",
    generatedAt: now.toISOString(),
    status,
    runnerHash: stableHash({
      status,
      contract: [contract.contractHash, contract.segment.selectedId, contract.segment.minEdge, contract.segment.minModelProbability],
      corpus: [rows.length, usableRows.length, picks.length],
      metrics: [modelBrierScore, marketBrierScore, modelLogLoss, marketLogLoss, yieldValue, closingLineValue, calibrationError],
      gates: gates.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status, picks.length),
    request: {
      dryRun: true,
      selectedSegmentId: contract.segment.selectedId,
      minEdge: contract.segment.minEdge,
      minModelProbability: contract.segment.minModelProbability,
      minHoldoutRows: contract.segment.minHoldoutRows
    },
    corpus: {
      inputRows: rows.length,
      usableRows: usableRows.length,
      rejectedRows,
      pickCount: picks.length,
      evidenceCoverage,
      missingEvidence
    },
    model: {
      brierScore: modelBrierScore,
      logLoss: modelLogLoss,
      calibrationError,
      calibrationBuckets: calibration.buckets
    },
    market: {
      brierScore: marketBrierScore,
      logLoss: marketLogLoss
    },
    picks: {
      yield: yieldValue,
      roiUnits: round(roiUnits) ?? 0,
      averageEdge,
      closingLineValue,
      sample: picks.slice(0, 12)
    },
    gateResults: gates,
    controls: {
      canInspectReadOnly: true,
      canWriteProviderRows: false,
      canPersistBacktestMemory: false,
      canPromoteToShadow: status === "passed-shadow-retest",
      canApplyThresholds: false,
      canPublishPicks: false,
      canStake: false
    },
    nextAction: nextAction(status),
    locks: [
      "Provider retest runner is read-only and cannot write provider rows, persist backtest memory, apply thresholds, publish picks, or stake.",
      "A passed runner only makes the segment eligible for shadow promotion review; live/public gates remain separate.",
      "Rows without raw payload links, pre-match evidence timestamps, feature snapshots, or settlement proof are rejected.",
      "The no-vig market stays dominant unless model Brier and log-loss both beat market consensus."
    ],
    proofUrls: [
      "/api/sports/decision/training/football-data-provider-retest-runner",
      "/api/sports/decision/training/football-data-provider-retest-contract",
      "/api/sports/decision/training/football-data-market-learning-roadmap",
      "/api/sports/decision/supabase-schema-manifest",
      "/api/sports/decision/learning-promotion-gate"
    ]
  };
}
