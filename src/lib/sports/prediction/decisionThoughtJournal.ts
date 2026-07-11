import type { DecisionMind, DecisionMindThoughtStatus } from "@/lib/sports/prediction/decisionMind";
import type { Sport } from "@/lib/sports/types";
import { readDecisionOpenAIProviderError } from "./decisionOpenAIProviderError";
import { extractOutputText } from "./openaiDecisionEnhancer";
import { getDecisionOpenAIModel } from "./openaiModel";

export type DecisionThoughtJournalStatus = "thinking" | "waiting-for-evidence" | "review-ready" | "blocked";
export type DecisionThoughtJournalPhase = "sense" | "weigh" | "challenge" | "decide" | "verify" | "learn";
export type DecisionThoughtJournalEntryStatus = "support" | "question" | "need-evidence" | "block";
export type DecisionThoughtJournalReviewVerdict = "agree" | "downgrade" | "needs-evidence" | "block";
export type DecisionThoughtJournalReviewStatus = "not-requested" | "not-configured" | "reviewed" | "provider-error" | "invalid-response";

export type DecisionThoughtJournalReview = {
  verdict: DecisionThoughtJournalReviewVerdict;
  summary: string;
  citedEntryIds: string[];
  riskFlags: string[];
  dataGaps: string[];
  falsifiers: string[];
  safetyGates: Array<{
    id: string;
    label: string;
    status: "pass" | "watch" | "block";
    reason: string;
  }>;
  nextEvidenceAction: string;
  unsupportedClaims: string[];
};

export type DecisionThoughtJournalEntry = {
  id: string;
  phase: DecisionThoughtJournalPhase;
  status: DecisionThoughtJournalEntryStatus;
  title: string;
  observation: string;
  evidence: string[];
  confidenceImpact: number;
  nextCheck: string;
};

export type DecisionThoughtJournal = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-thought-journal";
  status: DecisionThoughtJournalStatus;
  journalHash: string;
  summary: string;
  activeBelief: {
    matchId: string | null;
    match: string | null;
    authorizedAction: DecisionMind["activeDecision"]["authorizedAction"];
    publicPosture: DecisionMind["activeDecision"]["publicPosture"];
    source: DecisionMind["activeDecision"]["source"];
    movement: "raised" | "held" | "lowered" | "blocked";
    reason: string;
  };
  confidencePulse: {
    score: number;
    grade: DecisionMind["thinkingTrace"]["confidenceBudget"]["grade"];
    netThoughtPressure: number;
    support: number;
    questions: number;
    needsEvidence: number;
    blocks: number;
  };
  entries: DecisionThoughtJournalEntry[];
  nextEvidenceAction: string;
  changeTriggers: string[];
  controls: {
    canInspect: true;
    canSubmitToOpenAI: boolean;
    canPromote: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canUpgradePublicAction: false;
  };
  aiReview: {
    requested: boolean;
    provider: "openai" | "deterministic";
    status: DecisionThoughtJournalReviewStatus;
    model: string | null;
    reviewHash: string | null;
    reason: string | null;
    review: DecisionThoughtJournalReview | null;
    safeNoPersistence: true;
  };
  proofUrls: string[];
};

const thoughtJournalReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["agree", "downgrade", "needs-evidence", "block"] },
    summary: { type: "string" },
    citedEntryIds: { type: "array", items: { type: "string" } },
    riskFlags: { type: "array", items: { type: "string" } },
    dataGaps: { type: "array", items: { type: "string" } },
    falsifiers: { type: "array", items: { type: "string" } },
    safetyGates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          status: { type: "string", enum: ["pass", "watch", "block"] },
          reason: { type: "string" }
        },
        required: ["id", "label", "status", "reason"]
      }
    },
    nextEvidenceAction: { type: "string" },
    unsupportedClaims: { type: "array", items: { type: "string" } }
  },
  required: [
    "verdict",
    "summary",
    "citedEntryIds",
    "riskFlags",
    "dataGaps",
    "falsifiers",
    "safetyGates",
    "nextEvidenceAction",
    "unsupportedClaims"
  ]
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

function compact(value: string, max = 320): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function boundedText(value: unknown, max = 360): string {
  return typeof value === "string" ? compact(value, max) : "";
}

function boundedList(value: unknown, limit: number, max = 220): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => boundedText(item, max)).filter(Boolean).slice(0, limit);
}

