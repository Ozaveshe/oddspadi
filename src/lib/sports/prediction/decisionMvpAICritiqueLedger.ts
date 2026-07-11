import type { DecisionMvpAIReviewPacket } from "@/lib/sports/prediction/decisionMvpAIReviewPacket";
import type { DecisionMvpAIReviewRunner } from "@/lib/sports/prediction/decisionMvpAIReviewRunner";

export type DecisionMvpAICritiqueLedgerStatus = "not-reviewed" | "same-or-safer" | "needs-evidence" | "downgrade-required" | "blocked";
export type DecisionMvpAICritiqueLedgerEffect = "no-change" | "hold" | "monitor-only" | "avoid";

export type DecisionMvpAICritiqueLedgerItem = {
  id: string;
  label: string;
  status: "pass" | "watch" | "block";
  evidence: string;
  sameOrSaferEffect: DecisionMvpAICritiqueLedgerEffect;
  nextAction: string;
};

export type DecisionMvpAICritiqueLedger = {
  mode: "decision-mvp-ai-critique-ledger";
  generatedAt: string;
  date: string;
  sport: DecisionMvpAIReviewPacket["sport"];
  status: DecisionMvpAICritiqueLedgerStatus;
  ledgerHash: string;
  summary: string;
  source: {
    packetHash: string;
    runnerHash: string;
    packetStatus: DecisionMvpAIReviewPacket["status"];
    runnerStatus: DecisionMvpAIReviewRunner["status"];
    provider: DecisionMvpAIReviewRunner["latestRun"]["provider"];
    reviewHash: string | null;
  };
  verdict: {
    reviewVerdict: string | null;
    requestedAction: string | null;
    appliedEffect: DecisionMvpAICritiqueLedgerEffect;
    publicPosture: DecisionMvpAIReviewPacket["target"]["publicPosture"];
    trustCeiling: DecisionMvpAIReviewPacket["target"]["trustCeiling"];
    canImprovePublicAction: false;
  };
  items: DecisionMvpAICritiqueLedgerItem[];
  totals: {
    pass: number;
    watch: number;
    block: number;
    missingEvidence: number;
    unsupportedClaims: number;
    citedEvidence: number;
  };
  controls: {
    canInspectReadOnly: true;
    canApplyReview: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
    canUseHiddenChainOfThought: false;
  };
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
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

function compact(value: string | null | undefined, maxLength = 300): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No evidence available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
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

function effectFor(action: string | null | undefined, verdict: string | null | undefined): DecisionMvpAICritiqueLedgerEffect {
  if (action === "avoid" || verdict === "block") return "avoid";
  if (action === "monitor" || verdict === "downgrade") return "monitor-only";
  if (action === "hold" || verdict === "needs-evidence") return "hold";
  return "no-change";
}

function statusFor(runner: DecisionMvpAIReviewRunner, items: DecisionMvpAICritiqueLedgerItem[]): DecisionMvpAICritiqueLedgerStatus {
  if (!runner.review) return "not-reviewed";
  if (runner.review.verdict === "block" || runner.review.unsupportedClaims.length > 0 || runner.review.citedEvidenceIds.length === 0) return "blocked";
  if (runner.review.verdict === "needs-evidence" || runner.review.missingEvidence.length > 0) return "needs-evidence";
  if (items.some((item) => item.status === "block")) return "blocked";
  if (runner.review.verdict === "downgrade" || runner.review.action === "monitor" || runner.review.action === "avoid") return "downgrade-required";
  return "same-or-safer";
}

function summaryFor(status: DecisionMvpAICritiqueLedgerStatus): string {
  if (status === "same-or-safer") return "AI critique ledger accepts the review as advisory while keeping the deterministic decision unchanged.";
  if (status === "needs-evidence") return "AI critique ledger found evidence gaps; the MVP decision must stay held until those proof tasks clear.";
  if (status === "downgrade-required") return "AI critique ledger requires the same-or-safer posture to stay monitor-only or lower.";
  if (status === "blocked") return "AI critique ledger blocks promotion because the critique or safety gates found a hard stop.";
  return "AI critique ledger is waiting for a runner review before it can summarize same-or-safer effects.";
}

export function buildDecisionMvpAICritiqueLedger({
  packet,
  runner,
  now = new Date()
}: {
  packet: DecisionMvpAIReviewPacket;
  runner: DecisionMvpAIReviewRunner;
  now?: Date;
}): DecisionMvpAICritiqueLedger {
  const review = runner.review;
  const appliedEffect = effectFor(review?.action, review?.verdict);
  const reviewItems: DecisionMvpAICritiqueLedgerItem[] = review
    ? [
        {
          id: "review-verdict",
          label: "Review verdict",
          status: review.verdict === "agree" ? "pass" : review.verdict === "downgrade" ? "watch" : "block",
          evidence: review.summary,
          sameOrSaferEffect: appliedEffect,
          nextAction: review.saferAlternative
        },
        {
          id: "evidence-citations",
          label: "Evidence citations",
          status: review.citedEvidenceIds.length ? "pass" : "block",
          evidence: review.citedEvidenceIds.length ? `Cited ${review.citedEvidenceIds.join(", ")}.` : "Review did not cite supplied evidence IDs.",
          sameOrSaferEffect: review.citedEvidenceIds.length ? "no-change" : "hold",
          nextAction: review.citedEvidenceIds.length ? "Keep cited IDs attached to the critique." : "Rerun or discard the critique until supplied evidence IDs are cited."
        },
        {
          id: "missing-evidence",
          label: "Missing evidence",
          status: review.missingEvidence.length ? "block" : "pass",
          evidence: review.missingEvidence.length ? review.missingEvidence.slice(0, 4).join("; ") : "No additional missing evidence was named by the critique.",
          sameOrSaferEffect: review.missingEvidence.length ? "hold" : "no-change",
          nextAction: review.missingEvidence[0] ?? packet.nextAction.expectedEvidence
        },
        {
          id: "unsupported-claims",
          label: "Unsupported claims",
          status: review.unsupportedClaims.length ? "block" : "pass",
          evidence: review.unsupportedClaims.length ? review.unsupportedClaims.slice(0, 4).join("; ") : "No unsupported claims were returned.",
          sameOrSaferEffect: review.unsupportedClaims.length ? "hold" : "no-change",
          nextAction: review.unsupportedClaims.length ? "Discard unsupported claims and rerun with stricter evidence citations." : "Keep no-invention guard active."
        },
        {
          id: "safety-gates",
          label: "Safety gates",
          status: review.safetyGates.some((gate) => gate.status === "block") ? "block" : review.safetyGates.some((gate) => gate.status === "watch") ? "watch" : "pass",
          evidence: review.safetyGates.map((gate) => `${gate.label}: ${gate.status}`).join("; "),
          sameOrSaferEffect: review.safetyGates.some((gate) => gate.status === "block") ? "hold" : "no-change",
          nextAction: review.safetyGates.find((gate) => gate.status !== "pass")?.reason ?? "Keep side-effect locks closed."
        }
      ]
    : [
        {
          id: "review-request",
          label: "Review request",
          status: "watch",
          evidence: runner.summary,
          sameOrSaferEffect: "hold",
          nextAction: runner.nextAction.expectedEvidence
        }
      ];
  const lockItem: DecisionMvpAICritiqueLedgerItem = {
    id: "same-or-safer-lock",
    label: "Same-or-safer lock",
    status: "pass",
    evidence: "Critique output cannot improve public posture, trust ceiling, confidence, probabilities, staking, publishing, persistence, training, or provider writes.",
    sameOrSaferEffect: "no-change",
    nextAction: "Use the critique only to hold, monitor, avoid, or request evidence."
  };
  const items = [...reviewItems, lockItem];
  const status = statusFor(runner, items);
  const nextBlocked = items.find((item) => item.status === "block") ?? items.find((item) => item.status === "watch") ?? null;

  return {
    mode: "decision-mvp-ai-critique-ledger",
    generatedAt: now.toISOString(),
    date: packet.date,
    sport: packet.sport,
    status,
    ledgerHash: stableHash({
      packet: packet.packetHash,
      runner: runner.runnerHash,
      status,
      review: runner.latestRun.reviewHash,
      items: items.map((item) => [item.id, item.status, item.sameOrSaferEffect])
    }),
    summary: summaryFor(status),
    source: {
      packetHash: packet.packetHash,
      runnerHash: runner.runnerHash,
      packetStatus: packet.status,
      runnerStatus: runner.status,
      provider: runner.latestRun.provider,
      reviewHash: runner.latestRun.reviewHash
    },
    verdict: {
      reviewVerdict: review?.verdict ?? null,
      requestedAction: review?.action ?? null,
      appliedEffect,
      publicPosture: packet.target.publicPosture,
      trustCeiling: packet.target.trustCeiling,
      canImprovePublicAction: false
    },
    items,
    totals: {
      pass: items.filter((item) => item.status === "pass").length,
      watch: items.filter((item) => item.status === "watch").length,
      block: items.filter((item) => item.status === "block").length,
      missingEvidence: review?.missingEvidence.length ?? 0,
      unsupportedClaims: review?.unsupportedClaims.length ?? 0,
      citedEvidence: review?.citedEvidenceIds.length ?? 0
    },
    controls: {
      canInspectReadOnly: true,
      canApplyReview: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    nextAction: {
      label: status === "not-reviewed" ? "Run or inspect guarded critique" : nextBlocked ? "Resolve critique blocker" : "Keep critique advisory",
      command:
        status === "not-reviewed"
          ? `curl.exe "http://127.0.0.1:3025/api/sports/decision/mvp-ai-critique-ledger?date=${encodeURIComponent(packet.date)}&sport=${encodeURIComponent(packet.sport)}&limit=8&run=1"`
          : runner.nextAction.command,
      verifyUrl: "/api/sports/decision/mvp-ai-critique-ledger",
      safeToRun: status === "not-reviewed" ? runner.nextAction.safeToRun : false,
      expectedEvidence: compact(nextBlocked?.nextAction ?? "Ledger remains advisory and same-or-safer; no side-effect controls open.", 320)
    },
    proofUrls: unique(["/api/sports/decision/mvp-ai-critique-ledger", "/api/sports/decision/mvp-ai-review-runner", ...runner.proofUrls, ...packet.proofUrls], 28),
    locks: unique(
      [
        "AI critique ledger is read-only and cannot apply review output.",
        "AI critique can only preserve or lower action posture; it cannot improve public action.",
        "No hidden chain-of-thought, provider invention, persistence, training, staking, publishing, probability adjustment, or confidence raise is allowed.",
        ...runner.locks,
        ...packet.locks
      ],
      80
    )
  };
}
