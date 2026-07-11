import { beforeEach, describe, expect, it, vi } from "vitest";

const getMatchPredictionMock = vi.hoisted(() => vi.fn());
const persistDecisionRunMock = vi.hoisted(() => vi.fn());
const runDecisionEnhancementWithOpenAIMock = vi.hoisted(() => vi.fn());
const runOpenAIDecisionAgentReviewMock = vi.hoisted(() => vi.fn());
const runDecisionEngineSelfTestMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sports/service", () => ({
  getMatchPrediction: getMatchPredictionMock,
  isSupportedSport: () => true,
  todayIsoDate: () => "2026-07-09"
}));

vi.mock("@/lib/sports/prediction/decisionPersistence", () => ({
  persistDecisionRun: persistDecisionRunMock
}));

vi.mock("@/lib/sports/prediction/openaiDecisionEnhancer", () => ({
  runDecisionEnhancementWithOpenAI: runDecisionEnhancementWithOpenAIMock
}));

vi.mock("@/lib/sports/prediction/openaiDecisionAgent", () => ({
  runOpenAIDecisionAgentReview: runOpenAIDecisionAgentReviewMock
}));

vi.mock("@/lib/sports/prediction/decisionReadiness", () => ({
  runDecisionEngineSelfTest: runDecisionEngineSelfTestMock
}));

import { GET as getMatchDecision, POST as postMatchDecision } from "@/_archived/api-sports-decision/[matchId]/route";
import { GET as getDecisionSelfTest } from "@/_archived/api-sports-decision/self-test/route";

const decision = {
  verdict: "avoid",
  action: "avoid",
  confidence: 0.4,
  risk: "medium",
  decisionScore: 42,
  factors: []
};

const matchPredictionRow = {
  match: { id: "epl-001", sport: "football" },
  prediction: { decision }
};

function matchContext(matchId = "epl-001") {
  return { params: Promise.resolve({ matchId }) };
}

async function json(response: Response) {
  return response.json() as Promise<{ success: boolean; data: unknown; error?: string }>;
}

describe("decision persistence admin guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ODDSPADI_ADMIN_TOKEN;
    delete process.env.OPENAI_API_KEY;
    getMatchPredictionMock.mockResolvedValue(matchPredictionRow);
    persistDecisionRunMock.mockResolvedValue({
      requested: true,
      status: "stored",
      configured: true,
      table: "op_decision_runs",
      id: "decision-run-1"
    });
    runDecisionEngineSelfTestMock.mockResolvedValue({ health: "pass" });
  });

  it("keeps GET match-decision reads side-effect free", async () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "test-admin-token";

    const response = await getMatchDecision(new Request("https://oddspadi.test/api/sports/decision/epl-001?persist=1"), matchContext());
    const body = await json(response);

    expect(response.status).toBe(405);
    expect(body.success).toBe(false);
    expect(body.error).toContain("read-only");
    expect(persistDecisionRunMock).not.toHaveBeenCalled();
  });

  it("keeps match decision read-only GET open without the admin header", async () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "test-admin-token";

    const response = await getMatchDecision(new Request("https://oddspadi.test/api/sports/decision/epl-001"), matchContext());
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(getMatchPredictionMock).toHaveBeenCalledWith("epl-001");
    expect(persistDecisionRunMock).not.toHaveBeenCalled();
  });

  it("rejects decision mutations without the admin header", async () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "test-admin-token";

    const response = await postMatchDecision(
      new Request("https://oddspadi.test/api/sports/decision/epl-001", {
        method: "POST",
        body: JSON.stringify({ persist: true })
      }),
      matchContext()
    );

    expect(response.status).toBe(401);
    expect(persistDecisionRunMock).not.toHaveBeenCalled();
  });

  it("allows authenticated POST decision persistence", async () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "test-admin-token";

    const response = await postMatchDecision(
      new Request("https://oddspadi.test/api/sports/decision/epl-001", {
        method: "POST",
        headers: { "x-oddspadi-admin-token": "test-admin-token", "content-type": "application/json" },
        body: JSON.stringify({ persist: true })
      }),
      matchContext()
    );

    expect(response.status).toBe(200);
    expect(persistDecisionRunMock).toHaveBeenCalledWith({
      match: matchPredictionRow.match,
      prediction: matchPredictionRow.prediction,
      decision,
      aiAgent: expect.objectContaining({ requested: false, provider: "deterministic", status: "not-requested", review: null })
    });
  });

  it("decodes encoded provider match IDs before lookup", async () => {
    const response = await getMatchDecision(
      new Request("https://oddspadi.test/api/sports/decision/api-football%3A1557367"),
      matchContext("api-football%3A1557367")
    );

    expect(response.status).toBe(200);
    expect(getMatchPredictionMock).toHaveBeenCalledWith("api-football:1557367");
  });

  it("rejects self-test persist requests without the admin header", async () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "test-admin-token";

    const response = await getDecisionSelfTest(new Request("https://oddspadi.test/api/sports/decision/self-test?persist=1"));
    const body = await json(response);

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toContain("x-oddspadi-admin-token");
    expect(runDecisionEngineSelfTestMock).not.toHaveBeenCalled();
  });

  it("keeps self-test read-only GET open without the admin header", async () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "test-admin-token";

    const response = await getDecisionSelfTest(new Request("https://oddspadi.test/api/sports/decision/self-test?matchId=epl-001"));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(runDecisionEngineSelfTestMock).toHaveBeenCalledWith({
      matchId: "epl-001",
      enhance: false,
      persist: false
    });
  });

  it("allows self-test persist requests with the admin header", async () => {
    process.env.ODDSPADI_ADMIN_TOKEN = "test-admin-token";

    const response = await getDecisionSelfTest(
      new Request("https://oddspadi.test/api/sports/decision/self-test?matchId=epl-001&persist=1", {
        headers: { "x-oddspadi-admin-token": "test-admin-token" }
      })
    );

    expect(response.status).toBe(200);
    expect(runDecisionEngineSelfTestMock).toHaveBeenCalledWith({
      matchId: "epl-001",
      enhance: false,
      persist: true
    });
  });
});