function isReviewVerdict(value: unknown): value is DecisionThoughtJournalReviewVerdict {
  return value === "agree" || value === "downgrade" || value === "needs-evidence" || value === "block";
}

function isSafetyGateStatus(value: unknown): value is DecisionThoughtJournalReview["safetyGates"][number]["status"] {
  return value === "pass" || value === "watch" || value === "block";
}

function boundedSafetyGates(value: unknown): DecisionThoughtJournalReview["safetyGates"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const label = boundedText(record.label, 120);
      const reason = boundedText(record.reason, 360);
      const status = isSafetyGateStatus(record.status) ? record.status : null;
      if (!label || !reason || !status) return null;
      return {
        id: boundedText(record.id, 90) || `thought-journal-gate-${index + 1}`,
        label,
        status,
        reason
      };
    })
    .filter((item): item is DecisionThoughtJournalReview["safetyGates"][number] => Boolean(item))
    .slice(0, 8);
}

function entryStatus(status: DecisionMindThoughtStatus): DecisionThoughtJournalEntryStatus {
  if (status === "supports") return "support";
  if (status === "questions") return "question";
  if (status === "needs-evidence") return "need-evidence";
  return "block";
}

function statusFromMind(status: DecisionMind["status"]): DecisionThoughtJournalStatus {
  if (status === "waiting-for-evidence") return "waiting-for-evidence";
  return status;
}

function confidenceImpact(status: DecisionThoughtJournalEntryStatus, weightedScore = 0): number {
  if (status === "support") return Math.max(1, Math.round(weightedScore));
  if (status === "question") return -Math.max(1, Math.round(weightedScore / 2 || 4));
  if (status === "need-evidence") return -Math.max(2, Math.round(weightedScore / 2 || 6));
  return -Math.max(8, Math.round(weightedScore || 10));
}

function movementFor(mind: DecisionMind): DecisionThoughtJournal["activeBelief"]["movement"] {
  if (mind.status === "blocked" || mind.thinkingTrace.beliefPressure.blocking > 0) return "blocked";
  if (mind.activeDecision.authorizedAction === "avoid") return "lowered";
  if (mind.thinkingTrace.confidenceBudget.score >= 70 && mind.activeDecision.authorizedAction === "consider") return "raised";
  return "held";
}

export function safeParseThoughtJournalReview(text: string, allowedEntryIds: Set<string>): DecisionThoughtJournalReview | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!isReviewVerdict(parsed.verdict)) return null;
    const summary = boundedText(parsed.summary, 560);
    const nextEvidenceAction = boundedText(parsed.nextEvidenceAction, 300);
    const safetyGates = boundedSafetyGates(parsed.safetyGates);
    if (!summary || !nextEvidenceAction || !safetyGates.length) return null;
    return {
      verdict: parsed.verdict,
      summary,
      citedEntryIds: boundedList(parsed.citedEntryIds, 12, 120).filter((id) => allowedEntryIds.has(id)),
      riskFlags: boundedList(parsed.riskFlags, 8),
      dataGaps: boundedList(parsed.dataGaps, 8),
      falsifiers: boundedList(parsed.falsifiers, 8),
      safetyGates,
      nextEvidenceAction,
      unsupportedClaims: boundedList(parsed.unsupportedClaims, 8)
    };
  } catch {
    return null;
  }
}

function entry(input: DecisionThoughtJournalEntry): DecisionThoughtJournalEntry {
  return {
    ...input,
    observation: compact(input.observation, 360),
    evidence: unique(input.evidence, 8),
    nextCheck: compact(input.nextCheck, 260)
  };
}

