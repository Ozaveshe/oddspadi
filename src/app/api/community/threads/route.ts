import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { isUuid } from "@/lib/security/inputValidation";
import { readBoundedJson } from "@/lib/security/boundedJson";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ error: "Community is not enabled yet." }, { status: 503 });

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to start a thread." }, { status: 401 });

  const parsed = await readBoundedJson<{ categoryId?: unknown; title?: unknown; body?: unknown }>(request, 24_576);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.value;
  const categoryId = typeof payload.categoryId === "string" ? payload.categoryId : "";
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!isUuid(categoryId)) return Response.json({ error: "Missing category." }, { status: 400 });
  if (title.length < 3 || title.length > 160) return Response.json({ error: "Title must be 3–160 characters." }, { status: 400 });
  if (body.length < 1 || body.length > 8000) return Response.json({ error: "Post must be 1–8000 characters." }, { status: 400 });

  const { data, error } = await supabase
    .from("op_forum_threads")
    .insert({ category_id: categoryId, author_id: user.id, title, body })
    .select("id")
    .single();

  if (error) return databaseUnavailable("forum thread create", error, "Could not start that thread right now.");
  return Response.json({ id: data.id }, { status: 201 });
}
