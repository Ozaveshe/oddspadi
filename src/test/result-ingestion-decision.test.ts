import { describe, expect, it } from "vitest";
import { decideResultIngestion, requiresResettle } from "@/lib/results/ingestionDecision";
import { emptyResult, type CanonicalResult } from "@/lib/results/canonicalResult";
import type { ResultObservation } from "@/lib/results/verification";

const BASE = new Date("2026-08-07T18:00:00.000Z");
const at = (minutes: number) => new Date(BASE.getTime() + minutes * 60_000).toISOString();

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

function result(overrides: Partial<CanonicalResult> = {}): CanonicalResult {
  return {
    ...emptyResult("fx", "football"),
    resultStatus: "finished",
    regulationHome: 2,
    regulationAway: 1,
    winner: "home",
    winnerBasis: "regulation",
    ...overrides
  };
}

function decide(args: {
  observations: ResultObservation[];
  parsed: CanonicalResult | null;
  existing: CanonicalResult | null;
  minutesLater?: number;
}) {
  return decideResultIngestion({
    sport: "football",
    observations: args.observations,
    parsed: args.parsed,
    existing: args.existing,
    now: new Date(BASE.getTime() + (args.minutesLater ?? 20) * 60_000)
  });
}

describe("first observation of a fixture", () => {
  it("inserts at whatever state the ladder gave it", () => {
    const decision = decide({ observations: [observation()], parsed: result(), existing: null });
    expect(decision.action).toBe("insert");
    expect(decision.action === "insert" && decision.result.verificationState).toBe("provisional");
  });

  it("inserts verified once two agreeing observations are far enough apart", () => {
    const decision = decide({
      observations: [observation(), observation({ observedAt: at(15) })],
      parsed: result(),
      existing: null
    });
    expect(decision.action === "insert" && decision.result.verificationState).toBe("verified");
  });

  it("inserts a conflicted row rather than nothing, and carries the exception", () => {
    // A conflicted row is still the honest record of what we observed, and it
    // gives the exception something to point at.
    const decision = decide({
      observations: [observation(), observation({ observedAt: at(15), regulationAway: 3 })],
      parsed: result(),
      existing: null
    });
    expect(decision.action).toBe("insert");
    expect(decision.action === "insert" && decision.result.verificationState).toBe("conflicted");
    expect(decision.action === "insert" && decision.verdict.exception?.kind).toBe("result_conflict");
  });

  it("does nothing when no observation parsed", () => {
    expect(decide({ observations: [observation()], parsed: null, existing: null }).action).toBe("none");
  });
});

describe("an unchanged result", () => {
  it("writes nothing when neither score nor state moved", () => {
    const existing = result({ verificationState: "verified" });
    const decision = decide({
      observations: [observation(), observation({ sourceId: "second", observedAt: at(1) })],
      parsed: result(),
      existing
    });
    expect(decision.action).toBe("none");
  });

  it("supersedes when only the verification state moved", () => {
    // A second observation arriving is exactly how provisional becomes
    // verified, and that is a revision worth writing.
    const existing = result({ verificationState: "provisional" });
    const decision = decide({
      observations: [observation(), observation({ observedAt: at(15) })],
      parsed: result(),
      existing
    });
    expect(decision.action).toBe("supersede");
    expect(decision.action === "supersede" && decision.result.verificationState).toBe("verified");
    expect(decision.action === "supersede" && decision.result.revision).toBe(2);
    expect(decision.action === "supersede" && decision.correctionReason).toContain("provisional to verified");
  });
});

describe("a provider correction", () => {
  const existing = result({ verificationState: "verified" });
  const corrected = result({ regulationHome: 3, regulationAway: 1 });
  const observations = [
    observation({ regulationHome: 3, observedAt: at(30) }),
    observation({ regulationHome: 3, observedAt: at(45) })
  ];

  it("supersedes with correction language naming both scores", () => {
    const decision = decide({ observations, parsed: corrected, existing, minutesLater: 50 });
    expect(decision.action).toBe("supersede");
    expect(decision.action === "supersede" && decision.result.revision).toBe(2);
    const reason = decision.action === "supersede" ? decision.correctionReason : "";
    expect(reason).toContain("2-1");
    expect(reason).toContain("3-1");
    expect(reason).toContain("re-settled");
  });

  it("requires a re-settle", () => {
    const decision = decide({ observations, parsed: corrected, existing, minutesLater: 50 });
    expect(requiresResettle(decision, existing)).toBe(true);
  });

  it("does not require a re-settle when the previous result was never verified", () => {
    // A provisional result never produced a verdict, so nothing needs redoing.
    const provisional = result({ verificationState: "provisional" });
    const decision = decide({ observations, parsed: corrected, existing: provisional, minutesLater: 50 });
    expect(decision.action).toBe("supersede");
    expect(requiresResettle(decision, provisional)).toBe(false);
    expect(decision.action === "supersede" && decision.correctionReason).not.toContain("re-settled");
  });

  it("does not require a re-settle when only the verification state moved", () => {
    const decision = decide({
      observations: [observation(), observation({ observedAt: at(15) })],
      parsed: result(),
      existing: result({ verificationState: "provisional" })
    });
    expect(requiresResettle(decision, result({ verificationState: "provisional" }))).toBe(false);
  });

  it("treats a status change as material even at the same score", () => {
    // finished 2-1 and awarded 2-1 settle differently; the score alone is not
    // the fact that matters.
    const awarded = result({ resultStatus: "awarded" });
    const decision = decide({
      observations: [
        observation({ resultStatus: "awarded", observedAt: at(30) }),
        observation({ resultStatus: "awarded", observedAt: at(45) })
      ],
      parsed: awarded,
      existing: result({ verificationState: "verified" }),
      minutesLater: 50
    });
    expect(decision.action).toBe("supersede");
    expect(requiresResettle(decision, result({ verificationState: "verified" }))).toBe(true);
  });

  it("treats a late extra-time block as material", () => {
    // The provider first reported full time, then filled in extra time. That
    // changes the qualification market and must not pass as unchanged.
    const withExtraTime = result({ extraTimeHome: 3, extraTimeAway: 1 });
    const decision = decide({
      observations: [observation({ observedAt: at(30) }), observation({ observedAt: at(45) })],
      parsed: withExtraTime,
      existing: result({ verificationState: "verified" }),
      minutesLater: 50
    });
    expect(decision.action).toBe("supersede");
  });
});
