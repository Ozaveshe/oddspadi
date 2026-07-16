import type { SupabaseClient } from "@supabase/supabase-js";
import { databaseUnavailable } from "@/lib/security/databaseError";

export type AuthenticatedWriteAction =
  | "profile_update"
  | "follow_team"
  | "push_subscription"
  | "community_post"
  | "community_comment"
  | "community_like"
  | "forum_thread"
  | "forum_reply";

type RateLimitRow = {
  allowed?: unknown;
  remaining?: unknown;
  retry_after_seconds?: unknown;
};

export async function enforceUserRateLimit(
  client: SupabaseClient,
  action: AuthenticatedWriteAction
): Promise<Response | null> {
  const { data, error } = await client.rpc("op_consume_user_rate_limit", { p_action: action });
  if (error) return databaseUnavailable("authenticated write rate limit", error, "Write protection is temporarily unavailable.");

  const row = (Array.isArray(data) ? data[0] : data) as RateLimitRow | null;
  if (!row || typeof row.allowed !== "boolean") {
    return databaseUnavailable("authenticated write rate limit", { code: "invalid_result" }, "Write protection is temporarily unavailable.");
  }
  if (row.allowed) return null;

  const retryAfter = typeof row.retry_after_seconds === "number" && Number.isFinite(row.retry_after_seconds)
    ? Math.max(1, Math.ceil(row.retry_after_seconds))
    : 60;
  return Response.json(
    { error: "Too many requests. Please wait before trying again." },
    {
      status: 429,
      headers: {
        "Cache-Control": "private, no-store",
        "Retry-After": String(retryAfter)
      }
    }
  );
}
