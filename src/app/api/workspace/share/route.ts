import { randomUUID } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { privateJson } from "@/lib/security/privateJson";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { isSyncableWorkspace, sanitizeForShare } from "@/lib/workspaceSync/sanitize";
import { shareSecret, signShareToken, verifyShareToken } from "@/lib/workspaceSync/shareToken";

export const dynamic = "force-dynamic";

/**
 * Creating and revoking read-only workspace shares.
 *
 * A share stores a sanitised, frozen copy of the workspace — never a live
 * reference — so later edits to the workspace do not leak through an old
 * link, and nothing account-related is in the stored payload at all.
 *
 * Guests can share: possession of the returned token is what proves the
 * right to revoke. Signed-in users additionally get owner-based revocation,
 * which survives losing the link.
 */

const DEFAULT_EXPIRY_DAYS = 7;
const MAX_EXPIRY_DAYS = 30;

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request);
  if (originError) return originError;

  const secret = shareSecret();
  if (!secret) return privateJson({ error: "Sharing is not configured on this deployment." }, { status: 503 });
  const service = getSupabaseServerClient();
  if (!service) return privateJson({ error: "Sharing is not configured on this deployment." }, { status: 503 });

  const parsed = await readBoundedJson<{ workspace?: unknown; expiresInDays?: unknown }>(request, 256_000);
  if (!parsed.ok) return parsed.response;
  if (!isSyncableWorkspace(parsed.value.workspace)) {
    return privateJson({ error: "That workspace could not be validated for sharing." }, { status: 400 });
  }

  const requestedDays = Number(parsed.value.expiresInDays);
  const expiryDays = Number.isFinite(requestedDays)
    ? Math.min(MAX_EXPIRY_DAYS, Math.max(1, Math.floor(requestedDays)))
    : DEFAULT_EXPIRY_DAYS;

  // Owner attribution is optional — a guest share simply has none.
  const authed = await createSupabaseServerClient();
  const ownerId = authed ? (await authed.auth.getUser()).data.user?.id ?? null : null;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60_000);
  const shareId = randomUUID();
  const payload = sanitizeForShare(parsed.value.workspace, now.toISOString());

  const { error } = await service.from("op_workspace_shares").insert({
    share_id: shareId,
    owner_user_id: ownerId,
    payload,
    expires_at: expiresAt.toISOString()
  });
  if (error) return databaseUnavailable("workspace share create", error, "Could not create a share link right now.");

  const token = signShareToken(shareId, expiresAt.getTime(), secret);
  return privateJson(
    {
      token,
      path: `/workspace/shared/${token}`,
      expiresAt: expiresAt.toISOString(),
      // Stated, not implied: the reader sees the frozen analysis, nothing else.
      note: "The link shows a read-only copy of this analysis as it is now. It expires automatically and can be revoked."
    },
    { status: 201 }
  );
}

export async function DELETE(request: Request) {
  const originError = rejectCrossSiteMutation(request);
  if (originError) return originError;

  const secret = shareSecret();
  const service = getSupabaseServerClient();
  if (!secret || !service) return privateJson({ error: "Sharing is not configured on this deployment." }, { status: 503 });

  const parsed = await readBoundedJson<{ token?: unknown; shareId?: unknown }>(request, 4_096);
  if (!parsed.ok) return parsed.response;

  // Path 1: possession of the token proves the right to revoke (guest path).
  const token = typeof parsed.value.token === "string" ? parsed.value.token : null;
  if (token) {
    const verdict = verifyShareToken(token, secret, Date.now());
    // An expired token may still revoke — revoking something already dead is
    // an idempotent success, and refusing it just confuses the owner.
    const shareId = verdict.ok ? verdict.shareId : /^([a-z0-9-]{8,64})\./.exec(token)?.[1];
    if (!verdict.ok && verdict.reason === "bad_signature") {
      return privateJson({ error: "That link could not be verified." }, { status: 403 });
    }
    if (!shareId) return privateJson({ error: "That link could not be read." }, { status: 400 });
    const { error } = await service
      .from("op_workspace_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("share_id", shareId)
      .is("revoked_at", null);
    if (error) return databaseUnavailable("workspace share revoke", error, "Could not revoke that link right now.");
    return privateJson({ ok: true });
  }

  // Path 2: the signed-in owner revokes by share id, no token needed.
  const shareId = typeof parsed.value.shareId === "string" ? parsed.value.shareId : null;
  if (!shareId) return privateJson({ error: "Send the share token or a share id." }, { status: 400 });
  const authed = await createSupabaseServerClient();
  const user = authed ? (await authed.auth.getUser()).data.user : null;
  if (!user) return privateJson({ error: "Sign in to revoke by id, or use the share link itself." }, { status: 401 });

  const { error, count } = await service
    .from("op_workspace_shares")
    .update({ revoked_at: new Date().toISOString() }, { count: "exact" })
    .eq("share_id", shareId)
    .eq("owner_user_id", user.id)
    .is("revoked_at", null);
  if (error) return databaseUnavailable("workspace share revoke", error, "Could not revoke that link right now.");
  if (!count) return privateJson({ error: "No active share of yours matches that id." }, { status: 404 });
  return privateJson({ ok: true });
}
