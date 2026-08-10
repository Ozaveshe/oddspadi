import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_BUDGETS, budgetForRoute, performanceWaived, WAIVER_ENV } from "@/lib/performance/routeBudgets";

const read = (relative: string) => readFileSync(join(process.cwd(), ...relative.split("/")), "utf8");

describe("route performance budgets", () => {
  it("covers all ten critical routes the spec names", () => {
    const routes = ROUTE_BUDGETS.map((budget) => budget.route);
    for (const required of ["/", "/predictions/today", "/predictions", "/live-scores", "/predictions/[matchId]", "/track-record", "/engine/performance", "/my", "/news", "/predictions/league/[slug]"]) {
      expect(routes, `budget missing for ${required}`).toContain(required);
    }
    expect(routes.length).toBe(new Set(routes).size); // no duplicates
  });

  it("keeps every budget within a sane ceiling", () => {
    for (const budget of ROUTE_BUDGETS) {
      expect(budget.serverMs).toBeGreaterThan(0);
      expect(budget.serverMs).toBeLessThanOrEqual(4000); // never slower than the 8s statement timeout allows twice over
      expect(budget.lcpMs).toBeLessThanOrEqual(3000); // Core Web Vitals "good" boundary is 2500; 3000 is the hard ceiling
      expect(budget.cls).toBeLessThanOrEqual(0.1);
      expect(budget.inpMs).toBeLessThanOrEqual(200);
      expect(budget.bundleKb).toBeLessThanOrEqual(220);
    }
  });

  it("resolves a budget by route and returns null for an unknown route", () => {
    expect(budgetForRoute("/")?.serverMs).toBe(2500);
    expect(budgetForRoute("/nope")).toBeNull();
  });

  it("treats a set ODDSPADI_PERF_WAIVER as an explicit waiver", () => {
    expect(performanceWaived({})).toBe(false);
    expect(performanceWaived({ [WAIVER_ENV]: "SEV1-hotfix" })).toBe(true);
  });
});

describe("the load test fails the build on a p95 budget miss unless waived", () => {
  const source = read("scripts/load-test-public-reads.mjs");
  it("sets a non-zero exit code on a budget miss", () => {
    expect(source).toMatch(/process\.exitCode\s*=\s*1/);
    expect(source).toContain("ODDSPADI_PERF_WAIVER");
  });
});
