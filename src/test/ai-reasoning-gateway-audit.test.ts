import { describe, expect, it } from "vitest";
import {
  auditDecisionAIReasoningReview,
  runDecisionAIReasoningGateway,
  type DecisionAIReasoningReview
} from "@/lib/sports/prediction/decisionAIReasoningGateway";
import { buildDecisionAICognitiveLoop } from "@/lib/sports/prediction/decisionAICognitiveLoop";
import type { DecisionOperatorEpisode } from "@/lib/sports/prediction/decisionOperatorEpisode";

function review(overrides: Partial<DecisionAIReasoningReview> = {}): DecisionAIReasoningReview {
  return {
    reviewVerdict: "needs-evidence",
    operatorAction: "hold",
    confidencePatch: "keep-capped",
    trustPatch: "hold",
    summary: "Hold until proof improves.",
    publicReasoningTrace: [
      { phase: "observe", status: "pass", finding: "Proof hash was observed.", citedEvidenceIds: ["episode-proof-hash"] },
      { phase: "frame", status: "watch", finding: "The operator objective is still read-only.", citedEvidenceIds: ["episode-objective"] },
      { phase: "challenge", status: "watch", finding: "Provider evidence is still incomplete.", citedEvidenceIds: ["operator-narrative-risk"] },
      { phase: "decide", status: "watch", finding: "Hold the public action.", citedEvidenceIds: ["episode-final-patch"] },
      { phase: "verify", status: "pass", finding: "Replay the safe command only.", citedEvidenceIds: ["episode-proof-hash"] },
      { phase: "learn", status: "watch", finding: "Memory remains draft-only.", citedEvidenceIds: ["operator-memory-draft"] }
    ],
    riskFlags: ["Provider evidence incomplete."],
    dataGaps: ["Storage proof is locked."],
    falsifiers: ["Fresh proof contradicts the hold action."],
    nextSafeCommand: "curl.exe -sS http://127.0.0.1:3025/api/sports/decision/operator-episode",
    memoryCandidate: {
      label: "Reasoning memory",
      content: "Hold until proof improves.",
      canPersist: false
    },
    safetyGates: [
      { id: "no-persistence", label: "No persistence", status: "pass", reason: "Read-only." },
      { id: "no-publish", label: "No publish", status: "pass", reason: "Public action stays locked." },
      { id: "no-upgrade", label: "No upgrade", status: "pass", reason: "No public-action upgrade." }
    ],
    unsupportedClaims: [],
    ...overrides
  };
}

const evidenceIds = ["episode-proof-hash", "episode-objective", "operator-narrative-risk", "episode-final-patch", "operator-memory-draft"];

function episode(): DecisionOperatorEpisode {
  return {
    generatedAt: "2026-08-21T12:00:00.000Z",
    date: "2026-08-21",
    sport: "football",
    mode: "operator-episode",
    status: "observed",
    episodeHash: "fnv1a-episode",
    summary: "Operator episode has proof, but public action remains locked.",
    objective: {
      label: "Review the prediction decision",
      match: null,
      capability: null,
      reason: "Check the latest proof before any public recommendation moves."
    },
    chain: {
      turnHash: "fnv1a-turn",
      receiptHash: "fnv1a-receipt",
      stateHash: "fnv1a-state",
      proofHash: "fnv1a-proof"
    },
    timeline: [
      {
        id: "turn",
        label: "Turn selected",
        status: "pass",
        evidence: ["turn-proof"],
        detail: "Read-only turn selected.",
        nextAction: "Observe local proof."
      },
      {
        id: "receipt",
        label: "Proof observed",
        status: "pass",
        evidence: ["receipt-proof"],
        detail: "Proof receipt was observed.",
        nextAction: "Reduce operator state."
      }
    ],
    finalPatch: {
      confidence: "keep-capped",
      trust: "hold",
      action: "avoid",
      posture: "watchlist-only",
      canAdvanceReadOnly: false,
      canPersist: false,
      canPublish: false,
      canTrain: false
    },
    replay: {
      commands: [
        {
          id: "operator-episode",
          label: "Replay operator episode",
          command: "curl.exe -sS http://127.0.0.1:3025/api/sports/decision/operator-episode",
          safeToRun: true
        }
      ],
      urls: ["/api/sports/decision/operator-episode"]
    },
    operatorNarrative: {
      belief: "The model can explain but not publish.",
      observed: "Proof hash exists.",
      decision: "Keep the recommendation locked.",
      risk: "Provider evidence and Supabase write gates are still incomplete.",
      next: "Run another read-only proof check."
    },
    memoryDraft: {
      label: "Operator memory draft",
      content: "Hold until provider proof and storage proof are clean.",
      evidenceHash: "fnv1a-memory",
      canPersist: false
    },
    locks: ["No persistence.", "No publishing.", "No training."],
    proofUrls: ["/api/sports/decision/operator-episode"]
  };
}

