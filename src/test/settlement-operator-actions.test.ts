import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { markCloseUnavailable, resolveException, settleByRule, verifyResultManually } from "@/lib/settlement/operatorActions";

type Row = Record<string, unknown>;

function stubClient({
  results = [],
  closes = [],
  update = vi.fn().mockResolvedValue({ error: null }),
  insert = vi.fn(),
  log = vi.fn().mockResolvedValue({ error: null })
}: {
  results?: Row[];
  closes?: Row[];
  update?: ReturnType<typeof vi.fn>;
  insert?: ReturnType<typeof vi.fn>;
  log?: ReturnType<typeof vi.fn>;
} = {}) {
  const insertChain = insert.getMockName() === "vi.fn()" || !insert.mock ? insert : insert;
  return {
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order"]) chain[method] = vi.fn(() => chain);
      chain.limit = vi.fn(async () => ({
        data: table === "op_fixture_results" ? results : closes,
        error: null
      }));
      chain.update = vi.fn(() => ({ eq: update }));
      chain.insert =
        table === "op_settlement_operator_actions"
          ? log
          : vi.fn(() => {
              insertChain();
              return { select: vi.fn(() => ({ limit: vi.fn(async () => ({ data: [{ id: "new-close" }], error: null })) })) };
            });
      return chain;
    })
  } as never;
}

const CONTEXT = { actor: "analyst-a" };

describe("manual verification", () => {
  it("refuses without stated evidence", async () => {
    const result = await verifyResultManually(stubClient(), CONTEXT, { fixtureId: "fix-1", evidence: "ok" });
    expect(result.status).toBe("rejected");
    expect(result.status === "rejected" && result.reason).toContain("evidence");
  });

  it("refuses when no canonical result exists", async () => {
    const result = await verifyResultManually(stubClient({ results: [] }), CONTEXT, {
      fixtureId: "fix-1",
      evidence: "Checked the league's official match report."
    });
    expect(result.status).toBe("rejected");
  });

  it("refuses to re-verify an already verified result", async () => {
    const result = await verifyResultManually(
      stubClient({ results: [{ id: "res-1", verification_state: "verified" }] }),
      CONTEXT,
      { fixtureId: "fix-1", evidence: "Checked the league's official match report." }
    );
    expect(result.status).toBe("rejected");
  });

  it("verifies a manual_review result and records who and why", async () => {
    const log = vi.fn().mockResolvedValue({ error: null });
    const result = await verifyResultManually(
      stubClient({ results: [{ id: "res-1", verification_state: "manual_review" }], log }),
      CONTEXT,
      { fixtureId: "fix-1", evidence: "Checked the league's official match report." }
    );
    expect(result.status).toBe("ok");
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "analyst-a", action: "verify_result", evidence: expect.stringContaining("match report") })
    );
  });
});

describe("settling by rule", () => {
  it("refuses a market key that is not canonical, and says which are", async () => {
    const result = await settleByRule(stubClient(), CONTEXT, {
      publicationId: "pub-1",
      marketKey: "football.corners.regulation",
      evidence: "Operator reviewed the match report."
    });
    expect(result.status).toBe("rejected");
    expect(result.status === "rejected" && result.reason).toContain("football.1x2.regulation");
  });

  it("refuses without stated evidence", async () => {
    const result = await settleByRule(stubClient(), CONTEXT, {
      publicationId: "pub-1",
      marketKey: "football.1x2.regulation",
      evidence: ""
    });
    expect(result.status).toBe("rejected");
  });

  it("records the rule version and basis it settled under", async () => {
    const log = vi.fn().mockResolvedValue({ error: null });
    const result = await settleByRule(stubClient({ log }), CONTEXT, {
      publicationId: "pub-1",
      marketKey: "football.1x2.regulation",
      evidence: "Provider confirmed the normal-time score by email."
    });
    expect(result.status).toBe("ok");
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ basis: "regulation", ruleVersion: "2026-08-07.1" }) })
    );
  });
});

describe("marking a close unavailable", () => {
  it("refuses without a reason", async () => {
    const result = await markCloseUnavailable(stubClient(), CONTEXT, { publicationId: "pub-1", reason: "n/a" });
    expect(result.status).toBe("rejected");
  });

  it("refuses when no capture row exists", async () => {
    const result = await markCloseUnavailable(stubClient({ closes: [] }), CONTEXT, {
      publicationId: "pub-1",
      reason: "The book pulled the market before kickoff."
    });
    expect(result.status).toBe("rejected");
  });

  it("writes a status with a reason and never a zero", async () => {
    let written: Row | null = null;
    const client = {
      from: vi.fn((table: string) => {
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "eq", "order"]) chain[method] = vi.fn(() => chain);
        chain.limit = vi.fn(async () => ({
          data: table === "op_closing_prices"
            ? [{ id: "c-1", revision: 1, kickoff_at: "2026-08-01T18:00:00.000Z", market: "match_winner", selection: "home", market_line: null, fixture_id: "fix-1" }]
            : [],
          error: null
        }));
        chain.update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
        chain.insert = vi.fn((row: Row) => {
          if (table === "op_closing_prices") written = row;
          return { select: vi.fn(() => ({ limit: vi.fn(async () => ({ data: [{ id: "c-2" }], error: null })) })) };
        });
        return chain;
      })
    } as never;

    const result = await markCloseUnavailable(client, CONTEXT, {
      publicationId: "pub-1",
      reason: "The book pulled the market before kickoff; no consensus existed."
    });
    expect(result.status).toBe("ok");
    expect(written).not.toBeNull();
    expect(written!.capture_status).toBe("operator_unavailable");
    expect(written!.closing_odds).toBeNull();
    expect(written!.source_count).toBe(0);
    expect(written!.missing_reason).toContain("no consensus");
  });
});

describe("resolving an exception", () => {
  it("requires a resolution to resolve or dismiss", async () => {
    for (const state of ["resolved", "dismissed"] as const) {
      const result = await resolveException(stubClient(), CONTEXT, { exceptionId: "e-1", state, resolution: "" });
      expect(result.status).toBe("rejected");
    }
  });

  it("allows acknowledging without one, because it is still open work", async () => {
    const result = await resolveException(stubClient(), CONTEXT, {
      exceptionId: "e-1",
      state: "acknowledged",
      resolution: ""
    });
    expect(result.status).toBe("ok");
  });
});

describe("the surface cannot rewrite a published claim", () => {
  it("has no operator path that writes op_publications or its claim columns", async () => {
    const source = readFileSync("src/lib/settlement/operatorActions.ts", "utf8");
    expect(source).not.toContain('from("op_publications")');
    expect(source).not.toMatch(/odds_at_publication\s*:/);
    expect(source).not.toMatch(/model_probability\s*:/);
    expect(source).not.toMatch(/published_at\s*:/);
  });

  it("exposes no action that accepts an outcome", async () => {
    // "settle this as won" must not be a shape the API has.
    const source = readFileSync("src/lib/settlement/operatorActions.ts", "utf8");
    for (const outcome of ["won", "lost", "half_won", "half_lost"]) {
      expect(source).not.toMatch(new RegExp(`outcome[^\\n]*["']${outcome}["']`));
    }
  });

  it("guards every admin route with the shared token", () => {
    const root = "src/app/api/admin";
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (entry === "route.ts") routes.push(path);
      }
    };
    walk(root);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const source = readFileSync(route, "utf8");
      expect(source, `${route} must check authorization`).toContain("isCronAuthorized");
      expect(source, `${route} must not write op_publications`).not.toContain('from("op_publications")');
    }
  });
});
