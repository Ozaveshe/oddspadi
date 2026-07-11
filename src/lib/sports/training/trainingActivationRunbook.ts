import { hasAnyConfiguredEnv, hasConfiguredEnv } from "@/lib/env";
import type { LearnedWeightPromotionGovernor } from "@/lib/sports/training/learnedWeightPromotionGovernor";
import type { LearnedWeightShadowComparison } from "@/lib/sports/training/learnedWeightShadowComparison";
import type { ShadowTrainingCandidates } from "@/lib/sports/training/shadowTrainingCandidates";
import type { TrainingCorpusCommand } from "@/lib/sports/training/multiSportCorpusPlan";
import type { TrainingCorpusProof } from "@/lib/sports/training/trainingCorpusProof";
import type { TrainingReadiness } from "@/lib/sports/training/trainingReadiness";
import { decisionCurlCommand, decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";

type EnvMap = Record<string, string | undefined>;

export type TrainingActivationRunbookStatus = "ready-readonly" | "waiting-corpus" | "waiting-backtest" | "waiting-governance" | "blocked";
export type TrainingActivationStepStatus = "done" | "ready" | "waiting" | "blocked";
export type TrainingActivationStepId =
  | "prove-supabase"
  | "probe-provider-readiness"
  | "probe-odds-provider-readiness"
  | "run-provider-dry-run"
  | "write-corpus-review"
  | "generate-feature-snapshots"
  | "run-real-backtests"
  | "inspect-shadow-candidates"
  | "inspect-promotion-governor"
  | "run-shadow-comparison"
  | "operator-activation-review";

export type TrainingActivationStep = {
  id: TrainingActivationStepId;
  label: string;
  status: TrainingActivationStepStatus;
  command: string | null;
  verifyUrl: string;
  safeToRun: boolean;
  expectedEvidence: string;
  missingEnv: string[];
  blockedBy: string[];
  unlocks: string[];
};

export type TrainingActivationRunbook = {
  generatedAt: string;
  date: string;
  mode: "training-activation-runbook";
  status: TrainingActivationRunbookStatus;
  runbookHash: string;
  summary: string;
  nextStep: TrainingActivationStep | null;
  steps: TrainingActivationStep[];
  totals: {
    done: number;
    ready: number;
    waiting: number;
    blocked: number;
  };
  controls: {
    canInspectReadOnly: true;
    canRunNextSafeCommand: boolean;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeightsToPredictions: false;
    canPromoteLearnedWeights: false;
    canPublishPicks: false;
    canUpgradePublicAction: false;
  };
  blockers: string[];
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

function hasAnyEnv(env: EnvMap, keys: string[]): boolean {
  return hasAnyConfiguredEnv(env, keys);
}

function providerProbeMissingEnv(env: EnvMap): string[] {
  return unique([
    hasConfiguredEnv(env, "ODDSPADI_ADMIN_TOKEN") ? "" : "ODDSPADI_ADMIN_TOKEN",
    hasAnyEnv(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]) ? "" : "API_FOOTBALL_KEY or APISPORTS_KEY"
  ]);
}

function oddsProviderProbeMissingEnv(env: EnvMap): string[] {
  return unique([
    hasConfiguredEnv(env, "ODDSPADI_ADMIN_TOKEN") ? "" : "ODDSPADI_ADMIN_TOKEN",
    hasAnyEnv(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]) ? "" : "THE_ODDS_API_KEY or ODDS_API_KEY"
  ]);
}

function isSafeTrainingCommand(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  if (lower.includes("dryrun=0") || lower.includes("dryrun=false") || lower.includes("persist=1") || lower.includes("service_role")) return false;
  if (lower.startsWith("curl.exe -x post") && lower.includes("/api/sports/decision/training/provider-readiness")) return true;
  return lower.startsWith("curl.exe -ss") || (lower.startsWith("curl.exe -x post") && lower.includes("dryrun=1"));
}

