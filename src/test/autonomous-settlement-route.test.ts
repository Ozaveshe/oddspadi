import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runDecisionAutonomousSettlementMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sports/prediction/decisionAutonomousSettlement", () => ({
  runDecisionAutonomousSettlement: runDecisionAutonomousSettlementMock
}));

import { GET, POST } from "@/app/api/sports/decision/autonomous-settlement/route";

describe("autonomous settlement route", () => {
  beforeEach(() => {
    process.env.ODDSPADI_ADMIN_TOKEN = "admin-token";
    runDecisionAutonomousSettlementMock.mockResolvedValue({ status: "no-pending" });
  });

  afterEach(() => {
    delete process.env.ODDSPADI_ADMIN_TOKEN;
    vi.clearAllMocks();
  });

  it("keeps GET preview read-only", async () => {
    const response = await GET(new Request("http://127.0.0.1:3025/api/sports/decision/autonomous-settlement?limit=10"));
    expect(response.status).toBe(200);
    expect(runDecisionAutonomousSettlementMock).toHaveBeenCalledWith({ limit: 10, sport: "football" });
  });

  it("requires admin authorization for settlement writes", async () => {
    const response = await POST(
      new Request("http://127.0.0.1:3025/api/sports/decision/autonomous-settlement", { method: "POST" })
    );
    expect(response.status).toBe(401);
    expect(runDecisionAutonomousSettlementMock).not.toHaveBeenCalled();
  });

  it("runs an authenticated settlement cycle", async () => {
    const response = await POST(
      new Request("http://127.0.0.1:3025/api/sports/decision/autonomous-settlement?limit=25", {
        method: "POST",
        headers: { "x-oddspadi-admin-token": "admin-token" }
      })
    );
    expect(response.status).toBe(200);
    expect(runDecisionAutonomousSettlementMock).toHaveBeenCalledWith({
      runRequested: true,
      adminAuthorized: true,
      limit: 25,
      sport: "football"
    });
  });

  it("routes basketball settlement independently", async () => {
    const response = await GET(new Request("http://127.0.0.1:3025/api/sports/decision/autonomous-settlement?sport=basketball&limit=12"));
    expect(response.status).toBe(200);
    expect(runDecisionAutonomousSettlementMock).toHaveBeenCalledWith({ limit: 12, sport: "basketball" });
  });
});
