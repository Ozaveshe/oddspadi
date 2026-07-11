import type { DecisionBrainState, DecisionBrainStateLoopStatus } from "@/lib/sports/prediction/decisionBrainState";
import type { DecisionEvidenceInfluenceLedger } from "@/lib/sports/prediction/decisionEvidenceInfluenceLedger";
import type { DecisionOpenAILiveReviewReceipt } from "@/lib/sports/prediction/decisionOpenAILiveReviewReceipt";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { DecisionAction, Sport } from "@/lib/sports/types";

export type DecisionBrainReviewPacketStatus = "ready-to-submit" | "waiting-openai-quota" | "needs-evidence" | "blocked";
export type DecisionBrainReviewVerdict = "agree-shadow" | "downgrade" | "needs-evidence" | "block";
export type DecisionBrainReviewTrustPatch = "keep-ceiling" | "lower-ceiling" | "repair-first" | "block";
export type DecisionBrainReviewFindingStatus = "supports" | "challenges" | "missing";

export type DecisionBrainReviewEvidence = {
  id: string;
  source: "active-thesis" | "pressure" | "loop" | "next-move" | "self-critique" | "memory" | "influence-ledger";
  status: DecisionBrainStateLoopStatus | "info";
  label: string;
  claim: string;
  evidence: string[];
};

export type DecisionBrainReviewFinding = {
  evidenceId: string;
  status: DecisionBrainReviewFindingStatus;
  finding: string;
};

export type DecisionBrainReviewFallback = {
  verdict: DecisionBrainReviewVerdict;
  recommendedAction: DecisionAction;
  trustPatch: DecisionBrainReviewTrustPatch;
  summary: string;
  evidenceFindings: DecisionBrainReviewFinding[];
  requiredEvidence: string[];
  riskFlags: string[];
  unsupportedClaims: string[];
  publishPermission: "never";
  persistencePermission: "never";
  trainingPermission: "never";
  publicActionUpgradePermission: "never";
};

