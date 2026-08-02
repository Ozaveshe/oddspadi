import { timingSafeEqual } from "node:crypto";
import type { Config, Context } from "@netlify/functions";
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
 * Rebuild every public projection on a schedule.
 *
 * This is the job that keeps expensive work off the request path. It calls one
 * database function that sequences the builders; each builder owns its own
 * error handling, so a single failing projection cannot stop the others and
 * cannot replace a good payload with an empty one.
 *
 * Unlike the outcome ledger this needs no pipeline lock: the builders only
 * read operational tables and write their own projection rows, so a
 * concurrent run is redundant rather than harmful.
 */
export default async function projectionRefreshSweep(request: Request, _context: Context): Promise<Response> {
  // Netlify currently refuses external invocation of scheduled functions, but
  // that is platform configuration, not a property of this code: convert the
  // function to a non-scheduled one, or change hosts, and an anonymous caller
  // could drive unbounded database work. Every other job in this directory
  // checks the shared schedule token, and so does this one.
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
  console.info(JSON.stringify({
    event: "oddspadi-projection-refresh",
    success: failed.length === 0,
    totalMs: Date.now() - startedAt,
    projections: rows.map((row) => ({ name: row.name, scope: row.scope, status: row.status, rows: row.row_count, ms: row.build_duration_ms }))
  }));
  return Response.json({ success: failed.length === 0, projections: rows }, { status: failed.length ? 207 : 200 });
}

// Every 5 minutes: fast enough that the live board stays inside its 3-minute
// freshness threshold most of the time, cheap enough to be irrelevant to load
// (the whole refresh measured ~416 ms).
export const config: Config = { schedule: "*/5 * * * *" };