function buildEntries(mind: DecisionMind): DecisionThoughtJournalEntry[] {
  const trace = mind.thinkingTrace;
  const pressure = trace.beliefPressure;
  const evidenceGap = trace.evidenceGaps[0] ?? trace.nextEvidenceAction;
  const nextSafe = mind.nextSafeAction?.reason ?? trace.nextEvidenceAction;
  const budgetEntries = trace.confidenceBudget.items.slice(0, 5).map((item) => {
    const status: DecisionThoughtJournalEntryStatus =
      item.status === "adds-confidence" ? "support" : item.status === "neutral" ? "question" : "need-evidence";
    return entry({
      id: `budget-${item.id}`,
      phase: "weigh",
      status,
      title: item.label,
      observation: item.detail,
      evidence: [item.id, `score:${item.score}`, `weight:${item.weight}`],
      confidenceImpact: confidenceImpact(status, item.weightedScore),
      nextCheck: status === "support" ? "Keep this signal in the active belief budget." : trace.nextEvidenceAction
    });
  });
  const thoughtEntries = mind.thoughts.slice(0, 8).map((thought) => {
    const status = entryStatus(thought.status);
    return entry({
      id: `thought-${thought.id}`,
      phase: thought.status === "supports" ? "weigh" : thought.status === "questions" ? "challenge" : thought.status === "blocks" ? "decide" : "challenge",
      status,
      title: thought.label,
      observation: thought.claim,
      evidence: thought.evidence,
      confidenceImpact: confidenceImpact(status),
      nextCheck: thought.nextCheck
    });
  });

  return [
    entry({
      id: "sense-active-belief",
      phase: "sense",
      status: mind.activeDecision.match ? "support" : "need-evidence",
      title: mind.activeDecision.match ?? "No active decision",
      observation: mind.belief.summary,
      evidence: unique([
        mind.activeDecision.matchId,
        `source:${mind.activeDecision.source}`,
        `score:${mind.activeDecision.decisionScore ?? "n/a"}`,
        `edge:${mind.activeDecision.valueEdge ?? "n/a"}`
      ]),
      confidenceImpact: mind.activeDecision.match ? 4 : -8,
      nextCheck: trace.nextEvidenceAction
    }),
    ...budgetEntries,
    ...thoughtEntries,
    entry({
      id: "challenge-counter-thesis",
      phase: "challenge",
      status: pressure.blocking ? "block" : pressure.needsEvidence ? "need-evidence" : pressure.questioning ? "question" : "support",
      title: "Counter-thesis",
      observation: trace.counterThesis,
      evidence: unique([...trace.falsifiers.slice(0, 4), ...mind.doubts.slice(0, 4)]),
      confidenceImpact: pressure.blocking ? -16 : pressure.needsEvidence ? -10 : pressure.questioning ? -6 : 3,
      nextCheck: evidenceGap
    }),
    entry({
      id: "decide-authority",
      phase: "decide",
      status: mind.activeDecision.authorizedAction === "avoid" ? "block" : mind.activeDecision.authorizedAction === "monitor" ? "question" : "support",
      title: `Authority says ${mind.activeDecision.authorizedAction}`,
      observation: mind.activeDecision.reason,
      evidence: unique([
        `posture:${mind.activeDecision.publicPosture}`,
        `confidence:${mind.activeDecision.confidence}`,
        `risk:${mind.activeDecision.risk}`,
        mind.activeDecision.source
      ]),
      confidenceImpact: mind.activeDecision.authorizedAction === "consider" ? 8 : mind.activeDecision.authorizedAction === "monitor" ? -4 : -14,
      nextCheck: nextSafe
    }),
    entry({
      id: "verify-next-action",
      phase: "verify",
      status: mind.nextSafeAction ? "support" : "need-evidence",
      title: mind.nextSafeAction?.label ?? "No safe proof command",
      observation: mind.nextSafeAction?.reason ?? "The journal needs a read-only proof command before trust can move.",
      evidence: unique([mind.nextSafeAction?.command, mind.nextSafeAction?.verifyUrl, ...mind.proofUrls.slice(0, 4)]),
      confidenceImpact: mind.nextSafeAction ? 4 : -8,
      nextCheck: mind.nextSafeAction?.command ?? trace.nextEvidenceAction
    }),
    entry({
      id: "learn-change-triggers",
      phase: "learn",
      status: mind.changeMyMind.length ? "question" : "support",
      title: "Change-my-mind triggers",
      observation: mind.changeMyMind[0] ?? "No immediate change trigger was supplied, so the active belief stays under observation.",
      evidence: unique([mind.mindHash, ...mind.changeMyMind.slice(0, 5)]),
      confidenceImpact: mind.changeMyMind.length ? -5 : 2,
      nextCheck: mind.changeMyMind[0] ?? "Keep recording falsifiers after each proof turn."
    })
  ].slice(0, 22);
}

