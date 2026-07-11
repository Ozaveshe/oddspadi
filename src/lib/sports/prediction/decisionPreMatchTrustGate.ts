import type { DecisionDataAuthority } from "@/lib/sports/prediction/decisionDataAuthority";
import type { DecisionDataBackbone } from "@/lib/sports/prediction/decisionDataBackbone";
import type { DecisionEplPreKickoffRehearsal } from "@/lib/sports/prediction/decisionEplPreKickoffRehearsal";
import type { DecisionEvidenceFreshnessGate } from "@/lib/sports/prediction/decisionEvidenceFreshnessGate";
import type { DecisionMarketAlternativeArbiter, DecisionMarketAlternativeCandidate } from "@/lib/sports/prediction/decisionMarketAlternativeArbiter";
import type { Sport } from "@/lib/sports/types";

export type DecisionPreMatchTrustStatus = "shadow-ready" | "monitor-only" | "avoid-only" | "blocked";
export type DecisionPreMatchTrustCeiling = "shadow-analysis" | "monitor-only" | "avoid-only" | "blocked";
export type DecisionPreMatchGateStatus = "pass" | "watch" | "block";

export type DecisionPreMatchGate = {
  id: string;
  label: string;
  status: DecisionPreMatchGateStatus;
  score: number;
  detail: string;
  nextAction: string;
  proofUrl: string;
};

export type DecisionPreMatchTrustCandidate = {
  matchId: string;
  match: string;
  sport: Sport;
  league: string;
  primarySelection: string | null;
  preferredAlternative: string | null;
  marketRecommendation: DecisionMarketAlternativeCandidate["recommendation"];
  trustScore: number;
  trustCeiling: DecisionPreMatchTrustCeiling;
  publicAction: "blocked" | "avoid-only" | "monitor-only";
  canUseProviderSignals: boolean;
  canUseMarketEdge: boolean;
  canUseAIReview: boolean;
  gates: DecisionPreMatchGate[];
  requiredNextEvidence: string[];
  engineInstruction: string;
};

