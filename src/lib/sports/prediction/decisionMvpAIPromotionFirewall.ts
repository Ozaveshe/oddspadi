import type { DecisionMvpAIShadowCalibrationBridge } from "@/lib/sports/prediction/decisionMvpAIShadowCalibrationBridge";

export type DecisionMvpAIPromotionFirewallStatus = "blocked-labels" | "blocked-sample" | "blocked-governance" | "shadow-only-ready" | "withheld";

export type DecisionMvpAIPromotionFirewall = {
  mode: "decision-mvp-ai-promotion-firewall";
  generatedAt: string;
  date: string;
  sport: DecisionMvpAIShadowCalibrationBridge["sport"];
  status: DecisionMvpAIPromotionFirewallStatus;
  firewallHash: string;
  summary: string;
  promotionCase: {
    caseId: string;
    sourceBridgeHash: string;
    allowedScope: "none" | "shadow-memory";
    trustCeiling: "locked" | "shadow-only";
    canPromoteLearnedWeights: false;
    canRaisePublicConfidence: false;
    canPublishPublicPick: false;
  };
  gates: Array<{
    id: string;
    label: string;
    status: "pass" | "watch" | "block";
    detail: string;
    requiredEvidence: string[];
  }>;
  promotionPolicy: {
    minSettledRows: number;
    minRowsPerBucket: number;
    requiresNonNegativeClv: true;
    requiresBacktest: true;
    requiresOperatorApproval: true;
    maxPublicProbabilityDelta: 0;
    maxStakeUnits: 0;
  };
  controls: {
    canInspectReadOnly: true;
    canSimulateShadowPromotion: boolean;
    canPersistPromotion: false;
    canPersistCalibrationRun: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
  };
  source: {
    bridgeHash: string;
    labelGateHash: string;
    quarantineHash: string;
    handoffHash: string;
    critiqueLedgerHash: string;
    decisionTurnHash: string;
    releaseHash: string;
    auditHash: string;
  };
  nextAction: {
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
  };
  proofUrls: string[];
  locks: string[];
};

const MIN_SETTLED_ROWS = 30;
const MIN_ROWS_PER_BUCKET = 10;

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function compact(value: string | null | undefined, maxLength = 320): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No evidence available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function statusFor(bridge: DecisionMvpAIShadowCalibrationBridge, gates: DecisionMvpAIPromotionFirewall["gates"]): DecisionMvpAIPromotionFirewallStatus {
  if (bridge.status === "withheld") return "withheld";
  if (gates.find((gate) => gate.id === "settled-labels")?.status === "block") return "blocked-labels";
  if (gates.find((gate) => gate.id === "calibration-sample")?.status === "block") return "blocked-sample";
  if (gates.some((gate) => gate.status === "block" || gate.status === "watch")) return "blocked-governance";
  return "shadow-only-ready";
}

function summaryFor(status: DecisionMvpAIPromotionFirewallStatus): string {
  if (status === "shadow-only-ready") return "MVP AI promotion firewall would allow shadow-memory comparison only; public influence remains locked.";
  if (status === "blocked-sample") return "MVP AI promotion firewall is blocked until settled calibration sample and bucket minimums are met.";
  if (status === "blocked-governance") return "MVP AI promotion firewall is blocked by backtest, CLV, governance, or operator-approval evidence.";
  if (status === "blocked-labels") return "MVP AI promotion firewall is blocked until settled labels and calibration inputs exist.";
  return "MVP AI promotion firewall withholds promotion because the upstream calibration case was withheld.";
}

