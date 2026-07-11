import type { DecisionEplProviderDryRunReceipt } from "@/lib/sports/prediction/decisionEplProviderDryRunReceipt";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

export type DecisionEplProviderDryRunInterpreterStatus =
  | "waiting-provider-key"
  | "waiting-admin-token"
  | "waiting-admin-run"
  | "observed-provider-proof"
  | "rate-limited"
  | "needs-provider-repair"
  | "blocked";

export type DecisionEplProviderDryRunInterpreterTraceStatus = "pass" | "watch" | "block";

export type DecisionEplProviderDryRunInterpreterTrace = {
  id: "provider" | "admin" | "dry-run" | "counts" | "storage" | "trust";
  label: string;
  status: DecisionEplProviderDryRunInterpreterTraceStatus;
  publicReason: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionEplProviderDryRunInterpreter = {
  generatedAt: string;
  date: string;
  sport: "football";
  mode: "decision-epl-provider-dry-run-interpreter";
  status: DecisionEplProviderDryRunInterpreterStatus;
  interpreterHash: string;
  summary: string;
  input: {
    receiptHash: string;
    intakeHash: string;
    receiptStatus: DecisionEplProviderDryRunReceipt["status"];
    proofHash: string | null;
    normalized: number;
    fixtures: number;
  };
  interpretation: {
    learned: string;
    risk: string;
    nextAction: string;
    confidenceEffect: "keep-capped" | "reduce" | "shadow-only";
    publicActionEffect: "none";
    probabilityEffect: 0;
  };
  publicTrace: DecisionEplProviderDryRunInterpreterTrace[];
  nextTurn: {
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
    requiresAdminHeader: boolean;
  };
  memoryDraft: {
    canPersist: false;
    label: string;
    evidenceHash: string | null;
    content: string;
  };
  controls: {
    canRequestAdminDryRun: boolean;
    canUseProviderProofForStorageReview: boolean;
    canPersistMemory: false;
    canPersistDecisions: false;
    canWriteFixtures: false;
    canWriteProviderRows: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
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

function unique(values: Array<string | null | undefined>, limit = 30): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function statusFor(receipt: DecisionEplProviderDryRunReceipt): DecisionEplProviderDryRunInterpreterStatus {
  if (receipt.status === "needs-provider") return "waiting-provider-key";
  if (receipt.status === "needs-admin-token") return "waiting-admin-token";
  if (receipt.status === "not-run" || receipt.status === "admin-blocked") return "waiting-admin-run";
  if (receipt.status === "rate-limited") return "rate-limited";
  if (receipt.status === "verified") {
    return receipt.observation.dryRun === true && receipt.observation.statusLabel === "dry-run" && receipt.observation.counts.fixtures > 0
      ? "observed-provider-proof"
      : "needs-provider-repair";
  }
  if (receipt.status === "provider-error" || receipt.status === "failed" || receipt.status === "observed-warning") return "needs-provider-repair";
  return "blocked";
}

function traceItem(input: DecisionEplProviderDryRunInterpreterTrace): DecisionEplProviderDryRunInterpreterTrace {
  return {
    ...input,
    publicReason: compact(input.publicReason),
    evidence: unique(input.evidence, 8),
    nextAction: compact(input.nextAction)
  };
}

function buildTrace({
  receipt,
  status
}: {
  receipt: DecisionEplProviderDryRunReceipt;
  status: DecisionEplProviderDryRunInterpreterStatus;
}): DecisionEplProviderDryRunInterpreterTrace[] {
  const counts = receipt.observation.counts;
  return [
    traceItem({
      id: "provider",
      label: "Provider key",
      status: receipt.target.providerKeyConfigured ? "pass" : "block",
      publicReason: receipt.target.providerKeyConfigured ? "API-Football provider credentials are configured." : "API-Football provider credentials are missing.",
      evidence: [`provider-key:${receipt.target.providerKeyConfigured}`, receipt.request.provider, `league:${receipt.request.league}`, `season:${receipt.request.season}`],
      nextAction: receipt.target.providerKeyConfigured ? "Keep provider requests pinned to EPL league 39 season 2026." : "Configure API_FOOTBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY."
    }),
    traceItem({
      id: "admin",
      label: "Admin authority",
      status: receipt.target.adminTokenConfigured ? (receipt.target.adminAuthorized || !receipt.verification.requested ? "watch" : "block") : "block",
      publicReason: receipt.target.adminTokenConfigured
        ? receipt.target.adminAuthorized
          ? "The dry-run request was admin-authorized."
          : "The admin token is configured, but this request has not supplied a valid admin header."
        : "ODDSPADI_ADMIN_TOKEN is missing, so no operator dry-run can run.",
      evidence: [`admin-token:${receipt.target.adminTokenConfigured}`, `admin-authorized:${receipt.target.adminAuthorized}`, `requested:${receipt.verification.requested}`],
      nextAction: receipt.target.adminAuthorized ? "Use the admin-authorized receipt hash as provider proof." : "Run the receipt with a valid x-oddspadi-admin-token header."
    }),
    traceItem({
      id: "dry-run",
      label: "Dry-run guard",
      status: receipt.observation.statusLabel === "dry-run" && receipt.observation.dryRun === true ? "pass" : receipt.observation.attempted ? "block" : "watch",
      publicReason:
        receipt.observation.statusLabel === "dry-run" && receipt.observation.dryRun === true
          ? "Provider sync returned dry-run status."
          : receipt.observation.attempted
            ? "Provider sync did not return a clean dry-run proof."
            : "No provider dry-run has been observed yet.",
      evidence: [`attempted:${receipt.observation.attempted}`, `status:${receipt.observation.statusLabel ?? "none"}`, `dryRun:${receipt.observation.dryRun ?? "none"}`],
      nextAction: receipt.observation.statusLabel === "dry-run" ? "Interpret counts and keep write mode locked." : receipt.verification.fallbackAction
    }),
    traceItem({
      id: "counts",
      label: "Normalized counts",
      status: status === "observed-provider-proof" && counts.fixtures > 0 ? "pass" : status === "observed-provider-proof" ? "block" : "watch",
      publicReason:
        counts.fixtures > 0
          ? `Provider dry-run normalized ${counts.fixtures} fixture(s), ${counts.standings} standing row(s), and ${counts.featureRows} feature row(s).`
          : "Provider dry-run has not produced fixture counts yet.",
      evidence: [
        `fetched:${receipt.observation.fetched}`,
        `normalized:${receipt.observation.normalized}`,
        `fixtures:${counts.fixtures}`,
        `standings:${counts.standings}`,
        `availability:${counts.availability}`,
        `featureRows:${counts.featureRows}`
      ],
      nextAction: counts.fixtures > 0 ? "Use counts as review evidence before storage proof." : "Do not proceed to storage review until fixture counts are non-zero."
    }),
    traceItem({
      id: "storage",
      label: "Storage proof",
      status: "watch",
      publicReason: "Provider dry-run proof is not storage proof; Supabase project, schema, and service-role verification still gate writes.",
      evidence: ["writes:false", "providerRows:false", "training:false", "publish:false"],
      nextAction: "Run Supabase proof binder/schema checks before any fixture upsert or training corpus write."
    }),
    traceItem({
      id: "trust",
      label: "Trust effect",
      status: "watch",
      publicReason: "Dry-run evidence can reduce data-availability uncertainty, but cannot raise public pick confidence by itself.",
      evidence: [`receipt:${receipt.receiptHash}`, `proof:${receipt.observation.responseHash ?? "pending"}`, `status:${status}`],
      nextAction: "Keep probability, confidence, learned weights, public picks, and stake unchanged."
    })
  ];
}

function interpretationFor(
  status: DecisionEplProviderDryRunInterpreterStatus,
  receipt: DecisionEplProviderDryRunReceipt
): DecisionEplProviderDryRunInterpreter["interpretation"] {
  if (status === "observed-provider-proof") {
    return {
      learned: `API-Football EPL 2026 dry-run normalized ${receipt.observation.normalized} fixture(s) with proof ${receipt.observation.responseHash ?? "unhashed"}.`,
      risk: "Dry-run counts prove provider normalization only. They do not prove Supabase schema, write safety, odds mapping, freshness, or model accuracy.",
      nextAction: "Move to Supabase schema/storage proof and operator review before fixture upsert.",
      confidenceEffect: "shadow-only",
      publicActionEffect: "none",
      probabilityEffect: 0
    };
  }
  if (status === "waiting-provider-key") {
    return {
      learned: "The EPL provider dry-run cannot run because provider credentials are missing.",
      risk: "Without provider proof, the 2026/27 EPL fixture intake remains official-source-only and cannot seed live data.",
      nextAction: "Configure API_FOOTBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY.",
      confidenceEffect: "keep-capped",
      publicActionEffect: "none",
      probabilityEffect: 0
    };
  }
  if (status === "waiting-admin-token") {
    return {
      learned: "The provider key gate is ready, but no ODDSPADI_ADMIN_TOKEN is configured for operator dry-runs.",
      risk: "Without admin authority, the app should not call live providers from this receipt.",
      nextAction: "Configure ODDSPADI_ADMIN_TOKEN and retry the receipt with the admin header.",
      confidenceEffect: "keep-capped",
      publicActionEffect: "none",
      probabilityEffect: 0
    };
  }
  if (status === "waiting-admin-run") {
    return {
      learned: "The EPL provider dry-run needs an operator-authorized run before proof exists.",
      risk: "The dashboard link alone must not call the provider or claim provider coverage.",
      nextAction: "Run the dry-run receipt with x-oddspadi-admin-token.",
      confidenceEffect: "keep-capped",
      publicActionEffect: "none",
      probabilityEffect: 0
    };
  }
  if (status === "rate-limited") {
    return {
      learned: compact(receipt.observation.reason ?? receipt.observation.error ?? "API-Football returned a rate-limit/throttling response."),
      risk: "The provider key reached API-Football, but repeated or rapid probes can exhaust the quota window; do not treat this as a missing key or model failure.",
      nextAction: "Cool down until the API-Football throttle/quota window resets, then rerun one admin dry-run without repeated polling.",
      confidenceEffect: "keep-capped",
      publicActionEffect: "none",
      probabilityEffect: 0
    };
  }
  return {
    learned: compact(receipt.observation.error ?? receipt.observation.reason ?? receipt.target.reason),
    risk: "Provider proof is blocked, failed, or ambiguous, so data trust must stay capped.",
    nextAction: receipt.verification.fallbackAction,
    confidenceEffect: "reduce",
    publicActionEffect: "none",
    probabilityEffect: 0
  };
}

function nextTurnFor(
  status: DecisionEplProviderDryRunInterpreterStatus,
  receipt: DecisionEplProviderDryRunReceipt
): DecisionEplProviderDryRunInterpreter["nextTurn"] {
  if (status === "observed-provider-proof") {
    return {
      label: "Prove Supabase fixture storage before upsert",
      command: decisionCurlCommand("/api/sports/decision/supabase-proof-binder"),
      verifyUrl: "/api/sports/decision/supabase-proof-binder",
      safeToRun: true,
      requiresAdminHeader: false
    };
  }
  if (status === "waiting-admin-run") {
    return {
      label: "Run admin-authorized EPL provider dry-run",
      command: null,
      verifyUrl: receipt.target.path,
      safeToRun: false,
      requiresAdminHeader: true
    };
  }
  if (status === "waiting-provider-key") {
    return {
      label: "Configure API-Football provider key",
      command: null,
      verifyUrl: "/api/sports/decision/env-activation-matrix?sport=football",
      safeToRun: false,
      requiresAdminHeader: false
    };
  }
  if (status === "waiting-admin-token") {
    return {
      label: "Configure OddsPadi admin token",
      command: null,
      verifyUrl: "/api/sports/decision/env-activation-matrix?sport=football",
      safeToRun: false,
      requiresAdminHeader: false
    };
  }
  if (status === "rate-limited") {
    return {
      label: "Cool down before retrying API-Football dry-run",
      command: null,
      verifyUrl: "/api/sports/decision/epl-provider-dry-run-receipt",
      safeToRun: false,
      requiresAdminHeader: true
    };
  }
  return {
    label: "Repair EPL provider dry-run proof",
    command: null,
    verifyUrl: "/api/sports/decision/epl-provider-dry-run-receipt",
    safeToRun: false,
    requiresAdminHeader: true
  };
}

function summaryFor(
  status: DecisionEplProviderDryRunInterpreterStatus,
  interpretation: DecisionEplProviderDryRunInterpreter["interpretation"]
): string {
  if (status === "observed-provider-proof") return `EPL provider dry-run interpreter learned: ${interpretation.learned}`;
  if (status === "waiting-provider-key") return "EPL provider dry-run interpreter is waiting for API-Football provider credentials.";
  if (status === "waiting-admin-token") return "EPL provider dry-run interpreter is waiting for an OddsPadi admin token.";
  if (status === "waiting-admin-run") return "EPL provider dry-run interpreter is waiting for an admin-authorized dry-run.";
  if (status === "rate-limited") return "EPL provider dry-run interpreter is waiting for API-Football rate-limit backoff before retry.";
  if (status === "needs-provider-repair") return "EPL provider dry-run interpreter needs provider proof repair.";
  return "EPL provider dry-run interpreter is blocked by an unsafe or unavailable provider proof target.";
}

export function buildDecisionEplProviderDryRunInterpreter({
  receipt,
  now = new Date()
}: {
  receipt: DecisionEplProviderDryRunReceipt;
  now?: Date;
}): DecisionEplProviderDryRunInterpreter {
  const status = statusFor(receipt);
  const interpretation = interpretationFor(status, receipt);
  const publicTrace = buildTrace({ receipt, status });
  const nextTurn = nextTurnFor(status, receipt);
  const memoryContent = compact(
    [
      `status:${status}`,
      `receipt:${receipt.receiptHash}`,
      `proof:${receipt.observation.responseHash ?? "pending"}`,
      `normalized:${receipt.observation.normalized}`,
      `learned:${interpretation.learned}`,
      `risk:${interpretation.risk}`
    ].join(" | "),
    460
  );
  const interpreterHash = stableHash({
    date: receipt.date,
    receipt: receipt.receiptHash,
    status,
    proof: receipt.observation.responseHash,
    trace: publicTrace.map((item) => [item.id, item.status]),
    next: nextTurn.verifyUrl
  });

  return {
    generatedAt: now.toISOString(),
    date: receipt.date,
    sport: "football",
    mode: "decision-epl-provider-dry-run-interpreter",
    status,
    interpreterHash,
    summary: summaryFor(status, interpretation),
    input: {
      receiptHash: receipt.receiptHash,
      intakeHash: receipt.intakeHash,
      receiptStatus: receipt.status,
      proofHash: receipt.observation.responseHash,
      normalized: receipt.observation.normalized,
      fixtures: receipt.observation.counts.fixtures
    },
    interpretation,
    publicTrace,
    nextTurn,
    memoryDraft: {
      canPersist: false,
      label: "epl_provider_dry_run_interpretation",
      evidenceHash: receipt.observation.responseHash,
      content: memoryContent
    },
    controls: {
      canRequestAdminDryRun: status === "waiting-admin-run",
      canUseProviderProofForStorageReview: status === "observed-provider-proof",
      canPersistMemory: false,
      canPersistDecisions: false,
      canWriteFixtures: false,
      canWriteProviderRows: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/epl-provider-dry-run-interpreter",
      "/api/sports/decision/epl-provider-dry-run-receipt",
      nextTurn.verifyUrl,
      ...receipt.proofUrls
    ]),
    locks: unique([
      "EPL provider dry-run interpretation is public trace only, not hidden chain-of-thought.",
      "Provider dry-run proof can only move the workflow to storage/schema review.",
      "It cannot write fixtures, write provider rows, persist memory or decisions, train models, apply weights, adjust probabilities, raise confidence, publish picks, stake, or upgrade public action.",
      ...receipt.locks
    ])
  };
}