export type DecisionPreMatchTrustGate = {
  mode: "pre-match-trust-gate";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionPreMatchTrustStatus;
  trustHash: string;
  summary: string;
  eplBridge: {
    season: string;
    startDate: string;
    daysUntilStart: number;
    officialFixtureSeeded: boolean;
    openingFixtures: number;
    rehearsalStatus: DecisionEplPreKickoffRehearsal["status"];
  };
  totals: {
    candidates: number;
    shadowAnalysis: number;
    monitorOnly: number;
    avoidOnly: number;
    blocked: number;
    averageTrustScore: number;
    providerReady: number;
    marketEdgeUsable: number;
  };
  topCandidate: DecisionPreMatchTrustCandidate | null;
  candidates: DecisionPreMatchTrustCandidate[];
  controls: {
    canInspectReadOnly: true;
    canUseForAiPrompt: true;
    canApplyToLiveDecision: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
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

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return 0;
  return clamp(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

function compact(text: string, max = 210): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function scoreGate(status: DecisionPreMatchGateStatus, base: number): number {
  if (status === "pass") return base;
  if (status === "watch") return Math.round(base * 0.55);
  return 0;
}

function gate({
  id,
  label,
  status,
  base,
  detail,
  nextAction,
  proofUrl
}: {
  id: string;
  label: string;
  status: DecisionPreMatchGateStatus;
  base: number;
  detail: string;
  nextAction: string;
  proofUrl: string;
}): DecisionPreMatchGate {
  return {
    id,
    label,
    status,
    score: scoreGate(status, base),
    detail: compact(detail),
    nextAction: compact(nextAction),
    proofUrl
  };
}

function statusFromBackbone(status: DecisionDataBackbone["status"]): DecisionPreMatchGateStatus {
  if (status === "ready-provider-dry-run") return "pass";
  if (status === "needs-provider-env" || status === "needs-corpus" || status === "needs-storage-proof") return "watch";
  return "block";
}

function statusFromAuthority(status: DecisionDataAuthority["status"]): DecisionPreMatchGateStatus {
  if (status === "live-authorized" || status === "dry-run-ready") return "pass";
  if (status === "needs-provider-env" || status === "needs-supabase-proof" || status === "training-blocked") return "watch";
  return "block";
}

function statusFromFreshness(status: DecisionEvidenceFreshnessGate["status"]): DecisionPreMatchGateStatus {
  if (status === "fresh-enough") return "pass";
  if (status === "needs-refresh") return "watch";
  return "block";
}

function statusFromMarket(recommendation: DecisionMarketAlternativeCandidate["recommendation"]): DecisionPreMatchGateStatus {
  if (recommendation === "prefer-primary" || recommendation === "prefer-safer-alternative") return "pass";
  if (recommendation === "needs-price") return "watch";
  return "block";
}

function statusFromEpl(rehearsal: DecisionEplPreKickoffRehearsal, candidate: DecisionMarketAlternativeCandidate): DecisionPreMatchGateStatus {
  if (candidate.sport !== "football" || !/premier league/i.test(candidate.league)) return "watch";
  if (rehearsal.status === "ready-read-only") return "pass";
  if (rehearsal.status === "needs-provider" || rehearsal.status === "needs-context") return "watch";
  return "block";
}

function candidateGates({
  candidate,
  dataBackbone,
  dataAuthority,
  evidenceFreshnessGate,
  eplPreKickoffRehearsal
}: {
  candidate: DecisionMarketAlternativeCandidate;
  dataBackbone: DecisionDataBackbone;
  dataAuthority: DecisionDataAuthority;
  evidenceFreshnessGate: DecisionEvidenceFreshnessGate;
  eplPreKickoffRehearsal: DecisionEplPreKickoffRehearsal;
}): DecisionPreMatchGate[] {
  const backboneGate = dataBackbone.gates.find((item) => item.status === "block") ?? dataBackbone.gates.find((item) => item.status === "watch") ?? dataBackbone.gates[0];
  const freshness = evidenceFreshnessGate.selectedCheck;
  const providerFamily = dataAuthority.topFamily;
  const marketGateStatus = statusFromMarket(candidate.recommendation);
  const eplGateStatus = statusFromEpl(eplPreKickoffRehearsal, candidate);

  return [
    gate({
      id: "data-backbone",
      label: "Data backbone",
      status: statusFromBackbone(dataBackbone.status),
      base: 25,
      detail: `${dataBackbone.readinessScore}/100 readiness; ${backboneGate?.detail ?? dataBackbone.summary}`,
      nextAction: dataBackbone.nextAction.expectedEvidence,
      proofUrl: "/api/sports/decision/data-backbone"
    }),
    gate({
      id: "provider-authority",
      label: "Provider authority",
      status: statusFromAuthority(dataAuthority.status),
      base: 20,
      detail: `${dataAuthority.trustScore}/100 authority; ${providerFamily?.label ?? "no provider family selected"}.`,
      nextAction: dataAuthority.nextCommand.expectedEvidence,
      proofUrl: "/api/sports/decision/data-authority"
    }),
    gate({
      id: "evidence-freshness",
      label: "Evidence freshness",
      status: statusFromFreshness(evidenceFreshnessGate.status),
      base: 20,
      detail: freshness ? `${freshness.label}: ${freshness.status}; ${freshness.freshnessScore}/100.` : evidenceFreshnessGate.summary,
      nextAction: freshness?.nextAction ?? evidenceFreshnessGate.summary,
      proofUrl: "/api/sports/decision/evidence-freshness-gate"
    }),
    gate({
      id: "market-alternative",
      label: "Market alternative",
      status: marketGateStatus,
      base: 20,
      detail: `${candidate.recommendation.replaceAll("-", " ")}; ${candidate.rationale}`,
      nextAction:
        candidate.recommendation === "needs-price"
          ? "Load provider odds for safer alternatives before edge or EV can be trusted."
          : candidate.recommendation === "avoid-market"
            ? "Keep the match in research mode until market and evidence blockers clear."
            : "Keep arbitration read-only until provider/storage/training gates pass.",
      proofUrl: "/api/sports/decision/market-alternative-arbiter"
    }),
    gate({
      id: "epl-pre-kickoff",
      label: "EPL pre-kickoff",
      status: eplGateStatus,
      base: 15,
      detail:
        candidate.sport === "football" && /premier league/i.test(candidate.league)
          ? `${eplPreKickoffRehearsal.season.season} starts ${eplPreKickoffRehearsal.season.seasonStartDate}; rehearsal ${eplPreKickoffRehearsal.status}.`
          : `EPL bridge is tracked separately; current candidate league is ${candidate.league}.`,
      nextAction:
        candidate.sport === "football" && /premier league/i.test(candidate.league)
          ? eplPreKickoffRehearsal.fixtures[0]?.nextAction.expectedEvidence ?? eplPreKickoffRehearsal.summary
          : "No EPL opening-fixture gate applies to this candidate.",
      proofUrl: "/api/sports/decision/epl-pre-kickoff-rehearsal"
    })
  ];
}

function ceilingFor({
  gates,
  dataAuthority,
  evidenceFreshnessGate,
  marketCandidate
}: {
  gates: DecisionPreMatchGate[];
  dataAuthority: DecisionDataAuthority;
  evidenceFreshnessGate: DecisionEvidenceFreshnessGate;
  marketCandidate: DecisionMarketAlternativeCandidate;
}): DecisionPreMatchTrustCeiling {
  if (gates.some((item) => item.id === "data-backbone" && item.status === "block")) return "blocked";
  if (evidenceFreshnessGate.status === "blocked") return "avoid-only";
  if (marketCandidate.recommendation === "avoid-market") return "avoid-only";
  if (dataAuthority.decisionPolicy.publicDecisionCeiling === "monitor-only" && gates.every((item) => item.status !== "block")) return "monitor-only";
  if (gates.some((item) => item.status === "watch" || item.status === "block")) return "shadow-analysis";
  return "monitor-only";
}

function publicActionFor(ceiling: DecisionPreMatchTrustCeiling): DecisionPreMatchTrustCandidate["publicAction"] {
  if (ceiling === "monitor-only") return "monitor-only";
  if (ceiling === "avoid-only" || ceiling === "shadow-analysis") return "avoid-only";
  return "blocked";
}

function engineInstructionFor(candidate: DecisionPreMatchTrustCandidate): string {
  if (candidate.trustCeiling === "blocked") {
    return `Do not generate a public pick for ${candidate.match}; explain the blocked data backbone and request the next evidence item.`;
  }
  if (candidate.trustCeiling === "avoid-only") {
    return `For ${candidate.match}, allow only avoid/monitor language until missing freshness, provider, and market gates clear.`;
  }
  if (candidate.trustCeiling === "shadow-analysis") {
    return `For ${candidate.match}, think through the model and safer alternatives, but label the result shadow-only and require proof before action.`;
  }
  return `For ${candidate.match}, provider-backed monitoring may be explained, but staking, publishing, persistence, and training remain locked.`;
}

function trustCandidate({
  marketCandidate,
  dataBackbone,
  dataAuthority,
  evidenceFreshnessGate,
  eplPreKickoffRehearsal
}: {
  marketCandidate: DecisionMarketAlternativeCandidate;
  dataBackbone: DecisionDataBackbone;
  dataAuthority: DecisionDataAuthority;
  evidenceFreshnessGate: DecisionEvidenceFreshnessGate;
  eplPreKickoffRehearsal: DecisionEplPreKickoffRehearsal;
}): DecisionPreMatchTrustCandidate {
  const gates = candidateGates({
    candidate: marketCandidate,
    dataBackbone,
    dataAuthority,
    evidenceFreshnessGate,
    eplPreKickoffRehearsal
  });
  const trustCeiling = ceilingFor({ gates, dataAuthority, evidenceFreshnessGate, marketCandidate });
  const requiredNextEvidence = gates
    .filter((item) => item.status !== "pass")
    .map((item) => `${item.label}: ${item.nextAction}`)
    .slice(0, 5);
  const candidate: DecisionPreMatchTrustCandidate = {
    matchId: marketCandidate.matchId,
    match: marketCandidate.match,
    sport: marketCandidate.sport,
    league: marketCandidate.league,
    primarySelection: marketCandidate.primary.selection,
    preferredAlternative: marketCandidate.recommendedAlternative?.selection ?? null,
    marketRecommendation: marketCandidate.recommendation,
    trustScore: clamp(gates.reduce((sum, item) => sum + item.score, 0)),
    trustCeiling,
    publicAction: publicActionFor(trustCeiling),
    canUseProviderSignals: dataAuthority.decisionPolicy.canUseProviderBackedLiveSignals && evidenceFreshnessGate.policy.canTrustLiveSlate,
    canUseMarketEdge: marketCandidate.recommendation === "prefer-primary" || marketCandidate.recommendation === "prefer-safer-alternative",
    canUseAIReview: trustCeiling !== "blocked",
    gates,
    requiredNextEvidence,
    engineInstruction: ""
  };
  return {
    ...candidate,
    engineInstruction: engineInstructionFor(candidate)
  };
}

function statusFor(candidates: DecisionPreMatchTrustCandidate[]): DecisionPreMatchTrustStatus {
  if (!candidates.length || candidates.every((item) => item.trustCeiling === "blocked")) return "blocked";
  if (candidates.some((item) => item.trustCeiling === "monitor-only")) return "monitor-only";
  if (candidates.some((item) => item.trustCeiling === "shadow-analysis")) return "shadow-ready";
  return "avoid-only";
}

export function buildDecisionPreMatchTrustGate({
  date,
  sport,
  dataBackbone,
  dataAuthority,
  evidenceFreshnessGate,
  marketAlternativeArbiter,
  eplPreKickoffRehearsal,
  limit = 6,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  dataBackbone: DecisionDataBackbone;
  dataAuthority: DecisionDataAuthority;
  evidenceFreshnessGate: DecisionEvidenceFreshnessGate;
  marketAlternativeArbiter: DecisionMarketAlternativeArbiter;
  eplPreKickoffRehearsal: DecisionEplPreKickoffRehearsal;
  limit?: number;
  now?: Date;
}): DecisionPreMatchTrustGate {
  const candidates = marketAlternativeArbiter.candidates
    .map((marketCandidate) =>
      trustCandidate({
        marketCandidate,
        dataBackbone,
        dataAuthority,
        evidenceFreshnessGate,
        eplPreKickoffRehearsal
      })
    )
    .slice(0, Math.max(1, limit));
  const status = statusFor(candidates);
  const totals = {
    candidates: candidates.length,
    shadowAnalysis: candidates.filter((item) => item.trustCeiling === "shadow-analysis").length,
    monitorOnly: candidates.filter((item) => item.trustCeiling === "monitor-only").length,
    avoidOnly: candidates.filter((item) => item.trustCeiling === "avoid-only").length,
    blocked: candidates.filter((item) => item.trustCeiling === "blocked").length,
    averageTrustScore: average(candidates.map((item) => item.trustScore)),
    providerReady: candidates.filter((item) => item.canUseProviderSignals).length,
    marketEdgeUsable: candidates.filter((item) => item.canUseMarketEdge).length
  };
  const hashPayload = candidates.map((candidate) => [
    candidate.matchId,
    candidate.trustCeiling,
    candidate.publicAction,
    candidate.trustScore,
    candidate.gates.map((gateItem) => [gateItem.id, gateItem.status, gateItem.score])
  ]);

  return {
    mode: "pre-match-trust-gate",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    trustHash: stableHash({
      date,
      sport,
      dataBackbone: dataBackbone.backboneHash,
      dataAuthority: dataAuthority.authorityHash,
      freshness: evidenceFreshnessGate.freshnessHash,
      market: marketAlternativeArbiter.arbiterHash,
      epl: eplPreKickoffRehearsal.rehearsalHash,
      candidates: hashPayload
    }),
    summary:
      candidates.length === 0
        ? "Pre-match trust gate is blocked because no market candidates were available."
        : `Pre-match trust gate scored ${candidates.length} candidate(s); public action remains capped while provider, freshness, storage, and training gates are unresolved.`,
    eplBridge: {
      season: eplPreKickoffRehearsal.season.season,
      startDate: eplPreKickoffRehearsal.season.seasonStartDate,
      daysUntilStart: eplPreKickoffRehearsal.season.daysUntilStart,
      officialFixtureSeeded: true,
      openingFixtures: eplPreKickoffRehearsal.totals.openingFixtures,
      rehearsalStatus: eplPreKickoffRehearsal.status
    },
    totals,
    topCandidate: candidates[0] ?? null,
    candidates,
    controls: {
      canInspectReadOnly: true,
      canUseForAiPrompt: true,
      canApplyToLiveDecision: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: [
      "/api/sports/decision/pre-match-trust-gate",
      "/api/sports/decision/data-backbone",
      "/api/sports/decision/data-authority",
      "/api/sports/decision/evidence-freshness-gate",
      "/api/sports/decision/market-alternative-arbiter",
      "/api/sports/decision/epl-pre-kickoff-rehearsal"
    ],
    locks: [
      "Pre-match trust gate is read-only and cannot mutate live predictions, provider rows, training data, public picks, or stakes.",
      "AI review may use this packet as prompt context, but cannot raise the public action above the computed trust ceiling.",
      "EPL 2026/27 opening fixtures are tracked as official season seeds; provider IDs, lineups, odds, injuries, weather, and backtests still gate action."
    ]
  };
}
