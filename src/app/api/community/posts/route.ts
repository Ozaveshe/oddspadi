import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";

export const dynamic = "force-dynamic";

const POST_SELECT = "id, body, match_id, created_at, author:op_profiles(username, display_name, avatar_url)";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ posts: [] });
  try {
    const { data, error } = await supabase
      .from("op_feed_posts")
      .select(POST_SELECT)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return Response.json({ posts: [], note: error.message });
    return Response.json({ posts: data ?? [] });
  } catch {
    return Response.json({ posts: [] });
  }
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ error: "Community is not enabled yet." }, { status: 503 });

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to post." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as { body?: unknown; matchId?: unknown };
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!body || body.length > 2000) {
    return Response.json({ error: "A post must be between 1 and 2000 characters." }, { status: 400 });
  }
  const matchId = typeof payload.matchId === "string" && payload.matchId ? payload.matchId.slice(0, 80) : null;

  // RLS enforces author_id = auth.uid() on insert.
  const { data, error } = await supabase
    .from("op_feed_posts")
    .insert({ author_id: user.id, body, match_id: matchId })
    .select("id")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ id: data.id }, { status: 201 });
}
