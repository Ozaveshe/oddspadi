import type { DecisionInformationGainCandidate, DecisionInformationGainPlanner } from "@/lib/sports/prediction/decisionInformationGain";
import type { DecisionMind } from "@/lib/sports/prediction/decisionMind";
import type { Sport } from "@/lib/sports/types";

export type DecisionReasoningAlignmentStatus = "aligned" | "watching" | "drift" | "blocked";
export type DecisionReasoningAlignmentCheckStatus = "pass" | "watch" | "block";

export type DecisionReasoningAlignmentCheck = {
  id: string;
  label: string;
  status: DecisionReasoningAlignmentCheckStatus;
  score: number;
  thoughtEvidence: string;
  plannerEvidence: string;
  finding: string;
  nextAction: string;
};

export type DecisionReasoningAlignment = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "reasoning-proof-alignment";
  status: DecisionReasoningAlignmentStatus;
  alignmentHash: string;
  summary: string;
  alignmentScore: number;
  driftScore: number;
  activeCandidate: DecisionInformationGainCandidate | null;
  matchingThoughts: Array<{
    id: string;
    label: string;
    status: DecisionMind["thoughts"][number]["status"];
    score: number;
    nextCheck: string;
  }>;
  checks: DecisionReasoningAlignmentCheck[];
  nextAlignment: {
    label: string;
    command: string | null;
    verifyUrl: string | null;
    source: string | null;
    reason: string;
    safeToRun: boolean;
  } | null;
  controls: {
    canRunReadOnly: boolean;
    canRunDryRun: boolean;
    canAskOpenAI: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canRaiseTrust: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  forbiddenActions: string[];
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

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function compact(value: string, max = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 16): string[] {
  return Array.from(new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))).slice(0, limit);
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "until",
  "before",
  "after",
  "current",
  "decision",
  "evidence",
  "proof",
  "status",
  "candidate",
  "next",
  "run"
]);

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 3 && !STOP_WORDS.has(item))
  );
}

function tokenScore(left: string, right: string): number {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const overlap = Array.from(leftTokens).filter((item) => rightTokens.has(item)).length;
  const base = overlap / Math.min(leftTokens.size, rightTokens.size);
  return clamp(base * 100);
}

