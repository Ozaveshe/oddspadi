import type { DecisionOddsSnapshotStorageReadiness } from "@/lib/sports/prediction/decisionOddsSnapshotStorageReadiness";
import type { DecisionShadowNextCycleInterpreter } from "@/lib/sports/prediction/decisionShadowNextCycleInterpreter";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { PublicHistoricalTrainingEvidence } from "@/lib/sports/training/publicHistoricalTrainingEvidence";

export type DecisionHistoricalDiagnosisLadderStatus =
  | "no-history"
  | "waiting-observation"
  | "ready-next-proof"
  | "manual-proof-required"
  | "needs-repair"
  | "blocked"
  | "complete-shadow";

export type DecisionHistoricalDiagnosisLadderStepState = "observed" | "ready" | "waiting" | "manual" | "blocked";

type ProviderRetestChecklistItem = PublicHistoricalTrainingEvidence["failureDiagnosis"]["providerRetestChecklist"][number];

export type DecisionHistoricalDiagnosisLadderStep = {
  id: ProviderRetestChecklistItem["id"];
  label: string;
  priority: number;
  state: DecisionHistoricalDiagnosisLadderStepState;
  requiredEvidence: string;
  proofUrl: string;
  safeToRun: boolean;
  observed: boolean;
  nextAction: string;
  evidence: string[];
};

