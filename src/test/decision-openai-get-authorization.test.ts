import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const buildDecisionLaunchContextMock = vi.hoisted(() => vi.fn());
const runDecisionFinalAnswerAIReviewMock = vi.hoisted(() => vi.fn());
const buildDecisionAICouncilMock = vi.hoisted(() => vi.fn());
const runOpenAIDecisionCouncilReviewMock = vi.hoisted(() => vi.fn());
const runDecisionEngineSelfTestMock = vi.hoisted(() => vi.fn());
const runFootballProviderLiveAIReviewReceiptMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sports/prediction/decisionLaunchContext", () => ({
  buildDecisionLaunchContext: buildDecisionLaunchContextMock
}));

vi.mock("@/lib/sports/prediction/decisionFinalAnswerAIReview", () => ({
  runDecisionFinalAnswerAIReview: runDecisionFinalAnswerAIReviewMock
}));

vi.mock("@/lib/sports/prediction/decisionAICouncil", () => ({
  buildDecisionAICouncil: buildDecisionAICouncilMock,
  runOpenAIDecisionCouncilReview: runOpenAIDecisionCouncilReviewMock
}));

vi.mock("@/lib/sports/prediction/decisionReadiness", () => ({
  runDecisionEngineSelfTest: runDecisionEngineSelfTestMock,
  verifyDecisionEngineReadiness: vi.fn()
}));

vi.mock("@/lib/sports/training/footballProviderLiveAIReviewReceipt", () => ({
  runFootballProviderLiveAIReviewReceipt: runFootballProviderLiveAIReviewReceiptMock
}));

import { GET as getFinalAnswerReview } from "@/app/api/sports/decision/final-answer-ai-review/route";
import { GET as getCouncil } from "@/app/api/sports/decision/ai-council/route";
import { GET as getDeliberation } from "@/app/api/sports/decision/ai-deliberation/route";
import { GET as getSelfTest } from "@/app/api/sports/decision/self-test/route";
import { GET as getLiveProviderReview } from "@/app/api/sports/decision/training/football-provider-live-ai-review/route";

async function json(response: Response) {
  return response.json() as Promise<{ success: boolean; data?: unknown; error?: string }>;
}

describe("decision OpenAI GET authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ODDSPADI_ADMIN_TOKEN = "test-admin-token";
    buildDecisionLaunchContextMock.mockResolvedValue({
      finalAnswerAIReview: { status: "preview" },
      finalAnswerContract: {},
      changeMindLedger: {},
      trustFirewall: {},
      portfolioRisk: {},
      openAiKeyDiagnostic: {}
    });
  });

  afterEach(() => {
    delete process.env.ODDSPADI_ADMIN_TOKEN;
  });

  it("keeps final-answer diagnostics public without running OpenAI", async () => {
    const response = await getFinalAnswerReview(
      new Request("https://oddspadi.test/api/sports/decision/final-answer-ai-review?date=2026-07-10&sport=football")
    );

    expect(response.status).toBe(200);
    expect((await json(response)).success).toBe(true);
    expect(runDecisionFinalAnswerAIReviewMock).not.toHaveBeenCalled();
  });

  it("rejects anonymous direct and wrapper live-review requests before execution", async () => {
    const [councilResponse, deliberationResponse] = await Promise.all([
      getCouncil(new Request("https://oddspadi.test/api/sports/decision/ai-council?date=2026-07-10&sport=football&review=1")),
      getDeliberation(new Request("https://oddspadi.test/api/sports/decision/ai-deliberation?date=2026-07-10&sport=football&run=1"))
    ]);

    expect(councilResponse.status).toBe(401);
    expect(deliberationResponse.status).toBe(401);
    expect(runOpenAIDecisionCouncilReviewMock).not.toHaveBeenCalled();
  });

  it("rejects anonymous self-test enhancement before it can invoke OpenAI", async () => {
    const response = await getSelfTest(new Request("https://oddspadi.test/api/sports/decision/self-test?enhance=1"));

    expect(response.status).toBe(401);
    expect(runDecisionEngineSelfTestMock).not.toHaveBeenCalled();
  });

  it("rejects anonymous live-provider OpenAI review requests", async () => {
    const response = await getLiveProviderReview(new Request("https://oddspadi.test/api/sports/decision/training/football-provider-live-ai-review?run=1"));

    expect(response.status).toBe(401);
    expect(runFootballProviderLiveAIReviewReceiptMock).not.toHaveBeenCalled();
  });
});
