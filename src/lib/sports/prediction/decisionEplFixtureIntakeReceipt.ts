import type { DecisionEplFixtureIntake, DecisionEplFixtureIntakeTask } from "@/lib/sports/prediction/decisionEplFixtureIntake";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";

export type DecisionEplFixtureIntakeReceiptStatus =
  | "not-run"
  | "verified"
  | "provider-blocked"
  | "storage-blocked"
  | "observed-warning"
  | "blocked"
  | "failed";

export type DecisionEplFixtureIntakeReceiptTarget = {
  allowed: boolean;
  method: "GET" | null;
  path: string | null;
  url: string | null;
  reason: string;
};

export type DecisionEplFixtureIntakeReceiptCounts = {
  fixtures: number | null;
  teams: number | null;
  events: number | null;
  lineups: number | null;
  injuries: number | null;
  odds: number | null;
};

export type DecisionEplFixtureIntakeReceiptObservation = {
  attempted: boolean;
  ok: boolean;
  statusCode: number | null;
  contentType: string | null;
  responseHash: string | null;
  bodyBytes: number;
  success: boolean | null;
  mode: string | null;
  statusLabel: string | null;
  provider: string | null;
  dryRun: boolean | null;
  summary: string | null;
  counts: DecisionEplFixtureIntakeReceiptCounts;
  signals: string[];
  error: string | null;
};

export type DecisionEplFixtureIntakeReceipt = {
  generatedAt: string;
  date: string;
  sport: "football";
  mode: "decision-epl-fixture-intake-receipt";
  status: DecisionEplFixtureIntakeReceiptStatus;
  receiptHash: string;
  intakeHash: string;
  summary: string;
  selectedTask: {
    id: DecisionEplFixtureIntakeTask["id"] | null;
    label: string | null;
    verifyUrl: string | null;
    status: DecisionEplFixtureIntakeTask["status"] | null;
    missingEnv: string[];
    expectedEvidence: string | null;
  };
  target: DecisionEplFixtureIntakeReceiptTarget;
  observation: DecisionEplFixtureIntakeReceiptObservation;
  verification: {
    requested: boolean;
    successCriteria: string[];
    failureSignals: string[];
    fallbackAction: string;
  };
  controls: {
    canObserveFixtureDryRun: boolean;
    canExecuteShell: false;
    canWriteFixtures: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
};

type DecisionFetch = (input: URL | string, init?: RequestInit) => Promise<Response>;

function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
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

function compact(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizePath(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/")) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function unsafeQuery(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.includes("dryrun=0") ||
    lower.includes("dryrun=false") ||
    lower.includes("persist=1") ||
    lower.includes("persist=true") ||
    lower.includes("publish=1") ||
    lower.includes("publish=true") ||
    lower.includes("train=1") ||
    lower.includes("train=true") ||
    lower.includes("stake=1") ||
    lower.includes("stake=true") ||
    lower.includes("review=1") ||
    lower.includes("review=true") ||
    lower.includes("agent=1") ||
    lower.includes("enhance=1") ||
    lower.includes("deploy")
  );
}

function emptyCounts(): DecisionEplFixtureIntakeReceiptCounts {
  return {
    fixtures: null,
    teams: null,
    events: null,
    lineups: null,
    injuries: null,
    odds: null
  };
}

function countsFrom(value: unknown): DecisionEplFixtureIntakeReceiptCounts {
  if (!value || typeof value !== "object") return emptyCounts();
  const record = value as Record<string, unknown>;
  return {
    fixtures: numberValue(record.fixtures) ?? numberValue(record.fixtureCount) ?? numberValue(record.fetched) ?? numberValue(record.normalized),
    teams: numberValue(record.teams),
    events: numberValue(record.events),
    lineups: numberValue(record.lineups),
    injuries: numberValue(record.injuries),
    odds: numberValue(record.odds)
  };
}

export function resolveDecisionEplFixtureIntakeReceiptTarget({
  intake,
  origin = decisionSiteOrigin()
}: {
  intake: DecisionEplFixtureIntake;
  origin?: string;
}): DecisionEplFixtureIntakeReceiptTarget {
  const task = intake.nextTask;
  if (!task) {
    return {
      allowed: false,
      method: null,
      path: null,
      url: null,
      reason: "No EPL fixture intake task is selected."
    };
  }

  if (!intake.controls.canRunFixtureDryRun || task.status !== "ready" || !task.command) {
    return {
      allowed: false,
      method: null,
      path: task.verifyUrl,
      url: null,
      reason: "The selected EPL fixture task is not currently ready for a read-only dry-run observation."
    };
  }

  const path = normalizePath(task.verifyUrl);
  if (!path) {
    return {
      allowed: false,
      method: null,
      path: task.verifyUrl,
      url: null,
      reason: "The selected EPL fixture task does not expose a local proof URL."
    };
  }

  if (!path.startsWith("/api/sports/decision/") || path.includes("/epl-fixture-intake-receipt")) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "Only non-recursive local sports decision proof routes can be observed by the EPL fixture receipt."
    };
  }

  if (!path.toLowerCase().includes("dryrun=1") && !path.toLowerCase().includes("dryrun=true")) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "EPL fixture receipt observations require an explicit dryRun=1 or dryRun=true proof URL."
    };
  }

  if (unsafeQuery(path)) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "The EPL fixture proof URL contains a write, persistence, publishing, training, staking, deploy, or unsafe AI-run flag."
    };
  }

  if (path.startsWith("/api/sports/decision/training/provider-sync")) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "Provider sync is currently POST-only/admin-gated; the EPL receipt is GET-only and will not execute admin provider-sync calls."
    };
  }

  return {
    allowed: true,
    method: "GET",
    path,
    url: new URL(path, origin).toString(),
    reason: "Approved local read-only EPL fixture proof route."
  };
}

