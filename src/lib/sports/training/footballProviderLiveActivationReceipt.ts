import type { FootballProviderLiveBriefingPacket } from "@/lib/sports/training/footballProviderLiveBriefingPacket";
import type { FootballProviderLiveFeatureMaterializerReceipt } from "@/lib/sports/training/footballProviderLiveFeatureMaterializer";
import type { FootballProviderLiveFeatureStorageReceipt } from "@/lib/sports/training/footballProviderLiveFeatureStorageReceipt";
import type { FootballProviderLiveRuntimeSnapshot } from "@/lib/sports/training/footballProviderLiveRuntime";
import type { FootballProviderLiveWatchlistReceipt } from "@/lib/sports/training/footballProviderLiveWatchlistReceipt";

export type FootballProviderLiveActivationStatus =
  | "provider-monitor-ready"
  | "waiting-provider-keys"
  | "waiting-provider-proof"
  | "waiting-live-odds"
  | "waiting-storage"
  | "waiting-watchlist"
  | "blocked";

export type FootballProviderLiveActivationReceipt = {
  mode: "football-provider-live-activation-receipt";
  generatedAt: string;
  status: FootballProviderLiveActivationStatus;
  activationHash: string;
  summary: string;
  target: {
    targetDate: string;
    fixtureExternalId: string | null;
    match: string | null;
    selection: string | null;
    action: "monitor" | "avoid";
    publicPickAllowed: false;
  };
  runtime: {
    source: FootballProviderLiveRuntimeSnapshot["source"];
    providerLabel: string;
    proof: FootballProviderLiveRuntimeSnapshot["proof"];
  };
  pipeline: {
    materializer: {
      status: FootballProviderLiveFeatureMaterializerReceipt["status"];
      rowsPreviewed: number;
      providerBackedFixtures: number;
      mockSeedFixtures: number;
    };
    storage: {
      status: FootballProviderLiveFeatureStorageReceipt["status"];
      providerBackedRows: number;
      pendingRows: number;
      canWrite: boolean;
      inserted: boolean;
      readbackChecked: boolean;
      readbackRows: number;
      readbackEvidenceReady: boolean;
    };
    watchlist: {
      status: FootballProviderLiveWatchlistReceipt["status"];
      candidates: number;
      monitorCandidates: number;
      topSelection: string | null;
    };
    briefing: {
      status: FootballProviderLiveBriefingPacket["status"];
      evidenceItems: number;
      support: number;
      watch: number;
      block: number;
    };
  };
  readiness: {
    providerKeysReady: boolean;
    providerProofReady: boolean;
    oddsReady: boolean;
    storagePreviewReady: boolean;
    storageReadbackReady: boolean;
    watchlistReady: boolean;
    briefingReady: boolean;
    monitorReady: boolean;
    missing: string[];
  };
  nextAction: {
    label: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
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

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function buildReadiness({
  runtime,
  materializer,
  storage,
  watchlist,
  briefing
}: {
  runtime: FootballProviderLiveRuntimeSnapshot;
  materializer: FootballProviderLiveFeatureMaterializerReceipt;
  storage: FootballProviderLiveFeatureStorageReceipt;
  watchlist: FootballProviderLiveWatchlistReceipt;
  briefing: FootballProviderLiveBriefingPacket;
}): FootballProviderLiveActivationReceipt["readiness"] {
  const providerKeysReady = runtime.proof.apiFootballConfigured && runtime.proof.oddsConfigured;
  const providerProofReady = runtime.proof.providerBackedFixtures > 0 && runtime.proof.rawPayloadLinkedFixtures > 0;
  const oddsReady = runtime.proof.completeOddsFixtures > 0 && materializer.corpus.withCompleteOdds > 0 && materializer.status !== "blocked-no-odds";
  const storagePreviewReady = storage.status === "preview-ready" || storage.status === "stored";
  const storageReadbackReady = storage.status === "stored" || storage.readback.evidenceReady;
  const watchlistReady = watchlist.status === "watchlist-ready" && watchlist.totals.monitorCandidates > 0;
  const briefingReady = briefing.status === "explanation-ready";
  const monitorReady = providerKeysReady && providerProofReady && oddsReady && storagePreviewReady && storageReadbackReady && watchlistReady && briefingReady;

  const missing = unique([
    ...runtime.proof.missing,
    providerKeysReady ? "" : "provider API keys",
    providerProofReady ? "" : "provider-backed fixture rows with raw payload proof",
    oddsReady ? "" : "complete live match_winner odds",
    storagePreviewReady ? "" : "provider-backed live storage preview",
    storageReadbackReady ? "" : "stored provider-backed live monitor row readback",
    watchlistReady ? "" : "positive-EV monitor candidate",
    briefingReady ? "" : "evidence-cited live briefing packet"
  ]);

  return {
    providerKeysReady,
    providerProofReady,
    oddsReady,
    storagePreviewReady,
    storageReadbackReady,
    watchlistReady,
    briefingReady,
    monitorReady,
    missing
  };
}

function statusFor(readiness: FootballProviderLiveActivationReceipt["readiness"], materializer: FootballProviderLiveFeatureMaterializerReceipt): FootballProviderLiveActivationStatus {
  if (!readiness.providerKeysReady) return "waiting-provider-keys";
  if (!readiness.providerProofReady) return "waiting-provider-proof";
  if (!readiness.oddsReady || materializer.status === "blocked-no-odds") return "waiting-live-odds";
  if (!readiness.storagePreviewReady || !readiness.storageReadbackReady) return "waiting-storage";
  if (!readiness.watchlistReady) return "waiting-watchlist";
  if (!readiness.briefingReady) return "blocked";
  return "provider-monitor-ready";
}

function summaryFor(status: FootballProviderLiveActivationStatus, readiness: FootballProviderLiveActivationReceipt["readiness"]): string {
  if (status === "provider-monitor-ready") return "Provider-backed live fixture is ready for monitor-only review; public picks, staking, and training remain locked.";
  if (status === "waiting-provider-keys") return "Live activation is waiting for API-Football and odds provider keys before real fixture evidence can replace seed data.";
  if (status === "waiting-provider-proof") return "Live activation has keys but still needs provider-backed fixture rows and raw payload proof.";
  if (status === "waiting-live-odds") return "Live activation is waiting for complete match_winner odds from the odds provider.";
  if (status === "waiting-storage") return "Live activation is waiting for a provider-backed live storage preview plus readback-proven monitor snapshot.";
  if (status === "waiting-watchlist") return "Live activation is waiting for a positive-EV monitor candidate after model-vs-market ranking.";
  return `Live activation is blocked by: ${readiness.missing.join(", ") || "unresolved evidence gate"}.`;
}

function nextActionFor(status: FootballProviderLiveActivationStatus): FootballProviderLiveActivationReceipt["nextAction"] {
  if (status === "waiting-provider-keys") {
    return {
      label: "Configure API-Football and odds keys",
      verifyUrl: "/api/sports/decision/training/football-provider-live-feature-materializer?date=2026-08-21&dryRun=1",
      expectedEvidence: "Runtime source changes from mock-fallback to provider-backed, with API-Football fixtures and odds provider evidence attached."
    };
  }
  if (status === "waiting-provider-proof") {
    return {
      label: "Collect provider-backed raw payload proof",
      verifyUrl: "/api/sports/decision/training/football-provider-live-feature-materializer?date=2026-08-21&dryRun=1",
      expectedEvidence: "Live preview rows show dataSource.kind=provider and evidence.rawPayloadLinked=true for every fixture."
    };
  }
  if (status === "waiting-live-odds") {
    return {
      label: "Collect complete match_winner odds",
      verifyUrl: "/api/sports/decision/training/football-provider-live-feature-materializer?date=2026-08-21&dryRun=1",
      expectedEvidence: "Home, draw, and away prices exist, bookmaker margin can be removed, and model-vs-market edges can be ranked."
    };
  }
  if (status === "waiting-storage") {
    return {
      label: "Preview provider-backed live storage",
      verifyUrl: "/api/sports/decision/training/football-provider-live-feature-storage-receipt?date=2026-08-21&dryRun=1",
      expectedEvidence: "Storage receipt reaches preview-ready or stored, then readback shows split=live rows with pending settlement labels and raw payload proof."
    };
  }
  if (status === "waiting-watchlist") {
    return {
      label: "Refresh odds and rank watchlist",
      verifyUrl: "/api/sports/decision/training/football-provider-live-watchlist?date=2026-08-21&dryRun=1",
      expectedEvidence: "Watchlist returns at least one monitor candidate with positive edge and positive expected value."
    };
  }
  if (status === "blocked") {
    return {
      label: "Repair evidence-cited briefing packet",
      verifyUrl: "/api/sports/decision/training/football-provider-live-briefing-packet?date=2026-08-21&dryRun=1",
      expectedEvidence: "Briefing packet reaches explanation-ready with cited evidence IDs and side-effect locks."
    };
  }
  return {
    label: "Review provider-backed monitor candidate",
    verifyUrl: "/api/sports/decision/training/football-provider-live-activation?date=2026-08-21&dryRun=1",
    expectedEvidence: "Activation receipt is provider-monitor-ready while public picks, staking, and model training stay locked."
  };
}

export function buildFootballProviderLiveActivationReceipt({
  runtime,
  materializer,
  storage,
  watchlist,
  briefing,
  now = new Date()
}: {
  runtime: FootballProviderLiveRuntimeSnapshot;
  materializer: FootballProviderLiveFeatureMaterializerReceipt;
  storage: FootballProviderLiveFeatureStorageReceipt;
  watchlist: FootballProviderLiveWatchlistReceipt;
  briefing: FootballProviderLiveBriefingPacket;
  now?: Date;
}): FootballProviderLiveActivationReceipt {
  const readiness = buildReadiness({ runtime, materializer, storage, watchlist, briefing });
  const status = statusFor(readiness, materializer);
  const target = {
    targetDate: runtime.targetDate,
    fixtureExternalId: briefing.target.fixtureExternalId,
    match: briefing.target.match,
    selection: briefing.target.selection,
    action: briefing.target.action,
    publicPickAllowed: false as const
  };

  return {
    mode: "football-provider-live-activation-receipt",
    generatedAt: now.toISOString(),
    status,
    activationHash: stableHash({
      status,
      target,
      runtime: [runtime.source, runtime.providerLabel, runtime.proof],
      materializer: [materializer.materializerHash, materializer.status, materializer.corpus],
      storage: [storage.receiptHash, storage.status, storage.materializer.providerBackedRows],
      readback: [storage.readback.checked, storage.readback.evidenceReady, storage.readback.matchedRows],
      watchlist: [watchlist.watchlistHash, watchlist.status, watchlist.totals.monitorCandidates],
      briefing: [briefing.packetHash, briefing.status, briefing.evidence.ids]
    }),
    summary: summaryFor(status, readiness),
    target,
    runtime: {
      source: runtime.source,
      providerLabel: runtime.providerLabel,
      proof: runtime.proof
    },
    pipeline: {
      materializer: {
        status: materializer.status,
        rowsPreviewed: materializer.corpus.rowsPreviewed,
        providerBackedFixtures: materializer.corpus.providerBackedFixtures,
        mockSeedFixtures: materializer.corpus.mockSeedFixtures
      },
      storage: {
        status: storage.status,
        providerBackedRows: storage.materializer.providerBackedRows,
        pendingRows: storage.materializer.pendingRows,
        canWrite: storage.controls.canWriteLiveFeatureSnapshots,
        inserted: storage.storage.inserted,
        readbackChecked: storage.readback.checked,
        readbackRows: storage.readback.matchedRows,
        readbackEvidenceReady: storage.readback.evidenceReady
      },
      watchlist: {
        status: watchlist.status,
        candidates: watchlist.candidates.length,
        monitorCandidates: watchlist.totals.monitorCandidates,
        topSelection: watchlist.topCandidate?.selectionLabel ?? null
      },
      briefing: {
        status: briefing.status,
        evidenceItems: briefing.evidence.items.length,
        support: briefing.evidence.support,
        watch: briefing.evidence.watch,
        block: briefing.evidence.block
      }
    },
    readiness,
    nextAction: nextActionFor(status),
    controls: {
      canInspectReadOnly: true,
      canUseForMonitor: status === "provider-monitor-ready",
      canRequestAIReview: readiness.watchlistReady && readiness.briefingReady,
      canWriteLiveFeatureSnapshots: storage.controls.canWriteLiveFeatureSnapshots,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Provider live activation is monitor-only; it cannot publish picks, stake, or unlock public betting language.",
      "Training remains locked until the fixture settles and a label exists for the split=live row.",
      "Provider-backed fixture proof, raw payload links, complete odds, storage readback, watchlist ranking, and briefing evidence must all be green.",
      "Storage writes still require the separate storage receipt gate with dryRun=0, run=1, admin authorization, correct Supabase project, and service-role readiness.",
      ...storage.locks,
      ...watchlist.locks,
      ...briefing.locks
    ].slice(0, 14),
    proofUrls: unique([
      "/api/sports/decision/training/football-provider-live-activation",
      "/api/sports/decision/training/football-provider-live-feature-materializer",
      "/api/sports/decision/training/football-provider-live-feature-storage-receipt",
      "/api/sports/decision/training/football-provider-live-watchlist",
      "/api/sports/decision/training/football-provider-live-briefing-packet",
      ...materializer.proofUrls,
      ...storage.proofUrls,
      ...watchlist.proofUrls,
      ...briefing.proofUrls
    ])
  };
}