export function buildDecisionMvpAIPromotionFirewall({
  shadowCalibrationBridge,
  now = new Date()
}: {
  shadowCalibrationBridge: DecisionMvpAIShadowCalibrationBridge;
  now?: Date;
}): DecisionMvpAIPromotionFirewall {
  const sampleReady = shadowCalibrationBridge.calibrationCase.currentSettledRows >= MIN_SETTLED_ROWS;
  const bucketsReady = shadowCalibrationBridge.calibrationBuckets.every((bucket) => bucket.currentSettledRows >= bucket.minimumSettledRows);
  const mathReady = shadowCalibrationBridge.mathChecks.every((check) => check.status === "pass");
  const gates = [
    {
      id: "settled-labels",
      label: "Settled labels",
      status: shadowCalibrationBridge.status === "waiting-labels" || shadowCalibrationBridge.calibrationCase.sampleState === "missing-label" ? ("block" as const) : ("watch" as const),
      detail: "Promotion requires final score, exact market settlement, model probability, taken odds, closing odds, and settled timestamp.",
      requiredEvidence: ["final score", "market settlement", "closing odds", "model probability", "settled timestamp"]
    },
    {
      id: "calibration-sample",
      label: "Calibration sample",
      status: sampleReady && bucketsReady ? ("watch" as const) : ("block" as const),
      detail: `${shadowCalibrationBridge.calibrationCase.currentSettledRows}/${MIN_SETTLED_ROWS} settled rows and bucket minimums are available.`,
      requiredEvidence: [`${MIN_SETTLED_ROWS} settled rows`, `${MIN_ROWS_PER_BUCKET} settled rows per active probability bucket`]
    },
    {
      id: "calibration-math",
      label: "Calibration math",
      status: mathReady ? ("watch" as const) : ("block" as const),
      detail: "Brier score, log loss, CLV, ROI, and calibration buckets must all be gradeable from settled evidence.",
      requiredEvidence: shadowCalibrationBridge.mathChecks.map((check) => check.label)
    },
    {
      id: "historical-backtest",
      label: "Historical backtest",
      status: "block" as const,
      detail: "No MVP shadow bridge has attached a real historical backtest receipt to this AI case.",
      requiredEvidence: ["real-data backtest id", "sample size", "pick count", "Brier score", "log loss"]
    },
    {
      id: "clv-governance",
      label: "CLV governance",
      status: "block" as const,
      detail: "Promotion needs non-negative closing-line value and no replay pattern that says the market beat the model.",
      requiredEvidence: ["non-negative CLV", "replay pressure below threshold", "market benchmark not dominated by bookmaker prior"]
    },
    {
      id: "operator-approval",
      label: "Operator approval",
      status: "block" as const,
      detail: "A human/operator launch decision must approve any move beyond shadow analysis.",
      requiredEvidence: ["operator approval receipt", "model card", "risk review", "public-answer gate"]
    },
    {
      id: "public-safety-firewall",
      label: "Public safety firewall",
      status: "pass" as const,
      detail: "This firewall keeps probability changes, confidence raises, pick publication, stakes, and learned weights locked.",
      requiredEvidence: ["max probability delta 0", "max stake units 0", "hidden chain-of-thought blocked"]
    }
  ];
  const status = statusFor(shadowCalibrationBridge, gates);
  const selectedGate = gates.find((gate) => gate.status === "block") ?? gates.find((gate) => gate.status === "watch") ?? null;
  const canSimulateShadowPromotion = status === "shadow-only-ready";

  return {
    mode: "decision-mvp-ai-promotion-firewall",
    generatedAt: now.toISOString(),
    date: shadowCalibrationBridge.date,
    sport: shadowCalibrationBridge.sport,
    status,
    firewallHash: stableHash({
      status,
      bridgeHash: shadowCalibrationBridge.bridgeHash,
      gates: gates.map((gate) => [gate.id, gate.status])
    }),
    summary: summaryFor(status),
    promotionCase: {
      caseId: shadowCalibrationBridge.calibrationCase.caseId,
      sourceBridgeHash: shadowCalibrationBridge.bridgeHash,
      allowedScope: canSimulateShadowPromotion ? "shadow-memory" : "none",
      trustCeiling: canSimulateShadowPromotion ? "shadow-only" : "locked",
      canPromoteLearnedWeights: false,
      canRaisePublicConfidence: false,
      canPublishPublicPick: false
    },
    gates,
    promotionPolicy: {
      minSettledRows: MIN_SETTLED_ROWS,
      minRowsPerBucket: MIN_ROWS_PER_BUCKET,
      requiresNonNegativeClv: true,
      requiresBacktest: true,
      requiresOperatorApproval: true,
      maxPublicProbabilityDelta: 0,
      maxStakeUnits: 0
    },
    controls: {
      canInspectReadOnly: true,
      canSimulateShadowPromotion,
      canPersistPromotion: false,
      canPersistCalibrationRun: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    source: {
      bridgeHash: shadowCalibrationBridge.bridgeHash,
      labelGateHash: shadowCalibrationBridge.source.labelGateHash,
      quarantineHash: shadowCalibrationBridge.source.quarantineHash,
      handoffHash: shadowCalibrationBridge.source.handoffHash,
      critiqueLedgerHash: shadowCalibrationBridge.source.critiqueLedgerHash,
      decisionTurnHash: shadowCalibrationBridge.source.decisionTurnHash,
      releaseHash: shadowCalibrationBridge.source.releaseHash,
      auditHash: shadowCalibrationBridge.source.auditHash
    },
    nextAction: {
      label: selectedGate?.label ?? "Keep shadow-only promotion locked",
      command: null,
      verifyUrl: "/api/sports/decision/mvp-ai-promotion-firewall",
      safeToRun: false,
      expectedEvidence: compact(selectedGate ? `Promotion blocker: ${selectedGate.detail}` : "Continue shadow comparison without public or model-weight influence.")
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-ai-promotion-firewall",
      ...shadowCalibrationBridge.proofUrls
    ]),
    locks: unique([
      "MVP AI promotion firewall cannot persist promotion, persist calibration, write training rows, train models, apply learned weights, adjust probabilities, raise confidence, publish picks, stake, or expose hidden chain-of-thought.",
      ...shadowCalibrationBridge.locks
    ])
  };
}
