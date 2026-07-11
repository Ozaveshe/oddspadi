import type { FootballProviderLiveActivationReceipt } from "@/lib/sports/training/footballProviderLiveActivationReceipt";
import type { FootballProviderLiveAIReviewReceipt } from "@/lib/sports/training/footballProviderLiveAIReviewReceipt";
import type { FootballProviderLiveBriefingPacket } from "@/lib/sports/training/footballProviderLiveBriefingPacket";

export type FootballProviderLiveDecisionCycleStatus =
  | "waiting-provider-data"
  | "waiting-openai-key"
  | "ready-for-ai-review"
  | "ai-reviewed-monitor"
  | "safe-hold";

export type FootballProviderLiveDecisionCycleReceipt = {
  mode: "football-provider-live-decision-cycle";
  generatedAt: string;
  status: FootballProviderLiveDecisionCycleStatus;
  cycleHash: string;
  summary: string;
  target: FootballProviderLiveActivationReceipt["target"];
  progress: {
    readinessScore: number;
    readyGates: number;
    totalGates: number;
    label: string;
  };
  stages: {
    providerData: {
      status: FootballProviderLiveActivationReceipt["status"];
      source: FootballProviderLiveActivationReceipt["runtime"]["source"];
      provider: string;
      ready: boolean;
      missing: string[];
    };
    modelMarket: {
      ready: boolean;
      watchlistStatus: FootballProviderLiveActivationReceipt["pipeline"]["watchlist"]["status"];
      monitorCandidates: number;
      topSelection: string | null;
    };
    storageEvidence: {
      ready: boolean;
      status: FootballProviderLiveActivationReceipt["pipeline"]["storage"]["status"];
      readbackChecked: boolean;
      matchedRows: number;
      evidenceReady: boolean;
    };
    briefing: {
      ready: boolean;
      status: FootballProviderLiveBriefingPacket["status"];
      evidenceItems: number;
      blockEvidence: number;
    };
    aiCritique: {
      status: FootballProviderLiveAIReviewReceipt["status"];
      provider: FootballProviderLiveAIReviewReceipt["provider"];
      ready: boolean;
      reviewed: boolean;
      latestReason: string | null;
    };
    safeAction: {
      action: "avoid" | "monitor";
      publicPickAllowed: false;
      trainAllowed: false;
      publishAllowed: false;
      stakeAllowed: false;
    };
  };
  thinkingTrace: Array<{
    id: string;
    label: string;
    status: "pass" | "watch" | "block";
    note: string;
    proofUrl: string;
  }>;
  risks: string[];
  nextActions: Array<{
    label: string;
    verifyUrl: string;
    expectedEvidence: string;
  }>;
  controls: {
    canInspectReadOnly: true;
    canUseForMonitor: boolean;
    canRequestAIReview: boolean;
    canWriteLiveFeatureSnapshots: boolean;
    canTrainModels: false;
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

function unique(values: Array<string | null | undefined>, limit = 14): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function pct(ready: number, total: number): number {
  return total > 0 ? Math.round((ready / total) * 100) : 0;
}

function evidenceStatus(ready: boolean, watch = false): "pass" | "watch" | "block" {
  if (ready) return "pass";
  return watch ? "watch" : "block";
}

function statusFor({
  activation,
  aiReview
}: {
  activation: FootballProviderLiveActivationReceipt;
  aiReview: FootballProviderLiveAIReviewReceipt;
}): FootballProviderLiveDecisionCycleStatus {
  if (activation.status !== "provider-monitor-ready") return "waiting-provider-data";
  if (aiReview.status === "missing-key") return "waiting-openai-key";
  if (aiReview.status === "reviewed") return "ai-reviewed-monitor";
  if (aiReview.status === "not-requested" || aiReview.status === "ready-to-run") return "ready-for-ai-review";
  return "safe-hold";
}

function summaryFor(status: FootballProviderLiveDecisionCycleStatus, activation: FootballProviderLiveActivationReceipt, aiReview: FootballProviderLiveAIReviewReceipt): string {
  if (status === "ai-reviewed-monitor") return "Live decision cycle has provider-backed evidence and a bounded AI critique; action remains monitor-only.";
  if (status === "ready-for-ai-review") return "Live decision cycle has provider-backed monitor evidence and is ready for explicit AI review.";
  if (status === "waiting-openai-key") return "Live decision cycle has provider evidence but is waiting for a server-side OpenAI key.";
  if (status === "safe-hold") return `Live decision cycle is holding safely because AI review is ${aiReview.status}.`;
  return `Live decision cycle is waiting for provider data: ${activation.readiness.missing.join(", ") || activation.status}.`;
}

function nextActionsFor({
  activation,
  aiReview
}: {
  activation: FootballProviderLiveActivationReceipt;
  aiReview: FootballProviderLiveAIReviewReceipt;
}): FootballProviderLiveDecisionCycleReceipt["nextActions"] {
  const actions: FootballProviderLiveDecisionCycleReceipt["nextActions"] = [];
  if (activation.status !== "provider-monitor-ready") {
    actions.push(activation.nextAction);
  }
  if (activation.status === "provider-monitor-ready" && aiReview.status === "not-requested") {
    actions.push({
      label: "Run bounded live AI critique",
      verifyUrl: "/api/sports/decision/training/football-provider-live-ai-review?date=2026-08-21&run=1",
      expectedEvidence: "AI review returns strict JSON with evidence IDs, same-or-safer action, and no publish, stake, train, or persistence permissions."
    });
  }
  if (aiReview.status === "missing-key") {
    actions.push({
      label: "Load server-side OpenAI key",
      verifyUrl: "/api/sports/decision/training/football-provider-live-ai-review?date=2026-08-21",
      expectedEvidence: "OpenAI gate changes from missing-key to not-requested or ready-to-run without exposing the key."
    });
  }
  if (!actions.length) {
    actions.push({
      label: "Keep monitoring evidence freshness",
      verifyUrl: "/api/sports/decision/training/football-provider-live-decision-cycle?date=2026-08-21",
      expectedEvidence: "Cycle remains monitor-only while provider evidence, odds, briefing, and AI critique stay current."
    });
  }
  return actions.slice(0, 4);
}

export function buildFootballProviderLiveDecisionCycleReceipt({
  activation,
  briefing,
  aiReview,
  now = new Date()
}: {
  activation: FootballProviderLiveActivationReceipt;
  briefing: FootballProviderLiveBriefingPacket;
  aiReview: FootballProviderLiveAIReviewReceipt;
  now?: Date;
}): FootballProviderLiveDecisionCycleReceipt {
  const providerReady = activation.readiness.providerKeysReady && activation.readiness.providerProofReady && activation.readiness.oddsReady;
  const storageReady = activation.readiness.storagePreviewReady;
  const storageReadbackReady = activation.readiness.storageReadbackReady;
  const watchlistReady = activation.readiness.watchlistReady;
  const briefingReady = activation.readiness.briefingReady;
  const aiReady = aiReview.controls.canRequestOpenAI || aiReview.status === "reviewed";
  const reviewed = aiReview.status === "reviewed";
  const gates = [providerReady, storageReady, storageReadbackReady, watchlistReady, briefingReady, aiReady, reviewed];
  const readyGates = gates.filter(Boolean).length;
  const readinessScore = pct(readyGates, gates.length);
  const status = statusFor({ activation, aiReview });
  const safeAction = aiReview.appliedReview.recommendedAction ?? activation.target.action;
  const risks = unique(
    [
      ...activation.readiness.missing,
      ...briefing.publicBriefing.riskCase,
      ...aiReview.appliedReview.riskFlags,
      ...aiReview.appliedReview.dataGaps,
      "Public picks, staking, training, and persistence remain locked until settlement and production governance gates clear."
    ],
    10
  );
  const thinkingTrace = [
    {
      id: "observe-provider",
      label: "Observe provider data",
      status: evidenceStatus(providerReady),
      note: providerReady ? `Provider-backed ${activation.runtime.providerLabel} evidence is available.` : activation.summary,
      proofUrl: "/api/sports/decision/training/football-provider-live-activation"
    },
    {
      id: "read-stored-evidence",
      label: "Read stored evidence",
      status: evidenceStatus(storageReadbackReady, storageReady),
      note: storageReadbackReady
        ? `Read back ${activation.pipeline.storage.readbackRows} stored live monitor row(s).`
        : `Storage readback is ${activation.pipeline.storage.readbackChecked ? "checked" : "not checked"}; stored evidence ready ${activation.pipeline.storage.readbackEvidenceReady}.`,
      proofUrl: "/api/sports/decision/training/football-provider-live-feature-storage-receipt"
    },
    {
      id: "estimate-probability",
      label: "Estimate probability",
      status: evidenceStatus(watchlistReady, activation.pipeline.watchlist.candidates > 0),
      note: watchlistReady
        ? `${activation.pipeline.watchlist.monitorCandidates} monitor candidate(s); top selection ${activation.pipeline.watchlist.topSelection}.`
        : "Model-vs-market ranking is not ready for a positive-EV monitor candidate.",
      proofUrl: "/api/sports/decision/training/football-provider-live-watchlist"
    },
    {
      id: "explain-risks",
      label: "Explain risks",
      status: evidenceStatus(briefingReady),
      note: briefing.summary,
      proofUrl: "/api/sports/decision/training/football-provider-live-briefing-packet"
    },
    {
      id: "critique-with-ai",
      label: "Critique with AI",
      status: reviewed ? "pass" : aiReady ? "watch" : "block",
      note: aiReview.summary,
      proofUrl: "/api/sports/decision/training/football-provider-live-ai-review"
    },
    {
      id: "choose-safe-action",
      label: "Choose safe action",
      status: safeAction === "monitor" && activation.status === "provider-monitor-ready" ? "pass" : "block",
      note: `Action is ${safeAction}; public pick allowed ${activation.target.publicPickAllowed}.`,
      proofUrl: "/api/sports/decision/training/football-provider-live-decision-cycle"
    }
  ] satisfies FootballProviderLiveDecisionCycleReceipt["thinkingTrace"];

  return {
    mode: "football-provider-live-decision-cycle",
    generatedAt: now.toISOString(),
    status,
    cycleHash: stableHash({
      status,
      activation: activation.activationHash,
      briefing: briefing.packetHash,
      aiReview: aiReview.reviewHash,
      readinessScore,
      safeAction
    }),
    summary: summaryFor(status, activation, aiReview),
    target: activation.target,
    progress: {
      readinessScore,
      readyGates,
      totalGates: gates.length,
      label: `${readinessScore}% live decision-cycle ready`
    },
    stages: {
      providerData: {
        status: activation.status,
        source: activation.runtime.source,
        provider: activation.runtime.providerLabel,
        ready: providerReady,
        missing: activation.readiness.missing
      },
      modelMarket: {
        ready: watchlistReady,
        watchlistStatus: activation.pipeline.watchlist.status,
        monitorCandidates: activation.pipeline.watchlist.monitorCandidates,
        topSelection: activation.pipeline.watchlist.topSelection
      },
      storageEvidence: {
        ready: storageReadbackReady,
        status: activation.pipeline.storage.status,
        readbackChecked: activation.pipeline.storage.readbackChecked,
        matchedRows: activation.pipeline.storage.readbackRows,
        evidenceReady: activation.pipeline.storage.readbackEvidenceReady
      },
      briefing: {
        ready: briefingReady,
        status: briefing.status,
        evidenceItems: briefing.evidence.items.length,
        blockEvidence: briefing.evidence.block
      },
      aiCritique: {
        status: aiReview.status,
        provider: aiReview.provider,
        ready: aiReady,
        reviewed,
        latestReason: aiReview.latestRun.reason
      },
      safeAction: {
        action: safeAction,
        publicPickAllowed: false,
        trainAllowed: false,
        publishAllowed: false,
        stakeAllowed: false
      }
    },
    thinkingTrace,
    risks,
    nextActions: nextActionsFor({ activation, aiReview }),
    controls: {
      canInspectReadOnly: true,
      canUseForMonitor: activation.controls.canUseForMonitor && (aiReview.status === "reviewed" || aiReview.status === "not-requested" || aiReview.status === "ready-to-run"),
      canRequestAIReview: aiReview.controls.canRequestOpenAI,
      canWriteLiveFeatureSnapshots: activation.controls.canWriteLiveFeatureSnapshots,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: unique(
      [
        "Live decision cycle is advisory and monitor-only.",
        "No public pick, stake, model training, trust upgrade, or persistence is allowed from this cycle.",
        "Settlement labels and production governance are required before learning or publishing.",
        ...activation.locks,
        ...aiReview.locks
      ],
      12
    ),
    proofUrls: unique([
      "/api/sports/decision/training/football-provider-live-decision-cycle",
      "/api/sports/decision/training/football-provider-live-activation",
      "/api/sports/decision/training/football-provider-live-ai-review",
      "/api/sports/decision/training/football-provider-live-watchlist",
      "/api/sports/decision/training/football-provider-live-briefing-packet",
      ...activation.proofUrls,
      ...aiReview.proofUrls
    ])
  };
}