function commandStep(input: Omit<TrainingActivationStep, "safeToRun">): TrainingActivationStep {
  return {
    ...input,
    missingEnv: unique(input.missingEnv),
    blockedBy: unique(input.blockedBy),
    safeToRun: input.status === "ready" && input.missingEnv.length === 0 && isSafeTrainingCommand(input.command)
  };
}

function readOnlyCommand(label: string, verifyUrl: string): TrainingCorpusCommand {
  return {
    label,
    command: decisionCurlCommand(verifyUrl),
    verifyUrl,
    safeToRun: true,
    missingEnv: [],
    expectedEvidence: `Returns ${label.toLowerCase()} without writes.`
  };
}

function providerReadinessCommand(): TrainingCorpusCommand {
  const verifyUrl =
    "/api/sports/decision/training/provider-readiness?provider=api-football&league=39&season=2025&includeEvents=1&includeContext=1&includeStandings=1&includeAvailability=1&includeLineups=1&limit=1";
  return {
    label: "API-Football provider readiness probe",
    command: `curl.exe -X POST "${decisionSiteOrigin()}${verifyUrl}" -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`,
    verifyUrl,
    safeToRun: true,
    missingEnv: [],
    expectedEvidence:
      "Returns per-feed fixture, event, standings, availability/suspension, and lineup readiness without writes or season backfill."
  };
}

function oddsProviderReadinessCommand(date: string): TrainingCorpusCommand {
  const query = new URLSearchParams({
    provider: "the-odds-api",
    sportKey: "soccer_epl",
    date: date.includes("T") ? date : `${date}T12:00:00Z`,
    regions: "uk,eu",
    limit: "5"
  });
  const verifyUrl = `/api/sports/decision/training/provider-readiness?${query.toString()}`;

  return {
    label: "The Odds API bookmaker odds readiness probe",
    command: `curl.exe -X POST "${decisionSiteOrigin()}${verifyUrl}" -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`,
    verifyUrl,
    safeToRun: true,
    missingEnv: [],
    expectedEvidence:
      "Returns bookmaker h2h odds readiness for EPL, normalized selection rows, no-vig inputs, and dry-run storage safety without writes."
  };
}

function stepStatus(conditionDone: boolean, conditionReady: boolean, blocked: boolean): TrainingActivationStepStatus {
  if (blocked) return "blocked";
  if (conditionDone) return "done";
  if (conditionReady) return "ready";
  return "waiting";
}

function nextActionCommand(command: TrainingCorpusCommand, fallbackUrl: string): TrainingCorpusCommand {
  return command.command ? command : readOnlyCommand(command.label, command.verifyUrl ?? fallbackUrl);
}

