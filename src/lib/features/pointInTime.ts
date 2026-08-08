/**
 * Point-in-time correctness.
 *
 * A model claim is only worth what the data behind it was worth *at the moment
 * the decision was made*. Every backtest that has ever flattered a model did it
 * the same way: a feature computed from something that had not happened yet.
 *
 * The failure is silent by construction. A leaked feature does not error, does
 * not look wrong, and improves every metric — which is exactly why it has to be
 * made structurally impossible rather than reviewed for.
 *
 * So a feature is not a number. It is a number plus the six timestamps that say
 * when it could have been known, and a feature that cannot answer those is not
 * admissible.
 */

export type FeatureTimestamps = {
  /** When the thing the feature describes happened. */
  eventAt: string;
  /** When the source published it. A match played at 19:00 may be reported at 21:30. */
  sourcePublishedAt: string;
  /** When we fetched it. */
  retrievedAt: string;
  /** When we computed the value. */
  calculatedAt: string;
};

export type FeatureValue = {
  entity: string;
  sport: string;
  name: string;
  featureVersion: string;
  value: number | null;
  timestamps: FeatureTimestamps;
  /** Why the value is null. A null with no reason is indistinguishable from zero. */
  missingReason: string | null;
  confidence: number | null;
  /** From when this value is the correct one to read. */
  validFrom: string;
  /** Until when. Null means still current. */
  validUntil: string | null;
};

/**
 * The kinds of leakage worth naming, because each has a different tell.
 *
 * Named rather than collapsed into "future data" so a detection reads as a
 * diagnosis rather than an alarm.
 */
export type LeakageKind =
  | "source_published_after_cutoff"
  | "retrieved_after_cutoff"
  | "calculated_after_cutoff"
  | "event_after_cutoff"
  | "value_not_yet_valid"
  | "target_event_included";

export type LeakageFinding = {
  kind: LeakageKind;
  feature: string;
  detail: string;
  /** How far past the cutoff, in minutes. Sizes the problem. */
  minutesLate: number;
};

export type CutoffContext = {
  /** The decision cutoff: nothing known after this may inform the decision. */
  decisionCutoffAt: string;
  /** The event being predicted. Its own outcome can never be an input. */
  targetEventId: string;
  targetKickoffAt: string;
};

function minutesAfter(cutoff: string, moment: string): number {
  return (new Date(moment).getTime() - new Date(cutoff).getTime()) / 60_000;
}

/**
 * Every way a single feature can be inadmissible at a cutoff.
 *
 * All checks run rather than short-circuiting on the first: a feature leaking
 * three ways is a different problem from one leaking once, and knowing which
 * is how you find the source.
 */
export function detectLeakage(feature: FeatureValue, context: CutoffContext): LeakageFinding[] {
  const findings: LeakageFinding[] = [];
  const { decisionCutoffAt } = context;

  const checks: Array<[LeakageKind, string, string]> = [
    ["source_published_after_cutoff", feature.timestamps.sourcePublishedAt, "the source published it"],
    ["retrieved_after_cutoff", feature.timestamps.retrievedAt, "it was retrieved"],
    ["calculated_after_cutoff", feature.timestamps.calculatedAt, "it was calculated"],
    ["event_after_cutoff", feature.timestamps.eventAt, "the event it describes happened"]
  ];

  for (const [kind, moment, phrase] of checks) {
    const late = minutesAfter(decisionCutoffAt, moment);
    if (late > 0) {
      findings.push({
        kind,
        feature: feature.name,
        detail: `${phrase} ${Math.round(late)} minutes after the decision cutoff`,
        minutesLate: Math.round(late)
      });
    }
  }

  // A value whose validity window opens after the cutoff is a later revision of
  // the same feature — the classic corrected-score leak, where the corrected
  // number is read into a decision made before the correction existed.
  const validLate = minutesAfter(decisionCutoffAt, feature.validFrom);
  if (validLate > 0) {
    findings.push({
      kind: "value_not_yet_valid",
      feature: feature.name,
      detail: `this revision only becomes valid ${Math.round(validLate)} minutes after the cutoff`,
      minutesLate: Math.round(validLate)
    });
  }

  return findings;
}