export type DecisionBrainReviewPacket = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-brain-review-packet";
  status: DecisionBrainReviewPacketStatus;
  packetHash: string;
  summary: string;
  evidencePacket: DecisionBrainReviewEvidence[];
  reviewPrompt: {
    system: string;
    task: string;
    payload: {
      activeThesis: DecisionBrainState["activeThesis"];
      evidenceInfluence: {
        status: DecisionEvidenceInfluenceLedger["status"];
        ledgerHash: string;
        activeTarget: DecisionEvidenceInfluenceLedger["activeTarget"];
        totals: DecisionEvidenceInfluenceLedger["totals"];
        selectedEntry: DecisionEvidenceInfluenceLedger["selectedEntry"];
        blockedSignals: Array<Pick<DecisionEvidenceInfluenceLedger["entries"][number], "id" | "label" | "category" | "blockers" | "nextAction">>;
        instructions: string[];
      };
      pressure: DecisionBrainState["pressure"];
      nextMove: DecisionBrainState["nextMove"];
      loops: DecisionBrainState["loops"];
      selfCritique: string[];
      memory: DecisionBrainState["memory"];
      controls: DecisionBrainState["controls"];
    };
  };
  expectedOutputContract: {
    requiredKeys: string[];
    allowedVerdicts: DecisionBrainReviewVerdict[];
    allowedActions: DecisionAction[];
    forbidden: string[];
  };
  deterministicFallback: DecisionBrainReviewFallback;
  submit: {
    label: string;
    command: string | null;
    verifyUrl: string;
    expectedEvidence: string;
    safeToRun: boolean;
    blockedBy: string[];
  };
  controls: {
    canInspectReadOnly: true;
    canSubmitToOpenAI: boolean;
    canApplyAI: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
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

function compact(value: string, maxLength = 320): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function actionFromBrain(brainState: DecisionBrainState): DecisionAction {
  if (brainState.activeThesis.publicStance === "consider-shadow" && brainState.activeThesis.confidenceCeiling === "candidate") return "consider";
  if (brainState.activeThesis.publicStance === "avoid" || brainState.activeThesis.confidenceCeiling === "none") return "avoid";
  return "monitor";
}

function statusFrom({
  brainState,
  openAiLiveReviewReceipt,
  evidenceInfluenceLedger
}: {
  brainState: DecisionBrainState;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  evidenceInfluenceLedger: DecisionEvidenceInfluenceLedger;
}): DecisionBrainReviewPacketStatus {
  if (openAiLiveReviewReceipt.status === "quota-or-billing-blocked" || openAiLiveReviewReceipt.status === "rate-or-quota-limited") return "waiting-openai-quota";
  if (evidenceInfluenceLedger.status === "blocked") return "blocked";
  if (brainState.status === "blocked") return "blocked";
  if (brainState.status === "needs-evidence" || brainState.status === "thinking") return "needs-evidence";
  return openAiLiveReviewReceipt.controls.canRequestLiveReview ? "ready-to-submit" : "needs-evidence";
}

function evidencePacket(brainState: DecisionBrainState, evidenceInfluenceLedger: DecisionEvidenceInfluenceLedger): DecisionBrainReviewEvidence[] {
  const thesis = brainState.activeThesis;
  const selectedInfluence = evidenceInfluenceLedger.selectedEntry;
  const ledgerStatus: DecisionBrainReviewEvidence["status"] =
    evidenceInfluenceLedger.status === "decision-eligible" ? "pass" : evidenceInfluenceLedger.status === "shadow-only" ? "watch" : "block";
  const packet: DecisionBrainReviewEvidence[] = [
    {
      id: "active-thesis",
      source: "active-thesis",
      status: "info",
      label: thesis.match ?? "No active match",
      claim: thesis.reason,
      evidence: unique([
        thesis.selection,
        thesis.baselineAction,
        thesis.publicStance,
        `ceiling:${thesis.confidenceCeiling}`,
        thesis.posteriorProbability === null ? null : `posterior:${thesis.posteriorProbability}`,
        thesis.expectedValue === null ? null : `ev:${thesis.expectedValue}`
      ])
    },
    {
      id: "pressure",
      source: "pressure",
      status: brainState.pressure.blockerCount > 0 ? "block" : brainState.pressure.watchCount > 0 ? "watch" : "pass",
      label: "Brain pressure",
      claim: `Evidence debt ${brainState.pressure.evidenceDebt}/100, blockers ${brainState.pressure.blockerCount}, consensus ${brainState.pressure.consensusScore}/100.`,
      evidence: [
        `readiness:${brainState.pressure.readinessScore}`,
        `contradictions:${brainState.pressure.contradictionCount}`,
        `watch:${brainState.pressure.watchCount}`
      ]
    },
    ...brainState.loops.map((item) => ({
      id: `loop-${item.id}`,
      source: "loop" as const,
      status: item.status,
      label: item.label,
      claim: item.signal,
      evidence: item.evidence
    })),
    {
      id: "next-move",
      source: "next-move",
      status: brainState.nextMove.safeToRun ? "pass" : brainState.nextMove.blockedBy.length ? "block" : "watch",
      label: brainState.nextMove.label,
      claim: brainState.nextMove.expectedEvidence,
      evidence: unique([brainState.nextMove.kind, brainState.nextMove.verifyUrl, brainState.nextMove.safeToRun ? "safe-to-run" : "held", ...brainState.nextMove.blockedBy])
    },
    ...brainState.selfCritique.slice(0, 5).map((item, index) => ({
      id: `self-critique-${index + 1}`,
      source: "self-critique" as const,
      status: "watch" as const,
      label: `Self critique ${index + 1}`,
      claim: item,
      evidence: ["The AI reviewer must address this objection before trust can rise."]
    })),
    {
      id: "evidence-influence-ledger",
      source: "influence-ledger",
      status: ledgerStatus,
      label: "Evidence influence ledger",
      claim: `${evidenceInfluenceLedger.summary} Selected blocker: ${selectedInfluence?.label ?? "none"}.`,
      evidence: unique([
        evidenceInfluenceLedger.ledgerHash,
        `status:${evidenceInfluenceLedger.status}`,
        `allowed:${evidenceInfluenceLedger.totals.influenceAllowed}`,
        `shadow:${evidenceInfluenceLedger.totals.shadowOnly}`,
        `blocked:${evidenceInfluenceLedger.totals.blocked}`,
        selectedInfluence?.nextAction
      ])
    },
    ...evidenceInfluenceLedger.entries
      .filter((entry) => entry.state !== "influence-allowed")
      .slice(0, 4)
      .map((entry): DecisionBrainReviewEvidence => {
        const status: DecisionBrainReviewEvidence["status"] = entry.state === "blocked" ? "block" : "watch";
        return {
          id: `influence-${entry.category}`,
          source: "influence-ledger",
          status,
          label: `${entry.label} influence`,
          claim: `${entry.state.replaceAll("-", " ")}: ${entry.nextAction}`,
          evidence: unique([entry.provider, entry.sourceStatus, entry.freshnessStatus, entry.providerStatus, ...entry.blockers, ...entry.watches], 8)
        };
      }),
    {
      id: "memory-hashes",
      source: "memory",
      status: "info",
      label: "Attached brain memory",
      claim: "The review packet is linked to the same belief, kernel, acquisition, operation, and OpenAI receipt hashes shown on the dashboard.",
      evidence: [
        brainState.memory.beliefLedgerHash,
        brainState.memory.cognitiveKernelHash,
        brainState.memory.acquisitionPlannerHash,
        brainState.memory.operationQueueHash,
        brainState.memory.openAiReceiptHash
      ]
    }
  ];

  return packet.map((item) => ({
    ...item,
    claim: compact(item.claim, 420),
    evidence: unique(item.evidence, 8)
  }));
}

function findingFor(item: DecisionBrainReviewEvidence): DecisionBrainReviewFinding {
  if (item.status === "pass") {
    return {
      evidenceId: item.id,
      status: "supports",
      finding: compact(`${item.label} supports the current shadow state, but does not authorize public promotion by itself.`)
    };
  }
  if (item.status === "block") {
    return {
      evidenceId: item.id,
      status: "challenges",
      finding: compact(`${item.label} blocks or materially challenges the active thesis: ${item.claim}`)
    };
  }
  return {
    evidenceId: item.id,
    status: "missing",
    finding: compact(`${item.label} still needs evidence: ${item.claim}`)
  };
}

function fallbackReview(brainState: DecisionBrainState, evidence: DecisionBrainReviewEvidence[]): DecisionBrainReviewFallback {
  const action = actionFromBrain(brainState);
  const blockers = evidence.filter((item) => item.status === "block");
  const watches = evidence.filter((item) => item.status === "watch");
  const verdict: DecisionBrainReviewVerdict = blockers.length ? "block" : watches.length ? "needs-evidence" : action === "consider" ? "agree-shadow" : "downgrade";
  const trustPatch: DecisionBrainReviewTrustPatch = blockers.length ? "block" : watches.length ? "repair-first" : action === "consider" ? "keep-ceiling" : "lower-ceiling";
  return {
    verdict,
    recommendedAction: verdict === "agree-shadow" ? action : verdict === "block" ? "avoid" : "monitor",
    trustPatch,
    summary: compact(
      blockers.length
        ? `Deterministic fallback blocks the brain state because ${blockers[0]?.label ?? "an evidence gate"} challenges the thesis.`
        : watches.length
          ? `Deterministic fallback keeps the brain in evidence-gathering mode because ${watches[0]?.label ?? "a proof item"} still needs support.`
          : "Deterministic fallback agrees only with a shadow decision; publication and persistence remain locked."
    ),
    evidenceFindings: evidence.slice(0, 12).map(findingFor),
    requiredEvidence: unique(
      [
        ...blockers.map((item) => item.claim),
        ...watches.map((item) => item.claim),
        brainState.nextMove.expectedEvidence,
        "Fresh provider-backed evidence must clear the active self-critique before trust can rise."
      ],
      10
    ),
    riskFlags: unique(
      [
        brainState.pressure.evidenceDebt >= 70 ? `Evidence debt is ${brainState.pressure.evidenceDebt}/100.` : null,
        brainState.pressure.blockerCount > 0 ? `${brainState.pressure.blockerCount} blocker(s) remain.` : null,
        brainState.activeThesis.confidenceCeiling === "none" ? "Confidence ceiling is none." : null,
        brainState.nextMove.safeToRun ? null : "No safe next command is available."
      ],
      8
    ),
    unsupportedClaims: unique(
      evidence
        .filter((item) => item.status !== "pass")
        .map((item) => `${item.label}: ${item.claim}`),
      8
    ),
    publishPermission: "never",
    persistencePermission: "never",
    trainingPermission: "never",
    publicActionUpgradePermission: "never"
  };
}

export function buildDecisionBrainReviewPacket({
  date,
  sport,
  brainState,
  evidenceInfluenceLedger,
  openAiLiveReviewReceipt,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  brainState: DecisionBrainState;
  evidenceInfluenceLedger: DecisionEvidenceInfluenceLedger;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  now?: Date;
}): DecisionBrainReviewPacket {
  const evidence = evidencePacket(brainState, evidenceInfluenceLedger);
  const status = statusFrom({ brainState, openAiLiveReviewReceipt, evidenceInfluenceLedger });
  const fallback = fallbackReview(brainState, evidence);
  const blockedBy = unique(
    [
      status === "waiting-openai-quota" ? openAiLiveReviewReceipt.nextAction : null,
      status === "blocked" && evidenceInfluenceLedger.status === "blocked" ? (evidenceInfluenceLedger.selectedEntry?.nextAction ?? evidenceInfluenceLedger.summary) : null,
      status === "blocked" ? brainState.summary : null,
      ...openAiLiveReviewReceipt.locks
    ],
    8
  );
  const command =
    openAiLiveReviewReceipt.controls.canRequestLiveReview && status !== "waiting-openai-quota"
      ? decisionCurlCommand(`/api/sports/decision/openai-live-review-receipt?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}&limit=1&run=1`)
      : null;

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-brain-review-packet",
    status,
    packetHash: stableHash({
      date,
      sport,
      status,
      brain: brainState.brainHash,
      influence: evidenceInfluenceLedger.ledgerHash,
      receipt: openAiLiveReviewReceipt.receiptHash,
      evidence: evidence.map((item) => [item.id, item.status, item.claim]),
      fallback: [fallback.verdict, fallback.recommendedAction, fallback.trustPatch]
    }),
    summary:
      status === "ready-to-submit"
        ? "Brain review packet is ready for a guarded OpenAI critique; AI output still cannot persist, publish, train, or raise trust."
        : status === "waiting-openai-quota"
          ? "Brain review packet is prepared, but OpenAI quota or billing blocks live critique."
          : status === "blocked"
            ? evidenceInfluenceLedger.status === "blocked"
              ? "Brain review packet falls back to deterministic block because the evidence influence ledger blocks required signals."
              : "Brain review packet falls back to deterministic block because the brain state still has blocking evidence debt."
            : "Brain review packet is prepared, but more evidence is needed before AI critique should influence the turn.",
    evidencePacket: evidence,
    reviewPrompt: {
      system:
        "You are OddsPadi's responsible sports decision reviewer. Critique the bounded brain state. Use only supplied evidence. Never recommend staking, certainty, persistence, publishing, or training.",
      task:
        "Return a same-or-safer JSON review. Identify unsupported claims, evidence that supports or challenges the active thesis, required evidence, risk flags, and whether the decision should remain avoid, monitor, or shadow-consider.",
      payload: {
        activeThesis: brainState.activeThesis,
        evidenceInfluence: {
          status: evidenceInfluenceLedger.status,
          ledgerHash: evidenceInfluenceLedger.ledgerHash,
          activeTarget: evidenceInfluenceLedger.activeTarget,
          totals: evidenceInfluenceLedger.totals,
          selectedEntry: evidenceInfluenceLedger.selectedEntry,
          blockedSignals: evidenceInfluenceLedger.entries
            .filter((entry) => entry.state === "blocked")
            .slice(0, 8)
            .map((entry) => ({
              id: entry.id,
              label: entry.label,
              category: entry.category,
              blockers: entry.blockers,
              nextAction: entry.nextAction
            })),
          instructions: evidenceInfluenceLedger.aiInstructions
        },
        pressure: brainState.pressure,
        nextMove: brainState.nextMove,
        loops: brainState.loops,
        selfCritique: brainState.selfCritique,
        memory: brainState.memory,
        controls: brainState.controls
      }
    },
    expectedOutputContract: {
      requiredKeys: [
        "verdict",
        "recommendedAction",
        "trustPatch",
        "summary",
        "evidenceFindings",
        "requiredEvidence",
        "riskFlags",
        "unsupportedClaims",
        "publishPermission",
        "persistencePermission",
        "trainingPermission",
        "publicActionUpgradePermission"
      ],
      allowedVerdicts: ["agree-shadow", "downgrade", "needs-evidence", "block"],
      allowedActions: ["consider", "monitor", "avoid"],
      forbidden: [
        "persist decisions",
        "publish picks",
        "train models",
        "stake",
        "raise public trust",
        "invent evidence",
        "use blocked evidence as support",
        "use shadow-only evidence as deterministic confidence",
        "use hidden chain-of-thought"
      ]
    },
    deterministicFallback: fallback,
    submit: {
      label: "Run guarded OpenAI brain critique",
      command,
      verifyUrl: "/api/sports/decision/openai-live-review-receipt?run=1&limit=1",
      expectedEvidence: openAiLiveReviewReceipt.nextAction,
      safeToRun: Boolean(command && status === "ready-to-submit"),
      blockedBy
    },
    controls: {
      canInspectReadOnly: true,
      canSubmitToOpenAI: Boolean(command && status === "ready-to-submit"),
      canApplyAI: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/brain-review-packet",
      "/api/sports/decision/evidence-influence-ledger",
      "/api/sports/decision/brain-state",
      "/api/sports/decision/openai-live-review-receipt",
      ...brainState.proofUrls,
      ...openAiLiveReviewReceipt.proofUrls
    ]),
    locks: unique([
      "Brain review packet is advisory only and cannot apply AI output automatically.",
      "AI review must be same-or-safer than the deterministic fallback.",
      "AI review must honor the evidence influence ledger; blocked evidence can only justify abstention or evidence requests.",
      "AI review cannot persist, publish, train, stake, raise public trust, invent evidence, or expose hidden chain-of-thought.",
      ...brainState.locks,
      ...openAiLiveReviewReceipt.locks
    ])
  };
}
