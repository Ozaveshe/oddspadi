import { describe, expect, it } from "vitest";
import { buildChampionChallengerReceipt } from "@/lib/sports/prediction/championChallenger";
import type { DecisionRunRow, OutcomeRow } from "@/lib/sports/prediction/decisionCalibration";

const champion = { promotionId: "promotion-1", modelKey: "football-v1", engineVersion: "engine-v1" };
const challenger = { candidateId: "candidate-2", modelKey: "football-v2", engineVersion: "engine-v1" };
const now = new Date("2026-04-10T12:00:00.000Z");

function runs(): DecisionRunRow[] {
  return [
    { id: "champion-run", confidence: "medium", health: "stable", model_key: champion.modelKey, engine_version: champion.engineVersion },
    { id: "challenger-run", confidence: "medium", health: "stable", model_key: challenger.modelKey, engine_version: challenger.engineVersion }
  ];
}

function pairedOutcomes({
  count = 80,
  championProbability = 0.5,
  challengerProbability = 0.72,
  wins = 58,
  challengerMissing = 0,
  identicalSettlements = false
}: {
  count?: number;
  championProbability?: number;
  challengerProbability?: number;
  wins?: number;
  challengerMissing?: number;
  identicalSettlements?: boolean;
} = {}): OutcomeRow[] {
  const rows: OutcomeRow[] = [];
  const regimeSize = Math.ceil(count / 2);
  const winsPerRegime = Math.round(wins / 2);
  for (let index = 0; index < count; index += 1) {
    const result = index % regimeSize < winsPerRegime ? "won" : "lost";
    const settledAt = identicalSettlements
      ? "2026-04-08T12:00:00.000Z"
      : new Date(Date.UTC(2026, 2, 1 + Math.floor(index / 2), 12)).toISOString();
    const shared = {
      fixture_external_id: `fixture-${index}`,
      sport: "football",
      market: "match_winner",
      selection: "home",
      implied_probability: 0.55,
      value_edge: 0.07,
      odds: 1.9,
      closing_odds: 1.85,
      result,
      settled_at: settledAt,
      created_at: settledAt
    } satisfies Omit<OutcomeRow, "id" | "decision_run_id" | "model_probability">;
    rows.push({ ...shared, id: `champion-${index}`, decision_run_id: "champion-run", model_probability: championProbability });
    if (index >= challengerMissing) {
      rows.push({ ...shared, id: `challenger-${index}`, decision_run_id: "challenger-run", model_probability: challengerProbability });
    }
  }
  return rows;
}

function receipt(outcomes = pairedOutcomes(), evaluatedAt = now) {
  return buildChampionChallengerReceipt({
    sport: "football",
    champion,
    challenger,
    evaluationWindowStart: "2026-02-28T00:00:00.000Z",
    outcomes,
    decisionRuns: runs(),
    now: evaluatedAt
  });
}

describe("champion challenger governance", () => {
  it("promotes only a fresh paired challenger that proves proper-score superiority", () => {
    const result = receipt();

    expect(result).toMatchObject({
      version: "champion-challenger-v1",
      status: "challenger-promotable",
      eligibleForPromotion: true,
      sample: { paired: 80, earlier: 40, recent: 40, championCoverage: 1, challengerCoverage: 1 }
    });
    expect(result.aggregate.brier.upper95ConfidenceBound).toBeLessThan(0);
    expect(result.aggregate.logLoss.upper95ConfidenceBound).toBeLessThan(0);
    expect(result.blockers).toEqual([]);
  });

  it("retains the champion when the challenger is confidently worse", () => {
    const result = receipt(pairedOutcomes({ championProbability: 0.72, challengerProbability: 0.5 }));

    expect(result.status).toBe("champion-retained");
    expect(result.eligibleForPromotion).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([expect.stringContaining("non-inferiority")]));
  });

  it("does not confuse equality with superiority", () => {
    const result = receipt(pairedOutcomes({ championProbability: 0.65, challengerProbability: 0.65 }));

    expect(result.status).toBe("inconclusive");
    expect(result.aggregate.brier.upper95ConfidenceBound).toBe(0);
    expect(result.blockers).toEqual(expect.arrayContaining([expect.stringContaining("not proved superiority")]));
  });

  it("fails closed on thin or poorly paired evidence", () => {
    const thin = receipt(pairedOutcomes({ count: 40, wins: 29 }), new Date("2026-03-22T12:00:00.000Z"));
    const lowCoverage = receipt(pairedOutcomes({ count: 80, challengerMissing: 25 }));

    expect(thin.status).toBe("warming");
    expect(lowCoverage.status).toBe("warming");
    expect(lowCoverage.sample.paired).toBe(55);
  });

  it("rejects duplicate predictions and conflicting outcomes instead of choosing a convenient row", () => {
    const rows = pairedOutcomes();
    rows.push({ ...rows[0]!, id: "champion-duplicate" });
    const duplicate = receipt(rows);
    const conflictingRows = pairedOutcomes();
    conflictingRows[1] = { ...conflictingRows[1]!, result: "lost" };
    const conflicting = receipt(conflictingRows);

    expect(duplicate.status).toBe("invalid");
    expect(duplicate.blockers[0]).toContain("duplicate key");
    expect(conflicting.status).toBe("invalid");
    expect(conflicting.blockers[0]).toContain("conflicting pair");
  });

  it("never splits one settlement cohort to manufacture regime stability", () => {
    const result = receipt(pairedOutcomes({ identicalSettlements: true }));

    expect(result.status).toBe("inconclusive");
    expect(result.blockers).toEqual(expect.arrayContaining([expect.stringContaining("no strict earlier/recent settlement boundary")]));
  });

  it("keeps pair coverage honest inside the bounded 200-pair rolling window", () => {
    const result = receipt(
      pairedOutcomes({ count: 240, wins: 174, challengerProbability: 0.67 }),
      new Date("2026-06-29T12:00:00.000Z")
    );

    expect(result.sample).toMatchObject({ championEligible: 200, challengerEligible: 200, paired: 200, championCoverage: 1, challengerCoverage: 1 });
    expect(result.status).toBe("challenger-promotable");
  });

  it("requires distinct exact model identities and current evidence", () => {
    const sameIdentity = buildChampionChallengerReceipt({
      sport: "football",
      champion,
      challenger: { ...challenger, modelKey: champion.modelKey },
      evaluationWindowStart: "2026-02-28T00:00:00.000Z",
      outcomes: pairedOutcomes(),
      decisionRuns: runs(),
      now
    });
    const stale = buildChampionChallengerReceipt({
      sport: "football",
      champion,
      challenger,
      evaluationWindowStart: "2026-02-28T00:00:00.000Z",
      outcomes: pairedOutcomes(),
      decisionRuns: runs(),
      now: new Date("2026-05-01T12:00:00.000Z")
    });

    expect(sameIdentity.status).toBe("invalid");
    expect(stale.status).toBe("stale");
  });
});
