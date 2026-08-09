/**
 * Per-route production performance budgets.
 *
 * The single source of truth for what "fast enough" means on each critical
 * route. The CI budget test asserts this table stays complete and sane; the
 * real-browser LCP/INP measurement lives in the load-test/observability layer
 * (CI has no browser). A budget MISS never blocks a critical reliability fix on
 * its own — but the override must be explicit via ODDSPADI_PERF_WAIVER.
 */

export type RouteBudget = {
  route: string;
  /** Time-to-first-byte / server render budget (ms). */
  serverMs: number;
  /** Largest Contentful Paint budget (ms). */
  lcpMs: number;
  /** Cumulative Layout Shift budget (unitless). */
  cls: number;
  /** Interaction to Next Paint budget (ms). */
  inpMs: number;
  /** Shared client JS budget for the route (KB, gzipped). */
  bundleKb: number;
};

export const WAIVER_ENV = "ODDSPADI_PERF_WAIVER";

/** The ten routes the spec requires measured. */
export const ROUTE_BUDGETS: readonly RouteBudget[] = [
  { route: "/", serverMs: 2500, lcpMs: 2500, cls: 0.1, inpMs: 200, bundleKb: 180 },
  { route: "/predictions/today", serverMs: 2500, lcpMs: 2500, cls: 0.1, inpMs: 200, bundleKb: 180 },
  { route: "/predictions", serverMs: 2500, lcpMs: 2500, cls: 0.1, inpMs: 200, bundleKb: 180 },
  { route: "/live-scores", serverMs: 2500, lcpMs: 2500, cls: 0.1, inpMs: 200, bundleKb: 180 },
  { route: "/predictions/[matchId]", serverMs: 2500, lcpMs: 2800, cls: 0.1, inpMs: 200, bundleKb: 200 },
  { route: "/track-record", serverMs: 4000, lcpMs: 2800, cls: 0.1, inpMs: 200, bundleKb: 200 },
  { route: "/engine/performance", serverMs: 4000, lcpMs: 2800, cls: 0.1, inpMs: 200, bundleKb: 200 },
  { route: "/my", serverMs: 2500, lcpMs: 2500, cls: 0.1, inpMs: 200, bundleKb: 180 },
  { route: "/news", serverMs: 2500, lcpMs: 2500, cls: 0.1, inpMs: 200, bundleKb: 180 },
  { route: "/predictions/league/[slug]", serverMs: 2500, lcpMs: 2800, cls: 0.1, inpMs: 200, bundleKb: 200 }
] as const;

export function budgetForRoute(route: string): RouteBudget | null {
  return ROUTE_BUDGETS.find((budget) => budget.route === route) ?? null;
}

/** Is a budget miss currently waived (explicit operator override)? */
export function performanceWaived(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env[WAIVER_ENV]?.trim());
}
