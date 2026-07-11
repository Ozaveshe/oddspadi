import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { MultiSportBacktestRun } from "@/lib/sports/training/multiSportBacktestRun";
import type { MultiSportModelGovernance } from "@/lib/sports/training/multiSportModelGovernance";
import type { PublicHistoricalTrainingEvidence } from "@/lib/sports/training/publicHistoricalTrainingEvidence";

export type PublicHistoryBacktestBridgeStatus =
  | "provider-retest-ready"
  | "diagnostic-shadow-ready"
  | "market-prior-dominant"
  | "storage-blocked"
  | "insufficient-history"
  | "failed";

export type PublicHistoryBacktestBridge = {
  mode: "public-history-backtest-bridge";
  generatedAt: string;
  status: PublicHistoryBacktestBridgeStatus;
  bridgeHash: string;
  summary: string;
  sport: "football";
  source: PublicHistoricalTrainingEvidence["source"];
  evidence: {
    diagnosticScore: number;
    seasonsLoaded: number;
    fixtures: number;
    oddsRows: number;
    benchmarkRows: number;
    benchmarkVerdict: PublicHistoricalTrainingEvidence["scorecard"]["benchmarkVerdict"];
    walkForwardAction: PublicHistoricalTrainingEvidence["scorecard"]["walkForwardAction"];
    aiEvidenceValue: PublicHistoricalTrainingEvidence["contribution"]["aiEvidenceValue"];
  };
  storageBridge: {
    multiSportBacktestStatus: MultiSportBacktestRun["status"];
    footballJobStatus: string | null;
    footballStorageStatus: string | null;
    canRunStoredBacktest: boolean;
    canStoreBacktestRows: boolean;
    reason: string;
  };
  governanceBridge: {
    multiSportGovernanceStatus: MultiSportModelGovernance["status"];
    footballGovernanceStatus: string | null;
    canRaiseToShadowCandidate: boolean;
    canUseAsAiEvidence: boolean;
    canSatisfyStoredBacktestGate: false;
    reason: string;
  };
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canUseAsAiEvidence: boolean;
    canRunProviderRetest: boolean;
    canRunStoredBacktest: boolean;
    canPersistTrainingRows: false;
    canPersistBacktestRun: false;
    canApplyLearnedWeights: false;
    canPromoteLiveProbabilities: false;
    canPublishPicks: false;
    canStake: false;
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

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function statusFor({
  publicEvidence,
  multiSportBacktest
}: {
  publicEvidence: PublicHistoricalTrainingEvidence;
  multiSportBacktest: MultiSportBacktestRun;
}): PublicHistoryBacktestBridgeStatus {
  if (publicEvidence.status === "failed") return "failed";
  if (publicEvidence.status === "insufficient-history") return "insufficient-history";
  if (publicEvidence.status === "market-prior-dominant") return "market-prior-dominant";
  if (publicEvidence.status === "provider-retest-ready") return "provider-retest-ready";
  if (multiSportBacktest.status === "blocked-storage") return "storage-blocked";
  return "diagnostic-shadow-ready";
}

function summaryFor(status: PublicHistoryBacktestBridgeStatus, evidence: PublicHistoricalTrainingEvidence): string {
  if (status === "provider-retest-ready") return "Public EPL historical evidence is strong enough to queue provider-enriched retest planning, but stored training and public picks remain locked.";
  if (status === "diagnostic-shadow-ready") return "Public EPL historical evidence can inform AI diagnosis as shadow evidence while stored backtests remain the authority gate.";
  if (status === "market-prior-dominant") return "Public EPL historical evidence says market prior still dominates the current model, so answer promotion must stay blocked.";
  if (status === "storage-blocked") return "Public EPL evidence is usable for diagnostics, but Supabase storage blocks stored backtests and model governance.";
  if (status === "insufficient-history") return "Public EPL evidence is not strong enough to guide training or provider retests.";
  return evidence.summary;
}

function nextActionFor({
  status,
  publicEvidence,
  multiSportBacktest
}: {
  status: PublicHistoryBacktestBridgeStatus;
  publicEvidence: PublicHistoricalTrainingEvidence;
  multiSportBacktest: MultiSportBacktestRun;
}): PublicHistoryBacktestBridge["nextAction"] {
  if (status === "storage-blocked") {
    const verifyUrl = "/api/sports/decision/supabase-credential-activation";
    return {
      label: "Fix Supabase server credential proof",
      command: decisionCurlCommand(verifyUrl),
      verifyUrl,
      expectedEvidence: "OddsPadi Supabase server credential proof passes, then the multi-sport stored backtest runner can move beyond blocked-storage."
    };
  }
  if (status === "provider-retest-ready") {
    const verifyUrl = "/api/sports/decision/training/football-data-provider-retest-contract?seasonFrom=2016&seasonTo=2025&dryRun=1";
    return {
      label: "Prepare provider-enriched retest contract",
      command: decisionCurlCommand(verifyUrl),
      verifyUrl,
      expectedEvidence: "Provider feature rows are mapped into a retest contract before any shadow promotion is considered."
    };
  }
  if (status === "market-prior-dominant") {
    const verifyUrl = "/api/sports/decision/training/football-data-market-learning-roadmap?seasonFrom=2016&seasonTo=2025&dryRun=1";
    return {
      label: "Keep market-prior roadmap active",
      command: decisionCurlCommand(verifyUrl),
      verifyUrl,
      expectedEvidence: "The roadmap identifies which segment or provider evidence must improve before the model can challenge market prior."
    };
  }
  if (multiSportBacktest.controls.canRunBacktests) {
    return {
      label: "Run stored football backtest after admin confirmation",
      command: decisionCurlCommand("/api/sports/decision/training/multi-sport-backtest-run?sport=football&run=1&minSample=30&limit=5000"),
      verifyUrl: "/api/sports/decision/training/multi-sport-backtest-run?sport=football&run=1&minSample=30&limit=5000",
      expectedEvidence: "A server-side stored backtest attempt returns stored/no-data/failure evidence without changing public picks."
    };
  }
  return publicEvidence.nextAction;
}

export function buildPublicHistoryBacktestBridge({
  publicEvidence,
  multiSportBacktest,
  multiSportGovernance,
  now = new Date()
}: {
  publicEvidence: PublicHistoricalTrainingEvidence;
  multiSportBacktest: MultiSportBacktestRun;
  multiSportGovernance: MultiSportModelGovernance;
  now?: Date;
}): PublicHistoryBacktestBridge {
  const footballJob = multiSportBacktest.jobs.find((job) => job.sport === "football");
  const footballGovernance = multiSportGovernance.sports.find((sport) => sport.sport === "football");
  const status = statusFor({ publicEvidence, multiSportBacktest });
  const canUseAsAiEvidence = publicEvidence.controls.canUseAsAiEvidence && status !== "failed" && status !== "insufficient-history";
  const canRunProviderRetest = status === "provider-retest-ready";
  const nextAction = nextActionFor({ status, publicEvidence, multiSportBacktest });

  return {
    mode: "public-history-backtest-bridge",
    generatedAt: now.toISOString(),
    status,
    bridgeHash: stableHash({
      status,
      publicEvidence: [publicEvidence.status, publicEvidence.diagnosticScore, publicEvidence.scorecard.benchmarkVerdict],
      backtest: [multiSportBacktest.status, footballJob?.status, footballJob?.storageStatus],
      governance: [multiSportGovernance.status, footballGovernance?.status]
    }),
    summary: summaryFor(status, publicEvidence),
    sport: "football",
    source: publicEvidence.source,
    evidence: {
      diagnosticScore: publicEvidence.diagnosticScore,
      seasonsLoaded: publicEvidence.scorecard.seasonsLoaded,
      fixtures: publicEvidence.scorecard.fixtures,
      oddsRows: publicEvidence.scorecard.oddsRows,
      benchmarkRows: publicEvidence.scorecard.benchmarkRows,
      benchmarkVerdict: publicEvidence.scorecard.benchmarkVerdict,
      walkForwardAction: publicEvidence.scorecard.walkForwardAction,
      aiEvidenceValue: publicEvidence.contribution.aiEvidenceValue
    },
    storageBridge: {
      multiSportBacktestStatus: multiSportBacktest.status,
      footballJobStatus: footballJob?.status ?? null,
      footballStorageStatus: footballJob?.storageStatus ?? null,
      canRunStoredBacktest: Boolean(footballJob && (footballJob.status === "ready" || footballJob.status === "admin-required")),
      canStoreBacktestRows: multiSportBacktest.controls.canStoreBacktestRows,
      reason:
        footballJob?.status === "storage-blocked"
          ? "Public history cannot satisfy the stored backtest gate while Supabase storage is blocked."
          : footballJob?.nextAction ?? "Inspect the multi-sport backtest runner before attempting stored evidence."
    },
    governanceBridge: {
      multiSportGovernanceStatus: multiSportGovernance.status,
      footballGovernanceStatus: footballGovernance?.status ?? null,
      canRaiseToShadowCandidate: canRunProviderRetest && footballGovernance?.status !== "blocked-storage",
      canUseAsAiEvidence,
      canSatisfyStoredBacktestGate: false,
      reason: canUseAsAiEvidence
        ? "Public history can be cited by the AI reviewer as diagnostic evidence, but it cannot pass stored-data, stored-backtest, or promotion gates."
        : "Public history is not strong enough to influence AI review even as shadow evidence."
    },
    nextAction,
    controls: {
      canInspectReadOnly: true,
      canUseAsAiEvidence,
      canRunProviderRetest,
      canRunStoredBacktest: Boolean(footballJob && footballJob.status === "ready"),
      canPersistTrainingRows: false,
      canPersistBacktestRun: false,
      canApplyLearnedWeights: false,
      canPromoteLiveProbabilities: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Public history bridge is read-only and cannot write fixtures, feature rows, backtest rows, learned weights, live probabilities, public picks, or stakes.",
      "Football-Data public CSV evidence can inform AI diagnosis only; stored provider-backed rows remain the model authority gate.",
      "If public history says market prior dominates, answer promotion must stay blocked even when a local model edge appears.",
      "Provider-enriched retests still require Supabase credential proof, official fixture IDs, odds snapshots, context signals, and admin authorization."
    ],
    proofUrls: unique([
      "/api/sports/decision/training/public-history-backtest-bridge",
      "/api/sports/decision/training/public-historical-training-evidence",
      "/api/sports/decision/training/multi-sport-backtest-run",
      "/api/sports/decision/training/multi-sport-model-governance",
      ...publicEvidence.proofUrls,
      ...multiSportBacktest.proofUrls,
      ...multiSportGovernance.proofUrls
    ])
  };
}
