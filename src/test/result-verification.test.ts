import { describe, expect, it } from "vitest";
import {
  AGREEMENT_WINDOW_MINUTES,
  SINGLE_OBSERVATION_TIMEOUT_HOURS,
  verifyResult,
  type ResultObservation
} from "@/lib/results/verification";

const BASE = new Date("2026-08-07T18:00:00.000Z");

function at(minutesAfterBase: number): string {
  return new Date(BASE.getTime() + minutesAfterBase * 60_000).toISOString();
}

function observation(overrides: Partial<ResultObservation> = {}): ResultObservation {
  return {
    sourceId: "api-football",
    observedAt: at(0),
    resultStatus: "finished",
    regulationHome: 2,
    regulationAway: 1,
    winner: "home",
    ...overrides
  };
}

function verify(observations: ResultObservation[], options: { minutesLater?: number; liveEventGoals?: { home: number; away: number } | null } = {}) {
  return verifyResult({
    sport: "football",
    observations,
    liveEventGoals: options.liveEventGoals ?? null,
    now: new Date(BASE.getTime() + (options.minutesLater ?? 5) * 60_000)
  });
}

describe("verification ladder", () => {
  it("is provisional with no observation at all", () => {
    expect(verify([]).state).toBe("provisional");
  });

  it("is provisional while the fixture is not terminal", () => {
    expect(verify([observation({ resultStatus: "live" as never })]).state).toBe("provisional");
  });

  it("is provisional on a single fresh observation", () => {
    expect(verify([observation()]).state).toBe("provisional");
  });

  it("is provisional when two agreeing observations are too close together", () => {
    const verdict = verify([observation(), observation({ observedAt: at(AGREEMENT_WINDOW_MINUTES - 1) })]);
    expect(verdict.state).toBe("provisional");
    expect(verdict.reason).toContain("minutes apart");
  });

  it("verifies two agreeing observations far enough apart", () => {
    const verdict = verify([observation(), observation({ observedAt: at(AGREEMENT_WINDOW_MINUTES) })], {
      minutesLater: 15
    });
    expect(verdict.state).toBe("verified");
  });

  it("verifies immediately when two independent sources agree", () => {
    const verdict = verify([observation(), observation({ sourceId: "the-odds-api", observedAt: at(1) })]);
    expect(verdict.state).toBe("verified");
    expect(verdict.reason).toContain("independent sources");
  });
});

describe("conflict detection", () => {
  it("conflicts when observations disagree on the score", () => {
    const verdict = verify([observation(), observation({ observedAt: at(20), regulationAway: 2 })], {
      minutesLater: 30
    });
    expect(verdict.state).toBe("conflicted");
    expect(verdict.exception?.kind).toBe("result_conflict");
    expect(verdict.exception?.detail.reason).toBe("observations_disagree");
  });

  it("conflicts when observations disagree on the status", () => {
    const verdict = verify([observation(), observation({ observedAt: at(20), resultStatus: "abandoned" })], {
      minutesLater: 30
    });
    expect(verdict.state).toBe("conflicted");
  });

  it("conflicts when the live event stream contradicts the final score", () => {
    const verdict = verify([observation(), observation({ sourceId: "second", observedAt: at(1) })], {
      liveEventGoals: { home: 3, away: 1 }
    });
    expect(verdict.state).toBe("conflicted");
    expect(verdict.exception?.detail.reason).toBe("event_stream_mismatch");
  });

  it("verifies when the live event stream agrees", () => {
    const verdict = verify([observation(), observation({ sourceId: "second", observedAt: at(1) })], {
      liveEventGoals: { home: 2, away: 1 }
    });
    expect(verdict.state).toBe("verified");
  });

  it("treats disagreement as outranking a later agreement", () => {
    // Three observations, two of which agree with each other but not with the
    // latest. Majority is not the rule: any disagreement is a conflict.
    const verdict = verify(
      [
        observation(),
        observation({ observedAt: at(20) }),
        observation({ observedAt: at(40), regulationHome: 3 })
      ],
      { minutesLater: 50 }
    );
    expect(verdict.state).toBe("conflicted");
  });
});

describe("incomplete scores", () => {
  it("stays provisional when a finished football fixture has no score", () => {
    const verdict = verify([
      observation({ regulationHome: null, regulationAway: null }),
      observation({ sourceId: "second", observedAt: at(1), regulationHome: null, regulationAway: null })
    ]);
    expect(verdict.state).toBe("provisional");
    expect(verdict.reason).toContain("without a score");
  });

  it("does not demand a score from a postponed fixture", () => {
    const postponed = { resultStatus: "postponed" as const, regulationHome: null, regulationAway: null, winner: "none" as const };
    const verdict = verify([
      observation(postponed),
      observation({ ...postponed, sourceId: "second", observedAt: at(1) })
    ]);
    expect(verdict.state).toBe("verified");
  });

  it("requires an awarded winner for tennis rather than a goal score", () => {
    const noWinner = verifyResult({
      sport: "tennis",
      observations: [
        observation({ regulationHome: null, regulationAway: null, winner: "none" }),
        observation({ sourceId: "second", observedAt: at(1), regulationHome: null, regulationAway: null, winner: "none" })
      ],
      liveEventGoals: null,
      now: new Date(BASE.getTime() + 300_000)
    });
    expect(noWinner.state).toBe("provisional");

    const withWinner = verifyResult({
      sport: "tennis",
      observations: [
        observation({ regulationHome: null, regulationAway: null, winner: "home" }),
        observation({ sourceId: "second", observedAt: at(1), regulationHome: null, regulationAway: null, winner: "home" })
      ],
      liveEventGoals: null,
      now: new Date(BASE.getTime() + 300_000)
    });
    expect(withWinner.state).toBe("verified");
  });
});

describe("the single-observation escalation", () => {
  it("escalates to manual review once a second observation will not arrive", () => {
    const verdict = verify([observation()], { minutesLater: SINGLE_OBSERVATION_TIMEOUT_HOURS * 60 });
    expect(verdict.state).toBe("manual_review");
    expect(verdict.exception?.detail.reason).toBe("single_observation_timeout");
  });

  it("does not escalate before the timeout", () => {
    const verdict = verify([observation()], { minutesLater: SINGLE_OBSERVATION_TIMEOUT_HOURS * 60 - 1 });
    expect(verdict.state).toBe("provisional");
  });

  it("never escalates a conflict into manual review silently", () => {
    // A conflict stays a conflict however old it gets; it has its own queue.
    const verdict = verify([observation(), observation({ observedAt: at(20), regulationHome: 9 })], {
      minutesLater: SINGLE_OBSERVATION_TIMEOUT_HOURS * 60
    });
    expect(verdict.state).toBe("conflicted");
  });
});
