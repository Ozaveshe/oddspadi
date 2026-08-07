import { describe, expect, it } from "vitest";
import { buildFixtureCard, isReaderFacing, resolveConsumerState, type CardInput } from "@/lib/discovery/fixtureCard";

function input(overrides: Partial<CardInput> = {}): CardInput {
  return {
    fixtureStatus: "scheduled",
    decision: "pick",
    hasOfficialPick: false,
    settlement: null,
    oddsAreCurrent: true,
    hasHistoricalOdds: false,
    decimalOdds: 2.1,
    modelProbability: 0.55,
    reason: "The model sees value at the current price.",
    ...overrides
  };
}

describe("consumer states", () => {
  it("maps each decision to its state", () => {
    expect(resolveConsumerState(input({ decision: "pick" }))).toBe("pick");
    expect(resolveConsumerState(input({ decision: "lean" }))).toBe("pick");
    expect(resolveConsumerState(input({ decision: "watch" }))).toBe("watch");
    expect(resolveConsumerState(input({ decision: "pass" }))).toBe("pass");
    expect(resolveConsumerState(input({ decision: "unavailable" }))).toBe("analysis_unavailable");
    expect(resolveConsumerState(input({ decision: "withheld" }))).toBe("analysis_unavailable");
    expect(resolveConsumerState(input({ decision: null }))).toBe("analysis_unavailable");
  });

  it("lets lifecycle outrank the verdict", () => {
    // Showing "Pick" on a match that ended two hours ago is the commonest way
    // a board goes stale-looking.
    expect(resolveConsumerState(input({ fixtureStatus: "live" }))).toBe("live");
    expect(resolveConsumerState(input({ fixtureStatus: "finished" }))).toBe("finished");
    expect(resolveConsumerState(input({ fixtureStatus: "postponed" }))).toBe("finished");
    expect(resolveConsumerState(input({ fixtureStatus: "cancelled" }))).toBe("finished");
  });

  it("distinguishes a result being verified from a finished fixture", () => {
    // The reader is owed the difference between "we know" and "we are
    // checking", and only a published claim creates that obligation.
    const verifying = input({ fixtureStatus: "finished", hasOfficialPick: true, settlement: "unsettled" });
    expect(resolveConsumerState(verifying)).toBe("result_being_verified");
    expect(resolveConsumerState({ ...verifying, settlement: "pending_verification" })).toBe("result_being_verified");
    expect(resolveConsumerState({ ...verifying, settlement: "won" })).toBe("finished");
    // No published claim: nothing is pending, so it is simply finished.
    expect(resolveConsumerState({ ...verifying, hasOfficialPick: false })).toBe("finished");
  });

  it("waits for a current price rather than claiming a pick against a dead one", () => {
    expect(resolveConsumerState(input({ oddsAreCurrent: false }))).toBe("waiting_for_odds");
    expect(resolveConsumerState(input({ decision: "lean", oddsAreCurrent: false }))).toBe("waiting_for_odds");
  });

  it("does not make a pass or a watch wait for a price it does not need", () => {
    // A pass is a complete analysis. It is not waiting for anything.
    expect(resolveConsumerState(input({ decision: "pass", oddsAreCurrent: false }))).toBe("pass");
    expect(resolveConsumerState(input({ decision: "watch", oddsAreCurrent: false }))).toBe("watch");
  });
});

