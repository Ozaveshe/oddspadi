import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Append one row to the operator audit log. Best-effort: a failed audit write
 * is logged (by code only) but never blocks the action's own error handling —
 * the caller decides whether the action succeeded. Every destructive admin
 * action should write exactly one of these.
 */
export async function writeOperatorAudit(
  client: SupabaseClient,
  entry: {
    actorFingerprint: string;
    action: string;
    target?: string | null;
    detail?: Record<string, unknown>;
    outcome?: "applied" | "rejected" | "failed";
  }
): Promise<void> {
  const { error } = await client.from("op_operator_audit").insert({
    actor_fingerprint: entry.actorFingerprint,
    action: entry.action,
    target: entry.target ?? null,
    detail: entry.detail ?? {},
    outcome: entry.outcome ?? "applied"
  });
  if (error) console.error("[operator-audit] write failed", { code: error.code });
}