function statusForScore(score: number): DecisionReasoningAlignmentCheckStatus {
  if (score >= 70) return "pass";
  if (score >= 40) return "watch";
  return "block";
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return clamp(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function sourceHints(candidate: DecisionInformationGainCandidate | null): string {
  if (!candidate) return "";
  const hints: Record<DecisionInformationGainCandidate["source"], string[]> = {
    "evidence-refresh": ["evidence", "refresh", "signal", "trust", "provider"],
    "hypothesis-lab": ["hypothesis", "falsifier", "thesis", "test"],
    "counterfactual-lab": ["counterfactual", "shock", "robustness", "breaks", "downgrades"],
    "belief-revision": ["belief", "revision", "weaken", "retire", "needs evidence"],
    "data-intake": ["data", "intake", "provider", "missing", "coverage"]
  };
  return [candidate.source, candidate.category, ...hints[candidate.source]].join(" ");
}

function candidateText(candidate: DecisionInformationGainCandidate | null): string {
  if (!candidate) return "";
  return [
    candidate.label,
    candidate.source,
    candidate.category,
    candidate.expectedEvidence,
    candidate.decisionImpact,
    candidate.reason,
    candidate.expectedOutcomes.ifSupports,
    candidate.expectedOutcomes.ifChallenges,
    candidate.expectedOutcomes.ifMissing,
    candidate.verifyUrl ?? "",
    candidate.command ?? ""
  ].join(" ");
}

function mindText(mind: DecisionMind): string {
  return [
    mind.summary,
    mind.thinkingTrace.thesis,
    mind.thinkingTrace.counterThesis,
    mind.thinkingTrace.synthesis,
    mind.thinkingTrace.nextEvidenceAction,
    ...mind.thinkingTrace.evidenceGaps,
    ...mind.changeMyMind,
    ...mind.doubts,
    ...mind.thoughts.flatMap((thought) => [thought.label, thought.claim, thought.uncertainty, thought.nextCheck, thought.source])
  ].join(" ");
}

function matchingThoughts(mind: DecisionMind, candidate: DecisionInformationGainCandidate | null): DecisionReasoningAlignment["matchingThoughts"] {
  const target = candidateText(candidate);
  return mind.thoughts
    .map((thought) => ({
      id: thought.id,
      label: thought.label,
      status: thought.status,
      score: tokenScore(target, [thought.label, thought.claim, thought.uncertainty, thought.nextCheck, thought.source].join(" ")),
      nextCheck: thought.nextCheck
    }))
    .filter((thought) => thought.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 5);
}

function commandCheck(mind: DecisionMind, candidate: DecisionInformationGainCandidate | null): DecisionReasoningAlignmentCheck {
  const thoughtCommand = mind.nextSafeAction?.command ?? null;
  const thoughtUrl = mind.nextSafeAction?.verifyUrl ?? null;
  const candidateCommand = candidate?.command ?? null;
  const candidateUrl = candidate?.verifyUrl ?? null;
  let score = 0;

  if (!candidate) score = 0;
  else if (candidateCommand && thoughtCommand && candidateCommand === thoughtCommand) score = 100;
  else if (candidateUrl && thoughtUrl && candidateUrl === thoughtUrl) score = 90;
  else if (candidate.safeToRun && mind.nextSafeAction?.safeToRun) score = 62;
  else if (!candidate.safeToRun && !mind.nextSafeAction) score = 72;
  else if (candidate.safeToRun && !mind.nextSafeAction) score = 30;
  else score = 42;

  return {
    id: "next-command",
    label: "Next command alignment",
    status: statusForScore(score),
    score,
    thoughtEvidence: thoughtCommand ?? thoughtUrl ?? "No safe command selected by the active mind.",
    plannerEvidence: candidateCommand ?? candidateUrl ?? "No information-gain candidate command.",
    finding:
      score >= 70
        ? "The active mind and proof planner point at the same or compatible verification path."
        : "The active mind and proof planner are not selecting the same next verification path.",
    nextAction: candidate?.safeToRun ? `Prefer information-gain proof: ${candidate.label}.` : "Hold command execution until the planner has a safe candidate."
  };
}

function safetyCheck(mind: DecisionMind, informationGain: DecisionInformationGainPlanner): DecisionReasoningAlignmentCheck {
  const safe =
    mind.locks.canPromote === false &&
    mind.locks.canPersist === false &&
    mind.locks.canPublish === false &&
    mind.locks.canTrain === false &&
    informationGain.controls.canPersist === false &&
    informationGain.controls.canPublish === false &&
    informationGain.controls.canTrain === false &&
    informationGain.controls.canRaiseTrust === false &&
    informationGain.controls.canUpgradePublicAction === false;

  return {
    id: "safety-locks",
    label: "Safety locks",
    status: safe ? "pass" : "block",
    score: safe ? 100 : 0,
    thoughtEvidence: mind.locks.reasons[0] ?? "Mind locks are absent.",
    plannerEvidence: informationGain.forbiddenActions[0] ?? "Planner locks are absent.",
    finding: safe ? "Both layers keep promotion, persistence, publishing, training, and trust raises locked." : "A safety lock drift was detected.",
    nextAction: safe ? "Keep the alignment layer read-only." : "Block the reasoning path until safety locks are restored."
  };
}

function buildChecks(mind: DecisionMind, informationGain: DecisionInformationGainPlanner): DecisionReasoningAlignmentCheck[] {
  const candidate = informationGain.nextCandidate;
  const candidateBody = candidateText(candidate);
  const mindBody = mindText(mind);
  const lexicalScore = tokenScore(candidateBody, mindBody);
  const sourceScore = tokenScore(sourceHints(candidate), mindBody);
  const actionImpactScore = tokenScore(
    [
      candidate?.decisionImpact ?? "",
      candidate?.expectedOutcomes.ifSupports ?? "",
      candidate?.expectedOutcomes.ifChallenges ?? "",
      candidate?.expectedOutcomes.ifMissing ?? ""
    ].join(" "),
    [mind.thinkingTrace.thesis, mind.thinkingTrace.synthesis, ...mind.doubts].join(" ")
  );
  const blockerScore = candidate
    ? candidate.status === "ready" && mind.nextSafeAction
      ? 74
      : candidate.status === "ready" && mind.status === "blocked"
        ? 55
        : candidate.status !== "ready" && (mind.status === "blocked" || mind.aiState.blockedBy.length || mind.thinkingTrace.evidenceGaps.length)
          ? 82
          : candidate.status !== "ready"
            ? 38
            : 52
    : 0;

  return [
    {
      id: "proof-language",
      label: "Proof language match",
      status: statusForScore(lexicalScore),
      score: lexicalScore,
      thoughtEvidence: compact(mind.thinkingTrace.nextEvidenceAction),
      plannerEvidence: compact(candidate?.expectedEvidence ?? "No active information-gain candidate."),
      finding:
        lexicalScore >= 70
          ? "The active thought trace names the same evidence family as the highest-value proof."
          : "The active thought trace does not strongly name the planner's highest-value proof.",
      nextAction: candidate ? `Use ${candidate.label} as the next explicit thought target.` : "Rebuild information gain with a non-empty candidate list."
    },
    {
      id: "source-recognition",
      label: "Planner source recognition",
      status: statusForScore(sourceScore),
      score: sourceScore,
      thoughtEvidence: compact(mind.thoughts.map((thought) => thought.source).join(", ")),
      plannerEvidence: candidate ? `${candidate.source}:${candidate.category}` : "No active source.",
      finding:
        sourceScore >= 70
          ? "The mind references the same source family as the information-gain planner."
          : "The mind does not clearly recognize the planner's source family.",
      nextAction: candidate ? `Add ${candidate.source} evidence to the visible thought trace before acting.` : "Hold alignment until a planner source exists."
    },
    commandCheck(mind, candidate),
    {
      id: "blocker-consistency",
      label: "Blocker consistency",
      status: statusForScore(blockerScore),
      score: blockerScore,
      thoughtEvidence: compact([mind.status, ...mind.aiState.blockedBy, ...mind.thinkingTrace.evidenceGaps].join(" ")),
      plannerEvidence: candidate ? `${candidate.status}; missing env ${candidate.missingEnv.join(", ") || "none"}` : "No active candidate.",
      finding:
        blockerScore >= 70
          ? "The active mind recognizes the same readiness or blocker shape as the planner."
          : "The active mind may be under- or over-stating the planner's readiness state.",
      nextAction: candidate?.missingEnv.length ? `Name missing env: ${candidate.missingEnv.join(", ")}.` : "Keep blocker language synced to the planner status."
    },
    {
      id: "action-impact",
      label: "Action-impact match",
      status: statusForScore(actionImpactScore),
      score: actionImpactScore,
      thoughtEvidence: compact(mind.thinkingTrace.synthesis),
      plannerEvidence: compact(candidate?.decisionImpact ?? "No planner impact available."),
      finding:
        actionImpactScore >= 70
          ? "The mind and planner agree on why the proof could change or cap the decision."
          : "The mind does not yet explain the planner's expected decision impact clearly.",
      nextAction: candidate ? `State how ${candidate.label} could support, challenge, or leave missing the active belief.` : "Wait for a candidate impact."
    },
    safetyCheck(mind, informationGain)
  ];
}

function statusFromScore(score: number, checks: DecisionReasoningAlignmentCheck[], candidate: DecisionInformationGainCandidate | null): DecisionReasoningAlignmentStatus {
  if (!candidate || checks.some((check) => check.id === "safety-locks" && check.status === "block")) return "blocked";
  if (score >= 70 && !checks.some((check) => check.status === "block")) return "aligned";
  if (score >= 50) return "watching";
  if (score >= 30) return "drift";
  return "blocked";
}

export function buildDecisionReasoningAlignment({
  date,
  sport,
  mind,
  informationGain,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  mind: DecisionMind;
  informationGain: DecisionInformationGainPlanner;
  now?: Date;
}): DecisionReasoningAlignment {
  const activeCandidate = informationGain.nextCandidate;
  const checks = buildChecks(mind, informationGain);
  const alignmentScore = average(checks.map((check) => check.score));
  const driftScore = clamp(100 - alignmentScore);
  const status = statusFromScore(alignmentScore, checks, activeCandidate);
  const matches = matchingThoughts(mind, activeCandidate);
  const weakest = checks.slice().sort((a, b) => a.score - b.score)[0] ?? null;
  const nextAlignment = activeCandidate
    ? {
        label: activeCandidate.label,
        command: activeCandidate.command,
        verifyUrl: activeCandidate.verifyUrl,
        source: activeCandidate.source,
        reason:
          weakest && weakest.status !== "pass"
            ? compact(`${weakest.finding} ${weakest.nextAction}`, 260)
            : compact(activeCandidate.reason, 260),
        safeToRun: activeCandidate.safeToRun
      }
    : null;
  const alignmentHash = stableHash({
    date,
    sport,
    mind: mind.mindHash,
    informationGain: informationGain.informationHash,
    activeCandidate: activeCandidate ? [activeCandidate.id, activeCandidate.status, activeCandidate.scoring.informationGainScore] : null,
    checks: checks.map((check) => [check.id, check.status, check.score]),
    alignmentScore,
    status
  });

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "reasoning-proof-alignment",
    status,
    alignmentHash,
    summary:
      status === "aligned"
        ? `Reasoning alignment is healthy at ${alignmentScore}/100; the active mind and planner agree on ${activeCandidate?.label ?? "the next proof"}.`
        : status === "watching"
          ? `Reasoning alignment is watchlisted at ${alignmentScore}/100; keep the next proof explicit before acting.`
          : status === "drift"
            ? `Reasoning alignment found drift at ${alignmentScore}/100; use the information-gain proof before trusting the thought trace.`
            : "Reasoning alignment is blocked because no safe aligned proof path is available.",
    alignmentScore,
    driftScore,
    activeCandidate,
    matchingThoughts: matches,
    checks,
    nextAlignment,
    controls: {
      canRunReadOnly: Boolean(activeCandidate?.safeToRun && activeCandidate.mode === "read-only"),
      canRunDryRun: Boolean(activeCandidate?.safeToRun && activeCandidate.mode === "dry-run"),
      canAskOpenAI: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRaiseTrust: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/reasoning-alignment",
      "/api/sports/decision/mind",
      "/api/sports/decision/information-gain",
      mind.nextSafeAction?.verifyUrl ?? null,
      activeCandidate?.verifyUrl ?? null,
      ...informationGain.proofUrls.slice(0, 6)
    ]),
    forbiddenActions: [
      "Do not treat a thought trace as sufficient proof when it disagrees with information-gain ranking.",
      "Do not ask OpenAI, persist, publish, train, raise trust, or upgrade public action from alignment alone.",
      "Do not run dry-run provider commands while required environment variables are missing.",
      "Do not replace provider evidence with narrative agreement."
    ]
  };
}
