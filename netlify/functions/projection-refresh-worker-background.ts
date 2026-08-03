import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

declare const Netlify: { env: { get(name: string): string | undefined } };

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

/** Constant-time compare: a length-or-content oracle is still an oracle. */
function tokenMatches(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Rebuild every public projection.
 *
 * This is the half that does the work and therefore the half that
 * authenticates. It is called by `projection-refresh-sweep`, which the
 * platform schedules; that entrypoint cannot verify an inbound token because
 * the scheduler has no way to send one, so the check lives here where there is
 * a real caller to check.
 *
 * One database function sequences the builders. Each builder owns its own
 * error handling, so a single failing projection cannot stop the others and
 * cannot replace a good payload with an empty one.
 *
 * No pipeline lock is needed: the builders read operational tables and write
 * their own projection rows, so a concurrent run is redundant rather than
 * harmful.
 */
export default async function projectionRefreshWorker(request: Request, _context: Context): Promise<Response> {
  const scheduleToken = clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN"));
  const supplied = clean(request.headers.get("x-oddspadi-schedule-token"));
  if (!scheduleToken || !supplied || !tokenMatches(scheduleToken, supplied)) {
    // Deliberately terse: an unauthenticated caller learns nothing about what
    // this endpoint does, which job it drives, or why it refused.
    return Response.json({ success: false }, { status: 401 });
  }

  const url = clean(Netlify.env.get("SUPABASE_URL"));
  const key = clean(Netlify.env.get("SUPABASE_SECRET_KEY")) ?? clean(Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!url || !key) {
    return Response.json({ success: false, error: "Projection refresh configuration is incomplete." }, { status: 503 });
  }

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const startedAt = Date.now();
  const { data, error } = await client.rpc("op_refresh_public_projections");
  if (error) {
    console.error(JSON.stringify({ event: "oddspadi-projection-refresh", success: false, error: error.message }));
    return Response.json({ success: false, error: error.message }, { status: 502 });
  }

  const rows = (data ?? []) as Array<{ name: string; scope: string; status: string; row_count: number; build_duration_ms: number }>;
  const failed = rows.filter((row) => row.status === "refresh_failed");
  // Structured so the projection health of every surface is greppable in logs
  // without opening a dashboard.
  console.info(
    JSON.stringify({
      event: "oddspadi-projection-refresh",
      success: failed.length === 0,
      totalMs: Date.now() - startedAt,
      projections: rows.map((row) => ({
        name: row.name,
        scope: row.scope,
        status: row.status,
        rows: row.row_count,
        ms: row.build_duration_ms
      }))
    })
  );
  return Response.json({ success: failed.length === 0, projections: rows }, { status: failed.length ? 207 : 200 });
}
