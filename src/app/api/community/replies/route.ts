import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { isUuid } from "@/lib/security/inputValidation";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ error: "Community is not enabled yet." }, { status: 503 });

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to reply." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "forum_reply"); if (rateLimit) return rateLimit;

  const parsed = await readBoundedJson<{ threadId?: unknown; body?: unknown }>(request, 24_576);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.value;
  const threadId = typeof payload.threadId === "string" ? payload.threadId : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!isUuid(threadId)) return Response.json({ error: "Missing thread." }, { status: 400 });
  if (body.length < 1 || body.length > 8000) return Response.json({ error: "Reply must be 1–8000 characters." }, { status: 400 });

  // RLS also blocks replies on locked threads and enforces author_id = auth.uid().
  const { data, error } = await supabase
    .from("op_forum_replies")
    .insert({ thread_id: threadId, author_id: user.id, body })
    .select("id")
    .single();

  if (error) return databaseUnavailable("forum reply create", error, "Could not publish that reply right now.");
  return Response.json({ id: data.id }, { status: 201 });
}