function buildSteps({
  date,
  trainingCorpusProof,
  trainingReadiness,
  shadowCandidates,
  promotionGovernor,
  shadowComparison,
  env
}: {
  date: string;
  trainingCorpusProof: TrainingCorpusProof;
  trainingReadiness: TrainingReadiness;
  shadowCandidates: ShadowTrainingCandidates;
  promotionGovernor: LearnedWeightPromotionGovernor;
  shadowComparison: LearnedWeightShadowComparison;
  env: EnvMap;
}): TrainingActivationStep[] {
  const supabaseBlocked = trainingCorpusProof.status === "blocked-supabase";
  const readinessBlocked = trainingReadiness.status === "blocked";
  const nextTrainingCommand = nextActionCommand(trainingReadiness.nextSafeCommand, "/api/sports/decision/training/readiness");
  const corpusCommand = nextActionCommand(trainingCorpusProof.nextProof, "/api/sports/decision/training/corpus-proof");
  const providerProbeCommand = providerReadinessCommand();
  const missingProviderProbeEnv = providerProbeMissingEnv(env);
  const oddsProviderProbeCommand = oddsProviderReadinessCommand(date);
  const missingOddsProviderProbeEnv = oddsProviderProbeMissingEnv(env);
  const candidateCommand = readOnlyCommand("Shadow training candidates", "/api/sports/decision/training/shadow-candidates");
  const governorCommand = readOnlyCommand("Learned weight promotion governor", "/api/sports/decision/training/promotion-governor");
  const comparisonCommand = readOnlyCommand("Learned weight shadow comparison", "/api/sports/decision/training/shadow-comparison");

  return [
    commandStep({
      id: "prove-supabase",
      label: "Prove OddsPadi Supabase schema",
      status: stepStatus(trainingCorpusProof.supabase.schemaVerified, trainingCorpusProof.supabase.canUseMcpForSchema, supabaseBlocked),
      command: corpusCommand.command,
      verifyUrl: "/api/sports/decision/training/corpus-proof",
      expectedEvidence: "Corpus proof confirms the OddsPadi project, expected schema, and no cross-project blockers.",
      missingEnv: corpusCommand.missingEnv,
      blockedBy: trainingCorpusProof.supabase.blocker ? [trainingCorpusProof.supabase.blocker] : [],
      unlocks: ["provider dry-runs", "training corpus counts", "backtest storage proof"]
    }),
    commandStep({
      id: "probe-provider-readiness",
      label: "Probe provider feed readiness",
      status: missingProviderProbeEnv.length ? "waiting" : "ready",
      command: providerProbeCommand.command,
      verifyUrl: providerProbeCommand.verifyUrl ?? "/api/sports/decision/training/provider-readiness",
      expectedEvidence: providerProbeCommand.expectedEvidence,
      missingEnv: missingProviderProbeEnv,
      blockedBy: [],
      unlocks: ["fixture provider proof", "context feed proof", "safer first corpus dry-run"]
    }),
    commandStep({
      id: "probe-odds-provider-readiness",
      label: "Probe bookmaker odds readiness",
      status: missingOddsProviderProbeEnv.length ? "waiting" : "ready",
      command: oddsProviderProbeCommand.command,
      verifyUrl: oddsProviderProbeCommand.verifyUrl ?? "/api/sports/decision/training/provider-readiness",
      expectedEvidence: oddsProviderProbeCommand.expectedEvidence,
      missingEnv: missingOddsProviderProbeEnv,
      blockedBy: [],
      unlocks: ["implied probability proof", "no-vig margin proof", "positive-EV ranking proof"]
    }),
    commandStep({
      id: "run-provider-dry-run",
      label: "Run capped provider dry-runs",
      status: stepStatus(false, trainingCorpusProof.controls.canRunProviderDryRun || trainingReadiness.controls.canRunBackfillDryRun, supabaseBlocked),
      command: nextTrainingCommand.command,
      verifyUrl: nextTrainingCommand.verifyUrl ?? "/api/sports/decision/training/readiness",
      expectedEvidence: nextTrainingCommand.expectedEvidence,
      missingEnv: nextTrainingCommand.missingEnv,
      blockedBy: trainingCorpusProof.controls.canRunProviderDryRun || trainingReadiness.controls.canRunBackfillDryRun ? [] : trainingReadiness.blockers,
      unlocks: ["normalized fixtures", "odds snapshots", "context snapshots", "feature-source checks"]
    }),
    commandStep({
      id: "write-corpus-review",
      label: "Review write-mode corpus import",
      status: stepStatus(trainingReadiness.totals.realFinishedFixtures > 0, false, readinessBlocked),
      command: decisionCurlCommand("/api/sports/decision/training/readiness"),
      verifyUrl: "/api/sports/decision/training/readiness",
      expectedEvidence: "Readiness shows real provider-backed finished fixtures and odds before any write-mode import is expanded.",
      missingEnv: [],
      blockedBy: trainingReadiness.totals.realFinishedFixtures > 0 ? [] : ["No real finished fixture rows are available yet."],
      unlocks: ["train/validation/test corpus", "feature snapshots", "backtest inputs"]
    }),
    commandStep({
      id: "generate-feature-snapshots",
      label: "Generate historical feature snapshots",
      status: stepStatus(trainingReadiness.totals.featureDeficit === 0 && trainingReadiness.totals.realFinishedFixtures > 0, false, readinessBlocked),
      command: decisionCurlCommand("/api/sports/decision/training/readiness"),
      verifyUrl: "/api/sports/decision/training/readiness",
      expectedEvidence: "Feature snapshot count matches historical real fixtures by sport.",
      missingEnv: [],
      blockedBy: trainingReadiness.totals.featureDeficit ? [`Feature snapshot deficit: ${trainingReadiness.totals.featureDeficit}.`] : [],
      unlocks: ["model-card feature parity", "governance drift checks"]
    }),
    commandStep({
      id: "run-real-backtests",
      label: "Run real-data backtests",
      status: stepStatus(trainingReadiness.totals.backtestDeficit === 0 && trainingReadiness.totals.backtestRuns > 0, false, readinessBlocked),
      command: decisionCurlCommand("/api/sports/decision/training/readiness"),
      verifyUrl: "/api/sports/decision/training/readiness",
      expectedEvidence: "Completed backtests exist for football, basketball, and tennis with ROI, Brier, log loss, and CLV.",
      missingEnv: [],
      blockedBy: trainingReadiness.totals.backtestDeficit ? [`Backtest deficit: ${trainingReadiness.totals.backtestDeficit}.`] : [],
      unlocks: ["learned weights", "shadow candidate inspection"]
    }),
    commandStep({
      id: "inspect-shadow-candidates",
      label: "Inspect shadow learned-weight candidates",
      status: stepStatus(shadowCandidates.status === "ready-shadow", shadowCandidates.status !== "blocked", shadowCandidates.status === "blocked"),
      command: candidateCommand.command,
      verifyUrl: "/api/sports/decision/training/shadow-candidates",
      expectedEvidence: "Candidate receipt lists learned weights, backtest metrics, and promotion blockers without activation.",
      missingEnv: [],
      blockedBy: shadowCandidates.status === "ready-shadow" ? [] : shadowCandidates.blockers,
      unlocks: ["promotion governor", "shadow comparison"]
    }),
    commandStep({
      id: "inspect-promotion-governor",
      label: "Inspect learned-weight promotion governor",
      status: stepStatus(promotionGovernor.status === "eligible-shadow", promotionGovernor.status !== "blocked", promotionGovernor.status === "blocked"),
      command: governorCommand.command,
      verifyUrl: "/api/sports/decision/training/promotion-governor",
      expectedEvidence: "Governor compares candidates to model cards and keeps promotion/apply controls locked.",
      missingEnv: [],
      blockedBy: promotionGovernor.status === "eligible-shadow" ? [] : promotionGovernor.blockers,
      unlocks: ["read-only learned-weight shadow comparison"]
    }),
    commandStep({
      id: "run-shadow-comparison",
      label: "Run learned-weight shadow comparison",
      status: stepStatus(shadowComparison.status === "ready-shadow", shadowComparison.status !== "blocked", shadowComparison.status === "blocked"),
      command: comparisonCommand.command,
      verifyUrl: "/api/sports/decision/training/shadow-comparison",
      expectedEvidence: "Comparison shows would-pass, would-downgrade, watch, and blocked deltas without mutating predictions.",
      missingEnv: [],
      blockedBy: shadowComparison.status === "ready-shadow" ? [] : shadowComparison.blockers,
      unlocks: ["operator review package", "future manual activation decision"]
    }),
    commandStep({
      id: "operator-activation-review",
      label: "Manual operator activation review",
      status: "waiting",
      command: null,
      verifyUrl: "/api/sports/decision/training/shadow-comparison",
      expectedEvidence: "Human operator reviews corpus, backtest, governor, and shadow comparison receipts before any future activation.",
      missingEnv: [],
      blockedBy: ["Manual activation is intentionally unavailable in the MVP."],
      unlocks: ["future controlled learned-weight activation"]
    })
  ];
}

