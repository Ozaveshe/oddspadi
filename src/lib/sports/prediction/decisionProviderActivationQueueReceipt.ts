import type {
  DecisionProviderActivationQueue,
  DecisionProviderActivationQueueItem
} from "@/lib/sports/prediction/decisionProviderActivationQueue";

export type DecisionProviderActivationQueueReceiptStatus =
  | "held-supabase-secret"
  | "ready-read-only-dry-run"
  | "waiting-provider-env"
  | "blocked";

export type DecisionProviderActivationQueueReceiptTraceStatus = "pass" | "watch" | "block";

export type DecisionProviderActivationQueueReceiptTrace = {
  id: "selection" | "secret" | "provider" | "dry-run" | "tables" | "model";
  label: string;
  status: DecisionProviderActivationQueueReceiptTraceStatus;
  evidence: string[];
  interpretation: string;
  nextAction: string;
};

export type DecisionProviderActivationQueueReceipt = {
  mode: "provider-activation-queue-receipt";
  generatedAt: string;
  date: string;
  status: DecisionProviderActivationQueueReceiptStatus;
  receiptHash: string;
  summary: string;
  queue: {
    queueHash: string;
    status: DecisionProviderActivationQueue["status"];
    itemCount: number;
    safeCommands: number;
  };
  selected: {
    id: string | null;
    kind: DecisionProviderActivationQueueItem["kind"] | null;
    label: string;
    status: DecisionProviderActivationQueueItem["status"] | null;
    verifyUrl: string;
    safeToRun: boolean;
    command: string | null;
    missing: string[];
    targetTables: string[];
  };
  decision: {
    action: "replace-secret" | "run-read-only-dry-run" | "configure-provider-env" | "repair-blocker";
    reason: string;
    acceptanceCriteria: string[];
    rejectionSignals: string[];
    proofAfterAction: string[];
  };
  publicTrace: DecisionProviderActivationQueueReceiptTrace[];
  controls: {
    canInspectReadOnly: true;
    canRunDryRun: boolean;
    canWriteProviderRows: false;
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

function unique(values: Array<string | null | undefined>, limit = 60): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function trace(input: DecisionProviderActivationQueueReceiptTrace): DecisionProviderActivationQueueReceiptTrace {
  return {
    ...input,
    evidence: unique(input.evidence, 10),
    interpretation: compact(input.interpretation),
    nextAction: compact(input.nextAction)
  };
}

function statusFor(queue: DecisionProviderActivationQueue, selected: DecisionProviderActivationQueueItem | null): DecisionProviderActivationQueueReceiptStatus {
  if (queue.status === "needs-supabase-secret") return "held-supabase-secret";
  if (selected?.safeToRun) return "ready-read-only-dry-run";
  if (queue.status === "needs-provider-env" || selected?.status === "waiting-env") return "waiting-provider-env";
  return "blocked";
}

function actionFor(status: DecisionProviderActivationQueueReceiptStatus): DecisionProviderActivationQueueReceipt["decision"]["action"] {
  if (status === "held-supabase-secret") return "replace-secret";
  if (status === "ready-read-only-dry-run") return "run-read-only-dry-run";
  if (status === "waiting-provider-env") return "configure-provider-env";
  return "repair-blocker";
}

function summaryFor(status: DecisionProviderActivationQueueReceiptStatus, selected: DecisionProviderActivationQueueItem | null): string {
  if (status === "held-supabase-secret") return "Activation receipt holds all provider progress until the rejected Supabase server secret is replaced and re-verified.";
  if (status === "ready-read-only-dry-run") return `Activation receipt approves one read-only dry-run candidate: ${selected?.label ?? "selected provider job"}.`;
  if (status === "waiting-provider-env") return `Activation receipt is waiting on provider environment for ${selected?.label ?? "the selected queue item"}.`;
  return `Activation receipt blocks activation until ${selected?.label ?? "the selected queue item"} is repaired.`;
}

function acceptanceCriteriaFor(selected: DecisionProviderActivationQueueItem | null): string[] {
  return unique([
    "The selected command must be read-only and explicitly dryRun=1 when it calls a provider endpoint.",
    "The response must include provider status, fetched count, normalized count, and source/provider identity.",
    "The result must not write fixtures, provider rows, decisions, training rows, public picks, or stake.",
    selected?.kind === "epl-fixtures" ? "EPL fixture proof must stay pinned to Premier League league 39, provider season 2026, and mutable kickoff timestamps." : "",
    selected?.kind === "ten-year-corpus" ? "10-year corpus proof must report planned jobs, executed dry-run jobs, target tables, estimated matches, and odds snapshot coverage." : "",
    selected?.kind === "provider-signal" ? "Provider signal proof must map normalized rows to the listed op_ target tables." : "",
    selected?.kind === "supabase-credential" ? "Supabase proof must show credential errors are zero after app restart." : ""
  ]);
}

function rejectionSignalsFor(selected: DecisionProviderActivationQueueItem | null): string[] {
  return unique([
    "dryRun=0",
    "stored status",
    "provider-error",
    "failed status",
    "missing admin token",
    "missing provider key",
    "invalid Supabase service-role key",
    "zero normalized rows for a fixture/corpus dry-run",
    selected?.missing.length ? `missing:${selected.missing.join(", ")}` : "",
    selected?.command?.toLowerCase().includes("dryrun=0") ? "unsafe command contains dryRun=0" : ""
  ]);
}

function proofAfterActionFor(selected: DecisionProviderActivationQueueItem | null): string[] {
  return unique([
    selected?.verifyUrl,
    "/api/sports/decision/provider-activation-queue",
    "/api/sports/decision/provider-activation-queue-receipt",
    selected?.kind === "supabase-credential" ? "/api/sports/decision/supabase-schema-manifest" : "",
    selected?.kind === "epl-fixtures" ? "/api/sports/decision/epl-provider-dry-run-interpreter" : "",
    selected?.kind === "ten-year-corpus" ? "/api/sports/decision/training/ten-year-corpus-execution" : "",
    selected?.kind === "provider-signal" ? "/api/sports/decision/provider-batch-manifest" : ""
  ]);
}

function buildTrace({
  queue,
  selected,
  status
}: {
  queue: DecisionProviderActivationQueue;
  selected: DecisionProviderActivationQueueItem | null;
  status: DecisionProviderActivationQueueReceiptStatus;
}): DecisionProviderActivationQueueReceiptTrace[] {
  return [
    trace({
      id: "selection",
      label: "Selected action",
      status: selected ? "pass" : "block",
      evidence: [selected?.id ?? "none", selected?.kind ?? "none", selected?.status ?? "none", `safe:${selected?.safeToRun ?? false}`],
      interpretation: selected ? `${selected.label} is the current queue-controlled activation action.` : "No provider activation item is selected.",
      nextAction: selected ? selected.userGoalFit : "Rebuild the provider activation queue."
    }),
    trace({
      id: "secret",
      label: "Supabase secret",
      status: status === "held-supabase-secret" ? "block" : "pass",
      evidence: [`queue-status:${queue.status}`, `missing:${selected?.missing.join(", ") ?? "none"}`],
      interpretation:
        status === "held-supabase-secret"
          ? "The server Supabase credential is still the first blocker; provider data cannot become trusted until storage reads are valid."
          : "The selected action is no longer blocked by the top-level Supabase-secret receipt.",
      nextAction: status === "held-supabase-secret" ? "Replace SUPABASE_SERVICE_ROLE_KEY server-side, restart the app, and re-run proof endpoints." : "Keep storage proof attached to every provider dry-run."
    }),
    trace({
      id: "provider",
      label: "Provider environment",
      status: status === "waiting-provider-env" ? "block" : selected?.missing.some((item) => /api|odds|provider|news|weather/i.test(item)) ? "watch" : "pass",
      evidence: selected?.missing ?? [],
      interpretation:
        status === "waiting-provider-env"
          ? "Provider credentials are still missing for the selected activation item."
          : "Provider environment is either satisfied for this item or lower priority than the current blocker.",
      nextAction: status === "waiting-provider-env" ? "Configure the listed provider env keys, then re-run the queue receipt." : "Do not call live providers outside a dry-run receipt."
    }),
    trace({
      id: "dry-run",
      label: "Dry-run safety",
      status: selected?.safeToRun ? "pass" : "watch",
      evidence: [selected?.command ?? "no-command", `safe:${selected?.safeToRun ?? false}`],
      interpretation: selected?.safeToRun ? "The selected item exposes a safe read-only command." : "The selected item is not currently runnable as a dry-run.",
      nextAction: selected?.safeToRun ? "Run the selected command and inspect counts only." : "Hold execution until the selected item exposes a safe dry-run command."
    }),
    trace({
      id: "tables",
      label: "Target tables",
      status: selected?.targetTables.length ? "pass" : "watch",
      evidence: selected?.targetTables ?? [],
      interpretation: selected?.targetTables.length ? "The selected action declares which op_ tables the eventual data should feed." : "Target table mapping is missing.",
      nextAction: "Use target tables for review only; do not write rows from this receipt."
    }),
    trace({
      id: "model",
      label: "Model authority",
      status: "watch",
      evidence: ["write:false", "train:false", "publish:false", "stake:false"],
      interpretation: "Provider activation proof can reduce data uncertainty, but it cannot change probabilities, learned weights, public picks, or stake by itself.",
      nextAction: "Wait for real stored rows, feature snapshots, backtests, and calibration proof before unlocking model authority."
    })
  ];
}

export function buildDecisionProviderActivationQueueReceipt({
  queue,
  now = new Date()
}: {
  queue: DecisionProviderActivationQueue;
  now?: Date;
}): DecisionProviderActivationQueueReceipt {
  const selected = queue.nextItem;
  const status = statusFor(queue, selected);
  const action = actionFor(status);
  const publicTrace = buildTrace({ queue, selected, status });
  const acceptanceCriteria = acceptanceCriteriaFor(selected);
  const rejectionSignals = rejectionSignalsFor(selected);
  const proofAfterAction = proofAfterActionFor(selected);
  const receiptHash = stableHash({
    date: queue.date,
    queueHash: queue.queueHash,
    status,
    selected: selected ? [selected.id, selected.status, selected.safeToRun, selected.missing] : null,
    trace: publicTrace.map((item) => [item.id, item.status])
  });

  return {
    mode: "provider-activation-queue-receipt",
    generatedAt: now.toISOString(),
    date: queue.date,
    status,
    receiptHash,
    summary: summaryFor(status, selected),
    queue: {
      queueHash: queue.queueHash,
      status: queue.status,
      itemCount: queue.totals.items,
      safeCommands: queue.totals.safeCommands
    },
    selected: {
      id: selected?.id ?? null,
      kind: selected?.kind ?? null,
      label: selected?.label ?? "No activation item selected",
      status: selected?.status ?? null,
      verifyUrl: selected?.verifyUrl ?? "/api/sports/decision/provider-activation-queue",
      safeToRun: selected?.safeToRun ?? false,
      command: selected?.command ?? null,
      missing: selected?.missing ?? [],
      targetTables: selected?.targetTables ?? []
    },
    decision: {
      action,
      reason:
        action === "replace-secret"
          ? "The first valid move is credential repair because provider evidence cannot become trusted while storage reads are rejected."
          : action === "run-read-only-dry-run"
            ? "The selected queue item has a safe dry-run command and enough gates to produce read-only evidence."
            : action === "configure-provider-env"
              ? "The selected queue item needs provider credentials before a dry-run can run."
              : "The selected queue item is blocked by storage, provider, or safety evidence.",
      acceptanceCriteria,
      rejectionSignals,
      proofAfterAction
    },
    publicTrace,
    controls: {
      canInspectReadOnly: true,
      canRunDryRun: status === "ready-read-only-dry-run" && Boolean(selected?.safeToRun),
      canWriteProviderRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: unique([
      "Provider activation queue receipt is read-only and cannot run shell commands.",
      "It cannot write provider rows, train models, publish picks, or stake.",
      "A passing receipt only authorizes evidence review, not storage writes or model authority.",
      ...queue.locks
    ]),
    proofUrls: unique(["/api/sports/decision/provider-activation-queue-receipt", ...proofAfterAction, ...queue.proofUrls])
  };
}
