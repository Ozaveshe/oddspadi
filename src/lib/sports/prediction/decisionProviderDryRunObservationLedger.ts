import type { DecisionEplOddsDryRunReceipt } from "@/lib/sports/prediction/decisionEplOddsDryRunReceipt";
import type { DecisionEplProviderDryRunReceipt } from "@/lib/sports/prediction/decisionEplProviderDryRunReceipt";

export type DecisionProviderDryRunObservationLedgerStatus =
  | "proof-ready"
  | "fixtures-not-listed-yet"
  | "odds-plan-blocked"
  | "provider-rate-limited"
  | "provider-repair-required"
  | "admin-required"
  | "not-run";

export type DecisionProviderDryRunObservationLedgerRow = {
  id: "football-fixtures" | "odds-markets";
  provider: "api-football" | "the-odds-api";
  status: "verified" | "observed-zero" | "plan-blocked" | "rate-limited" | "provider-error" | "admin-blocked" | "waiting" | "not-run";
  attempted: boolean;
  dryRun: boolean | null;
  normalizedRows: number;
  evidenceHash: string | null;
  evidence: string[];
  interpretation: string;
  nextAction: string;
  proofUrl: string;
};

export type DecisionProviderDryRunObservationLedger = {
  generatedAt: string;
  date: string;
  sport: "football";
  mode: "provider-dry-run-observation-ledger";
  status: DecisionProviderDryRunObservationLedgerStatus;
  ledgerHash: string;
  summary: string;
  run: {
    requested: boolean;
    adminAuthorized: boolean;
    providerReceiptHash: string;
    oddsReceiptHash: string;
  };
  rows: DecisionProviderDryRunObservationLedgerRow[];
  nextAction: {
    label: string;
    proofUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunAdminDryRun: boolean;
    canWriteFixtures: false;
    canWriteOddsSnapshots: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
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

function unique(values: Array<string | null | undefined>, limit = 50): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string | null | undefined, maxLength = 300): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No evidence available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function isRateLimited(value: string | null | undefined): boolean {
  return /(?:http\s*)?429|too many requests|rate[- ]?limit/i.test(value ?? "");
}

function fixtureRow(receipt: DecisionEplProviderDryRunReceipt): DecisionProviderDryRunObservationLedgerRow {
  const observedZero = receipt.status === "observed-warning" && receipt.observation.attempted && receipt.observation.dryRun === true;
  const rateLimited = receipt.status === "rate-limited" || isRateLimited(receipt.observation.reason) || isRateLimited(receipt.observation.error);
  let status: DecisionProviderDryRunObservationLedgerRow["status"] = "waiting";
  if (receipt.status === "verified") status = "verified";
  else if (rateLimited) status = "rate-limited";
  else if (observedZero) status = "observed-zero";
  else if (receipt.status === "provider-error" || receipt.status === "failed") status = "provider-error";
  else if (receipt.status === "admin-blocked") status = "admin-blocked";
  else if (receipt.status === "not-run") status = "not-run";

  return {
    id: "football-fixtures",
    provider: "api-football",
    status,
    attempted: receipt.observation.attempted,
    dryRun: receipt.observation.dryRun,
    normalizedRows: receipt.observation.normalized,
    evidenceHash: receipt.observation.responseHash,
    evidence: unique([
      `receipt:${receipt.receiptHash}`,
      `status:${receipt.status}`,
      `attempted:${receipt.observation.attempted}`,
      `dryRun:${receipt.observation.dryRun}`,
      `fetched:${receipt.observation.fetched}`,
      `normalized:${receipt.observation.normalized}`,
      ...receipt.observation.signals
    ]),
    interpretation:
      status === "verified"
        ? "API-Football returned normalized EPL fixture rows in dry-run mode."
        : status === "observed-zero"
          ? "API-Football was reachable, but the future EPL 2026/27 opener window returned zero normalized fixtures; treat as fixture-publication timing or entitlement coverage evidence."
          : status === "rate-limited"
            ? "API-Football returned a rate-limit response. Treat this as provider activation/quota/backoff evidence, not a model failure."
          : status === "provider-error"
            ? compact(receipt.observation.reason ?? receipt.observation.error, 260)
            : receipt.summary,
    nextAction:
      status === "verified"
        ? "Review fixture storage readiness before any write-mode ingestion."
        : status === "observed-zero"
          ? "Keep the official EPL fixture bridge and retry API-Football closer to provider publication or after confirming plan entitlement for season 2026 league 39."
          : status === "rate-limited"
            ? "Wait for API-Football subscription activation/quota reset, then rerun a single admin dry-run without repeated polling."
          : status === "admin-blocked"
            ? "Retry with a valid x-oddspadi-admin-token header."
            : "Repair API-Football provider/key/entitlement evidence before relying on live fixture rows.",
    proofUrl: "/api/sports/decision/epl-provider-dry-run-receipt"
  };
}

function oddsRow(receipt: DecisionEplOddsDryRunReceipt): DecisionProviderDryRunObservationLedgerRow {
  const planBlocked = receipt.status === "provider-error" && /paid usage plans/i.test(receipt.observation.reason ?? receipt.observation.error ?? "");
  const rateLimited = isRateLimited(receipt.observation.reason) || isRateLimited(receipt.observation.error);
  const status: DecisionProviderDryRunObservationLedgerRow["status"] =
    receipt.status === "verified"
      ? "verified"
      : planBlocked
        ? "plan-blocked"
        : receipt.status === "provider-error" || receipt.status === "failed"
          ? rateLimited
            ? "rate-limited"
            : "provider-error"
          : receipt.status === "admin-blocked"
            ? "admin-blocked"
            : receipt.status === "not-run"
              ? "not-run"
              : "waiting";

  return {
    id: "odds-markets",
    provider: "the-odds-api",
    status,
    attempted: receipt.observation.attempted,
    dryRun: receipt.observation.dryRun,
    normalizedRows: receipt.observation.normalizedOddsRows,
    evidenceHash: receipt.observation.responseHash,
    evidence: unique([
      `receipt:${receipt.receiptHash}`,
      `status:${receipt.status}`,
      `attempted:${receipt.observation.attempted}`,
      `dryRun:${receipt.observation.dryRun}`,
      `events:${receipt.observation.fetchedEvents}`,
      `oddsRows:${receipt.observation.normalizedOddsRows}`,
      ...receipt.observation.signals
    ]),
    interpretation:
      status === "verified"
        ? "The Odds API returned normalized EPL odds rows in dry-run mode."
        : status === "plan-blocked"
          ? "The Odds API key is valid enough to reach the provider path, but the current plan blocks historical odds access needed for EPL market proof."
          : status === "rate-limited"
            ? "The Odds API returned a rate-limit response. Treat this as quota/backoff evidence, not odds-intelligence proof."
          : status === "provider-error"
            ? compact(receipt.observation.reason ?? receipt.observation.error, 260)
            : receipt.summary,
    nextAction:
      status === "verified"
        ? "Review odds snapshot storage readiness and no-vig market benchmark coverage before any write-mode odds ingestion."
        : status === "plan-blocked"
          ? "Confirm the saved API key belongs to the paid The Odds API plan with historical odds access, wait for activation if just purchased, then re-run one dry-run receipt."
          : status === "rate-limited"
            ? "Wait for The Odds API quota/backoff window, then rerun a single admin dry-run without repeated polling."
          : status === "admin-blocked"
            ? "Retry with a valid x-oddspadi-admin-token header."
            : "Repair The Odds API key, plan, or market-map evidence before relying on odds intelligence.",
    proofUrl: "/api/sports/decision/epl-odds-dry-run-receipt"
  };
}

function statusFor(rows: DecisionProviderDryRunObservationLedgerRow[]): DecisionProviderDryRunObservationLedgerStatus {
  if (rows.every((row) => row.status === "verified")) return "proof-ready";
  if (rows.some((row) => row.status === "plan-blocked")) return "odds-plan-blocked";
  if (rows.some((row) => row.status === "rate-limited")) return "provider-rate-limited";
  if (rows.some((row) => row.status === "observed-zero")) return "fixtures-not-listed-yet";
  if (rows.some((row) => row.status === "admin-blocked")) return "admin-required";
  if (rows.every((row) => row.status === "not-run" || row.status === "waiting")) return "not-run";
  return "provider-repair-required";
}

function summaryFor(status: DecisionProviderDryRunObservationLedgerStatus): string {
  if (status === "proof-ready") return "Provider dry-run ledger has verified all required provider proof lanes; storage review can inspect it without writes.";
  if (status === "odds-plan-blocked") return "Provider dry-run ledger reached The Odds API, but odds proof is blocked by the current unpaid/insufficient odds plan.";
  if (status === "provider-rate-limited") return "Provider dry-run ledger reached a provider rate limit; wait for activation or quota reset before rerunning proof.";
  if (status === "fixtures-not-listed-yet") return "Provider dry-run ledger reached API-Football, but the future EPL opener is not normalized from the provider yet.";
  if (status === "admin-required") return "Provider dry-run ledger needs a valid admin header before live dry-run observation.";
  if (status === "not-run") return "Provider dry-run ledger has not observed a live dry-run yet.";
  return "Provider dry-run ledger needs provider/key/entitlement repair before real evidence can advance.";
}

function nextActionFor(
  status: DecisionProviderDryRunObservationLedgerStatus,
  rows: DecisionProviderDryRunObservationLedgerRow[]
): DecisionProviderDryRunObservationLedger["nextAction"] {
  const odds = rows.find((row) => row.id === "odds-markets");
  const fixtures = rows.find((row) => row.id === "football-fixtures");
  if (status === "odds-plan-blocked") {
    return {
      label: "Upgrade odds plan and rerun dry-run",
      proofUrl: odds?.proofUrl ?? "/api/sports/decision/epl-odds-dry-run-receipt",
      expectedEvidence: odds?.nextAction ?? "The Odds API returns normalized EPL odds rows in dry-run mode."
    };
  }
  if (status === "fixtures-not-listed-yet") {
    return {
      label: "Retry provider fixture proof when EPL 2026 is listed",
      proofUrl: fixtures?.proofUrl ?? "/api/sports/decision/epl-provider-dry-run-receipt",
      expectedEvidence: fixtures?.nextAction ?? "API-Football returns normalized league 39 season 2026 fixture rows."
    };
  }
  if (status === "provider-rate-limited") {
    return {
      label: "Wait for provider quota window and rerun dry-run",
      proofUrl: "/api/sports/decision/provider-dry-run-observation-ledger",
      expectedEvidence: "Provider dry-run is retried once after activation/quota reset and returns verified normalized rows or a precise entitlement receipt."
    };
  }
  if (status === "proof-ready") {
    return {
      label: "Review storage readiness only",
      proofUrl: "/api/sports/decision/supabase-storage-proof-ledger",
      expectedEvidence: "Observed dry-run hash is reviewed while write controls remain false."
    };
  }
  return {
    label: "Inspect provider repair evidence",
    proofUrl: "/api/sports/decision/provider-key-activation-receipt",
    expectedEvidence: "Provider, admin, and entitlement gates explain why dry-run proof cannot advance."
  };
}

export function buildDecisionProviderDryRunObservationLedger({
  eplProviderDryRunReceipt,
  eplOddsDryRunReceipt,
  runRequested = false,
  adminAuthorized = false,
  now = new Date()
}: {
  eplProviderDryRunReceipt: DecisionEplProviderDryRunReceipt;
  eplOddsDryRunReceipt: DecisionEplOddsDryRunReceipt;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  now?: Date;
}): DecisionProviderDryRunObservationLedger {
  const rows = [fixtureRow(eplProviderDryRunReceipt), oddsRow(eplOddsDryRunReceipt)];
  const status = statusFor(rows);
  const nextAction = nextActionFor(status, rows);
  const ledgerHash = stableHash({
    status,
    runRequested,
    adminAuthorized,
    provider: [eplProviderDryRunReceipt.receiptHash, eplProviderDryRunReceipt.status, eplProviderDryRunReceipt.observation.responseHash],
    odds: [eplOddsDryRunReceipt.receiptHash, eplOddsDryRunReceipt.status, eplOddsDryRunReceipt.observation.responseHash],
    rows: rows.map((row) => [row.id, row.status, row.normalizedRows, row.evidenceHash])
  });

  return {
    generatedAt: now.toISOString(),
    date: eplProviderDryRunReceipt.date,
    sport: "football",
    mode: "provider-dry-run-observation-ledger",
    status,
    ledgerHash,
    summary: summaryFor(status),
    run: {
      requested: runRequested,
      adminAuthorized,
      providerReceiptHash: eplProviderDryRunReceipt.receiptHash,
      oddsReceiptHash: eplOddsDryRunReceipt.receiptHash
    },
    rows,
    nextAction,
    controls: {
      canInspectReadOnly: true,
      canRunAdminDryRun:
        !runRequested &&
        (eplProviderDryRunReceipt.controls.canRunProviderDryRun || eplOddsDryRunReceipt.controls.canRunOddsDryRun),
      canWriteFixtures: false,
      canWriteOddsSnapshots: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: unique([
      "/api/sports/decision/provider-dry-run-observation-ledger",
      "/api/sports/decision/epl-provider-dry-run-receipt",
      "/api/sports/decision/epl-odds-dry-run-receipt",
      nextAction.proofUrl,
      ...eplProviderDryRunReceipt.proofUrls,
      ...eplOddsDryRunReceipt.proofUrls
    ]),
    locks: unique([
      "Provider dry-run observation ledger can run/read dry-run receipts only.",
      "It cannot write fixtures, odds snapshots, provider rows, decisions, feature rows, or training rows.",
      "It cannot train models, apply learned weights, adjust probabilities, raise confidence, publish picks, or stake.",
      "Zero-row and provider-plan observations are evidence for the next action, not production readiness.",
      ...eplProviderDryRunReceipt.locks,
      ...eplOddsDryRunReceipt.locks
    ])
  };
}