function totals(steps: TrainingActivationStep[]): TrainingActivationRunbook["totals"] {
  return {
    done: steps.filter((step) => step.status === "done").length,
    ready: steps.filter((step) => step.status === "ready").length,
    waiting: steps.filter((step) => step.status === "waiting").length,
    blocked: steps.filter((step) => step.status === "blocked").length
  };
}

function nextStep(steps: TrainingActivationStep[]): TrainingActivationStep | null {
  return steps.find((step) => step.status !== "done") ?? null;
}

function statusFromSteps(steps: TrainingActivationStep[], trainingReadiness: TrainingReadiness, shadowCandidates: ShadowTrainingCandidates, promotionGovernor: LearnedWeightPromotionGovernor): TrainingActivationRunbookStatus {
  if (steps.some((step) => step.status === "blocked")) return "blocked";
  if (trainingReadiness.status === "waiting-corpus" || trainingReadiness.status === "backfill-ready") return "waiting-corpus";
  if (shadowCandidates.status === "waiting-backtest") return "waiting-backtest";
  if (promotionGovernor.status === "waiting-governance") return "waiting-governance";
  if (steps.some((step) => step.status === "ready" && step.safeToRun)) return "ready-readonly";
  return "blocked";
}

function summary(status: TrainingActivationRunbookStatus, counts: TrainingActivationRunbook["totals"]): string {
  const suffix = `${counts.done} done, ${counts.ready} ready, ${counts.waiting} waiting, ${counts.blocked} blocked.`;
  if (status === "ready-readonly") return `Training activation has a safe read-only or dry-run step ready: ${suffix}`;
  if (status === "waiting-corpus") return `Training activation is waiting on the 10-year real corpus: ${suffix}`;
  if (status === "waiting-backtest") return `Training activation is waiting on completed real-data backtests: ${suffix}`;
  if (status === "waiting-governance") return `Training activation is waiting on model governance approval: ${suffix}`;
  return `Training activation is blocked by corpus, candidate, governor, or shadow-comparison proof: ${suffix}`;
}

