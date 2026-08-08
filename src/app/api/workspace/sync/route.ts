import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { privateJson } from "@/lib/security/privateJson";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";
import { isSyncableWorkspace } from "@/lib/workspaceSync/sanitize";

export const dynamic = "force-dynamic";

/**
 * Private workspace sync for signed-in users.
 *
 * The database rows are RLS-scoped to the owner, so this route runs on the
 * user's own client — there is no service-role path here, and a bug in this
 * file cannot read another user's workspaces because the database refuses to.
 *
 * Guests are not an error state: they keep their workspaces on-device and
 * this route simply reports `authenticated: false` so the interface can say
 * what syncing would add.
 */

const PRIVATE_READ_HEADERS = { "Cache-Control": "private, max-age=0, must-revalidate" };
const MAX_SYNC_BYTES = 512_000;

async function authClient() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: privateJson({ error: "Workspace sync is not configured." }, { status: 503 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: privateJson({ error: "Sign in to sync workspaces." }, { status: 401 }) };
  return { supabase, user };
}

export async function GET() {
  const auth = await authClient();
  if (auth.error) {
    if (auth.error.status === 401) {
      return privateJson({ workspaces: [], authenticated: false }, { headers: PRIVATE_READ_HEADERS });
    }
    return auth.error;
  }
  const { data, error } = await auth.supabase
    .from("op_workspaces")
    .select("workspace_id,payload,archived_at,updated_at")
    .eq("user_id", auth.user.id)
    .order("updated_at", { ascending: false });
  if (error) return databaseUnavailable("workspace sync read", error, "Workspaces are temporarily unavailable.");
  return privateJson(
    {
      authenticated: true,
      workspaces: (data ?? []).map((row) => row.payload)
    },
    { headers: PRIVATE_READ_HEADERS }
  );
}

export async function PUT(request: Request) {
  const originError = rejectCrossSiteMutation(request);
  if (originError) return originError;
  const auth = await authClient();
  if (auth.error) return auth.error;
  const rateLimit = await enforceUserRateLimit(auth.supabase, "workspace_sync");
  if (rateLimit) return rateLimit;

  const parsed = await readBoundedJson<{ workspaces?: unknown }>(request, MAX_SYNC_BYTES);
  if (!parsed.ok) return parsed.response;
  const incoming = Array.isArray(parsed.value.workspaces) ? parsed.value.workspaces : null;
  if (!incoming) return privateJson({ error: "Send { workspaces: [...] }." }, { status: 400 });
  if (incoming.length > 20) return privateJson({ error: "At most 20 workspaces sync." }, { status: 400 });

  const valid = incoming.filter(isSyncableWorkspace);
  if (valid.length !== incoming.length) {
    // Refusing the whole batch beats silently dropping the malformed entries:
    // a partial sync that looks complete is how devices end up disagreeing.
    return privateJson({ error: "One or more workspaces failed validation; nothing was synced." }, { status: 400 });
  }

  for (const workspace of valid) {
    const { error } = await auth.supabase.from("op_workspaces").upsert(
      {
        user_id: auth.user.id,
        workspace_id: workspace.workspaceId,
        payload: workspace,
        archived_at: workspace.archivedAt ?? null,
        updated_at: new Date().toISOString()
      },
      { onConflict: "user_id,workspace_id" }
    );
    if (error) return databaseUnavailable("workspace sync write", error, "Could not sync workspaces right now.");
  }
  return privateJson({ ok: true, synced: valid.length });
}

export async function DELETE(request: Request) {
  const originError = rejectCrossSiteMutation(request);
  if (originError) return originError;
  const auth = await authClient();
  if (auth.error) return auth.error;
  const rateLimit = await enforceUserRateLimit(auth.supabase, "workspace_sync");
  if (rateLimit) return rateLimit;

  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!workspaceId || workspaceId.length > 100) {
    return privateJson({ error: "Name the workspace to delete." }, { status: 400 });
  }
  const { error } = await auth.supabase
    .from("op_workspaces")
    .delete()
    .eq("user_id", auth.user.id)
    .eq("workspace_id", workspaceId);
  if (error) return databaseUnavailable("workspace delete", error, "Could not delete that workspace right now.");
  return privateJson({ ok: true });
}