function deterministicReview(journal: DecisionThoughtJournal): DecisionThoughtJournalReview {
  const blockingEntry = journal.entries.find((item) => item.status === "block");
  const evidenceEntry = journal.entries.find((item) => item.status === "need-evidence");
  const verdict: DecisionThoughtJournalReviewVerdict = blockingEntry ? "block" : evidenceEntry ? "needs-evidence" : "agree";
  return {
    verdict,
    summary: blockingEntry
      ? `Deterministic reviewer blocks promotion because ${blockingEntry.title} is blocking the active belief.`
      : evidenceEntry
        ? `Deterministic reviewer keeps the belief supervised because ${evidenceEntry.title} still needs evidence.`
        : "Deterministic reviewer agrees with the read-only thought journal.",
    citedEntryIds: unique([blockingEntry?.id, evidenceEntry?.id, journal.entries[0]?.id], 6),
    riskFlags: journal.entries.filter((item) => item.status === "block" || item.status === "question").map((item) => `${item.title}: ${item.observation}`).slice(0, 6),
    dataGaps: journal.entries.filter((item) => item.status === "need-evidence").map((item) => item.nextCheck).slice(0, 6),
    falsifiers: journal.changeTriggers.slice(0, 6),
    safetyGates: [
      {
        id: "no-promotion",
        label: "No promotion",
        status: journal.controls.canPromote ? "block" : "pass",
        reason: "Thought journal review cannot promote the active belief or public action."
      },
      {
        id: "no-persistence",
        label: "No persistence",
        status: journal.controls.canPersist ? "block" : "pass",
        reason: "Thought journal review cannot write memory, results, or training data."
      },
      {
        id: "belief-lock",
        label: "Belief lock",
        status: blockingEntry ? "block" : evidenceEntry ? "watch" : "pass",
        reason: blockingEntry?.nextCheck ?? evidenceEntry?.nextCheck ?? "No blocking journal entry was found."
      }
    ],
    nextEvidenceAction: blockingEntry?.nextCheck ?? evidenceEntry?.nextCheck ?? journal.nextEvidenceAction,
    unsupportedClaims: []
  };
}

function withReview({
  journal,
  provider,
  status,
  review,
  model = null,
  reason = null
}: {
  journal: DecisionThoughtJournal;
  provider: DecisionThoughtJournal["aiReview"]["provider"];
  status: DecisionThoughtJournalReviewStatus;
  review: DecisionThoughtJournalReview;
  model?: string | null;
  reason?: string | null;
}): DecisionThoughtJournal {
  return {
    ...journal,
    aiReview: {
      requested: true,
      provider,
      status,
      model,
      reviewHash: stableHash(review),
      reason,
      review,
      safeNoPersistence: true
    }
  };
}

export function buildOpenAIThoughtJournalPayload({
  journal,
  model
}: {
  journal: DecisionThoughtJournal;
  model: string;
}) {
  return {
    model,
    store: false,
    reasoning: { effort: "medium", summary: "auto" },
    input: [
      {
        role: "system" as const,
        content: [
          "You are OddsPadi's guarded thought-journal critic.",
          "Use only supplied journal JSON and cite supplied journal entry IDs.",
          "Return public audit notes only, not hidden chain-of-thought.",
          "Do not invent injuries, lineups, suspensions, weather, news, odds, scores, or bookmaker movement.",
          "You may agree, downgrade, require evidence, or block.",
          "You must not publish, persist, train, stake, or upgrade public action.",
          "Return strict JSON matching the schema."
        ].join(" ")
      },
      {
        role: "user" as const,
        content: JSON.stringify({
          journal: {
            date: journal.date,
            sport: journal.sport,
            status: journal.status,
            activeBelief: journal.activeBelief,
            confidencePulse: journal.confidencePulse,
            entries: journal.entries,
            nextEvidenceAction: journal.nextEvidenceAction,
            changeTriggers: journal.changeTriggers,
            controls: journal.controls
          },
          outputRules: {
            allowedEntryIds: journal.entries.map((item) => item.id),
            noPromotion: true,
            noPersistence: true,
            noPublish: true,
            noTraining: true,
            allowedVerdicts: ["agree", "downgrade", "needs-evidence", "block"]
          }
        })
      }
    ],
    text: {
      format: {
        type: "json_schema" as const,
        name: "OddsPadiThoughtJournalReview",
        strict: true,
        schema: thoughtJournalReviewSchema
      }
    },
    max_output_tokens: 1200
  };
}

