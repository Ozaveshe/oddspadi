import type { DecisionAIReviewReadiness } from "@/lib/sports/prediction/decisionAIReviewReadiness";
import type { DecisionDataGapResolver } from "@/lib/sports/prediction/decisionDataGapResolver";
import type { DecisionRequirementPulse } from "@/lib/sports/prediction/decisionRequirementPulse";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { DecisionSupabaseProofBinder } from "@/lib/sports/prediction/decisionSupabaseProofBinder";
import type { Sport } from "@/lib/sports/types";
import type { TrainingCorpusProof } from "@/lib/sports/training/trainingCorpusProof";

export type DecisionLaunchCommanderStatus = "ready-proof" | "waiting-env" | "blocked" | "watch";
export type DecisionLaunchCommanderItemStatus = "ready" | "waiting" | "blocked" | "watch" | "pass";
export type DecisionLaunchCommanderItemCategory = "supabase" | "training" | "provider" | "openai" | "requirements" | "safety";

export type DecisionLaunchCommanderItem = {
  id: string;
  category: DecisionLaunchCommanderItemCategory;
  status: DecisionLaunchCommanderItemStatus;
  priority: "critical" | "high" | "medium" | "low";
  label: string;
  detail: string;
  command: string | null;
  verifyUrl: string;
  safeToRun: boolean;
  missingEnv: string[];
  unlocks: string[];
  blocks: string[];
};

