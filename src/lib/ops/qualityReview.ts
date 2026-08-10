/**
 * Quality review — sampled second-look review of the operation's decisions.
 *
 * The pure logic: which subjects to sample, the verdict vocabulary, whether a
 * verdict recommends retraining, and how to summarise a batch of reviews. The
 * route persists; this module decides.
 */

export const QUALITY_SUBJECTS = [
  "mapping",
  "settlement",
  "result_verification",
  "social_copy",
  "moderation_decision"
] as const;
export type QualitySubject = (typeof QUALITY_SUBJECTS)[number];

export const QUALITY_VERDICTS = ["pass", "fail", "needs_follow_up"] as const;
export type QualityVerdict = (typeof QUALITY_VERDICTS)[number];

export function isQualitySubject(value: unknown): value is QualitySubject {
  return typeof value === "string" && (QUALITY_SUBJECTS as readonly string[]).includes(value);
}

export function isQualityVerdict(value: unknown): value is QualityVerdict {
  return typeof value === "string" && (QUALITY_VERDICTS as readonly string[]).includes(value);
}

/**
 * Deterministically sample a fraction of a list for review — every Nth item,
 * where N = round(1/rate). Deterministic on purpose: a review sample must be
 * reproducible and auditable, not a different set on every load. rate ≥ 1
 * reviews everything; rate ≤ 0 reviews nothing.
 */
export function sampleForReview<T>(items: readonly T[], rate: number): T[] {
  if (rate >= 1) return [...items];
  if (rate <= 0) return [];
  const step = Math.max(1, Math.round(1 / rate));
  return items.filter((_, index) => index % step === 0);
}

/** A failed review recommends retraining. The reviewer may still set the flag explicitly. */
export function retrainingRecommended(verdict: QualityVerdict): boolean {
  return verdict === "fail";
}

export type QualityReviewRow = { verdict: QualityVerdict; retraining_flag?: boolean };

export type QualityReviewSummary = {
  total: number;
  pass: number;
  fail: number;
  needsFollowUp: number;
  retraining: number;
  /** Pass share, or null over zero reviews — no reviews is unknown quality, not 100%. */
  passRate: number | null;
};

export function summariseReviews(rows: readonly QualityReviewRow[]): QualityReviewSummary {
  let pass = 0;
  let fail = 0;
  let needsFollowUp = 0;
  let retraining = 0;
  for (const r of rows) {
    if (r.verdict === "pass") pass += 1;
    else if (r.verdict === "fail") fail += 1;
    else if (r.verdict === "needs_follow_up") needsFollowUp += 1;
    if (r.retraining_flag) retraining += 1;
  }
  const total = rows.length;
  return { total, pass, fail, needsFollowUp, retraining, passRate: total === 0 ? null : (pass / total) * 100 };
}