function defaultObservation(): DecisionEplFixtureIntakeReceiptObservation {
  return {
    attempted: false,
    ok: false,
    statusCode: null,
    contentType: null,
    responseHash: null,
    bodyBytes: 0,
    success: null,
    mode: null,
    statusLabel: null,
    provider: null,
    dryRun: null,
    summary: null,
    counts: emptyCounts(),
    signals: [],
    error: null
  };
}

function summarizePayload(payload: unknown): Pick<
  DecisionEplFixtureIntakeReceiptObservation,
  "success" | "mode" | "statusLabel" | "provider" | "dryRun" | "summary" | "counts" | "signals"
> {
  if (!payload || typeof payload !== "object") {
    return {
      success: null,
      mode: null,
      statusLabel: null,
      provider: null,
      dryRun: null,
      summary: null,
      counts: emptyCounts(),
      signals: ["Response was not a JSON object."]
    };
  }

  const record = payload as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : record;
  const controls = data.controls && typeof data.controls === "object" ? (data.controls as Record<string, unknown>) : null;
  const nestedCounts = data.counts ?? data.normalizedCounts ?? (data.result && typeof data.result === "object" ? (data.result as Record<string, unknown>).counts : null);
  const counts = countsFrom(nestedCounts ?? data);
  const mode = stringValue(data.mode);
  const statusLabel = stringValue(data.status) ?? stringValue(record.status);
  const provider = stringValue(data.provider);
  const dryRun = booleanValue(data.dryRun);
  const summary = stringValue(data.summary) ?? stringValue(data.reason) ?? stringValue(record.error);

  return {
    success: typeof record.success === "boolean" ? record.success : statusLabel === "dry-run" || statusLabel === "stored" ? true : null,
    mode,
    statusLabel,
    provider,
    dryRun,
    summary: summary ? compact(summary) : null,
    counts,
    signals: unique([
      typeof record.success === "boolean" ? `success:${record.success}` : null,
      mode ? `mode:${mode}` : null,
      statusLabel ? `status:${statusLabel}` : null,
      provider ? `provider:${provider}` : null,
      typeof dryRun === "boolean" ? `dryRun:${dryRun}` : null,
      counts.fixtures !== null ? `fixtures:${counts.fixtures}` : null,
      counts.teams !== null ? `teams:${counts.teams}` : null,
      counts.events !== null ? `events:${counts.events}` : null,
      counts.lineups !== null ? `lineups:${counts.lineups}` : null,
      counts.injuries !== null ? `injuries:${counts.injuries}` : null,
      counts.odds !== null ? `odds:${counts.odds}` : null,
      controls && typeof controls.canWriteProviderRows === "boolean" ? `write-provider:${controls.canWriteProviderRows}` : null,
      controls && typeof controls.canPersistDecisions === "boolean" ? `persist:${controls.canPersistDecisions}` : null,
      controls && typeof controls.canTrainModels === "boolean" ? `train:${controls.canTrainModels}` : null,
      controls && typeof controls.canPublishPicks === "boolean" ? `publish:${controls.canPublishPicks}` : null,
      controls && typeof controls.canStake === "boolean" ? `stake:${controls.canStake}` : null
    ])
  };
}

