import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { privateJson } from "@/lib/security/privateJson";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { isUuid } from "@/lib/security/inputValidation";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";
import { boundedCommunityText } from "@/lib/community/predictionContracts";

export const dynamic = "force-dynamic";

const CONTENT_TYPES = new Set(["feed_post", "feed_comment", "forum_thread", "forum_reply", "community_tip", "profile"]);
const CATEGORIES = new Set([
  "spam",
  "scam_or_paid_tips",
  "guaranteed_win_claim",
  "harassment",
  "impersonation",
  "unsafe_link",
  "other"
]);

export async function POST(request: Request): Promise<Response> {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ error: "Reporting is not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to report content." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "community_report"); if (rateLimit) return rateLimit;
  const parsed = await readBoundedJson<{ contentType?: unknown; contentId?: unknown; category?: unknown; note?: unknown }>(request, 4_096);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.value;
  const contentType = typeof payload.contentType === "string" && CONTENT_TYPES.has(payload.contentType) ? payload.contentType : null;
  if (!contentType) return privateJson({ error: "Choose what you are reporting." }, { status: 400 });
  if (!isUuid(payload.contentId)) return privateJson({ error: "Invalid content reference." }, { status: 400 });
  const category = typeof payload.category === "string" && CATEGORIES.has(payload.category) ? payload.category : null;
  if (!category) return privateJson({ error: "Choose a report reason." }, { status: 400 });
  const note = payload.note === undefined || payload.note === null ? null : boundedCommunityText(payload.note, 1, 500);
  if (payload.note !== undefined && payload.note !== null && !note) {
    return privateJson({ error: "Keep the note under 500 characters." }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("op_content_reports")
    .insert({ reporter_id: user.id, content_type: contentType, content_id: payload.contentId, category, note })
    .select("id")
    .single();
  // A duplicate report from the same person about the same content is already
  // in the queue: treat it as filed, not as an error.
  if (error && error.code === "23505") return privateJson({ ok: true, note: "You already reported this. It is in the moderation queue." });
  if (error) return databaseUnavailable("community report create", error, "Could not file that report right now.");
  return privateJson({ id: data.id, note: "Report filed. A moderator will review it." }, { status: 201 });
}
