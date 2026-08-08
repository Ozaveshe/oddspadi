import { describe, expect, it, vi } from "vitest";
import {
  isInsideClosingWindow,
  MAX_TARGETS_PER_RUN,
  planClosingWindowRefresh,
  REFRESH_LEAD_MINUTES
} from "@/lib/closing/closingWindowRefresh";

type Row = Record<string, unknown>;

const NOW = new Date("2026-08-08T12:00:00.000Z");
const inMinutes = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

function stubClient(publications: Row[], error: { message: string } | null = null) {
  return {
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "gt", "lte", "order"]) chain[method] = vi.fn(() => chain);
      chain.limit = vi.fn(async () => ({ data: publications, error }));
      return chain;
    })
  } as never;
}

function publication(overrides: Row = {}): Row {
  return {
    fixture_id: "fix-1",
    fixture_external_id: "ext-1",
    sport: "football",
    kickoff_at: inMinutes(20),
    ...overrides
  };
}

describe("planning the closing-window refresh", () => {
  it("targets a fixture approaching kickoff with a published claim", async () => {
    const plan = await planClosingWindowRefresh({ now: NOW, client: stubClient([publication()]) });
    expect(plan.status).toBe("ready");
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]).toMatchObject({ fixtureId: "fix-1", minutesToKickoff: 20, publishedClaims: 1 });
    expect(plan.estimatedProviderCalls).toBe(1);
  });

  it("counts one provider call per fixture, not per claim", async () => {
    // The call fetches the fixture's whole odds board; three claims on one
    // fixture is still one request.
    const plan = await planClosingWindowRefresh({
      now: NOW,
      client: stubClient([publication(), publication(), publication()])
    });
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]!.publishedClaims).toBe(3);
    expect(plan.estimatedProviderCalls).toBe(1);
  });

  it("orders by soonest kickoff, because that window is about to shut", async () => {
    const plan = await planClosingWindowRefresh({
      now: NOW,
      client: stubClient([
        publication({ fixture_id: "later", kickoff_at: inMinutes(30) }),
        publication({ fixture_id: "sooner", kickoff_at: inMinutes(5) })
      ])
    });
    expect(plan.targets.map((target) => target.fixtureId)).toEqual(["sooner", "later"]);
  });

  it("is empty when nothing is approaching kickoff", async () => {
    const plan = await planClosingWindowRefresh({ now: NOW, client: stubClient([]) });
    expect(plan.status).toBe("empty");
    expect(plan.estimatedProviderCalls).toBe(0);
  });

  it("skips a fixture with no resolvable identity rather than polling nothing", async () => {
    const plan = await planClosingWindowRefresh({
      now: NOW,
      client: stubClient([publication({ fixture_id: null })])
    });
    expect(plan.targets).toHaveLength(0);
  });
});

describe("quota discipline", () => {
  it("caps the run and says what it dropped", async () => {
    // A silently capped sweep reports success while leaving claims unpriced.
    const many = Array.from({ length: MAX_TARGETS_PER_RUN + 5 }, (_, index) =>
      publication({ fixture_id: `fix-${index}`, kickoff_at: inMinutes(index + 1) })
    );
    const plan = await planClosingWindowRefresh({ now: NOW, client: stubClient(many) });
    expect(plan.targets).toHaveLength(MAX_TARGETS_PER_RUN);
    expect(plan.errors[0]).toContain("5 fixture(s)");
    expect(plan.errors[0]).toContain("insufficient_sources");
  });

  it("keeps the soonest kickoffs when it caps", async () => {
    const many = Array.from({ length: 50 }, (_, index) =>
      publication({ fixture_id: `fix-${index}`, kickoff_at: inMinutes(50 - index) })
    );
    const plan = await planClosingWindowRefresh({ now: NOW, client: stubClient(many), maxTargets: 3 });
    expect(plan.targets.map((target) => target.minutesToKickoff)).toEqual([1, 2, 3]);
  });

  it("reports a failed read as unavailable rather than an empty plan", async () => {
    const plan = await planClosingWindowRefresh({
      now: NOW,
      client: stubClient([], { message: "statement timeout" })
    });
    expect(plan.status).toBe("unavailable");
    expect(plan.targets).toHaveLength(0);
  });

  it("is unavailable when storage is not configured", async () => {
    expect((await planClosingWindowRefresh({ now: NOW, client: null })).status).toBe("unavailable");
  });
});

describe("the window the refresh and the capture must agree on", () => {
  const kickoff = "2026-08-08T19:00:00.000Z";
  const before = (minutes: number) => new Date(new Date(kickoff).getTime() - minutes * 60_000).toISOString();

  it("accepts a quote inside the window", () => {
    expect(isInsideClosingWindow(kickoff, before(10))).toBe(true);
    expect(isInsideClosingWindow(kickoff, before(90))).toBe(true);
  });

  it("refuses a quote outside it, on either side", () => {
    expect(isInsideClosingWindow(kickoff, before(91))).toBe(false);
    expect(isInsideClosingWindow(kickoff, before(-1))).toBe(false);
  });

  it("keeps the refresh lead inside the capture window", () => {
    // If the refresh reached further out than the capture accepts, every call
    // it made at that distance would buy a quote the capture then refuses.
    expect(REFRESH_LEAD_MINUTES).toBeLessThanOrEqual(90);
  });
});