export function buildDecisionThoughtJournal({
  mind,
  env = process.env,
  now = new Date()
}: {
  mind: DecisionMind;
  env?: Record<string, string | undefined>;
  now?: Date;
}): DecisionThoughtJournal {
  const entries = buildEntries(mind);
  const pressure = mind.thinkingTrace.beliefPressure;
  const status = statusFromMind(mind.status);
  const movement = movementFor(mind);
  const journalHash = stableHash({
    date: mind.date,
    sport: mind.sport,
    mind: mind.mindHash,
    status,
    movement,
    entries: entries.map((item) => [item.id, item.phase, item.status, item.confidenceImpact]),
    nextEvidenceAction: mind.thinkingTrace.nextEvidenceAction
  });
  const blocking = entries.filter((item) => item.status === "block").length;
  const waiting = entries.filter((item) => item.status === "need-evidence").length;
  const summary =
    blocking > 0
      ? `Thought journal recorded ${entries.length} steps and ${blocking} blocking thought(s); the active belief cannot promote.`
      : waiting > 0
        ? `Thought journal recorded ${entries.length} steps and ${waiting} evidence gap(s); the active belief stays supervised.`
        : `Thought journal recorded ${entries.length} steps; the active belief is internally coherent but still read-only.`;

  return {
    generatedAt: now.toISOString(),
    date: mind.date,
    sport: mind.sport,
    mode: "decision-thought-journal",
    status,
    journalHash,
    summary,
    activeBelief: {
      matchId: mind.activeDecision.matchId,
      match: mind.activeDecision.match,
      authorizedAction: mind.activeDecision.authorizedAction,
      publicPosture: mind.activeDecision.publicPosture,
      source: mind.activeDecision.source,
      movement,
      reason: mind.activeDecision.reason
    },
    confidencePulse: {
      score: mind.thinkingTrace.confidenceBudget.score,
      grade: mind.thinkingTrace.confidenceBudget.grade,
      netThoughtPressure: pressure.netScore,
      support: pressure.supporting,
      questions: pressure.questioning,
      needsEvidence: pressure.needsEvidence,
      blocks: pressure.blocking
    },
    entries,
    nextEvidenceAction: mind.thinkingTrace.nextEvidenceAction,
    changeTriggers: mind.changeMyMind.slice(0, 8),
    controls: {
      canInspect: true,
      canSubmitToOpenAI: Boolean(env.OPENAI_API_KEY?.trim()),
      canPromote: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canUpgradePublicAction: false
    },
    aiReview: {
      requested: false,
      provider: "deterministic",
      status: "not-requested",
      model: null,
      reviewHash: null,
      reason: null,
      review: null,
      safeNoPersistence: true
    },
    proofUrls: unique(["/api/sports/decision/thought-journal", "/api/sports/decision/mind", ...mind.proofUrls], 18)
  };
}

export async function runDecisionThoughtJournalReview({
  mind,
  runRequested = false,
  apiKey = process.env.OPENAI_API_KEY,
  model = getDecisionOpenAIModel(),
  env = process.env,
  fetchImpl = fetch,
  now = new Date()
}: {
  mind: DecisionMind;
  runRequested?: boolean;
  apiKey?: string;
  model?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<DecisionThoughtJournal> {
  const journal = buildDecisionThoughtJournal({
    mind,
    env: {
      ...env,
      OPENAI_API_KEY: apiKey
    },
    now
  });
  if (!runRequested) return journal;

  const fallback = deterministicReview(journal);
  if (!apiKey) {
    return withReview({
      journal,
      provider: "deterministic",
      status: "not-configured",
      review: fallback,
      reason: "OPENAI_API_KEY is not configured.",
      model: null
    });
  }

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(buildOpenAIThoughtJournalPayload({ journal, model }))
    });

    if (!response.ok) {
      const providerError = await readDecisionOpenAIProviderError(response);
      return withReview({
        journal,
        provider: "openai",
        status: "provider-error",
        review: fallback,
        reason: providerError.reason,
        model
      });
    }

    const outputText = extractOutputText((await response.json()) as unknown);
    if (!outputText) {
      return withReview({
        journal,
        provider: "openai",
        status: "invalid-response",
        review: fallback,
        reason: "OpenAI response did not include output text.",
        model
      });
    }

    const review = safeParseThoughtJournalReview(outputText, new Set(journal.entries.map((item) => item.id)));
    if (!review) {
      return withReview({
        journal,
        provider: "openai",
        status: "invalid-response",
        review: fallback,
        reason: "OpenAI response did not match the thought-journal review schema.",
        model
      });
    }

    return withReview({
      journal,
      provider: "openai",
      status: "reviewed",
      review,
      model
    });
  } catch {
    return withReview({
      journal,
      provider: "openai",
      status: "provider-error",
      review: fallback,
      reason: "OpenAI thought-journal review failed before a valid response was received.",
      model
    });
  }
}
