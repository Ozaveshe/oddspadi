import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runDecisionAutonomousCycleMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sports/prediction/decisionAutonomousCycle", () => ({
  runDecisionAutonomousCycle: runDecisionAutonomousCycleMock
}));

import { GET, POST } from "@/app/api/sports/decision/autonomous-cycle/route";

describe("autonomous decision cycle route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ODDSPADI_ADMIN_TOKEN = "test-admin-token";
    runDecisionAutonomousCycleMock.mockResolvedValue({ status: "completed", mode: "autonomous-decision-cycle" });
  });

  afterEach(() => {
    delete process.env.ODDSPADI_ADMIN_TOKEN;
  });

  it("keeps GET in preview mode", async () => {
    const response = await GET(new Request("http://127.0.0.1:3025/api/sports/decision/autonomous-cycle?date=2026-08-21&limit=4"));

    expect(response.status).toBe(200);
    expect(runDecisionAutonomousCycleMock).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2026-08-21", runRequested: false, runAi: false, persist: false, fixtureLimit: 4 })
    );
  });

  it("rejects unauthenticated POST execution", async () => {
    const response = await POST(
      new Request("http://127.0.0.1:3025/api/sports/decision/autonomous-cycle?date=2026-08-21", { method: "POST" })
    );

    expect(response.status).toBe(401);
    expect(runDecisionAutonomousCycleMock).not.toHaveBeenCalled();
  });

  it("runs bounded AI and persistence through authenticated POST", async () => {
    const response = await POST(
      new Request(
        "http://127.0.0.1:3025/api/sports/decision/autonomous-cycle?date=2026-08-21&limit=6&aiLimit=1&runAi=1&persist=1",
        { method: "POST", headers: { "x-oddspadi-admin-token": "test-admin-token" } }
      )
    );

    expect(response.status).toBe(200);
    expect(runDecisionAutonomousCycleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        date: "2026-08-21",
        sport: "football",
        runRequested: true,
        adminAuthorized: true,
        fixtureLimit: 6,
        aiReviewLimit: 1,
        runAi: true,
        persist: true
      })
    );
  });
});
