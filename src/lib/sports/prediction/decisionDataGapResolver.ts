import type { DecisionDataAuthority, DecisionDataAuthorityFamily, DecisionDataAuthorityStep } from "@/lib/sports/prediction/decisionDataAuthority";
import type { DecisionProviderIngestionEvidence } from "@/lib/sports/prediction/decisionProviderIngestionEvidence";
import type { DecisionRequirementPulse } from "@/lib/sports/prediction/decisionRequirementPulse";
import type { Sport } from "@/lib/sports/types";

export type DecisionDataGapResolverStatus = "ready-dry-run" | "needs-env" | "needs-supabase-proof" | "blocked" | "watch";
export type DecisionDataGapResolverActionStatus = "ready" | "waiting-env" | "waiting-supabase" | "watch" | "blocked";
export type DecisionDataGapResolverActionKind = "proof-gate" | "provider-feed" | "training-corpus";

export type DecisionDataGapResolverAction = {
  id: string;
  kind: DecisionDataGapResolverActionKind;
  status: DecisionDataGapResolverActionStatus;
  priority: DecisionDataAuthorityFamily["priority"] | "critical";
  label: string;
  provider: string;
  score: number;
  command: string | null;
  verifyUrl: string;
  safeToRun: boolean;
  missingEnv: string[];
  blockers: string[];
  expectedEvidence: string;
  unlocks: {
    liveDecisionUse: DecisionDataAuthorityFamily["liveDecisionUse"] | "not-applicable";
    modelImpact: string;
    oddsImpact: string;
    trainingImpact: string;
    aiReviewImpact: string;
  };
  storageTables: string[];
};