describe("AI reasoning gateway review audit", () => {
  it("passes a fully cited public reasoning review", () => {
    const audit = auditDecisionAIReasoningReview({
      review: review(),
      evidenceIds,
      activeSource: "openai"
    });

    expect(audit.status).toBe("pass");
    expect(audit.phaseCoverage.missing).toEqual([]);
    expect(audit.citationCoverage.invalidCitations).toBe(0);
    expect(audit.unsupportedClaims.count).toBe(0);
    expect(audit.decision.canUseReview).toBe(true);
    expect(audit.decision.mustUseFallback).toBe(false);
  });

  it("blocks an OpenAI review with unsupported claims or invalid citations", () => {
    const audit = auditDecisionAIReasoningReview({
      review: review({
        publicReasoningTrace: [
          { phase: "observe", status: "pass", finding: "Proof was observed.", citedEvidenceIds: ["not-real-evidence"] },
          { phase: "decide", status: "watch", finding: "Hold action.", citedEvidenceIds: ["episode-final-patch"] },
          { phase: "verify", status: "watch", finding: "Replay command remains needed.", citedEvidenceIds: ["episode-proof-hash"] }
        ],
        unsupportedClaims: ["Confirmed lineups were not supplied."]
      }),
      evidenceIds,
      activeSource: "openai"
    });

    expect(audit.status).toBe("block");
    expect(audit.citationCoverage.invalidCitations).toBe(1);
    expect(audit.unsupportedClaims.count).toBe(1);
    expect(audit.decision.canUseReview).toBe(false);
    expect(audit.decision.mustUseFallback).toBe(true);
  });

  it("watches deterministic reviews that are safe but incomplete", () => {
    const audit = auditDecisionAIReasoningReview({
      review: review({
        publicReasoningTrace: [
          { phase: "observe", status: "pass", finding: "Proof was observed.", citedEvidenceIds: ["episode-proof-hash"] },
          { phase: "decide", status: "watch", finding: "Hold action.", citedEvidenceIds: ["episode-final-patch"] },
          { phase: "verify", status: "watch", finding: "Replay command remains needed.", citedEvidenceIds: ["episode-proof-hash"] }
        ]
      }),
      evidenceIds,
      activeSource: "deterministic"
    });

    expect(audit.status).toBe("watch");
    expect(audit.phaseCoverage.missing).toEqual(["frame", "challenge", "learn"]);
    expect(audit.decision.canUseReview).toBe(true);
    expect(audit.decision.mustUseFallback).toBe(false);
  });

  it("falls back when an OpenAI review fails the audit quality gates", async () => {
    const openAiReview = review({
      summary: "OpenAI claims confirmed lineup movement, but no lineup evidence exists.",
      unsupportedClaims: ["Confirmed lineup movement is unavailable in the supplied evidence."]
    });
    const fetchImpl: typeof fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as { store?: boolean };
      expect(request.store).toBe(false);
      return new Response(JSON.stringify({ output_text: JSON.stringify(openAiReview) }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    const gateway = await runDecisionAIReasoningGateway({
      episode: episode(),
      apiKey: "test-key",
      model: "gpt-5.5",
      runRequested: true,
      fetchImpl,
      now: new Date("2026-08-21T12:05:00.000Z")
    });

    expect(gateway.status).toBe("reviewed");
    expect(gateway.latestRun.provider).toBe("openai");
    expect(gateway.latestRun.status).toBe("reviewed");
    expect(gateway.latestRun.reason).toContain("failed reasoning audit quality gates");
    expect(gateway.latestRun.reason).toContain("deterministic fallback remains authoritative");
    expect(gateway.reviewAudit.activeSource).toBe("openai");
    expect(gateway.reviewAudit.status).toBe("block");
    expect(gateway.reviewAudit.decision.canUseReview).toBe(false);
    expect(gateway.reviewAudit.decision.mustUseFallback).toBe(true);
    expect(gateway.review?.summary).toContain("confirmed lineup movement");
    expect(gateway.review?.unsupportedClaims).toHaveLength(1);
    expect(buildDecisionAICognitiveLoop({ episode: episode(), gateway }).activeReviewSource).toBe("deterministic-fallback");
    expect(gateway.permissions.canPersist).toBe(false);
    expect(gateway.permissions.canPublish).toBe(false);
    expect(gateway.permissions.canTrain).toBe(false);
  });
});
