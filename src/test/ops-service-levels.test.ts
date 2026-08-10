import { describe, expect, it } from "vitest";
import {
  SLA_POLICY,
  slaDueAt,
  classifyCaseSla,
  OPS_ANALYST_KPIS,
  COMMUNITY_MANAGER_KPIS,
  OPS_KPIS,
  type CaseSlaInput
} from "@/lib/ops/serviceLevels";

const OPENED = new Date("2026-08-09T10:00:00.000Z");

describe("SLA policy ordering", () => {
  it("makes critical tighter than warning tighter than info within a workspace", () => {
    for (const ws of ["market_ops", "community"] as const) {
      expect(SLA_POLICY[ws].critical.resolveMins).toBeLessThan(SLA_POLICY[ws].warning.resolveMins);
      expect(SLA_POLICY[ws].warning.resolveMins).toBeLessThan(SLA_POLICY[ws].info.resolveMins);
    }
  });

  it("resolves market-ops faster than community at equal severity", () => {
    for (const sev of ["critical", "warning", "info"] as const) {
      expect(SLA_POLICY.market_ops[sev].resolveMins).toBeLessThan(SLA_POLICY.community[sev].resolveMins);
    }
  });

  it("gives a critical case an earlier due_at than a warning opened at the same time", () => {
    const crit = slaDueAt("market_ops", "critical", OPENED).getTime();
    const warn = slaDueAt("market_ops", "warning", OPENED).getTime();
    expect(crit).toBeLessThan(warn);
  });
});

describe("classifyCaseSla", () => {
  const base: CaseSlaInput = {
    workspace: "market_ops",
    severity: "warning", // respond 30m, resolve 240m
    openedAt: OPENED.toISOString(),
    dueAt: slaDueAt("market_ops", "warning", OPENED).toISOString(),
    resolvedAt: null
  };

  it("is on_track early, due_soon past the response window, breached past the deadline", () => {
    expect(classifyCaseSla(base, new Date("2026-08-09T10:05:00.000Z"))).toBe("on_track"); // +5m
    expect(classifyCaseSla(base, new Date("2026-08-09T10:45:00.000Z"))).toBe("due_soon"); // +45m (past 30m respond)
    expect(classifyCaseSla(base, new Date("2026-08-09T14:30:00.000Z"))).toBe("breached"); // +270m (past 240m)
  });

  it("judges a resolved case on whether it beat its deadline, never re-breaching it", () => {
    const inSla = { ...base, resolvedAt: "2026-08-09T12:00:00.000Z" }; // +120m < 240m
    const late = { ...base, resolvedAt: "2026-08-09T15:00:00.000Z" }; // +300m > 240m
    // Long after the deadline, a resolved case is still classified by its resolution, not "breached".
    const wayLater = new Date("2026-08-10T00:00:00.000Z");
    expect(classifyCaseSla(inSla, wayLater)).toBe("resolved_in_sla");
    expect(classifyCaseSla(late, wayLater)).toBe("resolved_late");
  });

  it("never breaches a case that has no deadline", () => {
    const noDeadline = { ...base, dueAt: null };
    expect(classifyCaseSla(noDeadline, new Date("2027-01-01T00:00:00.000Z"))).toBe("on_track");
  });
});

describe("KPI sets", () => {
  it("never measures the operation on prediction win rate", () => {
    for (const kpi of OPS_KPIS) {
      expect(kpi.id).not.toMatch(/win|hit_?rate|roi|yield|brier/i);
      expect(kpi.name).not.toMatch(/win rate|hit rate|roi|yield/i);
    }
  });

  it("gives direct-database-edits and unsupported-claim-rate a hard target of zero", () => {
    const byId = Object.fromEntries(OPS_ANALYST_KPIS.map((k) => [k.id, k]));
    expect(byId.direct_database_edits.target).toBe(0);
    expect(byId.unsupported_claim_rate.target).toBe(0);
    expect(byId.direct_database_edits.direction).toBe("lower_is_better");
  });

  it("has distinct, non-empty ids across both role sets", () => {
    const ids = OPS_KPIS.map((k) => k.id);
    expect(ids.length).toBe(new Set(ids).size);
    expect(OPS_ANALYST_KPIS.length).toBeGreaterThanOrEqual(4);
    expect(COMMUNITY_MANAGER_KPIS.length).toBeGreaterThanOrEqual(4);
  });
});