export function buildTrainingActivationRunbook({
  date,
  trainingCorpusProof,
  trainingReadiness,
  shadowCandidates,
  promotionGovernor,
  shadowComparison,
  env = process.env,
  now = new Date()
}: {
  date: string;
  trainingCorpusProof: TrainingCorpusProof;
  trainingReadiness: TrainingReadiness;
  shadowCandidates: ShadowTrainingCandidates;
  promotionGovernor: LearnedWeightPromotionGovernor;
  shadowComparison: LearnedWeightShadowComparison;
  env?: EnvMap;
  now?: Date;
}): TrainingActivationRunbook {
  const steps = buildSteps({ date, trainingCorpusProof, trainingReadiness, shadowCandidates, promotionGovernor, shadowComparison, env });
  const counts = totals(steps);
  const status = statusFromSteps(steps, trainingReadiness, shadowCandidates, promotionGovernor);
  const selected = nextStep(steps);

  return {
    generatedAt: now.toISOString(),
    date,
    mode: "training-activation-runbook",
    status,
    runbookHash: stableHash({
      date,
      corpus: trainingCorpusProof.proofHash,
      readiness: trainingReadiness.readinessHash,
      candidates: shadowCandidates.candidateHash,
      governor: promotionGovernor.governorHash,
      comparison: shadowComparison.comparisonHash,
      steps: steps.map((step) => [step.id, step.status, step.safeToRun])
    }),
    summary: summary(status, counts),
    nextStep: selected,
    steps,
    totals: counts,
    controls: {
      canInspectReadOnly: true,
      canRunNextSafeCommand: Boolean(selected?.safeToRun),
      canRunProviderDryRun: trainingCorpusProof.controls.canRunProviderDryRun || trainingReadiness.controls.canRunBackfillDryRun,
      canWriteProviderRows: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeightsToPredictions: false,
      canPromoteLearnedWeights: false,
      canPublishPicks: false,
      canUpgradePublicAction: false
    },
    blockers: unique([
      ...trainingReadiness.blockers,
      ...shadowCandidates.blockers,
      ...promotionGovernor.blockers,
      ...shadowComparison.blockers,
      ...steps.flatMap((step) => step.blockedBy.map((blocker) => `${step.label}: ${blocker}`))
    ]),
    proofUrls: unique([
      "/api/sports/decision/training/activation-runbook",
      ...trainingCorpusProof.proofUrls,
      ...trainingReadiness.proofUrls,
      ...shadowCandidates.proofUrls,
      ...promotionGovernor.proofUrls,
      ...shadowComparison.proofUrls
    ])
  };
}
