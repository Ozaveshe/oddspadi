import type { DecisionEplOddsDryRunReceipt } from "@/lib/sports/prediction/decisionEplOddsDryRunReceipt";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

export type DecisionEplOddsDryRunInterpreterStatus =
  | "waiting-odds-key"
  | "waiting-admin-token"
  | "waiting-admin-run"
  | "observed-odds-proof"
  | "needs-odds-repair"
  | "blocked";

export type DecisionEplOddsDryRunInterpreterTraceStatus = "pass" | "watch" | "block";

export type DecisionEplOddsDryRunInterpreterTrace = {
  id: "odds-key" | "admin" | "dry-run" | "odds-rows" | "storage" | "trust";
  label: string;
  status: DecisionEplOddsDryRunInterpreterTraceStatus;
  publicReason: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionEplOddsDryRunInterpreter = {
  generatedAt: string;
  date: string;
  sport: "football";
  mode: "decision-epl-odds-dry-run-interpreter";
  status: DecisionEplOddsDryRunInterpreterStatus;
  interpreterHash: string;
  summary: string;
  input: {
    receiptHash: string;
    oddsMapHash: string;
    receiptStatus: DecisionEplOddsDryRunReceipt["status"];
    proofHash: string | null;
    fetchedEvents: number;
    oddsRows: number;
  };
  interpretation: {
    learned: string;
    risk: string;
    nextAction: string;
    confidenceEffect: "keep-capped" | "reduce" | "shadow-only";
    publicActionEffect: "none";
    probabilityEffect: 0;
  };
  publicTrace: DecisionEplOddsDryRunInterpreterTrace[];
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
    canRequestAdminOddsDryRun: boolean;
    canUseOddsProofForStorageReview: boolean;
    canPersistMemory: false;
    canPersistDecisions: false;
    canWriteOddsSnapshots: false;
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

function statusFor(receipt: DecisionEplOddsDryRunReceipt): DecisionEplOddsDryRunInterpreterStatus {
  if (receipt.status === "needs-odds-key") return "waiting-odds-key";
  if (receipt.status === "needs-admin-token") return "waiting-admin-token";
  if (receipt.status === "not-run" || receipt.status === "admin-blocked") return "waiting-admin-run";
  if (receipt.status === "verified") {
    return receipt.observation.dryRun === true && receipt.observation.statusLabel === "dry-run" && receipt.observation.normalizedOddsRows > 0
      ? "observed-odds-proof"
      : "needs-odds-repair";
  }
  if (receipt.status === "provider-error" || receipt.status === "failed" || receipt.status === "observed-warning") return "needs-odds-repair";
  return "blocked";
}

function traceItem(input: DecisionEplOddsDryRunInterpreterTrace): DecisionEplOddsDryRunInterpreterTrace {
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
  receipt: DecisionEplOddsDryRunReceipt;
  status: DecisionEplOddsDryRunInterpreterStatus;
}): DecisionEplOddsDryRunInterpreterTrace[] {
  return [
    traceItem({
      id: "odds-key",
      label: "Odds key",
      status: receipt.target.oddsKeyConfigured ? "pass" : "block",
      publicReason: receipt.target.oddsKeyConfigured ? "The Odds API credentials are configured." : "The Odds API credentials are missing.",
      evidence: [`odds-key:${receipt.target.oddsKeyConfigured}`, receipt.request.provider, receipt.request.sportKey, receipt.request.markets],
      nextAction: receipt.target.oddsKeyConfigured ? "Keep bookmaker requests pinned to EPL soccer_epl markets." : "Configure THE_ODDS_API_KEY or ODDS_API_KEY."
    }),
    traceItem({
      id: "admin",
      label: "Admin authority",
      status: receipt.target.adminTokenConfigured ? (receipt.target.adminAuthorized || !receipt.verification.requested ? "watch" : "block") : "block",
      publicReason: receipt.target.adminTokenConfigured
        ? receipt.target.adminAuthorized
          ? "The odds dry-run request was admin-authorized."
          : "The admin token is configured, but this request has not supplied a valid admin header."
        : "ODDSPADI_ADMIN_TOKEN is missing, so no operator odds dry-run can run.",
      evidence: [`admin-token:${receipt.target.adminTokenConfigured}`, `admin-authorized:${receipt.target.adminAuthorized}`, `requested:${receipt.verification.requested}`],
      nextAction: receipt.target.adminAuthorized ? "Use the admin-authorized receipt hash as odds proof." : "Run the receipt with a valid x-oddspadi-admin-token header."
    }),
    traceItem({
      id: "dry-run",
      label: "Dry-run guard",
      status: receipt.observation.statusLabel === "dry-run" && receipt.observation.dryRun === true ? "pass" : receipt.observation.attempted ? "block" : "watch",
      publicReason:
        receipt.observation.statusLabel === "dry-run" && receipt.observation.dryRun === true
          ? "Bookmaker sync returned dry-run status."
          : receipt.observation.attempted
            ? "Bookmaker sync did not return a clean dry-run proof."
            : "No bookmaker dry-run has been observed yet.",
      evidence: [`attempted:${receipt.observation.attempted}`, `status:${receipt.observation.statusLabel ?? "none"}`, `dryRun:${receipt.observation.dryRun ?? "none"}`],
      nextAction: receipt.observation.statusLabel === "dry-run" ? "Interpret odds rows and keep write mode locked." : receipt.verification.fallbackAction
    }),
    traceItem({
      id: "odds-rows",
      label: "Odds rows",
      status: status === "observed-odds-proof" && receipt.observation.normalizedOddsRows > 0 ? "pass" : status === "observed-odds-proof" ? "block" : "watch",
      publicReason:
        receipt.observation.normalizedOddsRows > 0
          ? `Bookmaker dry-run normalized ${receipt.observation.normalizedOddsRows} odds row(s) from ${receipt.observation.fetchedEvents} event(s).`
          : "Bookmaker dry-run has not produced odds rows yet.",
      evidence: [
        `events:${receipt.observation.fetchedEvents}`,
        `oddsRows:${receipt.observation.normalizedOddsRows}`,
        `markets:${receipt.request.markets}`,
        `regions:${receipt.request.regions}`
      ],
      nextAction: receipt.observation.normalizedOddsRows > 0 ? "Use odds counts as review evidence before snapshot storage proof." : "Do not proceed to storage review until odds rows are non-zero."
    }),
    traceItem({
      id: "storage",
      label: "Storage proof",
      status: "watch",
      publicReason: "Bookmaker dry-run proof is not storage proof; Supabase project, schema, and service-role verification still gate snapshot writes.",
      evidence: ["oddsSnapshots:false", "decisions:false", "training:false", "publish:false"],
      nextAction: "Run Supabase proof binder/schema checks before any odds snapshot write or training row."
    }),
    traceItem({
      id: "trust",
      label: "Trust effect",
      status: "watch",
      publicReason: "Odds dry-run evidence can reduce market-availability uncertainty, but cannot raise public pick confidence by itself.",
      evidence: [`receipt:${receipt.receiptHash}`, `proof:${receipt.observation.responseHash ?? "pending"}`, `status:${status}`],
      nextAction: "Keep probability, confidence, learned weights, public picks, and stake unchanged."
    })
  ];
}

function interpretationFor(
  status: DecisionEplOddsDryRunInterpreterStatus,
  receipt: DecisionEplOddsDryRunReceipt
): DecisionEplOddsDryRunInterpreter["interpretation"] {
  if (status === "observed-odds-proof") {
    return {
      learned: `The Odds API EPL dry-run normalized ${receipt.observation.normalizedOddsRows} odds row(s) from ${receipt.observation.fetchedEvents} event(s) with proof ${
        receipt.observation.responseHash ?? "unhashed"
      }.`,
      risk: "Dry-run odds rows prove bookmaker normalization only. They do not prove Supabase snapshot writes, no-vig calculation quality, odds freshness, line movement history, or model accuracy.",
      nextAction: "Move to Supabase schema/storage proof and operator review before odds snapshot writes.",
      confidenceEffect: "shadow-only",
      publicActionEffect: "none",
      probabilityEffect: 0
    };
  }
  if (status === "waiting-odds-key") {
    return {
      learned: "The EPL odds dry-run cannot run because bookmaker credentials are missing.",
      risk: "Without bookmaker proof, value edge, no-vig probabilities, and safer-market alternatives must remain mock/demo or formula-only.",
      nextAction: "Configure THE_ODDS_API_KEY or ODDS_API_KEY.",
      confidenceEffect: "keep-capped",
      publicActionEffect: "none",
      probabilityEffect: 0
    };
  }
  if (status === "waiting-admin-token") {
    return {
      learned: "The odds key gate is ready, but no ODDSPADI_ADMIN_TOKEN is configured for operator dry-runs.",
      risk: "Without admin authority, the app should not call live bookmaker providers from this receipt.",
      nextAction: "Configure ODDSPADI_ADMIN_TOKEN and retry the receipt with the admin header.",
      confidenceEffect: "keep-capped",
      publicActionEffect: "none",
      probabilityEffect: 0
    };
  }
  if (status === "waiting-admin-run") {
    return {
      learned: "The EPL odds dry-run needs an operator-authorized run before bookmaker proof exists.",
      risk: "The dashboard link alone must not call The Odds API or claim live market coverage.",
      nextAction: "Run the odds dry-run receipt with x-oddspadi-admin-token.",
      confidenceEffect: "keep-capped",
      publicActionEffect: "none",
      probabilityEffect: 0
    };
  }
  return {
    learned: compact(receipt.observation.error ?? receipt.observation.reason ?? receipt.target.reason),
    risk: "Bookmaker proof is blocked, failed, or ambiguous, so market trust must stay capped.",
    nextAction: receipt.verification.fallbackAction,
    confidenceEffect: "reduce",
    publicActionEffect: "none",
    probabilityEffect: 0
  };
}

function nextTurnFor(
  status: DecisionEplOddsDryRunInterpreterStatus,
  receipt: DecisionEplOddsDryRunReceipt
): DecisionEplOddsDryRunInterpreter["nextTurn"] {
  if (status === "observed-odds-proof") {
    return {
      label: "Prove odds snapshot storage before write",
      command: decisionCurlCommand("/api/sports/decision/supabase-proof-binder"),
      verifyUrl: "/api/sports/decision/supabase-proof-binder",
      safeToRun: true,
      requiresAdminHeader: false
    };
  }
  if (status === "waiting-admin-run") {
    return {
      label: "Run admin-authorized EPL odds dry-run",
      command: null,
      verifyUrl: receipt.target.path,
      safeToRun: false,
      requiresAdminHeader: true
    };
  }
  if (status === "waiting-odds-key") {
    return {
      label: "Configure bookmaker odds key",
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
  return {
    label: "Repair EPL odds dry-run proof",
    command: null,
    verifyUrl: "/api/sports/decision/epl-odds-dry-run-receipt",
    safeToRun: false,
    requiresAdminHeader: true
  };
}

function summaryFor(
  status: DecisionEplOddsDryRunInterpreterStatus,
  interpretation: DecisionEplOddsDryRunInterpreter["interpretation"]
): string {
  if (status === "observed-odds-proof") return `EPL odds dry-run interpreter learned: ${interpretation.learned}`;
  if (status === "waiting-odds-key") return "EPL odds dry-run interpreter is waiting for bookmaker credentials.";
  if (status === "waiting-admin-token") return "EPL odds dry-run interpreter is waiting for an OddsPadi admin token.";
  if (status === "waiting-admin-run") return "EPL odds dry-run interpreter is waiting for an admin-authorized odds dry-run.";
  if (status === "needs-odds-repair") return "EPL odds dry-run interpreter needs bookmaker proof repair.";
  return "EPL odds dry-run interpreter is blocked by an unsafe or unavailable odds proof target.";
}

export function buildDecisionEplOddsDryRunInterpreter({
  receipt,
  now = new Date()
}: {
  receipt: DecisionEplOddsDryRunReceipt;
  now?: Date;
}): DecisionEplOddsDryRunInterpreter {
  const status = statusFor(receipt);
  const interpretation = interpretationFor(status, receipt);
  const publicTrace = buildTrace({ receipt, status });
  const nextTurn = nextTurnFor(status, receipt);
  const memoryContent = compact(
    [
      `status:${status}`,
      `receipt:${receipt.receiptHash}`,
      `proof:${receipt.observation.responseHash ?? "pending"}`,
      `oddsRows:${receipt.observation.normalizedOddsRows}`,
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
    mode: "decision-epl-odds-dry-run-interpreter",
    status,
    interpreterHash,
    summary: summaryFor(status, interpretation),
    input: {
      receiptHash: receipt.receiptHash,
      oddsMapHash: receipt.oddsMapHash,
      receiptStatus: receipt.status,
      proofHash: receipt.observation.responseHash,
      fetchedEvents: receipt.observation.fetchedEvents,
      oddsRows: receipt.observation.normalizedOddsRows
    },
    interpretation,
    publicTrace,
    nextTurn,
    memoryDraft: {
      canPersist: false,
      label: "epl_odds_dry_run_interpretation",
      evidenceHash: receipt.observation.responseHash,
      content: memoryContent
    },
    controls: {
      canRequestAdminOddsDryRun: status === "waiting-admin-run",
      canUseOddsProofForStorageReview: status === "observed-odds-proof",
      canPersistMemory: false,
      canPersistDecisions: false,
      canWriteOddsSnapshots: false,
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
      "/api/sports/decision/epl-odds-dry-run-interpreter",
      "/api/sports/decision/epl-odds-dry-run-receipt",
      nextTurn.verifyUrl,
      ...receipt.proofUrls
    ]),
    locks: unique([
      "EPL odds dry-run interpretation is public trace only, not hidden chain-of-thought.",
      "Odds dry-run proof can only move the workflow to storage/schema review.",
      "It cannot write odds snapshots, persist memory or decisions, train models, apply weights, adjust probabilities, raise confidence, publish picks, stake, or upgrade public action.",
      ...receipt.locks
    ])
  };
}