async function fetchJsonText(url: string, fetchImpl: DecisionFetch): Promise<DecisionEplFixtureIntakeReceiptObservation> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    const summary = summarizePayload(parsed);

    return {
      attempted: true,
      ok: response.ok,
      statusCode: response.status,
      contentType: response.headers.get("content-type"),
      responseHash: stableHash(text),
      bodyBytes: text.length,
      success: summary.success,
      mode: summary.mode,
      statusLabel: summary.statusLabel,
      provider: summary.provider,
      dryRun: summary.dryRun,
      summary: summary.summary,
      counts: summary.counts,
      signals: summary.signals,
      error: response.ok ? null : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      ...defaultObservation(),
      attempted: true,
      error: error instanceof Error ? error.message : "EPL fixture intake receipt fetch failed."
    };
  } finally {
    clearTimeout(timeout);
  }
}

function statusFor({
  requested,
  target,
  observation
}: {
  requested: boolean;
  target: DecisionEplFixtureIntakeReceiptTarget;
  observation: DecisionEplFixtureIntakeReceiptObservation;
}): DecisionEplFixtureIntakeReceiptStatus {
  if (!target.allowed) {
    if (target.reason.toLowerCase().includes("storage")) return "storage-blocked";
    if (target.reason.toLowerCase().includes("provider") || target.reason.toLowerCase().includes("post-only")) return "provider-blocked";
    return "blocked";
  }
  if (!requested) return "not-run";
  if (!observation.attempted) return "blocked";
  if (observation.error || !observation.ok) return "failed";
  if (observation.success === false) {
    const signals = observation.signals.join(" ").toLowerCase();
    if (signals.includes("provider") || signals.includes("not-configured") || signals.includes("missing")) return "provider-blocked";
    if (signals.includes("supabase") || signals.includes("storage")) return "storage-blocked";
    return "observed-warning";
  }
  return "verified";
}

function summaryFor(
  status: DecisionEplFixtureIntakeReceiptStatus,
  intake: DecisionEplFixtureIntake,
  target: DecisionEplFixtureIntakeReceiptTarget,
  observation: DecisionEplFixtureIntakeReceiptObservation
): string {
  if (status === "verified") return `EPL fixture receipt observed ${observation.counts.fixtures ?? "unknown"} fixture(s) for ${intake.season.season}.`;
  if (status === "provider-blocked") return `EPL fixture receipt is provider-blocked: ${target.reason}`;
  if (status === "storage-blocked") return `EPL fixture receipt is storage-blocked: ${target.reason}`;
  if (status === "observed-warning") return "EPL fixture receipt observed the selected dry-run route, but the response needs review.";
  if (status === "failed") return `EPL fixture receipt attempted the selected dry-run route and failed: ${observation.error ?? `HTTP ${observation.statusCode ?? "unknown"}`}.`;
  if (status === "blocked") return `EPL fixture receipt is blocked: ${target.reason}`;
  return `EPL fixture receipt is ready to observe ${intake.nextTask?.label ?? "the selected task"} when run=1 is requested.`;
}