export type DecisionHistoricalDiagnosisLadder = {
  generatedAt: string;
  date: string;
  sport: DecisionShadowNextCycleInterpreter["sport"];
  mode: "decision-historical-diagnosis-ladder";
  status: DecisionHistoricalDiagnosisLadderStatus;
  ladderHash: string;
  summary: string;
  input: {
    publicHistoricalEvidenceHash: string | null;
    interpreterHash: string;
    interpreterStatus: DecisionShadowNextCycleInterpreter["status"];
    proofHash: string | null;
    oddsStorageReadinessHash: string;
    oddsStorageStatus: DecisionOddsSnapshotStorageReadiness["status"];
  };
  observedProof: {
    id: ProviderRetestChecklistItem["id"] | null;
    label: string | null;
    proofUrl: string | null;
    proofHash: string | null;
    evidence: string | null;
  };
  selectedStep: DecisionHistoricalDiagnosisLadderStep | null;
  steps: DecisionHistoricalDiagnosisLadderStep[];
  nextTurn: {
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
    reason: string;
  };
  controls: {
    canInspectReadOnly: true;
    canObserveFixtureProof: boolean;
    canInspectOddsSnapshotReadiness: boolean;
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

function unique(values: Array<string | null | undefined>, limit = 32): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function itemIdForLabel(label: string | null, checklist: ProviderRetestChecklistItem[]): ProviderRetestChecklistItem["id"] | null {
  if (!label) return null;
  return checklist.find((item) => item.label === label)?.id ?? null;
}

function nextItemForTarget(proofTarget: string | null, checklist: ProviderRetestChecklistItem[]): ProviderRetestChecklistItem | null {
  if (!proofTarget) return null;
  return checklist.find((item) => item.proofUrl === proofTarget) ?? null;
}

function stateFor({
  item,
  evidence,
  observedId,
  selectedId
}: {
  item: ProviderRetestChecklistItem;
  evidence: PublicHistoricalTrainingEvidence;
  observedId: ProviderRetestChecklistItem["id"] | null;
  selectedId: ProviderRetestChecklistItem["id"] | null;
}): DecisionHistoricalDiagnosisLadderStepState {
  if (evidence.status === "failed" || evidence.status === "insufficient-history") return "blocked";
  if (item.id === observedId) return "observed";
  if (item.id === selectedId) return item.proofUrl.includes("/training/") ? "manual" : "ready";
  if (!observedId && item.priority === 1) return item.proofUrl.includes("/training/") ? "manual" : "ready";
  return "waiting";
}

function nextActionFor(step: DecisionHistoricalDiagnosisLadderStep): string {
  if (step.state === "observed") return "Keep this proof hash attached and move to the next provider retest proof.";
  if (step.state === "ready") return `Inspect ${step.label.toLowerCase()} as the next read-only proof.`;
  if (step.state === "manual") return "Hold for an operator-selected read-only training proof route before inspection.";
  if (step.state === "blocked") return "Repair historical evidence before this proof can be trusted.";
  return "Wait until the earlier provider retest proof is observed.";
}

function summaryFor(status: DecisionHistoricalDiagnosisLadderStatus, selectedStep: DecisionHistoricalDiagnosisLadderStep | null): string {
  if (status === "ready-next-proof" && selectedStep) {
    return `Historical diagnosis ladder is ready for ${selectedStep.label}; controls remain shadow-only.`;
  }
  if (status === "waiting-observation") return "Historical diagnosis ladder is waiting for the first safe fixture-identity observation.";
  if (status === "manual-proof-required" && selectedStep) {
    return `Historical diagnosis ladder reached ${selectedStep.label}, which requires a manual read-only proof selection.`;
  }
  if (status === "needs-repair") return "Historical diagnosis ladder observed a proof that needs repair before continuing.";
  if (status === "blocked") return "Historical diagnosis ladder is blocked by failed or insufficient historical evidence.";
  if (status === "complete-shadow") return "Historical diagnosis ladder has no remaining read-only provider retest proof.";
  return "Historical diagnosis ladder has no public historical evidence to orchestrate.";
}

function nextTurnFor({
  status,
  selectedStep,
  interpreter
}: {
  status: DecisionHistoricalDiagnosisLadderStatus;
  selectedStep: DecisionHistoricalDiagnosisLadderStep | null;
  interpreter: DecisionShadowNextCycleInterpreter;
}): DecisionHistoricalDiagnosisLadder["nextTurn"] {
  if (status === "waiting-observation") {
    return {
      label: interpreter.nextTurn.label,
      command: interpreter.nextTurn.command,
      verifyUrl: interpreter.nextTurn.verifyUrl,
      safeToRun: interpreter.nextTurn.safeToRun,
      reason: "Observe the selected fixture-identity proof through the shadow receipt before advancing the ladder."
    };
  }
  if (selectedStep) {
    return {
      label: selectedStep.state === "manual" ? `Select proof for ${selectedStep.label}` : `Inspect ${selectedStep.label}`,
      command: selectedStep.safeToRun ? decisionCurlCommand(selectedStep.proofUrl) : null,
      verifyUrl: selectedStep.proofUrl,
      safeToRun: selectedStep.safeToRun,
      reason: selectedStep.nextAction
    };
  }
  return {
    label: "No ladder proof selected",
    command: null,
    verifyUrl: "/api/sports/decision/historical-diagnosis-ladder",
    safeToRun: false,
    reason: "No safe provider retest proof is currently available."
  };
}

export function buildDecisionHistoricalDiagnosisLadder({
  publicHistoricalTrainingEvidence,
  interpreter,
  oddsSnapshotStorageReadiness,
  now = new Date()
}: {
  publicHistoricalTrainingEvidence: PublicHistoricalTrainingEvidence | null;
  interpreter: DecisionShadowNextCycleInterpreter;
  oddsSnapshotStorageReadiness: DecisionOddsSnapshotStorageReadiness;
  now?: Date;
}): DecisionHistoricalDiagnosisLadder {
  const evidence = publicHistoricalTrainingEvidence;
  const checklist = evidence?.failureDiagnosis.providerRetestChecklist ?? [];
  const observedId =
    interpreter.status === "observed-proof" && interpreter.interpretation.diagnosis.active
      ? itemIdForLabel(interpreter.interpretation.diagnosis.selectedLabel, checklist)
      : null;
  const nextItem =
    interpreter.status === "observed-proof"
      ? nextItemForTarget(interpreter.interpretation.diagnosis.proofTarget, checklist)
      : checklist[0] ?? null;
  const selectedId = nextItem?.id ?? null;
  const steps =
    evidence === null
      ? []
      : checklist.map((item) => {
          const state = stateFor({ item, evidence, observedId, selectedId });
          const safeToRun = state === "ready" && !item.proofUrl.includes("/training/");
          const step: DecisionHistoricalDiagnosisLadderStep = {
            id: item.id,
            label: item.label,
            priority: item.priority,
            state,
            requiredEvidence: item.requiredEvidence,
            proofUrl: item.proofUrl,
            safeToRun,
            observed: state === "observed",
            nextAction: "",
            evidence: unique([
              item.requiredEvidence,
              item.id === "odds-snapshots" ? oddsSnapshotStorageReadiness.summary : null,
              item.id === observedId ? interpreter.interpretation.learned : null
            ])
          };
          return {
            ...step,
            nextAction: nextActionFor(step)
          };
        });
  const selectedStep = steps.find((item) => item.id === selectedId) ?? steps.find((item) => item.state === "ready") ?? null;
  const status: DecisionHistoricalDiagnosisLadderStatus =
    evidence === null
      ? "no-history"
      : evidence.status === "failed" || evidence.status === "insufficient-history"
        ? "blocked"
        : interpreter.status === "needs-repair" || interpreter.status === "blocked"
          ? "needs-repair"
          : interpreter.status === "waiting-observation"
            ? "waiting-observation"
            : selectedStep?.state === "manual"
              ? "manual-proof-required"
              : selectedStep?.state === "ready"
                ? "ready-next-proof"
                : "complete-shadow";
  const observedItem = observedId ? checklist.find((item) => item.id === observedId) ?? null : null;
  const nextTurn = nextTurnFor({ status, selectedStep, interpreter });
  const ladderHash = stableHash({
    evidence: evidence?.evidenceHash ?? null,
    interpreter: interpreter.interpreterHash,
    oddsStorage: oddsSnapshotStorageReadiness.readinessHash,
    observedId,
    selectedId,
    states: steps.map((item) => [item.id, item.state])
  });

  return {
    generatedAt: now.toISOString(),
    date: interpreter.date,
    sport: interpreter.sport,
    mode: "decision-historical-diagnosis-ladder",
    status,
    ladderHash,
    summary: summaryFor(status, selectedStep),
    input: {
      publicHistoricalEvidenceHash: evidence?.evidenceHash ?? null,
      interpreterHash: interpreter.interpreterHash,
      interpreterStatus: interpreter.status,
      proofHash: interpreter.input.proofHash,
      oddsStorageReadinessHash: oddsSnapshotStorageReadiness.readinessHash,
      oddsStorageStatus: oddsSnapshotStorageReadiness.status
    },
    observedProof: {
      id: observedItem?.id ?? null,
      label: observedItem?.label ?? null,
      proofUrl: observedItem?.proofUrl ?? null,
      proofHash: interpreter.input.proofHash,
      evidence: observedItem ? compact(interpreter.interpretation.learned) : null
    },
    selectedStep,
    steps,
    nextTurn,
    controls: {
      canInspectReadOnly: true,
      canObserveFixtureProof: status === "waiting-observation" && interpreter.nextTurn.safeToRun,
      canInspectOddsSnapshotReadiness: selectedStep?.id === "odds-snapshots" && selectedStep.safeToRun,
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
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/historical-diagnosis-ladder",
      nextTurn.verifyUrl,
      observedItem?.proofUrl,
      ...steps.map((item) => item.proofUrl),
      ...interpreter.proofUrls,
      ...oddsSnapshotStorageReadiness.proofUrls,
      ...(evidence?.proofUrls ?? [])
    ]),
    locks: unique([
      "Historical diagnosis ladder can choose only the next read-only provider retest proof.",
      "Observed proof can move the ladder forward but cannot train, write snapshots, persist decisions, publish picks, or stake.",
      "Training-namespaced proof routes stay manual until an operator selects a read-only route.",
      ...interpreter.locks,
      ...oddsSnapshotStorageReadiness.locks,
      ...(evidence?.locks ?? [])
    ])
  };
}
