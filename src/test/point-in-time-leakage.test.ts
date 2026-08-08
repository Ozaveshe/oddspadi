import { describe, expect, it } from "vitest";
import {
  admitFeature,
  aggregateIncludesTarget,
  auditFeatureSet,
  detectLeakage,
  resolveMissing,
  type CutoffContext,
  type FeatureValue
} from "@/lib/features/pointInTime";

const CUTOFF = "2026-08-08T18:00:00.000Z";
const KICKOFF = "2026-08-08T19:00:00.000Z";
const at = (minutesFromCutoff: number) =>
  new Date(new Date(CUTOFF).getTime() + minutesFromCutoff * 60_000).toISOString();

const CONTEXT: CutoffContext = {
  decisionCutoffAt: CUTOFF,
  targetEventId: "fx-target",
  targetKickoffAt: KICKOFF
};

function feature(overrides: Partial<FeatureValue> = {}): FeatureValue {
  return {
    entity: "team-1",
    sport: "football",
    name: "recent_form",
    featureVersion: "form.v3",
    value: 1.8,
    timestamps: {
      eventAt: at(-2880),
      sourcePublishedAt: at(-2800),
      retrievedAt: at(-120),
      calculatedAt: at(-60)
    },
    missingReason: null,
    confidence: 0.9,
    validFrom: at(-60),
    validUntil: null,
    ...overrides
  };
}

describe("a clean feature", () => {
  it("is admissible when everything predates the cutoff", () => {
    const verdict = admitFeature(feature(), CONTEXT);
    expect(verdict.admissible).toBe(true);
  });

  it("reports no findings", () => {
    expect(detectLeakage(feature(), CONTEXT)).toEqual([]);
  });
});

describe("the leaks that flatter a backtest", () => {
  it("catches a final result used as an input", () => {
    // The event itself happened after the decision was made.
    const findings = detectLeakage(
      feature({
        name: "final_score",
        timestamps: { eventAt: at(90), sourcePublishedAt: at(120), retrievedAt: at(130), calculatedAt: at(135) }
      }),
      CONTEXT
    );
    expect(findings.map((f) => f.kind)).toContain("event_after_cutoff");
    expect(findings.map((f) => f.kind)).toContain("source_published_after_cutoff");
  });

  it("catches a closing price captured after the cutoff", () => {
    const findings = detectLeakage(
      feature({
        name: "closing_odds",
        timestamps: { eventAt: at(-5), sourcePublishedAt: at(55), retrievedAt: at(58), calculatedAt: at(59) }
      }),
      CONTEXT
    );
    expect(findings.map((f) => f.kind)).toContain("source_published_after_cutoff");
  });

  it("catches a lineup released after the cutoff", () => {
    const findings = detectLeakage(
      feature({
        name: "confirmed_lineup",
        timestamps: { eventAt: at(-1), sourcePublishedAt: at(1), retrievedAt: at(2), calculatedAt: at(3) }
      }),
      CONTEXT
    );
    expect(findings[0]?.kind).toBe("source_published_after_cutoff");
    // Sized, so a one-minute miss reads differently from an hour.
    expect(findings[0]?.minutesLate).toBe(1);
  });

  it("catches a later injury report reaching an earlier decision", () => {
    const findings = detectLeakage(
      feature({ name: "availability", timestamps: { ...feature().timestamps, retrievedAt: at(30) } }),
      CONTEXT
    );
    expect(findings.map((f) => f.kind)).toContain("retrieved_after_cutoff");
  });

  it("catches a corrected revision read into a decision that predates it", () => {
    // Every timestamp can look fine while the value is a later revision.
    const findings = detectLeakage(feature({ name: "corrected_score", validFrom: at(240) }), CONTEXT);
    expect(findings.map((f) => f.kind)).toContain("value_not_yet_valid");
  });

  it("reports every leak rather than stopping at the first", () => {
    // Three ways is a different problem from one, and knowing which finds the
    // source.
    const findings = detectLeakage(
      feature({
        timestamps: { eventAt: at(10), sourcePublishedAt: at(20), retrievedAt: at(30), calculatedAt: at(40) }
      }),
      CONTEXT
    );
    expect(findings).toHaveLength(4);
  });

  it("refuses rather than clamping the value to the cutoff", () => {
    // There is no correct number to fall back to: the value was computed from
    // information that did not exist.
    const verdict = admitFeature(feature({ timestamps: { ...feature().timestamps, calculatedAt: at(5) } }), CONTEXT);
    expect(verdict.admissible).toBe(false);
    expect("feature" in verdict).toBe(false);
  });
});