/**
 * Whether an aggregate window includes the event being predicted.
 *
 * The subtlest leak of the set, because every timestamp on the feature can be
 * legitimate: a "last 10 matches" form figure computed before kickoff is fine,
 * unless the ten include this one. Nothing about the feature's own timestamps
 * reveals it — only its membership does.
 */
export function aggregateIncludesTarget(
  memberEventIds: string[],
  context: CutoffContext
): LeakageFinding | null {
  if (!memberEventIds.includes(context.targetEventId)) return null;
  return {
    kind: "target_event_included",
    feature: "aggregate",
    detail: `the aggregate window contains the target event ${context.targetEventId}, so the feature partly describes its own outcome`,
    minutesLate: 0
  };
}

export type AdmissibilityResult =
  | { admissible: true; feature: FeatureValue }
  | { admissible: false; findings: LeakageFinding[] };

/**
 * The gate a feature passes before it can reach a model.
 *
 * Refuses rather than repairs. A leaked feature cannot be salvaged by clamping
 * it to the cutoff — the value was computed from information that did not
 * exist, and there is no correct number to fall back to.
 */
export function admitFeature(feature: FeatureValue, context: CutoffContext): AdmissibilityResult {
  const findings = detectLeakage(feature, context);
  return findings.length === 0 ? { admissible: true, feature } : { admissible: false, findings };
}

export type FeatureSetAudit = {
  admitted: FeatureValue[];
  rejected: Array<{ feature: string; findings: LeakageFinding[] }>;
  /** Features present but null, with their stated reason. */
  missing: Array<{ feature: string; reason: string }>;
  /** True when nothing leaked. The only state in which a claim is defensible. */
  clean: boolean;
};

/**
 * Audit a whole feature set against one cutoff.
 *
 * Missing features are reported separately from rejected ones. A feature that
 * is absent and says why is honest; a feature that leaked is a defect. Folding
 * them together loses the distinction that decides whether a model run is
 * merely limited or actually invalid.
 */
export function auditFeatureSet(features: FeatureValue[], context: CutoffContext): FeatureSetAudit {
  const admitted: FeatureValue[] = [];
  const rejected: FeatureSetAudit["rejected"] = [];
  const missing: FeatureSetAudit["missing"] = [];

  for (const feature of features) {
    const verdict = admitFeature(feature, context);
    if (!verdict.admissible) {
      rejected.push({ feature: feature.name, findings: verdict.findings });
      continue;
    }
    if (feature.value === null) {
      missing.push({
        feature: feature.name,
        // A null with no stated reason is indistinguishable from a zero the
        // moment it reaches a model, which is the whole point of demanding one.
        reason: feature.missingReason ?? "null with no stated reason, which is itself the finding"
      });
      continue;
    }
    admitted.push(feature);
  }

  return { admitted, rejected, missing, clean: rejected.length === 0 };
}

/**
 * Substitution policy for a missing feature.
 *
 * Never zero. Zero is a real value in every feature space this product has —
 * zero goals, zero rest days, zero rating — so substituting it makes "we do not
 * know" indistinguishable from "we measured nothing", and the model learns from
 * the difference.
 */
export type MissingPolicy =
  /** Carry the null through and let the model handle it explicitly. */
  | { kind: "explicit_null" }
  /** Use a sport-level prior, which is a stated assumption rather than data. */
  | { kind: "sport_prior"; value: number; rationale: string }
  /** Refuse to produce a decision at all. */
  | { kind: "abstain"; rationale: string };

export function resolveMissing(feature: FeatureValue, policy: MissingPolicy): {
  value: number | null;
  substituted: boolean;
  note: string;
} {
  if (feature.value !== null) return { value: feature.value, substituted: false, note: "" };

  switch (policy.kind) {
    case "explicit_null":
      return { value: null, substituted: false, note: feature.missingReason ?? "missing, no reason recorded" };
    case "sport_prior":
      return {
        value: policy.value,
        substituted: true,
        note: `substituted a sport prior (${policy.value}): ${policy.rationale}`
      };
    case "abstain":
      return { value: null, substituted: false, note: `abstaining: ${policy.rationale}` };
  }
}