export type DecisionDataGapResolver = {
  mode: "data-gap-resolver";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionDataGapResolverStatus;
  resolverHash: string;
  summary: string;
  totals: {
    actions: number;
    ready: number;
    waitingEnv: number;
    waitingSupabase: number;
    watch: number;
    blocked: number;
  };
  nextAction: DecisionDataGapResolverAction | null;
  actions: DecisionDataGapResolverAction[];
  controls: {
    canInspectReadOnly: true;
    canRunNextCommand: boolean;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
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

function unique(values: Array<string | null | undefined>, limit = 24): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function safeCommand(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  return lower.includes("curl.exe") && !lower.includes("persist=1") && !lower.includes("dryrun=0") && !lower.includes("deploy --prod");
}

function priorityScore(priority: DecisionDataGapResolverAction["priority"]): number {
  if (priority === "critical") return 35;
  if (priority === "high") return 28;
  if (priority === "medium") return 20;
  return 12;
}

function statusScore(status: DecisionDataGapResolverActionStatus): number {
  if (status === "ready") return 45;
  if (status === "waiting-env") return 32;
  if (status === "waiting-supabase") return 30;
  if (status === "watch") return 18;
  return 6;
}

function statusForFamily(family: DecisionDataAuthorityFamily): DecisionDataGapResolverActionStatus {
  if (family.status === "dry-run-ready" && safeCommand(family.command)) return "ready";
  if (family.status === "needs-provider-env") return "waiting-env";
  if (family.status === "needs-supabase-proof") return "waiting-supabase";
  if (family.status === "computed-shadow" || family.status === "live-authorized") return "watch";
  return "blocked";
}

function statusForStep(step: DecisionDataAuthorityStep): DecisionDataGapResolverActionStatus {
  if (step.status === "ready" && safeCommand(step.command)) return "ready";
  if (step.id.includes("supabase") || step.id.includes("schema")) return step.status === "blocked" ? "waiting-supabase" : "watch";
  if (step.status === "waiting") return "waiting-env";
  return step.status === "ready" ? "watch" : "blocked";
}

function oddsImpactFor(family: DecisionDataAuthorityFamily): string {
  if (family.category === "odds") return "Unlocks no-vig probability, value edge, EV, market movement, and closing-line checks.";
  if (family.category === "fixtures" || family.category === "live-scores") return "Keeps odds comparisons attached to the correct fixture and match state.";
  return "Reduces false-positive value picks by improving context before odds edges are trusted.";
}

function trainingImpactFor(family: DecisionDataAuthorityFamily): string {
  if (family.category === "historical-results" || family.category === "training") return "Adds the real corpus rows needed for calibration, backtests, and learned guardrails.";
  if (family.storageTables.length) return `Feeds ${family.storageTables.join(", ")} for future feature snapshots and backtests.`;
  return "Keeps this signal in shadow mode until it can be normalized into the training corpus.";
}

function aiReviewImpactFor(family: DecisionDataAuthorityFamily): string {
  if (family.category === "news" || family.category === "injuries" || family.category === "lineups") {
    return "Gives the AI reviewer source-grounded evidence so it does not invent team news or availability.";
  }
  return "Adds cited evidence IDs the AI reviewer can inspect without upgrading unsupported claims.";
}

function actionFromFamily(family: DecisionDataAuthorityFamily): DecisionDataGapResolverAction {
  const status = statusForFamily(family);
  const missingEnv = unique(family.missingEnv);
  const blockers = unique([...family.blockers, ...family.storageMissing]);
  const score = clamp(priorityScore(family.priority) + statusScore(status) + Math.min(family.affectedMatches * 3, 18) + Math.round(family.authorityScore * 0.15));
  return {
    id: `resolve-${family.category}`,
    kind: family.category === "training" || family.category === "historical-results" ? "training-corpus" : "provider-feed",
    status,
    priority: family.priority,
    label: family.label,
    provider: family.provider,
    score,
    command: family.command,
    verifyUrl: family.verifyUrl,
    safeToRun: status === "ready" && safeCommand(family.command),
    missingEnv,
    blockers,
    expectedEvidence: family.expectedEvidence,
    unlocks: {
      liveDecisionUse: family.liveDecisionUse,
      modelImpact: family.modelImpact,
      oddsImpact: oddsImpactFor(family),
      trainingImpact: trainingImpactFor(family),
      aiReviewImpact: aiReviewImpactFor(family)
    },
    storageTables: family.storageTables
  };
}

function actionFromStep(step: DecisionDataAuthorityStep): DecisionDataGapResolverAction {
  const status = statusForStep(step);
  const blockers = unique(step.blockedBy);
  return {
    id: `resolve-${step.id}`,
    kind: "proof-gate",
    status,
    priority: step.id === "prove-oddspadi-supabase" || step.id === "verify-storage-schema" ? "critical" : "high",
    label: step.label,
    provider: "OddsPadi runtime proof",
    score: clamp(priorityScore(step.id === "prove-oddspadi-supabase" || step.id === "verify-storage-schema" ? "critical" : "high") + statusScore(status)),
    command: step.command,
    verifyUrl: step.verifyUrl,
    safeToRun: status === "ready" && safeCommand(step.command),
    missingEnv: blockers.filter((item) => /^[A-Z0-9_]+$/.test(item)),
    blockers,
    expectedEvidence: step.expectedEvidence,
    unlocks: {
      liveDecisionUse: "not-applicable",
      modelImpact: "Proves the runtime gate that must pass before model trust can rise.",
      oddsImpact: "Keeps odds intelligence from treating unverified provider data as actionable.",
      trainingImpact: "Required before write-mode corpus imports or backtest storage can be trusted.",
      aiReviewImpact: "Supplies a proof artifact the AI reviewer can cite instead of guessing operational state."
    },
    storageTables: []
  };
}

function sortActions(actions: DecisionDataGapResolverAction[]): DecisionDataGapResolverAction[] {
  const statusRank: Record<DecisionDataGapResolverActionStatus, number> = {
    ready: 5,
    "waiting-supabase": 4,
    "waiting-env": 3,
    watch: 2,
    blocked: 1
  };
  return actions.slice().sort((a, b) => {
    const status = statusRank[b.status] - statusRank[a.status];
    if (status !== 0) return status;
    return b.score - a.score;
  });
}

function totalsFor(actions: DecisionDataGapResolverAction[]): DecisionDataGapResolver["totals"] {
  return {
    actions: actions.length,
    ready: actions.filter((item) => item.status === "ready").length,
    waitingEnv: actions.filter((item) => item.status === "waiting-env").length,
    waitingSupabase: actions.filter((item) => item.status === "waiting-supabase").length,
    watch: actions.filter((item) => item.status === "watch").length,
    blocked: actions.filter((item) => item.status === "blocked").length
  };
}

function resolverStatus(totals: DecisionDataGapResolver["totals"], authority: DecisionDataAuthority): DecisionDataGapResolverStatus {
  if (totals.ready > 0) return "ready-dry-run";
  if (authority.status === "blocked" || totals.blocked === totals.actions) return "blocked";
  if (totals.waitingSupabase > 0) return "needs-supabase-proof";
  if (totals.waitingEnv > 0) return "needs-env";
  return "watch";
}

function summaryFor(status: DecisionDataGapResolverStatus, next: DecisionDataGapResolverAction | null): string {
  if (status === "ready-dry-run") return `Data gap resolver has a safe next proof: ${next?.label ?? "provider dry-run"}.`;
  if (status === "needs-supabase-proof") return "Data gap resolver is blocked first by OddsPadi Supabase target, credential, MCP, or op_ schema proof.";
  if (status === "needs-env") return "Data gap resolver needs provider or admin environment variables before real-data dry-runs can run.";
  if (status === "blocked") return "Data gap resolver found no safe provider proof path yet; repair the listed blockers first.";
  return "Data gap resolver is watching computed or shadow signals while write, train, and publish controls stay locked.";
}

export function buildDecisionDataGapResolver({
  date,
  sport,
  dataAuthority,
  providerIngestionEvidence,
  requirementPulse,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  dataAuthority: DecisionDataAuthority;
  providerIngestionEvidence: DecisionProviderIngestionEvidence;
  requirementPulse?: DecisionRequirementPulse | null;
  now?: Date;
}): DecisionDataGapResolver {
  const familyActions = dataAuthority.families.map(actionFromFamily);
  const stepActions = dataAuthority.activationSteps.map(actionFromStep);
  const actions = sortActions([...stepActions, ...familyActions]).slice(0, 12);
  const totals = totalsFor(actions);
  const status = resolverStatus(totals, dataAuthority);
  const nextAction = actions.find((item) => item.safeToRun) ?? actions[0] ?? null;
  const resolverHash = stableHash({
    date,
    sport,
    authority: dataAuthority.authorityHash,
    provider: providerIngestionEvidence.evidenceHash,
    pulse: requirementPulse?.pulseHash ?? null,
    actions: actions.map((item) => [item.id, item.status, item.score])
  });

  return {
    mode: "data-gap-resolver",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    resolverHash,
    summary: summaryFor(status, nextAction),
    totals,
    nextAction,
    actions,
    controls: {
      canInspectReadOnly: true,
      canRunNextCommand: Boolean(nextAction?.safeToRun),
      canRunProviderDryRun: dataAuthority.controls.canRunProviderDryRun,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/data-gap-resolver",
      "/api/sports/decision/data-authority",
      "/api/sports/decision/provider-ingestion-evidence",
      "/api/sports/decision/requirement-pulse",
      ...(requirementPulse?.proofUrls ?? []),
      ...dataAuthority.proofUrls,
      ...providerIngestionEvidence.proofUrls
    ]),
    locks: unique([
      "Resolver commands are read-only or dry-run only.",
      "Do not write provider rows until Supabase target and op_ schema proof pass.",
      "Do not train models until real corpus and backtests pass.",
      "Do not publish or upgrade public action from resolver output.",
      ...dataAuthority.locks,
      ...providerIngestionEvidence.controls.forbiddenActions
    ])
  };
}
