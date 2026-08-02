import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { DataAvailability } from "@/lib/domain/states";

/**
 * The public read path. One indexed row per surface, never a scan.
 *
 * Measured before (pg_stat_statements / EXPLAIN, 2026-08-01):
 *   today's slate join   31.4 ms, 13,818 buffers (~108 MB heap) for 340 rows
 *   census RPCs          mean 3.7 s and 5.1 s, max 7.98 s against an 8 s
 *                        statement timeout — on a public page
 * Measured after:
 *   projection read      0.101 ms, 2 buffers
 *
 * The performance win matters less than the semantic one. Those cancellations
 * were caught by `catch { return [] }` and rendered as "no fixtures" and "no
 * value picks". Here a failed read is `unavailable` and carries no rows to
 * mistake for an answer, while a genuinely empty slate is `confirmed_empty`.
 */
export type ProjectionName =
  | "daily_fixture_slate"
  | "live_fixture_board"
  | "performance_summary"
  | "latest_engine_status";

/**
 * How often the scheduled sweep rebuilds every projection.
 *
 * Every freshness threshold must exceed this. A threshold tighter than the
 * cadence is guaranteed to fire between rebuilds, which is exactly what
 * happened in production: the live board carried a 3-minute threshold against
 * a 5-minute sweep, so /api/status reported "delayed" most of the time and the
 * signal stopped meaning anything.
 */
export const PROJECTION_REFRESH_INTERVAL_MS = 5 * 60_000;

/**
 * How old a projection may be before the page must disclose its age.
 *
 * Each value allows at least one missed sweep on top of the cadence — Netlify
 * schedules are approximate, and a single late tick is not a fault worth
 * telling users about.
 */
export const FRESHNESS_THRESHOLD_MS: Record<ProjectionName, number> = {
  // Kickoffs and prices move; a slate older than 30 minutes is worth flagging.
  daily_fixture_slate: 30 * 60_000,
  // The most time-sensitive surface, so the tightest threshold the cadence
  // can actually support: two sweeps plus a margin.
  live_fixture_board: 12 * 60_000,
  // The ledger changes only when a pick settles.
  performance_summary: 6 * 60 * 60_000,
  latest_engine_status: 30 * 60_000
};

export type ProjectionRead<T> = {
  /**
   * `complete` fresh and current · `stale` verified but past threshold ·
   * `partial` renderable with known gaps · `confirmed_empty` genuinely nothing
   * · `unavailable` we could not establish the truth.
   */
  availability: DataAvailability;
  data: T | null;
  rowCount: number;
  /** When the projection was built. Shown to the reader once stale. */
  builtAt: string | null;
  /** Newest source record the payload reflects. */
  sourceMaxAt: string | null;
  ageMs: number | null;
  builderVersion: number | null;
  /**
   * Operator-facing only. Never rendered: it can carry database cancellation
   * text, and raw error strings do not belong on a public page.
   */
  diagnostic: string | null;
};

function unavailable<T>(diagnostic: string): ProjectionRead<T> {
  return {
    availability: "unavailable",
    data: null,
    rowCount: 0,
    builtAt: null,
    sourceMaxAt: null,
    ageMs: null,
    builderVersion: null,
    diagnostic
  };
}

/**
 * Builder versions this code understands. A payload written by a newer builder
 * is treated as unavailable rather than parsed optimistically — misreading a
 * changed shape is worse than admitting we cannot read it.
 */
const SUPPORTED_BUILDER_VERSION = 2;

export async function readProjection<T>(
  name: ProjectionName,
  scope = "",
  {
    client = getSupabaseServerClient(),
    now = Date.now(),
    freshnessMs = FRESHNESS_THRESHOLD_MS[name]
  }: { client?: SupabaseClient | null; now?: number; freshnessMs?: number } = {}
): Promise<ProjectionRead<T>> {
  if (!client) return unavailable<T>("Supabase server storage is not configured in this runtime.");

  const { data, error } = await client
    .from("op_public_projections")
    .select("payload,row_count,source_max_at,built_at,builder_version,status,last_error")
    .eq("name", name)
    .eq("scope", scope)
    .maybeSingle();

  // The whole point: a failed read is not an empty result.
  if (error) return unavailable<T>(`projection read failed: ${error.message}`);
  if (!data) return unavailable<T>(`no projection has been built for ${name}/${scope || "default"} yet`);

  const builderVersion = Number(data.builder_version) || 0;
  if (builderVersion > SUPPORTED_BUILDER_VERSION) {
    return unavailable<T>(`projection ${name} was built by version ${builderVersion}, newer than this reader`);
  }

  const builtAt = data.built_at ? String(data.built_at) : null;
  const ageMs = builtAt ? Math.max(0, now - Date.parse(builtAt)) : null;
  const rowCount = Number(data.row_count) || 0;
  const base = {
    data: (data.payload ?? null) as T | null,
    rowCount,
    builtAt,
    sourceMaxAt: data.source_max_at ? String(data.source_max_at) : null,
    ageMs,
    builderVersion,
    diagnostic: data.last_error ? String(data.last_error) : null
  };

  // A projection whose last refresh failed is still trustworthy as a snapshot
  // — that is the point of keeping it — but it can only be offered as stale.
  const refreshFailed = data.status === "refresh_failed";
  if (data.status === "confirmed_empty" && !refreshFailed) {
    return { ...base, availability: "confirmed_empty" };
  }
  if (ageMs !== null && ageMs > freshnessMs) return { ...base, availability: "stale" };
  if (data.status === "partial") return { ...base, availability: "partial" };
  if (refreshFailed) return { ...base, availability: "stale" };
  return { ...base, availability: "complete" };
}

/** Array-shaped projections: the payload is a jsonb array. */
export async function readProjectionList<T>(
  name: ProjectionName,
  scope = "",
  options: { client?: SupabaseClient | null; now?: number; freshnessMs?: number } = {}
): Promise<ProjectionRead<T[]>> {
  const read = await readProjection<T[]>(name, scope, options);
  if (read.data !== null && !Array.isArray(read.data)) {
    return unavailable<T[]>(`projection ${name} payload was not an array`);
  }
  return read;
}

/** Today's date key in UTC, matching how the slate projections are scoped. */
export function todayScope(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
