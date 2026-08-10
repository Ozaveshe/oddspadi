/**
 * Configurable operational service-level targets.
 *
 * These are the eight targets the operation is held to — separate from the case
 * SLA policy (which governs individual cases) and from the observability
 * registry (which governs infrastructure signals). Each has a sensible default
 * here; a deployment overrides any of them through a single JSON env var,
 * `ODDSPADI_OPS_SLA_OVERRIDES`, so tuning a target is a config change, not a
 * code change.
 *
 * Prediction win rate is deliberately NOT a target — the operation is measured
 * on how it runs, never on whether the model won.
 */

export type ServiceTargetUnit = "percent" | "minutes";
export type ServiceTargetDirection = "lower_is_better" | "higher_is_better";

export type ServiceTarget = {
  id: string;
  name: string;
  unit: ServiceTargetUnit;
  target: number;
  direction: ServiceTargetDirection;
};

type TargetDefault = Omit<ServiceTarget, "target"> & { default: number };

const DEFAULTS: readonly TargetDefault[] = [
  { id: "stale_card_rate", name: "Current-surface stale-card rate", unit: "percent", default: 2, direction: "lower_is_better" },
  { id: "result_verification_delay", name: "Result verification delay", unit: "minutes", default: 180, direction: "lower_is_better" },
  { id: "settlement_delay", name: "Official settlement delay", unit: "minutes", default: 60, direction: "lower_is_better" },
  { id: "closing_price_coverage", name: "Closing-price coverage", unit: "percent", default: 90, direction: "higher_is_better" },
  { id: "mapping_review_time", name: "Market-mapping review time", unit: "minutes", default: 240, direction: "lower_is_better" },
  { id: "high_priority_incident_response", name: "High-priority incident response", unit: "minutes", default: 15, direction: "lower_is_better" },
  { id: "community_report_response", name: "Community report response", unit: "minutes", default: 720, direction: "lower_is_better" },
  { id: "content_correction_time", name: "Content correction time", unit: "minutes", default: 120, direction: "lower_is_better" }
];

const OVERRIDE_ENV = "ODDSPADI_OPS_SLA_OVERRIDES";

/** Parse the override map defensively — a malformed value falls back to defaults, never throws. */
function parseOverrides(env: Record<string, string | undefined>): Record<string, number> {
  const raw = env[OVERRIDE_ENV];
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function serviceTargets(env: Record<string, string | undefined> = process.env): ServiceTarget[] {
  const overrides = parseOverrides(env);
  return DEFAULTS.map(({ default: def, ...rest }) => ({
    ...rest,
    target: rest.id in overrides ? overrides[rest.id] : def
  }));
}

export function serviceTarget(id: string, env: Record<string, string | undefined> = process.env): ServiceTarget | null {
  return serviceTargets(env).find((t) => t.id === id) ?? null;
}

/**
 * Does a measured value meet its target? Direction-aware. Returns `null` for an
 * unknown id or a null reading — an unmeasured target is never a satisfied one.
 */
export function meetsTarget(id: string, value: number | null, env: Record<string, string | undefined> = process.env): boolean | null {
  const t = serviceTarget(id, env);
  if (!t || value === null || !Number.isFinite(value)) return null;
  return t.direction === "lower_is_better" ? value <= t.target : value >= t.target;
}
