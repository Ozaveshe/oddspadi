import { describe, expect, it } from "vitest";
import { buildConsensusResearchReceipt } from "@/lib/community/consensusResearch";

describe("community consensus research", () => {
  it("measures model-vs-crowd divergence without promoting crowd votes into the model", () => {
    const receipt = buildConsensusResearchReceipt({
      model: { home: 0.52, draw: 0.26, away: 0.22 },
      votes: { home: 30, draw: 20, away: 50 }
    });
    expect(receipt).toMatchObject({ status: "research_ready", voteCount: 100, modelLeader: "home", crowdLeader: "away", totalVariation: 0.28 });
    expect(receipt.controls).toEqual({ canInfluenceModel: false, canCountAsModelPerformance: false, requiresFrozenPreKickoffPoll: true });
  });

  it("keeps sparse polls visibly below the research threshold", () => {
    const receipt = buildConsensusResearchReceipt({ model: { home: 0.6, away: 0.4 }, votes: { home: 7, away: 3 } });
    expect(receipt.status).toBe("collecting");
    expect(receipt.minimumVotes).toBe(20);
  });

  it("compares model and crowd Brier scores only after an outcome is supplied", () => {
    const receipt = buildConsensusResearchReceipt({
      model: { home: 0.7, draw: 0.2, away: 0.1 },
      votes: { home: 40, draw: 20, away: 40 },
      outcome: "home"
    });
    expect(receipt.brier).toEqual({ model: 0.14, crowd: 0.56, better: "model" });
  });
});