export function buildDecisionEplFixtureIntakeReceipt({
  intake,
  runRequested = false,
  observation,
  origin,
  now = new Date()
}: {
  intake: DecisionEplFixtureIntake;
  runRequested?: boolean;
  observation?: DecisionEplFixtureIntakeReceiptObservation;
  origin?: string;
  now?: Date;
}): DecisionEplFixtureIntakeReceipt {
  const target = resolveDecisionEplFixtureIntakeReceiptTarget({ intake, origin });
  const observed = observation ?? defaultObservation();
  const status = statusFor({ requested: runRequested, target, observation: observed });
  const selectedTask = intake.nextTask;
  const receiptHash = stableHash({
    date: intake.date,
    intake: intake.intakeHash,
    status,
    runRequested,
    selectedTask: [selectedTask?.id, selectedTask?.status, selectedTask?.verifyUrl],
    observation: [observed.statusCode, observed.responseHash, observed.success, observed.mode, observed.statusLabel, observed.counts]
  });

  return {
    generatedAt: now.toISOString(),
    date: intake.date,
    sport: "football",
    mode: "decision-epl-fixture-intake-receipt",
    status,
    receiptHash,
    intakeHash: intake.intakeHash,
    summary: summaryFor(status, intake, target, observed),
    selectedTask: {
      id: selectedTask?.id ?? null,
      label: selectedTask?.label ?? null,
      verifyUrl: selectedTask?.verifyUrl ?? null,
      status: selectedTask?.status ?? null,
      missingEnv: selectedTask?.missingEnv ?? [],
      expectedEvidence: selectedTask?.expectedEvidence ?? null
    },
    target,
    observation: observed,
    verification: {
      requested: runRequested,
      successCriteria: [
        "The selected EPL fixture dry-run route is a local GET sports decision proof route.",
        "The proof URL is explicitly dryRun=1 or dryRun=true and contains no write, train, publish, stake, persist, deploy, or AI-run flags.",
        "The receipt records response hash, provider, dry-run status, normalized counts, and public signals without executing shell commands."
      ],
      failureSignals: ["POST-only/admin-gated provider route", "missing provider credentials", "Supabase storage not proved", "HTTP failure", "non-success envelope"],
      fallbackAction: "Keep EPL fixture intake in read-only hold, then add a dedicated admin-reviewed provider dry-run receipt or prove the route manually."
    },
    controls: {
      canObserveFixtureDryRun: target.allowed,
      canExecuteShell: false,
      canWriteFixtures: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/epl-fixture-intake-receipt",
      "/api/sports/decision/epl-fixture-intake",
      target.path,
      ...intake.proofUrls
    ]),
    locks: unique([
      "EPL fixture intake receipt observes one local GET dry-run proof route only.",
      "It never executes shell commands, POSTs provider sync, writes fixtures, persists decisions, trains models, publishes picks, stakes, or upgrades public action.",
      "Provider-sync is left admin-gated until a separate write-safe dry-run operator receipt is approved.",
      "Observed output is a public response hash, normalized counts, and signal list, not private reasoning.",
      ...intake.locks
    ])
  };
}

export async function observeDecisionEplFixtureIntakeReceipt({
  intake,
  runRequested = false,
  origin,
  fetchImpl = fetch as DecisionFetch,
  now = new Date()
}: {
  intake: DecisionEplFixtureIntake;
  runRequested?: boolean;
  origin?: string;
  fetchImpl?: DecisionFetch;
  now?: Date;
}): Promise<DecisionEplFixtureIntakeReceipt> {
  const preview = buildDecisionEplFixtureIntakeReceipt({ intake, runRequested, origin, now });
  if (!runRequested || !preview.target.allowed || !preview.target.url) return preview;
  const observation = await fetchJsonText(preview.target.url, fetchImpl);
  return buildDecisionEplFixtureIntakeReceipt({ intake, runRequested, observation, origin, now });
}
