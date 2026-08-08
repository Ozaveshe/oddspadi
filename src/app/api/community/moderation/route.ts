import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { privateJson } from "@/lib/security/privateJson";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { isUuid } from "@/lib/security/inputValidation";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";
import { boundedCommunityText } from "@/lib/community/predictionContracts";

export const dynamic = "force-dynamic";

const HIDEABLE_TABLES: Record<string, string> = {
  feed_post: "op_feed_posts",
  feed_comment: "op_feed_comments",
  forum_thread: "op_forum_threads",
  forum_reply: "op_forum_replies"
};

const ACTIONS = new Set([
  "hide",
  "unhide",
  "lock_thread",
  "unlock_thread",
  "moderate_tip",
  "dismiss_report",
  "flag_account",
  "unflag_account",
  "note"
]);

/**
 * Moderator gate: cookie identity first, then the profile's is_admin flag.
 * Effects run on the service-role client because moderation columns carry no
 * authenticated grants — a non-admin can never reach them even by RLS mistake.
 */
async function requireModerator() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: privateJson({ error: "Moderation is not enabled yet." }, { status: 503 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: privateJson({ error: "Sign in first." }, { status: 401 }) };
  const { data: profile } = await supabase.from("op_profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_admin) return { ok: false as const, response: privateJson({ error: "Moderator access required." }, { status: 403 }) };
  return { ok: true as const, supabase, user };
}

export async function GET(): Promise<Response> {
  const gate = await requireModerator();
  if (!gate.ok) return gate.response;
  const admin = getSupabaseServerClient();
  if (!admin) return privateJson({ error: "Moderation is not enabled yet." }, { status: 503 });
  const { data, error } = await admin
    .from("op_content_reports")
    .select("id, reporter_id, content_type, content_id, category, note, status, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) return databaseUnavailable("moderation queue read", error, "The moderation queue is temporarily unavailable.");
  return privateJson({ reports: data ?? [] });
}

export async function POST(request: Request): Promise<Response> {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const gate = await requireModerator();
  if (!gate.ok) return gate.response;
  const rateLimit = await enforceUserRateLimit(gate.supabase, "community_moderation"); if (rateLimit) return rateLimit;
  const admin = getSupabaseServerClient();
  if (!admin) return privateJson({ error: "Moderation is not enabled yet." }, { status: 503 });
  const parsed = await readBoundedJson<{
    action?: unknown;
    contentType?: unknown;
    contentId?: unknown;
    targetUserId?: unknown;
    reportId?: unknown;
    reason?: unknown;
  }>(request, 4_096);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.value;
  const action = typeof payload.action === "string" && ACTIONS.has(payload.action) ? payload.action : null;
  if (!action) return privateJson({ error: "Choose a moderation action." }, { status: 400 });
  const reason = boundedCommunityText(payload.reason, 3, 500);
  if (!reason) return privateJson({ error: "Explain the action in 3 to 500 characters." }, { status: 400 });
  const contentType = typeof payload.contentType === "string" ? payload.contentType : null;
  const contentId = isUuid(payload.contentId) ? payload.contentId : null;
  const targetUserId = isUuid(payload.targetUserId) ? payload.targetUserId : null;
  const reportId = isUuid(payload.reportId) ? payload.reportId : null;
  const stampedAt = new Date().toISOString();

  // Apply the effect first; the audit row records what actually happened.
  if (action === "hide" || action === "unhide") {
    const table = contentType ? HIDEABLE_TABLES[contentType] : undefined;
    if (!table || !contentId) return privateJson({ error: "Hide needs hideable content and its id." }, { status: 400 });
    const { error } = await admin
      .from(table)
      .update(action === "hide" ? { hidden_at: stampedAt, hidden_reason: reason } : { hidden_at: null, hidden_reason: null })
      .eq("id", contentId);
    if (error) return databaseUnavailable("moderation hide", error, "Could not update that content right now.");
  } else if (action === "lock_thread" || action === "unlock_thread") {
    if (contentType !== "forum_thread" || !contentId) return privateJson({ error: "Locking needs a forum thread id." }, { status: 400 });
    const { error } = await admin.from("op_forum_threads").update({ is_locked: action === "lock_thread" }).eq("id", contentId);
    if (error) return databaseUnavailable("moderation lock", error, "Could not update that thread right now.");
  } else if (action === "moderate_tip") {
    if (contentType !== "community_tip" || !contentId) return privateJson({ error: "Tip moderation needs a community tip id." }, { status: 400 });
    const { error } = await admin
      .from("op_community_tips")
      .update({ moderated_at: stampedAt, moderated_reason: reason })
      .eq("id", contentId);
    if (error) return databaseUnavailable("moderation tip", error, "Could not moderate that tip right now.");
  } else if (action === "flag_account" || action === "unflag_account") {
    if (!targetUserId) return privateJson({ error: "Account flags need a target user." }, { status: 400 });
    const { error } = await admin
      .from("op_profiles")
      .update(
        action === "flag_account"
          ? { integrity_flagged_at: stampedAt, integrity_flag_reason: reason }
          : { integrity_flagged_at: null, integrity_flag_reason: null }
      )
      .eq("id", targetUserId);
    if (error) return databaseUnavailable("moderation flag", error, "Could not update that account right now.");
  } else if (action === "dismiss_report") {
    if (!reportId) return privateJson({ error: "Dismissing needs a report id." }, { status: 400 });
  }

  if (reportId) {
    const { error } = await admin
      .from("op_content_reports")
      .update({
        status: action === "dismiss_report" ? "dismissed" : "actioned",
        resolved_at: stampedAt,
        resolved_by: gate.user.id
      })
      .eq("id", reportId);
    if (error) return databaseUnavailable("moderation report resolve", error, "Could not resolve that report right now.");
  }

  // One audit row per action, always.
  const { data, error } = await admin
    .from("op_moderation_actions")
    .insert({
      actor_id: gate.user.id,
      action,
      content_type: contentType && (contentType in HIDEABLE_TABLES || contentType === "community_tip" || contentType === "profile") ? contentType : null,
      content_id: contentId,
      target_user_id: targetUserId,
      report_id: reportId,
      reason
    })
    .select("id")
    .single();
  if (error) return databaseUnavailable("moderation audit write", error, "The action applied but the audit write failed; retry to record it.");
  return privateJson({ id: data.id, action }, { status: 201 });
}