export type DecisionLaunchCommander = {
  mode: "decision-launch-commander";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionLaunchCommanderStatus;
  commanderHash: string;
  summary: string;
  totals: {
    items: number;
    ready: number;
    waiting: number;
    blocked: number;
    watch: number;
    pass: number;
  };
  topItem: DecisionLaunchCommanderItem | null;
  items: DecisionLaunchCommanderItem[];
  controls: {
    canInspectReadOnly: true;
    canRunNextCommand: boolean;
    canRunProviderDryRun: boolean;
    canRunOpenAIReview: boolean;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canPersistTrainingRows: false;
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

function unique(values: Array<string | null | undefined>, limit = 30): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function commandIsSafe(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  if (lower.includes("persist=1") || lower.includes("dryrun=0") || lower.includes("deploy --prod")) return false;
  if (lower.includes("service_role") || lower.includes("supabase_service_role_key")) return false;
  return lower.includes("curl.exe") || lower === "npm run build" || lower === "npx netlify status" || lower === "npx netlify env:list";
}

function priorityRank(priority: DecisionLaunchCommanderItem["priority"]): number {
  if (priority === "critical") return 4;
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function statusRank(status: DecisionLaunchCommanderItemStatus): number {
  if (status === "blocked") return 5;
  if (status === "ready") return 4;
  if (status === "waiting") return 3;
  if (status === "watch") return 2;
  return 1;
}

function sortItems(items: DecisionLaunchCommanderItem[]): DecisionLaunchCommanderItem[] {
  return items.slice().sort((a, b) => {
    const status = statusRank(b.status) - statusRank(a.status);
    if (status !== 0) return status;
    const priority = priorityRank(b.priority) - priorityRank(a.priority);
    if (priority !== 0) return priority;
    return a.id.localeCompare(b.id);
  });
}

function totalsFor(items: DecisionLaunchCommanderItem[]): DecisionLaunchCommander["totals"] {
  return {
    items: items.length,
    ready: items.filter((item) => item.status === "ready").length,
    waiting: items.filter((item) => item.status === "waiting").length,
    blocked: items.filter((item) => item.status === "blocked").length,
    watch: items.filter((item) => item.status === "watch").length,
    pass: items.filter((item) => item.status === "pass").length
  };
}

function commanderStatus(totals: DecisionLaunchCommander["totals"]): DecisionLaunchCommanderStatus {
  if (totals.blocked > 0) return "blocked";
  if (totals.ready > 0) return "ready-proof";
  if (totals.waiting > 0) return "waiting-env";
  return "watch";
}

function summaryFor(status: DecisionLaunchCommanderStatus, topItem: DecisionLaunchCommanderItem | null): string {
  if (status === "blocked") return `Launch commander is blocked first by ${topItem?.label ?? "a critical proof gate"}.`;
  if (status === "ready-proof") return `Launch commander has a safe next proof ready: ${topItem?.label ?? "read-only check"}.`;
  if (status === "waiting-env") return `Launch commander is waiting on ${topItem?.missingEnv.join(", ") || "environment proof"}.`;
  return "Launch commander is watching remaining proof gates while write, train, publish, and upgrade controls stay locked.";
}

function item(input: Omit<DecisionLaunchCommanderItem, "safeToRun">): DecisionLaunchCommanderItem {
  return {
    ...input,
    missingEnv: unique(input.missingEnv),
    blocks: unique(input.blocks),
    unlocks: unique(input.unlocks),
    safeToRun: input.status === "ready" && input.missingEnv.length === 0 && commandIsSafe(input.command)
  };
}

function statusFromSupabase(status: DecisionSupabaseProofBinder["status"]): DecisionLaunchCommanderItemStatus {
  if (status === "ready-proof") return "pass";
  if (status === "blocked-cross-project" || status === "blocked-invalid-key") return "blocked";
  return "waiting";
}

function statusFromCorpus(status: TrainingCorpusProof["status"]): DecisionLaunchCommanderItemStatus {
  if (status === "shadow-ready") return "pass";
  if (status === "ready-dry-run") return "ready";
  if (status === "blocked-supabase") return "blocked";
  if (status === "waiting-env") return "waiting";
  return "watch";
}

function statusFromData(status: DecisionDataGapResolver["status"]): DecisionLaunchCommanderItemStatus {
  if (status === "ready-dry-run") return "ready";
  if (status === "needs-supabase-proof" || status === "blocked") return "blocked";
  if (status === "needs-env") return "waiting";
  return "watch";
}

function statusFromAI(status: DecisionAIReviewReadiness["status"]): DecisionLaunchCommanderItemStatus {
  if (status === "ready-to-run") return "ready";
  if (status === "needs-key") return "waiting";
  return "blocked";
}

function statusFromPulse(status: DecisionRequirementPulse["status"]): DecisionLaunchCommanderItemStatus {
  if (status === "ready") return "pass";
  if (status === "blocked") return "blocked";
  return "watch";
}

export function buildDecisionLaunchCommander({
  date,
  sport,
  supabaseProofBinder,
  trainingCorpusProof,
  dataGapResolver,
  aiReviewReadiness,
  requirementPulse,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  supabaseProofBinder: DecisionSupabaseProofBinder;
  trainingCorpusProof: TrainingCorpusProof;
  dataGapResolver: DecisionDataGapResolver;
  aiReviewReadiness: DecisionAIReviewReadiness;
  requirementPulse: DecisionRequirementPulse;
  now?: Date;
}): DecisionLaunchCommander {
  const rawItems = [
    item({
      id: "supabase-proof",
      category: "supabase",
      status: statusFromSupabase(supabaseProofBinder.status),
      priority: "critical",
      label: "Prove OddsPadi Supabase",
      detail: supabaseProofBinder.summary,
      command: supabaseProofBinder.nextProof.command,
      verifyUrl: supabaseProofBinder.nextProof.verifyUrl,
      missingEnv: supabaseProofBinder.nextProof.missingEnv,
      unlocks: ["schema work", "provider dry-runs", "decision memory", "training corpus storage"],
      blocks: supabaseProofBinder.status === "ready-proof" ? [] : supabaseProofBinder.locks
    }),
    item({
      id: "training-corpus-proof",
      category: "training",
      status: statusFromCorpus(trainingCorpusProof.status),
      priority: "critical",
      label: "Prove 10-year corpus",
      detail: trainingCorpusProof.summary,
      command: trainingCorpusProof.nextProof.command,
      verifyUrl: trainingCorpusProof.nextProof.verifyUrl ?? "/api/sports/decision/training/corpus-proof",
      missingEnv: trainingCorpusProof.nextProof.missingEnv,
      unlocks: ["real backtests", "calibration", "model cards", "shadow learned guardrails"],
      blocks: trainingCorpusProof.blockers
    }),
    item({
      id: "provider-data-proof",
      category: "provider",
      status: statusFromData(dataGapResolver.status),
      priority: "high",
      label: dataGapResolver.nextAction?.label ?? "Prove provider data",
      detail: dataGapResolver.summary,
      command: dataGapResolver.nextAction?.command ?? null,
      verifyUrl: dataGapResolver.nextAction?.verifyUrl ?? "/api/sports/decision/data-gap-resolver",
      missingEnv: dataGapResolver.nextAction?.missingEnv ?? [],
      unlocks: ["fixtures", "odds intelligence", "news/context evidence", "AI citations"],
      blocks: dataGapResolver.nextAction?.blockers ?? dataGapResolver.locks
    }),
    item({
      id: "openai-review-proof",
      category: "openai",
      status: statusFromAI(aiReviewReadiness.status),
      priority: "high",
      label: aiReviewReadiness.nextSafeCommand.label,
      detail: aiReviewReadiness.summary,
      command: aiReviewReadiness.nextSafeCommand.command,
      verifyUrl: aiReviewReadiness.nextSafeCommand.url,
      missingEnv: aiReviewReadiness.missingEnv,
      unlocks: ["guarded model critique", "same-or-safer executive review", "evidence-cited AI audit"],
      blocks: aiReviewReadiness.locks
    }),
    item({
      id: "mvp-requirement-pulse",
      category: "requirements",
      status: statusFromPulse(requirementPulse.status),
      priority: "medium",
      label: requirementPulse.topGap?.label ?? "Review MVP requirement pulse",
      detail: requirementPulse.summary,
      command: requirementPulse.topGap
        ? decisionCurlCommand(requirementPulse.topGap.proofUrl)
        : decisionCurlCommand(`/api/sports/decision/requirement-pulse?date=${encodeURIComponent(date)}`),
      verifyUrl: requirementPulse.topGap?.proofUrl ?? "/api/sports/decision/requirement-pulse",
      missingEnv: [],
      unlocks: ["product readiness", "operator focus", "MVP completeness tracking"],
      blocks: requirementPulse.groups.filter((group) => group.status !== "ready").map((group) => `${group.label}: ${group.nextAction}`)
    }),
    item({
      id: "responsible-controls",
      category: "safety",
      status: "pass",
      priority: "medium",
      label: "Keep responsible controls locked",
      detail: "Publishing, staking, persistence, training, provider writes, and public-action upgrades remain independently locked.",
      command: decisionCurlCommand(`/api/sports/decision/requirement-pulse?date=${encodeURIComponent(date)}`),
      verifyUrl: "/api/sports/decision/requirement-pulse",
      missingEnv: [],
      unlocks: ["safe public UX", "auditability"],
      blocks: []
    })
  ];
  const items = sortItems(rawItems);
  const totals = totalsFor(items);
  const status = commanderStatus(totals);
  const topItem = items.find((entry) => entry.status === "blocked") ?? items.find((entry) => entry.safeToRun) ?? items[0] ?? null;
  const commanderHash = stableHash({
    date,
    sport,
    status,
    items: items.map((entry) => [entry.id, entry.status, entry.priority, entry.verifyUrl, entry.missingEnv])
  });

  return {
    mode: "decision-launch-commander",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    commanderHash,
    summary: summaryFor(status, topItem),
    totals,
    topItem,
    items,
    controls: {
      canInspectReadOnly: true,
      canRunNextCommand: Boolean(topItem?.safeToRun),
      canRunProviderDryRun: dataGapResolver.controls.canRunProviderDryRun && trainingCorpusProof.controls.canRunProviderDryRun,
      canRunOpenAIReview: aiReviewReadiness.controls.canRunLiveReview,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/launch-commander",
      ...supabaseProofBinder.proofUrls,
      ...trainingCorpusProof.proofUrls,
      ...dataGapResolver.proofUrls,
      ...aiReviewReadiness.proofUrls,
      ...requirementPulse.proofUrls
    ]),
    locks: unique([
      "Launch commander can rank and inspect proof only.",
      "It cannot write provider rows, persist decisions, train models, publish picks, or upgrade public action.",
      ...supabaseProofBinder.locks,
      ...trainingCorpusProof.blockers,
      ...aiReviewReadiness.locks,
      ...dataGapResolver.locks
    ])
  };
}
