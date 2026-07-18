export type ConsensusSide = "home" | "draw" | "away";
export type ConsensusDistribution = { home: number; draw?: number; away: number };

export type ConsensusResearchReceipt = {
  status: "no_sample" | "collecting" | "research_ready" | "invalid_model";
  voteCount: number;
  minimumVotes: number;
  model: ConsensusDistribution | null;
  crowd: ConsensusDistribution | null;
  modelLeader: ConsensusSide | null;
  crowdLeader: ConsensusSide | null;
  totalVariation: number | null;
  brier: { model: number; crowd: number; better: "model" | "crowd" | "tie" } | null;
  controls: { canInfluenceModel: false; canCountAsModelPerformance: false; requiresFrozenPreKickoffPoll: true };
};

function finiteProbability(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function normalizeDistribution(distribution: ConsensusDistribution, includeDraw: boolean): ConsensusDistribution | null {
  const home = finiteProbability(distribution.home);
  const away = finiteProbability(distribution.away);
  const draw = includeDraw ? finiteProbability(distribution.draw) : 0;
  if (home === null || away === null || draw === null) return null;
  const total = home + away + draw;
  if (total <= 0) return null;
  return includeDraw ? { home: home / total, draw: draw / total, away: away / total } : { home: home / total, away: away / total };
}

function leader(distribution: ConsensusDistribution): ConsensusSide {
  const entries: Array<[ConsensusSide, number]> = [["home", distribution.home], ["away", distribution.away]];
  if (typeof distribution.draw === "number") entries.push(["draw", distribution.draw]);
  return entries.sort((left, right) => right[1] - left[1])[0][0];
}

function multiclassBrier(distribution: ConsensusDistribution, outcome: ConsensusSide): number {
  const sides: ConsensusSide[] = typeof distribution.draw === "number" ? ["home", "draw", "away"] : ["home", "away"];
  const raw = sides.reduce((sum, side) => sum + ((distribution[side] ?? 0) - (side === outcome ? 1 : 0)) ** 2, 0);
  return Math.round(raw * 1_000_000) / 1_000_000;
}

export function buildConsensusResearchReceipt({
  model,
  votes,
  outcome = null,
  minimumVotes = 20
}: {
  model: ConsensusDistribution;
  votes: { home: number; draw?: number; away: number };
  outcome?: ConsensusSide | null;
  minimumVotes?: number;
}): ConsensusResearchReceipt {
  const includeDraw = typeof model.draw === "number";
  const normalizedModel = normalizeDistribution(model, includeDraw);
  const voteCount = Math.max(0, Math.trunc(votes.home)) + Math.max(0, Math.trunc(votes.away)) + (includeDraw ? Math.max(0, Math.trunc(votes.draw ?? 0)) : 0);
  const controls = { canInfluenceModel: false as const, canCountAsModelPerformance: false as const, requiresFrozenPreKickoffPoll: true as const };
  if (!normalizedModel) return { status: "invalid_model", voteCount, minimumVotes, model: null, crowd: null, modelLeader: null, crowdLeader: null, totalVariation: null, brier: null, controls };
  if (!voteCount) return { status: "no_sample", voteCount, minimumVotes, model: normalizedModel, crowd: null, modelLeader: leader(normalizedModel), crowdLeader: null, totalVariation: null, brier: null, controls };

  const crowd = normalizeDistribution({
    home: Math.max(0, Math.trunc(votes.home)) / voteCount,
    ...(includeDraw ? { draw: Math.max(0, Math.trunc(votes.draw ?? 0)) / voteCount } : {}),
    away: Math.max(0, Math.trunc(votes.away)) / voteCount
  }, includeDraw)!;
  const sides: ConsensusSide[] = includeDraw ? ["home", "draw", "away"] : ["home", "away"];
  const totalVariation = Math.round((0.5 * sides.reduce((sum, side) => sum + Math.abs((normalizedModel[side] ?? 0) - (crowd[side] ?? 0)), 0)) * 1_000_000) / 1_000_000;
  const modelBrier = outcome ? multiclassBrier(normalizedModel, outcome) : null;
  const crowdBrier = outcome ? multiclassBrier(crowd, outcome) : null;
  const brier = modelBrier === null || crowdBrier === null ? null : {
    model: modelBrier,
    crowd: crowdBrier,
    better: Math.abs(modelBrier - crowdBrier) < 0.000001 ? "tie" as const : modelBrier < crowdBrier ? "model" as const : "crowd" as const
  };
  return {
    status: voteCount >= minimumVotes ? "research_ready" : "collecting",
    voteCount,
    minimumVotes,
    model: normalizedModel,
    crowd,
    modelLeader: leader(normalizedModel),
    crowdLeader: leader(crowd),
    totalVariation,
    brier,
    controls
  };
}
