import { buildDecisionReflection, type DecisionReflectionStatus } from "@/lib/sports/prediction/decisionReflection";
import { buildDecisionRehearsal, type DecisionRehearsalStatus } from "@/lib/sports/prediction/decisionRehearsal";
import { buildDecisionSlateThinking } from "@/lib/sports/prediction/decisionSlateThinking";
import { buildDecisionWorkingMemory, type DecisionWorkingMemoryStatus } from "@/lib/sports/prediction/decisionWorkingMemory";
import type { Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionMultiSport = Extract<Sport, "football" | "basketball" | "tennis">;
export type DecisionMultiSportThinkingStatus = "ready" | "needs-proof" | "blocked";

export type DecisionMultiSportState = {
  sport: DecisionMultiSport;
  status: DecisionMultiSportThinkingStatus;
  priorityScore: number;
  matchCount: number;
  valueCandidates: number;
  monitorOnly: number;
  avoidCount: number;
  averageDataQuality: number;
  modelVersions: string[];
  learning: {
    status: string;
    active: boolean;
    sampleSize: number;
    reason: string;
  };
  slateStatus: string;
  workingMemoryStatus: DecisionWorkingMemoryStatus;
  reflectionStatus: DecisionReflectionStatus;
  rehearsalStatus: DecisionRehearsalStatus;
  blockerCount: number;
  watchCount: number;
  nextMatch: string | null;
  nextQuestion: string;
  nextCommand: string | null;
  verifyUrl: string;
  summary: string;
};

export type DecisionMultiSportThinking = {
  generatedAt: string;
  date: string;
  status: DecisionMultiSportThinkingStatus;
  thinkingHash: string;
  summary: string;
  totals: {
    sports: number;
    matches: number;
    valueCandidates: number;
    blockedSports: number;
    needsProofSports: number;
    readySports: number;
    activeLearningSports: number;
    failedLearningSports: number;
  };
  nextSport: DecisionMultiSportState | null;
  sports: DecisionMultiSportState[];
  policy: {
    canPromote: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    rule: string;
    verificationUrl: string;
  };
};

export type DecisionMultiSportSlateInput = {
  sport: DecisionMultiSport;
  rows: DecisionRow[];
};

export const DECISION_MULTI_SPORTS: DecisionMultiSport[] = ["football", "basketball", "tennis"];

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function compact(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 8): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function toStatus({
  reflectionStatus,
  rehearsalStatus,
  workingMemoryStatus,
  matchCount
}: {
  reflectionStatus: DecisionReflectionStatus;
  rehearsalStatus: DecisionRehearsalStatus;
  workingMemoryStatus: DecisionWorkingMemoryStatus;
  matchCount: number;
}): DecisionMultiSportThinkingStatus {
  if (matchCount === 0 || reflectionStatus === "blocked" || rehearsalStatus === "blocked" || workingMemoryStatus === "blocked") return "blocked";
  if (reflectionStatus === "watching" || rehearsalStatus === "needs-proof" || workingMemoryStatus === "needs-evidence") return "needs-proof";
  return "ready";
}

function priorityFor(state: Omit<DecisionMultiSportState, "priorityScore" | "summary">): number {
  const statusWeight = state.status === "blocked" ? 55 : state.status === "needs-proof" ? 28 : 8;
  const learningWeight = state.learning.active ? 0 : state.learning.status === "failed" ? 14 : 8;
  return Math.round(
    statusWeight +
      state.blockerCount * 5 +
      state.watchCount * 2 +
      state.valueCandidates * 3 +
      learningWeight +
      Math.max(0, 80 - state.averageDataQuality) * 0.12
  );
}

function buildSportState({ sport, rows, date }: DecisionMultiSportSlateInput & { date: string }): DecisionMultiSportState {
  const slateThinking = buildDecisionSlateThinking({ rows, date, sport, limit: 6 });
  const workingMemory = buildDecisionWorkingMemory({ rows, date, sport, slateThinking, limit: 24 });
  const reflection = buildDecisionReflection({ rows, date, sport, slateThinking, workingMemory, limit: 8 });
  const rehearsal = buildDecisionRehearsal({ rows, date, sport, slateThinking, workingMemory, reflection, limit: 5 });
  const valueCandidates = rows.filter((row) => row.prediction.bestPick.hasValue && row.prediction.bestPick.edge > 0 && row.prediction.bestPick.expectedValue > 0).length;
  const monitorOnly = rows.filter((row) => row.prediction.decision.action === "monitor").length;
  const avoidCount = rows.filter((row) => row.prediction.decision.action === "avoid").length;
  const learningProfile = rows.find((row) => row.prediction.decision.learningProfile)?.prediction.decision.learningProfile;
  const baseState = {
    sport,
    status: toStatus({
      reflectionStatus: reflection.status,
      rehearsalStatus: rehearsal.status,
      workingMemoryStatus: workingMemory.status,
      matchCount: rows.length
    }),
    matchCount: rows.length,
    valueCandidates,
    monitorOnly,
    avoidCount,
    averageDataQuality: average(rows.map((row) => row.match.dataQualityScore * 100)),
    modelVersions: unique(rows.map((row) => row.prediction.diagnostics.modelVersion), 6),
    learning: {
      status: learningProfile?.status ?? "missing",
      active: Boolean(learningProfile?.active),
      sampleSize: learningProfile?.sampleSize ?? 0,
      reason: learningProfile?.reason ?? "No sport-specific learning profile is loaded."
    },
    slateStatus: slateThinking.status,
    workingMemoryStatus: workingMemory.status,
    reflectionStatus: reflection.status,
    rehearsalStatus: rehearsal.status,
    blockerCount: workingMemory.counts.blockers + reflection.counts.block,
    watchCount: reflection.counts.watch + workingMemory.counts.doubts + workingMemory.counts.assumptions,
    nextMatch: rehearsal.focus.match ?? slateThinking.nextThought?.match ?? null,
    nextQuestion: rehearsal.focus.question,
    nextCommand: rehearsal.nextCommand.command,
    verifyUrl: rehearsal.nextCommand.verifyUrl
  };
  const priorityScore = priorityFor(baseState);

  return {
    ...baseState,
    priorityScore,
    summary: compact(
      `${sport} is ${baseState.status}; ${rows.length} match(es), ${valueCandidates} value candidate(s), learning ${baseState.learning.status}, next proof ${baseState.verifyUrl}.`,
      260
    )
  };
}

function sortStates(states: DecisionMultiSportState[]): DecisionMultiSportState[] {
  const rank: Record<DecisionMultiSportThinkingStatus, number> = { blocked: 3, "needs-proof": 2, ready: 1 };
  return states.slice().sort((a, b) => {
    const status = rank[b.status] - rank[a.status];
    if (status !== 0) return status;
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    return a.sport.localeCompare(b.sport);
  });
}

export function buildDecisionMultiSportThinking({
  date,
  slates,
  limit = 3
}: {
  date: string;
  slates: DecisionMultiSportSlateInput[];
  limit?: number;
}): DecisionMultiSportThinking {
  const states = sortStates(slates.map((slate) => buildSportState({ ...slate, date })));
  const visibleStates = states.slice(0, Math.max(1, Math.min(DECISION_MULTI_SPORTS.length, limit)));
  const blockedSports = states.filter((state) => state.status === "blocked").length;
  const needsProofSports = states.filter((state) => state.status === "needs-proof").length;
  const readySports = states.filter((state) => state.status === "ready").length;
  const status: DecisionMultiSportThinkingStatus = blockedSports > 0 ? "blocked" : needsProofSports > 0 ? "needs-proof" : "ready";
  const nextSport = visibleStates[0] ?? null;
  const thinkingHash = stableHash({
    date,
    status,
    states: states.map((state) => [
      state.sport,
      state.status,
      state.matchCount,
      state.valueCandidates,
      state.priorityScore,
      state.learning.status,
      state.verifyUrl
    ])
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    status,
    thinkingHash,
    summary: nextSport
      ? `Multi-sport thinking is ${status}; next sport is ${nextSport.sport} because ${nextSport.nextQuestion}`
      : "Multi-sport thinking is blocked because no active sport slates were loaded.",
    totals: {
      sports: states.length,
      matches: states.reduce((sum, state) => sum + state.matchCount, 0),
      valueCandidates: states.reduce((sum, state) => sum + state.valueCandidates, 0),
      blockedSports,
      needsProofSports,
      readySports,
      activeLearningSports: states.filter((state) => state.learning.active).length,
      failedLearningSports: states.filter((state) => state.learning.status === "failed").length
    },
    nextSport,
    sports: visibleStates,
    policy: {
      canPromote: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      rule: "Multi-sport thinking only chooses cross-sport attention and read-only proof order; it cannot promote, persist, publish, or train.",
      verificationUrl: `/api/sports/decision/multi-sport-thinking?date=${encodeURIComponent(date)}`
    }
  };
}
