import { requireStaff } from "@/lib/ops/staffAuth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { privateJson } from "@/lib/security/privateJson";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { writeOperatorAudit } from "@/lib/security/operatorAudit";
import {
  isQualitySubject,
  isQualityVerdict,
  retrainingRecommended,
  summariseReviews,
  type QualityReviewRow
} from "@/lib/ops/qualityReview";
import { guardCaseAction, assertProductionWriteAllowed, opsMode } from "@/lib/ops/trainingMode";

export const dynamic = "force-dynamic";

/**
 * Record and read sampled quality reviews. A review is the operation checking
 * its own work — a fail with the retraining flag set is the retraining record.
 * Every recorded review also writes an operator-audit row.
 */

export async function GET(request: Request): Promise<Response> {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;
  const client = getSupabaseServerClient();
  if (!client) return privateJson({ error: "Server storage is not configured." }, { status: 503 });

  const subjectType = new URL(request.url).searchParams.get("subject_type");
  let query = client
    .from("op_quality_reviews")
    .select("subject_type, subject_ref, verdict, feedback, retraining_flag, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (subjectType && isQualitySubject(subjectType)) query = query.eq("subject_type", subjectType);

  const { data, error } = await query;
  if (error) return databaseUnavailable("quality reviews read", error, "The review log is temporarily unavailable.");
  const rows = (data as QualityReviewRow[] | null) ?? [];
  return privateJson({ reviews: data ?? [], summary: summariseReviews(rows) });
}

export async function POST(request: Request): Promise<Response> {
  const originError = rejectCrossSiteMutation(request);
  if (originError) return originError;
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;
  const client = getSupabaseServerClient();
  if (!client) return privateJson({ error: "Server storage is not configured." }, { status: 503 });

  const parsed = await readBoundedJson<{
    subjectType?: unknown;
    subjectRef?: unknown;
    verdict?: unknown;
    feedback?: unknown;
    retraining?: unknown;
  }>(request, 4_096);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;

  if (!isQualitySubject(body.subjectType)) return privateJson({ error: "Unknown review subject." }, { status: 400 });
  if (!isQualityVerdict(body.verdict)) return privateJson({ error: "Verdict must be pass, fail or needs_follow_up." }, { status: 400 });
  const subjectRef = typeof body.subjectRef === "string" ? body.subjectRef.trim() : "";
  if (subjectRef.length < 1 || subjectRef.length > 200) return privateJson({ error: "A subject reference is required." }, { status: 400 });
  const feedback = typeof body.feedback === "string" && body.feedback.trim().length > 0 ? body.feedback.trim().slice(0, 2000) : null;
  // A failed review defaults to recommending retraining; the reviewer may force it either way.
  const retraining = typeof body.retraining === "boolean" ? body.retraining : retrainingRecommended(body.verdict);

  const row = {
    subject_type: body.subjectType,
    subject_ref: subjectRef,
    reviewer_fingerprint: gate.actorFingerprint,
    verdict: body.verdict,
    feedback,
    retraining_flag: retraining
  };

  const mode = opsMode(process.env);
  const guarded = guardCaseAction(mode, { describe: () => `review ${body.subjectType} ${subjectRef}: ${body.verdict}`, payload: row });
  if (guarded.status === "training-preview") {
    return privateJson({ status: "training-preview", wouldHave: guarded.wouldHave });
  }
  assertProductionWriteAllowed(mode, "quality review");

  const { data, error } = await client.from("op_quality_reviews").insert(guarded.action).select("id").single();
  if (error) return databaseUnavailable("quality review write", error, "Could not record that review right now.");

  await writeOperatorAudit(client, {
    actorFingerprint: gate.actorFingerprint,
    action: `quality_review_${body.subjectType}`,
    target: subjectRef,
    detail: { verdict: body.verdict, retraining },
    outcome: "applied"
  });

  return privateJson({ id: data.id, verdict: body.verdict, retraining }, { status: 201 });
}