describe("the aggregate leak", () => {
  it("catches a form window containing the match being predicted", () => {
    // The subtlest of the set: every timestamp is legitimate, and only
    // membership reveals it.
    const finding = aggregateIncludesTarget(["fx-a", "fx-b", "fx-target"], CONTEXT);
    expect(finding?.kind).toBe("target_event_included");
    expect(finding?.detail).toContain("its own outcome");
  });

  it("passes a window that stops short of the target", () => {
    expect(aggregateIncludesTarget(["fx-a", "fx-b"], CONTEXT)).toBeNull();
  });
});

describe("auditing a set", () => {
  it("separates rejected from merely missing", () => {
    // A feature that is absent and says why is honest; one that leaked is a
    // defect. Folding them together loses the distinction that decides whether
    // a run is limited or invalid.
    const audit = auditFeatureSet(
      [
        feature({ name: "clean" }),
        feature({ name: "leaked", timestamps: { ...feature().timestamps, retrievedAt: at(15) } }),
        feature({ name: "absent", value: null, missingReason: "provider returned no lineup" })
      ],
      CONTEXT
    );
    expect(audit.admitted.map((f) => f.name)).toEqual(["clean"]);
    expect(audit.rejected.map((r) => r.feature)).toEqual(["leaked"]);
    expect(audit.missing.map((m) => m.feature)).toEqual(["absent"]);
    expect(audit.clean).toBe(false);
  });

  it("is clean only when nothing leaked, missing features notwithstanding", () => {
    const audit = auditFeatureSet(
      [feature({ name: "absent", value: null, missingReason: "no data" })],
      CONTEXT
    );
    expect(audit.clean).toBe(true);
    expect(audit.admitted).toEqual([]);
  });

  it("treats a null with no stated reason as itself a finding", () => {
    const audit = auditFeatureSet([feature({ value: null, missingReason: null })], CONTEXT);
    expect(audit.missing[0]?.reason).toContain("no stated reason");
  });
});

describe("missing values are never zero", () => {
  const absent = feature({ value: null, missingReason: "no lineup published" });

  it("carries the null through under an explicit-null policy", () => {
    const resolved = resolveMissing(absent, { kind: "explicit_null" });
    expect(resolved.value).toBeNull();
    expect(resolved.substituted).toBe(false);
    expect(resolved.note).toBe("no lineup published");
  });

  it("marks a prior as substituted and states the assumption", () => {
    const resolved = resolveMissing(absent, {
      kind: "sport_prior",
      value: 1.35,
      rationale: "league mean goals per side"
    });
    expect(resolved.value).toBe(1.35);
    expect(resolved.substituted).toBe(true);
    expect(resolved.note).toContain("league mean");
  });

  it("abstains without inventing a number", () => {
    const resolved = resolveMissing(absent, { kind: "abstain", rationale: "lineup is required for this market" });
    expect(resolved.value).toBeNull();
    expect(resolved.substituted).toBe(false);
    expect(resolved.note).toContain("abstaining");
  });

  it("never substitutes zero under any policy", () => {
    // Zero is a real value in every feature space here — zero goals, zero rest
    // days, zero rating — so it cannot double as "unknown".
    const policies = [
      { kind: "explicit_null" } as const,
      { kind: "abstain", rationale: "x" } as const
    ];
    for (const policy of policies) {
      expect(resolveMissing(absent, policy).value).not.toBe(0);
    }
  });

  it("leaves a present value alone", () => {
    const resolved = resolveMissing(feature(), { kind: "sport_prior", value: 99, rationale: "unused" });
    expect(resolved.value).toBe(1.8);
    expect(resolved.substituted).toBe(false);
  });
});
