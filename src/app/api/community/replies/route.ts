import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ error: "Community is not enabled yet." }, { status: 503 });

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to reply." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as { threadId?: unknown; body?: unknown };
  const threadId = typeof payload.threadId === "string" ? payload.threadId : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!threadId) return Response.json({ error: "Missing thread." }, { status: 400 });
  if (body.length < 1 || body.length > 8000) return Response.json({ error: "Reply must be 1–8000 characters." }, { status: 400 });

  // RLS also blocks replies on locked threads and enforces author_id = auth.uid().
  const { data, error } = await supabase
    .from("op_forum_replies")
    .insert({ thread_id: threadId, author_id: user.id, body })
    .select("id")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ id: data.id }, { status: 201 });
}
