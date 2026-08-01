import { getSupabaseServerClient } from "@/lib/supabase/server";
import { FRESHNESS_THRESHOLD_MS, type ProjectionName } from "@/lib/readmodel/publicProjection";

/**
 * Two status surfaces from one read, deliberately unequal.
 *
 * The operational view carries what an operator needs: which job last
 * succeeded, how old each projection is, what the last error said. The public
 * payload carries a single word and a timestamp. Provider names, run ids,
 * database vendor details and raw errors stay on the private side — they are
 * reconnaissance for anyone probing the site and noise for everyone else.
 */
export type PublicStatusLevel = "operational" | "delayed" | "partial" | "unavailable";

export type PublicStatusPayload = {
  status: PublicStatusLevel;
  /** Last time any user-facing projection was successfully rebuilt. */
  lastUpdatedAt: string | null;
};

export type OperationalProjectionHealth = {
  name: string;
  scope: string;
  status: string;
  rowCount: number;
  builtAt: string | null;
  sourceMaxAt: string | null;
  ageMs: number | null;
  buildDurationMs: number | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  overThreshold: boolean;
};

export type OperationalStatus = {
  readable: boolean;
  projections: OperationalProjectionHealth[];
  /** Job type → last successful completion, from the run ledger. */
  jobs: Record<string, string | null>;
};

export async function readOperationalStatus(now = Date.now()): Promise<OperationalStatus> {
  const client = getSupabaseServerClient();
  if (!client) return { readable: false, projections: [], jobs: {} };

  const [{ data: projections, error }, { data: statusRow }] = await Promise.all([
    client
      .from("op_public_projections")
      .select("name,scope,status,row_count,built_at,source_max_at,build_duration_ms,last_attempt_at,last_error"),
    client
      .from("op_public_projections")
      .select("payload")
      .eq("name", "latest_engine_status")
      .eq("scope", "")
      .maybeSingle()
  ]);
  if (error) return { readable: false, projections: [], jobs: {} };

  const health = (projections ?? []).map((row) => {
    const builtAt = row.built_at ? String(row.built_at) : null;
    const ageMs = builtAt ? Math.max(0, now - Date.parse(builtAt)) : null;
    const threshold = FRESHNESS_THRESHOLD_MS[row.name as ProjectionName] ?? 30 * 60_000;
    return {
      name: String(row.name),
      scope: String(row.scope ?? ""),
      status: String(row.status),
      rowCount: Number(row.row_count) || 0,
      builtAt,
      sourceMaxAt: row.source_max_at ? String(row.source_max_at) : null,
      ageMs,
      buildDurationMs: row.build_duration_ms === null ? null : Number(row.build_duration_ms),
      lastAttemptAt: row.last_attempt_at ? String(row.last_attempt_at) : null,
      lastError: row.last_error ? String(row.last_error) : null,
      overThreshold: ageMs !== null && ageMs > threshold
    };
  });

  const payload = (statusRow?.payload ?? {}) as Record<string, { lastSuccessAt?: string | null }>;
  const jobs: Record<string, string | null> = {};
  for (const [jobType, value] of Object.entries(payload)) jobs[jobType] = value?.lastSuccessAt ?? null;

  return { readable: true, projections: health, jobs };
}

/**
 * Reduce operational detail to the four words the public may see.
 *
 * Deliberately lossy. Anything that would let a reader infer which provider or
 * which query is struggling is dropped here rather than filtered downstream.
 */
export function toPublicStatus(operational: OperationalStatus): PublicStatusPayload {
  if (!operational.readable || operational.projections.length === 0) {
    return { status: "unavailable", lastUpdatedAt: null };
  }

  const built = operational.projections
    .map((projection) => projection.builtAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const lastUpdatedAt = built.length ? built[built.length - 1]! : null;

  const anyFailing = operational.projections.some((projection) => projection.status === "refresh_failed");
  const anyPartial = operational.projections.some((projection) => projection.status === "partial");
  const anyStale = operational.projections.some((projection) => projection.overThreshold);

  // Ordered worst-first: a failing refresh is the strongest signal even when
  // most surfaces are fine, because it means one of them is silently ageing.
  if (anyFailing) return { status: "delayed", lastUpdatedAt };
  if (anyPartial) return { status: "partial", lastUpdatedAt };
  if (anyStale) return { status: "delayed", lastUpdatedAt };
  return { status: "operational", lastUpdatedAt };
}