describe("what the card shows", () => {
  it("shows current odds on a forecast card", () => {
    const card = buildFixtureCard(input());
    expect(card.odds).toEqual({ decimal: 2.1, label: "2.10" });
    expect(card.historicalOddsOnly).toBe(false);
  });

  it("never shows odds and 'no odds available' at once", () => {
    // The contradiction the match page was built to make unrepresentable, held
    // to on the card too.
    const stale = buildFixtureCard(input({ oddsAreCurrent: false, hasHistoricalOdds: true }));
    expect(stale.odds).toBeNull();
    expect(stale.historicalOddsOnly).toBe(true);
  });

  it("shows no odds on a finished or live card", () => {
    expect(buildFixtureCard(input({ fixtureStatus: "finished" })).odds).toBeNull();
    expect(buildFixtureCard(input({ fixtureStatus: "live" })).odds).toBeNull();
    // And does not claim historical odds are available to act on either.
    expect(buildFixtureCard(input({ fixtureStatus: "finished", hasHistoricalOdds: true })).historicalOddsOnly).toBe(false);
  });

  it("refuses an implausible price rather than rendering it", () => {
    expect(buildFixtureCard(input({ decimalOdds: 1 })).odds).toBeNull();
    expect(buildFixtureCard(input({ decimalOdds: null })).odds).toBeNull();
  });

  it("shows the model probability only beside a live verdict", () => {
    expect(buildFixtureCard(input({ decision: "pick" })).showModelProbability).toBe(true);
    expect(buildFixtureCard(input({ decision: "pass" })).showModelProbability).toBe(true);
    expect(buildFixtureCard(input({ fixtureStatus: "finished" })).showModelProbability).toBe(false);
    expect(buildFixtureCard(input({ decision: "unavailable" })).showModelProbability).toBe(false);
    expect(buildFixtureCard(input({ modelProbability: null })).showModelProbability).toBe(false);
  });

  it("allows action language only where an action is possible", () => {
    expect(buildFixtureCard(input()).allowsAction).toBe(true);
    expect(buildFixtureCard(input({ fixtureStatus: "live" })).allowsAction).toBe(false);
    expect(buildFixtureCard(input({ fixtureStatus: "finished" })).allowsAction).toBe(false);
    expect(buildFixtureCard(input({ oddsAreCurrent: false })).allowsAction).toBe(false);
  });

  it("marks result states so the card shows an outcome rather than a forecast", () => {
    expect(buildFixtureCard(input({ fixtureStatus: "finished" })).showsResult).toBe(true);
    expect(
      buildFixtureCard(input({ fixtureStatus: "finished", hasOfficialPick: true, settlement: "unsettled" })).showsResult
    ).toBe(true);
    expect(buildFixtureCard(input()).showsResult).toBe(false);
  });
});

describe("internal language never reaches a reader", () => {
  it("rejects gate and engine vocabulary", () => {
    expect(isReaderFacing("blocked: calibration_support below 0.62")).toBe(false);
    expect(isReaderFacing("needs_review")).toBe(false);
    expect(isReaderFacing("evidence_score 0.41")).toBe(false);
    expect(isReaderFacing("shadow run produced no decision")).toBe(false);
    expect(isReaderFacing("mock provider returned nothing")).toBe(false);
    expect(isReaderFacing("op_market_decisions had no row")).toBe(false);
    expect(isReaderFacing("undefined")).toBe(false);
  });

  it("accepts a sentence written for a person", () => {
    expect(isReaderFacing("The model sees value at the current price.")).toBe(true);
    expect(isReaderFacing("Worth watching; not a call yet.")).toBe(true);
  });

  it("substitutes a reader-facing sentence when the supplied one is internal", () => {
    const card = buildFixtureCard(input({ reason: "blocked: calibration_support below 0.62" }));
    expect(card.summary).toBe("The model sees value at the current price.");
    expect(isReaderFacing(card.summary)).toBe(true);
  });

  it("always produces a sentence, even with no reason at all", () => {
    for (const reason of [null, "", "   "]) {
      const card = buildFixtureCard(input({ reason }));
      expect(card.summary.length).toBeGreaterThan(10);
      expect(isReaderFacing(card.summary)).toBe(true);
    }
  });

  it("gives every state a reader-facing default", () => {
    const cases: Array<Partial<CardInput>> = [
      { decision: "pick" },
      { decision: "watch" },
      { decision: "pass" },
      { oddsAreCurrent: false },
      { decision: "unavailable" },
      { fixtureStatus: "live" },
      { fixtureStatus: "finished" },
      { fixtureStatus: "finished", hasOfficialPick: true, settlement: "unsettled" }
    ];
    const states = new Set<string>();
    for (const override of cases) {
      const card = buildFixtureCard(input({ ...override, reason: null }));
      states.add(card.state);
      expect(isReaderFacing(card.summary), `${card.state} summary must be reader-facing`).toBe(true);
      expect(card.label.length).toBeGreaterThan(0);
    }
    // All eight consumer states exercised.
    expect(states.size).toBe(8);
  });
});
