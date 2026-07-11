import { buildDecisionReflection, type DecisionReflection, type DecisionReflectionItem, type DecisionReflectionRisk } from "@/lib/sports/prediction/decisionReflection";
import { buildDecisionSlateThinking, type DecisionSlateThinking } from "@/lib/sports/prediction/decisionSlateThinking";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import { buildDecisionWorkingMemory, type DecisionWorkingMemory } from "@/lib/sports/prediction/decisionWorkingMemory";
import type { Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionRehearsalStatus = "ready" | "needs-proof" | "blocked";
export type DecisionRehearsalMode = "read-only-next-turn";
export type DecisionRehearsalPhase = "observe" | "challenge" | "verify" | "revise" | "learn";
export type DecisionRehearsalStepStatus = "ready" | "waiting" | "blocked";

export type DecisionRehearsalStep = {
  id: string;
  phase: DecisionRehearsalPhase;
  status: DecisionRehearsalStepStatus;
  title: string;
  thought: string;
  expectedEvidence: string[];
  command: string | null;
  verifyUrl: string;
  exitCriteria: string;
  ifFails: string;
};

export type DecisionRehearsal = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionRehearsalStatus;
  mode: DecisionRehearsalMode;
  rehearsalHash: string;
  summary: string;
  focus: {
    matchId: string | null;
    match: string | null;
    selection: string | null;
    risk: DecisionReflectionRisk | null;
    question: string;
  };
  simulatedTurn: DecisionRehearsalStep[];
  nextCommand: {
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
    expectedStateChange: string;
  };
  outcomeProjection: {
    ifProofPasses: string;
    ifProofIsWeak: string;
    ifProofFails: string;
    remainingLocks: string[];
  };
  counts: {
    steps: number;
    ready: number;
    waiting: number;
    blocked: number;
  };
  policy: {
    canPromote: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canRunReadOnlyProof: boolean;
    rule: string;
    verificationUrl: string;
  };
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

function commandFor(path: string): string {
  return decisionCurlCommand(path);
}

function pathForRisk(risk: DecisionReflectionRisk | null, fallback: string): string {
  if (risk === "guardrail-lock") return "/api/sports/decision/authority";
  if (risk === "action-drift") return fallback;
  if (risk === "data-gap" || risk === "provider-missing") return "/api/sports/decision/data-intake";
  if (risk === "market-fragility") return "/api/sports/decision/counterfactual-lab";
  if (risk === "memory-gap") return "/api/sports/decision/memory";
  if (risk === "overconfidence") return "/api/sports/decision/model-ensemble";
  return fallback;
}

function expectedEvidenceForRisk(risk: DecisionReflectionRisk | null, item: DecisionReflectionItem | null): string[] {
  const base = item?.evidence ?? [];
  const specific: Record<DecisionReflectionRisk, string[]> = {
    "guardrail-lock": ["Authority remains same-or-safer.", "Control policy still exposes no write, persist, publish, or train allowance."],
    "action-drift": ["Focused match decision replays with the same or safer action.", "No AI, market, or control layer upgrades the deterministic posture."],
    "data-gap": ["Fixture, odds, lineup, injury/news, standings, or historical-corpus gap is named with provider status.", "The next provider dry-run stays read-only."],
    "provider-missing": ["Missing provider keys or records are listed by signal family.", "Dry-run command identifies the first feed to verify."],
    "market-fragility": ["Counterfactual shock shows whether the edge survives price, lineup, weather/context, and robustness stress.", "Fair-odds buffer remains positive or the item downgrades."],
    "memory-gap": ["Recent memory, settlement, calibration, and backtest state are readable.", "Learned guardrails remain inactive unless real-data proof is healthy."],
    overconfidence: ["Model ensemble agrees the current edge is not outrunning data quality, memory, or risk.", "Positive EV stays discounted by blockers and doubts."]
  };
  return unique([...(risk ? specific[risk] : []), ...base], 6);
}

function buildSteps({
  reflection,
  memory
}: {
  reflection: DecisionReflection;
  memory: DecisionWorkingMemory;
}): DecisionRehearsalStep[] {
  const next = reflection.nextReflection;
  const verifyUrl = pathForRisk(next?.risk ?? null, next?.verifyUrl ?? memory.attention.verifyUrl ?? reflection.policy.verificationUrl);
  const command = next?.command ?? commandFor(verifyUrl);
  const expectedEvidence = expectedEvidenceForRisk(next?.risk ?? null, next);
  const hasBlock = reflection.counts.block > 0 || memory.counts.blockers > 0;
  const hasWatch = reflection.counts.watch > 0 || memory.counts.doubts > 0 || memory.counts.assumptions > 0;

  return [
    {
      id: "rehearsal-observe",
      phase: "observe",
      status: "ready",
      title: "Load the active doubt",
      thought: compact(next ? `Start with ${next.risk}: ${next.question}` : "Start from a clear reflection packet and confirm there is no active doubt."),
      expectedEvidence: unique([reflection.summary, memory.attention.currentBelief, memory.attention.whyNow], 4),
      command: commandFor(reflection.policy.verificationUrl),
      verifyUrl: reflection.policy.verificationUrl,
      exitCriteria: "The next reflection question and current belief are visible in one read-only packet.",
      ifFails: "Keep the slate blocked because the agent cannot name what it is testing."
    },
    {
      id: "rehearsal-challenge",
      phase: "challenge",
      status: "ready",
      title: "Run the targeted proof",
      thought: compact(next?.requiredChange ?? "Run the proof that would change, confirm, or weaken the active belief."),
      expectedEvidence,
      command,
      verifyUrl,
      exitCriteria: "The proof returns evidence that directly answers the active reflection risk.",
      ifFails: "Downgrade to avoid/watch-only and keep the same-or-safer rule active."
    },
    {
      id: "rehearsal-verify",
      phase: "verify",
      status: hasBlock ? "blocked" : "waiting",
      title: "Check same-or-safer posture",
      thought: "Compare the proof result against authority, firewall, and control-policy state before any public posture changes.",
      expectedEvidence: unique(["Authority action is same-or-safer.", "No persist, publish, or train flag opens.", "Reflection score does not rise from weak or missing proof."], 5),
      command: commandFor("/api/sports/decision/authority"),
      verifyUrl: "/api/sports/decision/authority",
      exitCriteria: "Authority confirms the action stayed blocked, watch-only, or safely inspectable.",
      ifFails: "Ignore the proof result and leave the decision blocked."
    },
    {
      id: "rehearsal-revise",
      phase: "revise",
      status: hasBlock || hasWatch ? "waiting" : "ready",
      title: "Revise belief only after proof",
      thought: "If evidence answers the doubt, update the belief pressure; if evidence is weak, lower trust rather than forcing a pick.",
      expectedEvidence: unique(["Belief revision names hold, weaken, needs-evidence, or retire.", "Counterfactual and model-ensemble checks do not contradict the revised posture."], 5),
      command: commandFor("/api/sports/decision/belief-revision"),
      verifyUrl: "/api/sports/decision/belief-revision",
      exitCriteria: "The revised belief has a clear falsifier and no blocked gate is bypassed.",
      ifFails: "Keep the previous safer action and add the failure to the next reflection loop."
    },
    {
      id: "rehearsal-learn",
      phase: "learn",
      status: "blocked",
      title: "Defer learning until storage is trusted",
      thought: "Learning is rehearsed but not executed until Supabase, outcomes, calibration, and provider history are verified.",
      expectedEvidence: unique(["Decision memory is readable.", "Outcome and calibration paths are admin-gated.", "Training corpus uses real provider data before learned guardrails activate."], 5),
      command: commandFor("/api/sports/decision/learning-queue"),
      verifyUrl: "/api/sports/decision/learning-queue",
      exitCriteria: "Learning remains queued until valid Supabase credentials and real-data backtests pass.",
      ifFails: "Do not train or persist; keep learned guardrails inactive."
    }
  ];
}

function statusFrom({
  reflection,
  memory
}: {
  reflection: DecisionReflection;
  memory: DecisionWorkingMemory;
}): DecisionRehearsalStatus {
  if (reflection.status === "blocked" || memory.status === "blocked") return "blocked";
  if (reflection.status === "watching" || memory.status === "needs-evidence") return "needs-proof";
  return "ready";
}

function stepCounts(steps: DecisionRehearsalStep[]): DecisionRehearsal["counts"] {
  return {
    steps: steps.length,
    ready: steps.filter((step) => step.status === "ready").length,
    waiting: steps.filter((step) => step.status === "waiting").length,
    blocked: steps.filter((step) => step.status === "blocked").length
  };
}

function remainingLocks(reflection: DecisionReflection, memory: DecisionWorkingMemory): string[] {
  return unique(
    [
      reflection.policy.canPromote === false ? "promotion locked" : null,
      reflection.policy.canPersist === false ? "persistence locked" : null,
      reflection.policy.canPublish === false ? "publishing locked" : null,
      reflection.policy.canTrain === false ? "training locked" : null,
      memory.status === "blocked" ? "working-memory blockers remain" : null,
      reflection.status === "blocked" ? "reflection blockers remain" : null
    ],
    8
  );
}

export function buildDecisionRehearsal({
  rows,
  date,
  sport,
  slateThinking,
  workingMemory,
  reflection,
  limit = 5
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  slateThinking?: DecisionSlateThinking;
  workingMemory?: DecisionWorkingMemory;
  reflection?: DecisionReflection;
  limit?: number;
}): DecisionRehearsal {
  const slate = slateThinking ?? buildDecisionSlateThinking({ rows, date, sport, limit: Math.max(8, limit) });
  const memory = workingMemory ?? buildDecisionWorkingMemory({ rows, date, sport, slateThinking: slate, limit: Math.max(24, limit * 4) });
  const reflected = reflection ?? buildDecisionReflection({ rows, date, sport, slateThinking: slate, workingMemory: memory, limit: Math.max(8, limit) });
  const allSteps = buildSteps({ reflection: reflected, memory });
  const simulatedTurn = allSteps.slice(0, Math.max(1, Math.min(8, limit)));
  const counts = stepCounts(allSteps);
  const status = statusFrom({ reflection: reflected, memory });
  const next = reflected.nextReflection;
  const challengeStep = allSteps.find((step) => step.phase === "challenge") ?? allSteps[0];
  const locks = remainingLocks(reflected, memory);
  const rehearsalHash = stableHash({
    date,
    sport,
    status,
    reflection: reflected.reflectionHash,
    memory: memory.memoryHash,
    steps: allSteps.map((step) => [step.id, step.status, step.verifyUrl, step.exitCriteria])
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    mode: "read-only-next-turn",
    rehearsalHash,
    summary:
      status === "blocked"
        ? `Rehearsal is blocked; next safe turn is ${challengeStep.title.toLowerCase()} without opening write-mode.`
        : status === "needs-proof"
          ? `Rehearsal needs proof; next safe turn is ${challengeStep.title.toLowerCase()} and then same-or-safer verification.`
          : "Rehearsal is ready; the slate can run a read-only proof turn before any trust change.",
    focus: {
      matchId: reflected.focus.matchId,
      match: reflected.focus.match,
      selection: reflected.focus.selection,
      risk: next?.risk ?? null,
      question: next?.question ?? "No active reflection question."
    },
    simulatedTurn,
    nextCommand: {
      label: challengeStep.title,
      command: challengeStep.command,
      verifyUrl: challengeStep.verifyUrl,
      safeToRun: Boolean(challengeStep.command?.includes("curl.exe -sS") && !challengeStep.command.includes("dryRun=0") && !challengeStep.command.includes("persist=1")),
      expectedStateChange: status === "ready" ? "confirm clear reflection or surface a new watch item" : "reduce, hold, or confirm the current blocked/watch posture"
    },
    outcomeProjection: {
      ifProofPasses: "The agent may rerun reflection and authority, but still cannot promote, persist, publish, or train without separate gates.",
      ifProofIsWeak: "The agent keeps the current posture and asks a narrower evidence question.",
      ifProofFails: "The agent downgrades or keeps the item blocked, then queues repair or data-intake work.",
      remainingLocks: locks
    },
    counts,
    policy: {
      canPromote: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRunReadOnlyProof: Boolean(challengeStep.command),
      rule: "Decision rehearsal simulates the next proof turn only; it cannot execute writes, place bets, publish picks, persist decisions, or train models.",
      verificationUrl: `/api/sports/decision/rehearsal?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`
    }
  };
}
